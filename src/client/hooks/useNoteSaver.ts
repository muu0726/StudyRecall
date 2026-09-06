import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotebookDTO } from '../../shared/types';
import { api, asNotebookConflict } from '../lib/api';
import { clearDraft, saveDraft } from '../lib/note-draft';

/**
 * ノートの保存を、エディタのコンポーネントより長生きする場所で預かる。
 *
 * **なぜコンポーネントの外に出すのか。**
 * タブを切り替えるとエディタはアンマウントされる。保存は 2 秒の debounce で
 * 遅れて走るので、素直に作ると「切り替えた瞬間に保留中の保存が消える」。
 * かといって cleanup で送りっぱなしにすると、`await` の後に書き戻すはずだった
 * `baseUpdatedAt`（楽観ロックのトークン）が行き場を失い、**次にそのノートを開くと
 * 古いトークンで保存して常時 409** になる。
 *
 * そこで「保留中の内容・タイマー・トークン・競合」を **ノートIDごとの Map** に置く。
 * 結果として次の 3 つが構造的に起きなくなる。
 *
 *   1. 保存の応答が別のノートの state を汚す（Map の別の値には触れない）
 *   2. 切替でサーバー保存が黙って捨てられる（タイマーがノートIDごと）
 *   3. 競合ダイアログが別のノートを上書きする（conflict も Map の中）
 *
 * localStorage への退避は入力のたびに行う（通信しないので毎回でよい）。
 * これが最終防衛線で、flush はあくまで「サーバーに載る確率を上げる」策。
 */

const AUTOSAVE_DELAY_MS = 2000;

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict';

export interface PendingSave {
  title: string;
  content: string;
  categoryId: string;
}

interface Entry {
  pending: PendingSave | null;
  timerId: ReturnType<typeof setTimeout> | null;
  inflight: boolean;
  /** 読み込んだ時点の updatedAt。楽観ロックのトークン */
  baseUpdatedAt: string | null;
  conflict: { currentContent: string } | null;
  failed: boolean;
}

function emptyEntry(): Entry {
  return {
    pending: null,
    timerId: null,
    inflight: false,
    baseUpdatedAt: null,
    conflict: null,
    failed: false,
  };
}

export interface NoteSaver {
  /** エディタを開いたときに、そのノートのロックトークンを教える */
  register: (noteId: string, baseUpdatedAt: string) => void;
  /** 入力のたび。端末へ退避し、そのノート専用のタイマーを張り直す */
  schedule: (noteId: string, pending: PendingSave) => void;
  /** 予約を今すぐ送る。切替・クローズ・画面を隠すときに使う */
  flush: (noteId?: string) => Promise<void>;
  /** 明示保存。force で競合を承知の上書き */
  saveNow: (noteId: string, options?: { force?: boolean }) => Promise<boolean>;
  /** 保存せずに保留を捨てる（削除するノート、競合でサーバー版を採ったとき） */
  cancel: (noteId: string) => void;
  statusOf: (noteId: string) => SaveStatus;
  conflictOf: (noteId: string) => { currentContent: string } | null;
  baseUpdatedAtOf: (noteId: string) => string | null;
  /** 同一セッションで書きかけがあれば取り出す（再マウント時にトーストを出さないため） */
  peek: (noteId: string) => PendingSave | null;
  /** 未保存を持つノートID */
  dirtyIds: ReadonlySet<string>;
}

interface Options {
  /** 保存が通ったときに一覧を差し替える */
  onSaved: (notebook: NotebookDTO) => void;
}

