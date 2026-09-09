import { and, eq } from 'drizzle-orm';
import { categories, notebooks } from '../../db/schema';
import {
  buildNotePaths,
  buildNotebookMarkdown,
  joinPath,
  type ExportableNotebook,
} from '../../shared/note-export';
import { planNoteSync, type DesiredNote, type SyncedNote } from '../../shared/note-sync';
import {
  deleteFile,
  ensureFolder,
  findFolder,
  moveFile,
  parentOf,
  updateText,
  uploadText,
} from './google-drive';
import { statusOf } from './google-error';
import type { Db } from './db';

/**
 * ノートを Google ドライブに .md としてミラーする。
 *
 * **差分の判断はここでやらない。** `shared/note-sync.ts` の `planNoteSync` が
 * 「何をするか」を決め、ここはそれを実行して DB に跡を残すだけ。
 * 判断をここに書くと、Drive が要るのでテストできなくなる。
 *
 * **一方通行。** Drive 側で編集された .md は読まない（次の書き出しで上書きされる）。
 */

/** ノート用のサブフォルダ名。バックアップ用フォルダの下に作る */
export const NOTES_FOLDER_NAME = 'ノート';
const MARKDOWN_MIME = 'text/markdown';

/**
 * 1 回の実行で叩く Drive の回数の上限。
 *
 * Workers の subrequest 上限（無料プランは 1 リクエストあたり 50）に収める。
 * 変わっていないノートは飛ばすので、**回を重ねれば必ず追いつく**。
 */
export const DRIVE_BUDGET = 30;

export interface NoteMirrorResult {
  created: number;
  updated: number;
  moved: number;
  deleted: number;
  /** 予算に入りきらなかった件数。0 になるまで押せば追いつく */
  remaining: number;
}

/** フォルダ id をその実行の中だけ覚える。DB には持たない（列が増える割に得が少ない） */
class FolderCache {
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly accessToken: string,
    private readonly rootId: string,
  ) {}

  /** 'A/B/C' を上から順に辿って（無ければ作って）末端の id を返す */
  async resolve(folders: readonly string[]): Promise<string> {
    let parent = this.rootId;
    let key = '';
    for (const name of folders) {
      key = key ? `${key}/${name}` : name;
      const cached = this.cache.get(key);
      if (cached) {
        parent = cached;
        continue;
      }
      parent = await ensureFolder(this.accessToken, parent, name);
      this.cache.set(key, parent);
    }
    return parent;
  }
}

