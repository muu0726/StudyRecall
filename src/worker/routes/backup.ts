import { Hono } from 'hono';
import { getDb, type AppEnv, type Db } from '../lib/db';
import { MAX_BYTES, MAX_ROWS, applySnapshot, collectSnapshotRows } from '../lib/backup-data';
import { buildSnapshot, backupFileName, parseSnapshot, totalRows } from '../../shared/backup';
import {
  GOOGLE_DRIVE_SCOPE,
  describeAccessFailure,
  getGoogleAccessToken,
} from '../lib/google-auth';
import {
  ensureBackupFolder,
  listBackups,
  downloadText,
  pruneBackups,
  uploadJson,
} from '../lib/google-drive';
import { describeGoogleError, statusOf } from '../lib/google-error';
import { discardNoteMirror, mirrorNotes } from '../lib/note-mirror';
import { discardGlossaryMirror, mirrorGlossary } from '../lib/glossary-mirror';
import { getSettings, saveSettings } from '../lib/user-settings';
import type {
  BackupFilesResponse,
  MirrorNotesResponse,
  RestoreBackupResponse,
  RunBackupResponse,
} from '../../shared/types';

/**
 * バックアップ。
 *
 * **Drive から切り離してある。** スナップショットの組み立てと復元は D1 だけで完結し、
 * Drive はその JSON を置く先でしかない。こうしておくと、中身が正しいかを
 * ローカル（Google 未連携）で端まで確かめられる。
 *
 * 書き込みの失敗は同期的に返す。`tasks.ts` の「D1 を先に確定させて Google は
 * best-effort」は使えない — バックアップは Drive に置けて初めて意味があるので、
 * 「200 なのにどこにも無い」を作らない。
 */

/** 自動バックアップの間隔 */
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** JSON にした結果が大きすぎないか。**切り詰めずに断る。** */
export function guardSize(json: string, rows: number): string | null {
  if (rows > MAX_ROWS) {
    return `データが多すぎてバックアップできません（${rows} 件／上限 ${MAX_ROWS} 件）。`;
  }
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > MAX_BYTES) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    const limit = Math.floor(MAX_BYTES / 1024 / 1024);
    return `バックアップが大きすぎます（${mb} MB／上限 ${limit} MB）。不要なノートを整理してください。`;
  }
  return null;
}

/**
 * 1 回ぶんのバックアップ。手動・自動・復元前の安全用で同じ処理を通す。
 * 大きすぎるときだけ `{ error }` を返し、それ以外の失敗は投げる。
 */
async function runBackup(
  db: Db,
  userId: string,
  accessToken: string,
  folderId: string | null,
): Promise<{ response: RunBackupResponse } | { error: string }> {
  const rows = await collectSnapshotRows(db, userId);
  const snapshot = buildSnapshot(rows, new Date());
  const json = JSON.stringify(snapshot);

  const tooBig = guardSize(json, totalRows(snapshot.data));
  if (tooBig) return { error: tooBig };

  const folder = await ensureBackupFolder(accessToken, folderId);
  const now = new Date();
  const file = await uploadJson(accessToken, folder.id, backupFileName(now), json);

  await saveSettings(db, userId, { driveFolderId: folder.id, driveBackupAt: now });
  // 掃除の失敗でバックアップ自体を失敗にしない（本体はもう置けている）
  await pruneBackups(accessToken, folder.id);

  return { response: { file, folder, backedUpAt: now.toISOString() } };
}

