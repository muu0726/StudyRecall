import { useCallback, useRef, useState } from 'react';
import type { NotebookDTO } from '../../shared/types';
import { collectSubtreeIds } from '../../shared/note-tree';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import type { MoveIntent } from '../components/NoteTree';

/**
 * ノート一覧と選択状態をアプリ全体で共有する。
 *
 * ツリーはサイドバー、本文はノート画面と、**同じノートを 2 か所が描く**ようになったため、
 * どちらか一方に state を置くと必ずズレる。App が本フックを持ち、両方へ props で降ろす。
 */

const NEW_NOTE_TITLE = '無題のノート';

export function useNotebooks() {
  const { showToast } = useToast();
  const [notebooks, setNotebooks] = useState<NotebookDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // 削除時に「消える範囲」を最新の一覧から求めるため、クロージャに閉じ込めない
  const notebooksRef = useRef<NotebookDTO[]>(notebooks);
  notebooksRef.current = notebooks;

  const reload = useCallback(async () => {
    try {
      const result = await api.listNotebooks();
      setNotebooks(result.notebooks);
      setError(null);
      return result.notebooks;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      return notebooksRef.current;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** 作ったらそのまま開く。親を指定するとカテゴリはサーバー側で親から継承される。 */
  const create = useCallback(
    async (categoryId: string, parentId?: string) => {
      try {
        const { notebook } = await api.createNotebook({
          categoryId,
          title: NEW_NOTE_TITLE,
          content: '',
          ...(parentId ? { parentId } : {}),
        });
        await reload();
        setSelectedId(notebook.id);
        return notebook;
      } catch (createError) {
        showToast(createError instanceof Error ? createError.message : String(createError), {
          kind: 'error',
        });
        return null;
      }
    },
    [reload, showToast],
  );

  const move = useCallback(
    async (intent: MoveIntent) => {
      if (isMoving) return false;
      setIsMoving(true);
      try {
        await api.moveNotebook(intent.id, {
          parentId: intent.parentId,
          index: intent.index,
          ...(intent.categoryId ? { categoryId: intent.categoryId } : {}),
        });
        await reload();
        return true;
      } catch (moveError) {
        showToast(moveError instanceof Error ? moveError.message : String(moveError), {
          kind: 'error',
        });
        return false;
      } finally {
        setIsMoving(false);
      }
    },
    [isMoving, reload, showToast],
  );

  /** ゴミ箱から戻す。部分木ごと復元される。 */
  const restore = useCallback(
    async (id: string) => {
      try {
        const result = await api.restoreNotebook(id);
        await reload();
        setSelectedId(id);
        showToast(
          result.movedToRoot
            ? // 親がまだゴミ箱に残っていた場合。黙って場所を変えると探す羽目になる。
              `${result.restored} 件を復元しました（親がゴミ箱にあるためカテゴリ直下に置きました）`
            : `${result.restored} 件のノートを復元しました`,
          { kind: 'success' },
        );
        return result;
      } catch (restoreError) {
        showToast(restoreError instanceof Error ? restoreError.message : String(restoreError), {
          kind: 'error',
        });
        return null;
      }
    },
    [reload, showToast],
  );

  /** ゴミ箱から完全に消す。ここだけは戻せない。 */
  const purge = useCallback(
    async (id: string) => {
      try {
        const { purged } = await api.purgeNotebook(id);
        showToast(`${purged} 件を完全に削除しました`, { kind: 'success' });
        return purged;
      } catch (purgeError) {
        showToast(purgeError instanceof Error ? purgeError.message : String(purgeError), {
          kind: 'error',
        });
        return null;
      }
    },
    [showToast],
  );

  /** ゴミ箱へ移す。子孫ごと入る。開いていたノートが消えたら選択も外す。 */
  const remove = useCallback(
    async (note: NotebookDTO) => {
      if (isDeleting) return null;
      setIsDeleting(true);
      try {
        const removed = new Set(collectSubtreeIds(notebooksRef.current, note.id));
        const { deleted } = await api.deleteNotebook(note.id);
        await reload();
        setSelectedId((current) => (current && removed.has(current) ? null : current));
        // その場で戻せるようにする。ゴミ箱を開きに行かせない。
        showToast(`${deleted} 件のノートをゴミ箱に移しました`, {
          kind: 'success',
          action: { label: '元に戻す', onClick: () => void restore(note.id) },
        });
        return deleted;
      } catch (deleteError) {
        showToast(deleteError instanceof Error ? deleteError.message : String(deleteError), {
          kind: 'error',
        });
        return null;
      } finally {
        setIsDeleting(false);
      }
    },
    [isDeleting, reload, showToast, restore],
  );

  /** 保存後の差し替え。順序は sortOrder が正なので中身だけ入れ替える。 */
  const replace = useCallback((notebook: NotebookDTO) => {
    setNotebooks((previous) => previous.map((n) => (n.id === notebook.id ? notebook : n)));
  }, []);

  /** 確認ダイアログ用。自分を除いた子孫の数。 */
  const descendantCount = useCallback(
    (id: string) => collectSubtreeIds(notebooksRef.current, id).length - 1,
    [],
  );

  return {
    notebooks,
    isLoading,
    error,
    selectedId,
    select: setSelectedId,
    reload,
    create,
    move,
    remove,
    restore,
    purge,
    replace,
    descendantCount,
    isMoving,
    isDeleting,
  };
}

export type NotebooksApi = ReturnType<typeof useNotebooks>;