export function useNoteSaver({ onSaved }: Options): NoteSaver {
  const entries = useRef(new Map<string, Entry>());
  /** 再レンダーを起こすための写し。判断は常に entries を見る */
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [, forceRender] = useState(0);

  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const entry = useCallback((noteId: string): Entry => {
    let found = entries.current.get(noteId);
    if (!found) {
      found = emptyEntry();
      entries.current.set(noteId, found);
    }
    return found;
  }, []);

  const publish = useCallback(() => {
    const next = new Set<string>();
    for (const [id, e] of entries.current) {
      if (e.pending !== null || e.inflight) next.add(id);
    }
    setDirtyIds((previous) => {
      if (previous.size === next.size && [...next].every((id) => previous.has(id))) return previous;
      return next;
    });
    forceRender((n) => n + 1);
  }, []);

  /** 実際の送信。呼び出し時点の pending を送る */
  const send = useCallback(
    async (noteId: string, options: { force?: boolean; manual: boolean }): Promise<boolean> => {
      const e = entry(noteId);
      const pending = e.pending;
      if (!pending || e.inflight) return false;

      e.inflight = true;
      if (e.timerId !== null) {
        clearTimeout(e.timerId);
        e.timerId = null;
      }
      publish();

      try {
        const { notebook } = await api.updateNotebook(noteId, {
          title: pending.title,
          content: pending.content,
          categoryId: pending.categoryId,
          ...(options.force
            ? { force: true }
            : { expectedUpdatedAt: e.baseUpdatedAt ?? undefined }),
        });

        // 送信中にさらに打たれていたら、その分は保留に残す
        const stillPending =
          e.pending !== null &&
          (e.pending.title !== pending.title ||
            e.pending.content !== pending.content ||
            e.pending.categoryId !== pending.categoryId);

        e.baseUpdatedAt = notebook.updatedAt;
        e.conflict = null;
        e.failed = false;
        if (!stillPending) {
          e.pending = null;
          clearDraft(noteId);
        }
        onSavedRef.current(notebook);
        return true;
      } catch (error) {
        const conflict = asNotebookConflict(error);
        if (conflict) {
          // 自動保存では勝手にモーダルを開かない。入力中に割り込むと手が止まるだけ。
          e.conflict = options.manual ? { currentContent: conflict.currentContent } : null;
          e.failed = !options.manual;
          return false;
        }
        // 通信断などは端末の退避が残っているので、書いた内容は失われない
        e.failed = true;
        return false;
      } finally {
        e.inflight = false;
        publish();
      }
    },
    [entry, publish],
  );

  const sendRef = useRef(send);
  sendRef.current = send;

  const schedule = useCallback(
    (noteId: string, pending: PendingSave) => {
      const e = entry(noteId);
      e.pending = pending;
      e.failed = false;
      saveDraft({
        id: noteId,
        title: pending.title,
        content: pending.content,
        categoryId: pending.categoryId,
        baseUpdatedAt: e.baseUpdatedAt,
        savedAt: new Date().toISOString(),
      });

      if (e.timerId !== null) clearTimeout(e.timerId);
      // 競合を検知しているあいだは投げない（解決するまで 409 が返るだけ）
      if (e.conflict === null) {
        e.timerId = setTimeout(() => {
          e.timerId = null;
          void sendRef.current(noteId, { manual: false });
        }, AUTOSAVE_DELAY_MS);
      }
      publish();
    },
    [entry, publish],
  );

  const cancel = useCallback(
    (noteId: string) => {
      const e = entries.current.get(noteId);
      if (!e) return;
      if (e.timerId !== null) clearTimeout(e.timerId);
      e.timerId = null;
      e.pending = null;
      e.conflict = null;
      e.failed = false;
      clearDraft(noteId);
      publish();
    },
    [publish],
  );

  const flush = useCallback(async (noteId?: string) => {
    const ids = noteId ? [noteId] : [...entries.current.keys()];
    await Promise.all(
      ids
        .filter((id) => {
          const e = entries.current.get(id);
          return e?.pending != null && e.conflict === null;
        })
        .map((id) => sendRef.current(id, { manual: false })),
    );
  }, []);

  const saveNow = useCallback(
    (noteId: string, options?: { force?: boolean }) =>
      sendRef.current(noteId, { manual: true, force: options?.force }),
    [],
  );

  /**
   * 画面が隠れたら保留を送る。
   * **モバイルでは beforeunload がほぼ飛ばない**ので、確実に走るのはこちら。
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasPending = [...entries.current.values()].some((e) => e.pending !== null);
      if (!hasPending) return;
      void flush();
      // 端末に退避はあるが、閉じてよいか一応尋ねる
      event.preventDefault();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flush]);

  return {
    dirtyIds,
    schedule,
    flush,
    saveNow,
    cancel,
    register: useCallback(
      (noteId: string, baseUpdatedAt: string) => {
        const e = entry(noteId);
        // 保留があるあいだは、退避時点のトークンを保つ（上書きすると他端末の更新を踏み潰す）
        if (e.pending === null) e.baseUpdatedAt = baseUpdatedAt;
        else if (e.baseUpdatedAt === null) e.baseUpdatedAt = baseUpdatedAt;
      },
      [entry],
    ),
    statusOf: useCallback((noteId: string): SaveStatus => {
      const e = entries.current.get(noteId);
      if (!e) return 'saved';
      if (e.conflict !== null) return 'conflict';
      if (e.inflight) return 'saving';
      if (e.failed) return 'failed';
      return e.pending !== null ? 'dirty' : 'saved';
    }, []),
    conflictOf: useCallback((noteId: string) => entries.current.get(noteId)?.conflict ?? null, []),
    baseUpdatedAtOf: useCallback(
      (noteId: string) => entries.current.get(noteId)?.baseUpdatedAt ?? null,
      [],
    ),
    peek: useCallback((noteId: string) => entries.current.get(noteId)?.pending ?? null, []),
  };
}