export async function mirrorNotes(
  db: Db,
  userId: string,
  accessToken: string,
  backupFolderId: string,
): Promise<NoteMirrorResult> {
  const [categoryRows, noteRows] = await Promise.all([
    db.select().from(categories).where(eq(categories.userId, userId)),
    db.select().from(notebooks).where(eq(notebooks.userId, userId)),
  ]);

  const categoryName = new Map(categoryRows.map((row) => [row.id, row.name]));
  // 生きているノートだけが Drive に居るべき。ゴミ箱行きは desired に入れない。
  const alive = noteRows.filter((row) => row.deletedAt === null);

  const exportable: ExportableNotebook[] = alive.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    title: row.title,
    content: row.content,
    categoryName: categoryName.get(row.categoryId) ?? 'カテゴリなし',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  const paths = buildNotePaths(exportable);
  const byId = new Map(exportable.map((note) => [note.id, note]));
  const desired: DesiredNote[] = exportable.map((note) => ({
    id: note.id,
    path: paths.get(note.id)!,
    updatedAt: note.updatedAt,
  }));
  const synced: SyncedNote[] = noteRows.map((row) => ({
    id: row.id,
    driveFileId: row.driveFileId,
    drivePath: row.drivePath,
    driveSyncedAt: row.driveSyncedAt?.toISOString() ?? null,
  }));

  const plan = planNoteSync(desired, synced, { budget: DRIVE_BUDGET });
  const result: NoteMirrorResult = {
    created: 0,
    updated: 0,
    moved: 0,
    deleted: 0,
    remaining: plan.remaining,
  };
  if (plan.actions.length === 0) return result;

  const notesRoot = await ensureFolder(accessToken, backupFolderId, NOTES_FOLDER_NAME);
  const folders = new FolderCache(accessToken, notesRoot);

  const markdownOf = (id: string): string => {
    const note = byId.get(id)!;
    const parentTitle = note.parentId ? byId.get(note.parentId)?.title : undefined;
    return buildNotebookMarkdown(note, parentTitle);
  };

  /*
   * **1 件ごとに DB を更新する。** 途中で落ちても、成功したぶんは次回スキップされる。
   * まとめて最後に書くと、落ちたときに全部やり直しになる。
   */
  for (const action of plan.actions) {
    const path = paths.get(action.id);

    if (action.kind === 'delete') {
      await deleteFile(accessToken, action.driveFileId);
      await db
        .update(notebooks)
        .set({ driveFileId: null, drivePath: null, driveSyncedAt: null })
        .where(and(eq(notebooks.id, action.id), eq(notebooks.userId, userId)));
      result.deleted += 1;
      continue;
    }

    if (!path) continue;
    const now = new Date();
    const folderId = await folders.resolve(path.folders);

    if (action.kind === 'create') {
      const fileId = await uploadText(
        accessToken,
        folderId,
        path.fileName,
        MARKDOWN_MIME,
        markdownOf(action.id),
      );
      await db
        .update(notebooks)
        .set({ driveFileId: fileId, drivePath: joinPath(path), driveSyncedAt: now })
        .where(and(eq(notebooks.id, action.id), eq(notebooks.userId, userId)));
      result.created += 1;
      continue;
    }

    try {
      if (action.kind === 'move' || action.kind === 'move-and-update') {
        // いまどこに居るかは Drive に聞く。DB の drivePath は名前であって id ではない。
        const current = await parentOf(accessToken, action.driveFileId);
        await moveFile(accessToken, action.driveFileId, path.fileName, folderId, current);
        result.moved += 1;
      }

      if (action.kind === 'update' || action.kind === 'move-and-update') {
        await updateText(accessToken, action.driveFileId, MARKDOWN_MIME, markdownOf(action.id));
        if (action.kind === 'update') result.updated += 1;
      }
    } catch (error) {
      /*
       * **Drive 側で消されていたら作り直させる。** id を握ったままだと、
       * 以後ずっと 404 で失敗し続けて、そのノートだけ永久に書き出されなくなる。
       */
      if (statusOf(error) !== 404 && statusOf(error) !== 410) throw error;
      console.warn('[note-mirror] file is gone; will recreate next run');
      await db
        .update(notebooks)
        .set({ driveFileId: null, drivePath: null, driveSyncedAt: null })
        .where(and(eq(notebooks.id, action.id), eq(notebooks.userId, userId)));
      continue;
    }

    await db
      .update(notebooks)
      .set({ drivePath: joinPath(path), driveSyncedAt: now })
      .where(and(eq(notebooks.id, action.id), eq(notebooks.userId, userId)));
  }

  return result;
}

/**
 * 復元のあとに Drive のノートフォルダを丸ごと捨てる。
 *
 * 復元でノートは総入れ替えになり、`driveFileId` も null に戻る。古いファイルを
 * 残すと、次のミラーが新しく作るぶんと**同じ名前で二重に並ぶ**。
 * 消せなくても復元自体は成功なので、失敗はログだけにする。
 */
export async function discardNoteMirror(
  accessToken: string,
  backupFolderId: string,
): Promise<void> {
  try {
    const notesRoot = await findFolder(accessToken, backupFolderId, NOTES_FOLDER_NAME);
    if (notesRoot) await deleteFile(accessToken, notesRoot);
  } catch (error) {
    console.error('[note-mirror] failed to discard the notes folder:', error);
  }
}