export const backupRoute = new Hono<AppEnv>()
  /**
   * いまの中身をそのまま返す。手元に保存したいときにも使える。
   *
   * **切り詰めない。** 完全に見えて欠けているバックアップが一番危ないので、
   * 上限を超えたら 413 で断る。
   */
  .get('/snapshot', async (c) => {
    const rows = await collectSnapshotRows(getDb(c.env), c.get('userId'));
    const snapshot = buildSnapshot(rows, new Date());
    const json = JSON.stringify(snapshot);

    const tooBig = guardSize(json, totalRows(snapshot.data));
    if (tooBig) return c.json({ error: tooBig }, 413);

    return new Response(json, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  })

  /**
   * バックアップを実行する。
   *
   * `auto: true` は 1 日 1 回の自動実行。**判定はサーバー側でやる**
   * （`driveBackupAt` はここにあるし、クライアントの時計を信用する理由も無い）。
   * 自動のときは失敗しても 200 で返す — 頼んでいない処理が人を驚かせない。
   */
  .post('/run', async (c) => {
    const userId = c.get('userId');
    const body = await c.req.json<{ auto?: unknown }>().catch(() => null);
    const auto = body?.auto === true;
    const db = getDb(c.env);

    const settings = await getSettings(db, userId);
    if (auto) {
      if (!settings.driveBackupEnabled) return c.json({ skipped: true, reason: 'disabled' });
      const since = settings.driveBackupAt
        ? Date.now() - settings.driveBackupAt.getTime()
        : Infinity;
      if (since < AUTO_INTERVAL_MS) return c.json({ skipped: true, reason: 'recent' });
    }

    const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_DRIVE_SCOPE]);
    if (!access.ok) {
      // 自動はエラーにしない。手動で押されたときだけ理由を返す。
      if (auto) return c.json({ skipped: true, reason: access.reason });
      return c.json({ error: describeAccessFailure(access.reason) }, 403);
    }

    try {
      const result = await runBackup(db, userId, access.accessToken, settings.driveFolderId);
      if ('error' in result) return c.json({ error: result.error }, 413);

      /*
       * ノートのミラーは**おまけ**。失敗しても JSON バックアップは成功のまま返す
       * （あちらが本体で、こちらは読むための写し）。
       */
      if (settings.driveNotesEnabled && result.response.folder) {
        try {
          await mirrorNotes(db, userId, access.accessToken, result.response.folder.id);
        } catch (mirrorError) {
          console.error('[backup] note mirror failed:', mirrorError);
        }
      }

      // 用語辞書も同じ扱い。ここに相乗りすることで 1 日 1 回の自動実行に乗る
      if (settings.driveGlossaryEnabled && result.response.folder) {
        try {
          await mirrorGlossary(db, userId, access.accessToken, result.response.folder.id);
        } catch (mirrorError) {
          console.error('[backup] glossary mirror failed:', mirrorError);
        }
      }

      const response: RunBackupResponse = result.response;
      return c.json(response);
    } catch (error) {
      console.error('[backup] run failed:', error);
      if (auto) return c.json({ skipped: true, reason: 'failed' });
      return c.json({ error: describeGoogleError(error) }, 502);
    }
  })

  /**
   * ノートを .md として Drive にミラーする。
   *
   * **一方通行。** Drive 側で編集された .md は読まず、次の書き出しで上書きする。
   * 1 回で叩く Drive の回数に上限があるので、多いときは `remaining` を返して
   * 次の実行に続ける（変わっていないものは飛ばすので必ず追いつく）。
   */
  .post('/notes', async (c) => {
    const userId = c.get('userId');
    const db = getDb(c.env);

    const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_DRIVE_SCOPE]);
    if (!access.ok) return c.json({ error: describeAccessFailure(access.reason) }, 403);

    const settings = await getSettings(db, userId);

    try {
      const folder = await ensureBackupFolder(access.accessToken, settings.driveFolderId);
      if (folder.id !== settings.driveFolderId) {
        await saveSettings(db, userId, { driveFolderId: folder.id });
      }
      const result = await mirrorNotes(db, userId, access.accessToken, folder.id);
      const response: MirrorNotesResponse = result;
      return c.json(response);
    } catch (error) {
      console.error('[backup] note mirror failed:', error);
      return c.json({ error: describeGoogleError(error) }, 502);
    }
  })

  /** フォルダの中のバックアップ一覧（新しい順） */
  .get('/files', async (c) => {
    const userId = c.get('userId');
    const db = getDb(c.env);

    const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_DRIVE_SCOPE]);
    if (!access.ok) return c.json({ error: describeAccessFailure(access.reason) }, 403);

    const settings = await getSettings(db, userId);
    if (!settings.driveFolderId) {
      const empty: BackupFilesResponse = { files: [], folder: null };
      return c.json(empty);
    }

    try {
      const folder = await ensureBackupFolder(access.accessToken, settings.driveFolderId);
      if (folder.id !== settings.driveFolderId) {
        await saveSettings(db, userId, { driveFolderId: folder.id });
      }
      const files = await listBackups(access.accessToken, folder.id);
      const response: BackupFilesResponse = { files, folder };
      return c.json(response);
    } catch (error) {
      console.error('[backup] list failed:', error);
      return c.json({ error: describeGoogleError(error) }, 502);
    }
  })

  /**
   * バックアップの内容で置き換える。**いまの中身は消える。**
   *
   * 段取りが命。**D1 に対話的トランザクションが無く atomic にできない**ので、
   *   1. 落として検証する（ここで断れば D1 は一切変わらない）
   *   2. **いまの状態を安全用にバックアップする。取れなければ復元しない**
   *   3. 置き換える
   * の順で、必ず戻れる場所を作ってから壊す。
   */
  .post('/restore', async (c) => {
    const userId = c.get('userId');
    const body = await c.req.json<{ fileId?: unknown }>().catch(() => null);
    const fileId = typeof body?.fileId === 'string' ? body.fileId : '';
    if (!fileId) return c.json({ error: '復元するバックアップを指定してください' }, 400);

    const db = getDb(c.env);
    const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_DRIVE_SCOPE]);
    if (!access.ok) return c.json({ error: describeAccessFailure(access.reason) }, 403);

    // 1. 落として検証する
    let raw: string;
    try {
      raw = await downloadText(access.accessToken, fileId);
    } catch (error) {
      console.error('[backup] download failed:', error);
      const status = statusOf(error);
      if (status === 404 || status === 410) {
        return c.json(
          { error: 'そのバックアップは見つかりませんでした。一覧を更新してください。' },
          404,
        );
      }
      return c.json({ error: describeGoogleError(error) }, 502);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return c.json({ error: 'バックアップファイルを読めませんでした。' }, 400);
    }
    const parsed = parseSnapshot(parsedJson);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    // 2. 戻れる場所を先に作る。ここが失敗したら壊さない。
    const settings = await getSettings(db, userId);
    let safetyBackup: RunBackupResponse['file'] = undefined;
    try {
      const safety = await runBackup(db, userId, access.accessToken, settings.driveFolderId);
      if ('error' in safety) return c.json({ error: safety.error }, 413);
      safetyBackup = safety.response.file;
    } catch (error) {
      console.error('[backup] safety backup failed:', error);
      return c.json(
        {
          error:
            '復元の前に、いまの状態をバックアップできませんでした。安全のため復元を中止します。',
        },
        502,
      );
    }

    // 3. 置き換える
    try {
      const counts = await applySnapshot(db, userId, parsed.value.data);

      /*
       * ノートは総入れ替えになり driveFileId も null に戻る。古い .md を残すと、
       * 次のミラーが作るぶんと**同じ名前で二重に並ぶ**ので捨てておく。
       * 消せなくても復元は成功なので、中で握りつぶしている。
       */
      if (settings.driveFolderId) {
        await discardNoteMirror(access.accessToken, settings.driveFolderId);
        /*
         * 用語辞書も同じ。覚えているファイル id は**復元前の中身**を指したままなので、
         * 消して作り直させる（消せなくても id は捨てる）。
         */
        await discardGlossaryMirror(db, userId, access.accessToken, settings.driveFolderId);
      }

      const response: RestoreBackupResponse = {
        ok: true,
        counts,
        safetyBackup: safetyBackup ?? null,
      };
      return c.json(response);
    } catch (error) {
      console.error('[backup] restore failed:', error);
      return c.json(
        {
          error: '復元の途中で失敗しました。直前に取ったバックアップから復元し直してください。',
        },
        500,
      );
    }
  });
