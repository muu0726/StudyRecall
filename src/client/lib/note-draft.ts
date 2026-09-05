import type { NotebookDTO } from '../../shared/types';

/**
 * 編集中のノートを localStorage へ退避する。
 *
 * サーバー保存は debounce で遅れて走るので、その隙にタブを閉じる・リロードする・
 * 端末がスリープすると、書いた内容が消える。ここへは**入力のたびに即座に**書く
 * （通信を伴わないので毎回やってよい）。
 *
 * サーバー保存が成功した時点で退避は消す。残っている＝まだサーバーに載っていない、という意味にする。
 */

const PREFIX = 'studyrecall:note-draft:';

export interface StoredNoteDraft {
  id: string;
  title: string;
  content: string;
  categoryId: string;
  /** 退避した時点でクライアントが持っていたサーバー版の updatedAt */
  baseUpdatedAt: string | null;
  /** 退避した時刻（ISO） */
  savedAt: string;
}

function key(id: string): string {
  return `${PREFIX}${id}`;
}

export function saveDraft(draft: StoredNoteDraft): void {
  try {
    localStorage.setItem(key(draft.id), JSON.stringify(draft));
  } catch {
    // 容量超過やプライベートモードでの失敗は無視する。
    // ここで例外を投げると入力そのものが止まってしまう。
  }
}

export function readDraft(id: string): StoredNoteDraft | null {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredDraft(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(id: string): void {
  try {
    localStorage.removeItem(key(id));
  } catch {
    // 同上
  }
}

/** 壊れた値を読み込んでエディタを空にしないよう、形を実行時に確かめる */
function isStoredDraft(value: unknown): value is StoredNoteDraft {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.id === 'string' &&
    typeof d.title === 'string' &&
    typeof d.content === 'string' &&
    typeof d.categoryId === 'string' &&
    (typeof d.baseUpdatedAt === 'string' || d.baseUpdatedAt === null) &&
    typeof d.savedAt === 'string'
  );
}

export type DraftRecovery =
  /** 退避が無い、またはサーバー版と同じ内容なので復元するものが無い */
  | { kind: 'none' }
  /** 退避のほうが新しい。そのまま復元してよい */
  | { kind: 'restore'; draft: StoredNoteDraft }
  /**
   * 退避はあるが、退避した後にサーバー側も変わっている。
   * 復元はするが、保存時は競合の解決フローへ回す必要がある。
   */
  | { kind: 'restore-stale'; draft: StoredNoteDraft };

/**
 * ノートを開いたときに、退避を復元すべきかを決める。
 *
 * 判定だけを切り出してあるのは、ここが一番間違えると痛いから
 * （誤って復元すると他端末の更新を巻き戻し、復元しそこねると書いた内容が消える）。
 */
export function decideRecovery(
  draft: StoredNoteDraft | null,
  notebook: NotebookDTO,
): DraftRecovery {
  if (!draft || draft.id !== notebook.id) return { kind: 'none' };

  const sameAsServer =
    draft.title === notebook.title &&
    draft.content === notebook.content &&
    draft.categoryId === notebook.categoryId;
  // 保存が通った後の消し忘れなど。復元しても意味がない。
  if (sameAsServer) return { kind: 'none' };

  // 退避した時点のサーバー版と、いま返ってきたサーバー版が同じなら、
  // 差分は自分がまだ送れていないぶんだけ。素直に復元してよい。
  if (draft.baseUpdatedAt === notebook.updatedAt) return { kind: 'restore', draft };

  // ずれている＝退避してからサーバー側も動いた。復元はするが競合として扱う。
  return { kind: 'restore-stale', draft };
}
