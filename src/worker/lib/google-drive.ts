import { GoogleApiError, isRetryable } from './google-error';

/**
 * Google Drive REST API の薄いラッパ。バックアップの JSON を置くためだけに使う。
 *
 * SDK は入れない（`google-tasks.ts` / `google-calendar.ts` と同じ理由）。
 * ただし**あの 2 つの `call()` はそのまま流用できない**。理由は 2 つ:
 *
 *   1. **ホストが 2 つある。** メタデータは `/drive/v3`、アップロードは `/upload/drive/v3`
 *   2. **JSON で返らない応答がある。** `?alt=media` はファイルの中身をそのまま返す
 *
 * スコープは `drive.file` だけ。**このアプリが作ったファイルしか見えない**ので、
 * 人の Drive の他のファイルを覗く力を持たない（非センシティブ扱いで審査も要らない）。
 */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1_500];

const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** アプリが作るフォルダの名前。作った後は移動も改名も自由（id で追う） */
export const BACKUP_FOLDER_NAME = 'StudyRecall バックアップ';
/** 残す世代の数。これを超えた古いものから消す */
export const MAX_BACKUPS = 10;

export interface DriveFolder {
  id: string;
  name: string;
  /** Drive で開くリンク。取れないこともある */
  url: string | null;
}

export interface DriveBackupFile {
  id: string;
  name: string;
  /** ISO */
  createdAt: string;
  size: number | null;
}

/**
 * `google-tasks.ts` の `call()` と同じ規律だが、**絶対 URL を受け取り**、
 * JSON かテキストかを選べる。期限は操作全体で 1 つ（再試行を含めて 30 秒）。
 */
async function call(
  accessToken: string,
  url: string,
  init: RequestInit = {},
  as: 'json' | 'text' | 'none' = 'json',
): Promise<unknown> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: deadline,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });

      if (!response.ok) {
        // 本文はログ用にだけ持つ。画面には describeGoogleError の文言しか出さない。
        throw new GoogleApiError(response.status, await response.text().catch(() => ''));
      }
      if (as === 'none' || response.status === 204) return null;
      return as === 'text' ? await response.text() : await response.json();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS - 1 || !isRetryable(error)) throw error;
      const wait = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      console.warn(`[google-drive] retrying in ${wait}ms (${attempt + 1}):`, error);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

function toFolder(raw: unknown): DriveFolder | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const file = raw as { id?: unknown; name?: unknown; webViewLink?: unknown; trashed?: unknown };
  if (typeof file.id !== 'string') return null;
  // ゴミ箱に入れられたフォルダは「無い」として扱う（下で作り直す）
  if (file.trashed === true) return null;
  return {
    id: file.id,
    name: typeof file.name === 'string' ? file.name : BACKUP_FOLDER_NAME,
    url: typeof file.webViewLink === 'string' ? file.webViewLink : null,
  };
}

function toBackupFile(raw: unknown): DriveBackupFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const file = raw as { id?: unknown; name?: unknown; createdTime?: unknown; size?: unknown };
  if (typeof file.id !== 'string' || typeof file.createdTime !== 'string') return null;
  return {
    id: file.id,
    name: typeof file.name === 'string' ? file.name : file.id,
    createdAt: file.createdTime,
    // size は文字列で返る（64bit を JSON の数値にしないため）
    size: typeof file.size === 'string' ? Number(file.size) : null,
  };
}

/**
 * 保存先のフォルダを用意する。
 *
 * **覚えている id が使えなければ作り直す。** ユーザーはフォルダをゴミ箱に入れられるし、
 * 完全に消すこともできる。そのたびに黙って失敗し続けるより、作り直すほうがよい
 * （移動と改名は id が変わらないのでそのまま追随する）。
 */
export async function ensureBackupFolder(
  accessToken: string,
  folderId: string | null,
): Promise<DriveFolder> {
  if (folderId) {
    try {
      const raw = await call(
        accessToken,
        `${API}/files/${encodeURIComponent(folderId)}?fields=id,name,webViewLink,trashed`,
      );
      const folder = toFolder(raw);
      if (folder) return folder;
      console.warn('[google-drive] backup folder is trashed; creating a new one');
    } catch (error) {
      // 404 は消された。それ以外（権限・通信）は本当の失敗なので投げ直す。
      if (!(error instanceof GoogleApiError) || error.status !== 404) throw error;
      console.warn('[google-drive] backup folder is gone; creating a new one');
    }
  }

  const created = await call(accessToken, `${API}/files?fields=id,name,webViewLink`, {
    method: 'POST',
    body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  const folder = toFolder(created);
  if (!folder) throw new GoogleApiError(500, 'folder create returned no id');
  return folder;
}

/**
 * JSON を 1 ファイル置く。
 *
 * multipart/related はここだけ手で組む。**境界文字列が本文に現れないこと**が
 * 成立条件なので、uuid から作る（スナップショットの中に偶然現れることはない）。
 */
export async function uploadJson(
  accessToken: string,
  folderId: string,
  name: string,
  json: string,
): Promise<DriveBackupFile> {
  const boundary = `studyrecall-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [folderId], mimeType: 'application/json' });

  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${json}\r\n` +
    `--${boundary}--`;

  const raw = await call(
    accessToken,
    `${UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime,size`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  const file = toBackupFile(raw);
  if (!file) throw new GoogleApiError(500, 'upload returned no id');
  return file;
}

/** フォルダの中のバックアップを新しい順に返す */
export async function listBackups(
  accessToken: string,
  folderId: string,
): Promise<DriveBackupFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    orderBy: 'createdTime desc',
    pageSize: '50',
    fields: 'files(id,name,createdTime,size)',
  });
  const raw = (await call(accessToken, `${API}/files?${params}`)) as { files?: unknown[] } | null;
  const files: DriveBackupFile[] = [];
  for (const item of raw?.files ?? []) {
    const file = toBackupFile(item);
    if (file) files.push(file);
  }
  return files;
}

/** ファイルの中身をそのまま返す。**JSON として解釈しない**（壊れていても検証側で断る） */
export function downloadText(accessToken: string, fileId: string): Promise<string> {
  return call(
    accessToken,
    `${API}/files/${encodeURIComponent(fileId)}?alt=media`,
    {},
    'text',
  ) as Promise<string>;
}

/** 消す。**もう無いなら成功として飲む**（google-tasks の deleteTask と同じ前例） */
export async function deleteFile(accessToken: string, fileId: string): Promise<void> {
  try {
    await call(
      accessToken,
      `${API}/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' },
      'none',
    );
  } catch (error) {
    if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}

/**
 * 古い世代を消して `MAX_BACKUPS` 件に保つ。
 *
 * **失敗してもバックアップ自体は成功。** 本体はもう置けているので、
 * 掃除が転んだくらいで「バックアップに失敗しました」と言わない。
 */
export async function pruneBackups(accessToken: string, folderId: string): Promise<void> {
  try {
    const files = await listBackups(accessToken, folderId);
    for (const file of files.slice(MAX_BACKUPS)) {
      await deleteFile(accessToken, file.id);
    }
  } catch (error) {
    console.error('[google-drive] prune failed:', error);
  }
}
