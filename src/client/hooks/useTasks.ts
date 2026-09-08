import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateTaskRequest, TaskDTO, UpdateTaskRequest } from '../../shared/types';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { useRevalidateOnFocus } from './useRevalidateOnFocus';

/**
 * タスク一覧と Google Tasks 同期。
 *
 * **完了のトグルだけ楽観更新する。** チェックを付けてから一覧が返るまで待たせると、
 * 連続してチェックを付けたときに指が止まる。追加・編集は結果を見せる必要があるので待つ。
 *
 * 同期は「画面を開いたとき」「タブ復帰」「手動ボタン」で走る。
 * 未連携でもサーバーは 200 と warning を返すので、ここではエラー扱いしない。
 */

interface Options {
  /** タスク画面を見ているあいだだけ同期する */
  active: boolean;
}

export function useTasks({ active }: Options) {
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // 同期の多重起動を防ぐ。state だと連打の間に反映が間に合わない。
  const syncingRef = useRef(false);

  const reload = useCallback(async () => {
    try {
      const { tasks: next } = await api.listTasks();
      setTasks(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** manual=true のときだけ結果をトーストで知らせる（自動同期は黙って走る） */
  const sync = useCallback(
    async (manual = false) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      setIsSyncing(true);
      try {
        const result = await api.syncTasks();
        setTasks(result.tasks);
        setSyncNotice(result.warning ?? null);
        if (manual && !result.warning) {
          const moved = result.pulled + result.pushed;
          showToast(moved === 0 ? '最新の状態です' : `${moved} 件を同期しました`, {
            kind: 'success',
          });
        }
        if (manual && result.warning) showToast(result.warning, { kind: 'info' });
      } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : String(syncError);
        setSyncNotice(message);
        if (manual) showToast(message, { kind: 'error' });
      } finally {
        syncingRef.current = false;
        setIsSyncing(false);
      }
    },
    [showToast],
  );

  // 画面を開いたら、まず手元を出してから裏で同期する（待たせない）
  useEffect(() => {
    if (!active) return;
    void reload().then(() => sync());
    // active になった瞬間だけ走らせたい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useRevalidateOnFocus(() => sync(), { enabled: active });

  const create = useCallback(
    async (body: CreateTaskRequest) => {
      try {
        const { task, warning } = await api.createTask(body);
        setTasks((previous) => [...previous, task]);
        if (warning) showToast(warning, { kind: 'info' });
        return task;
      } catch (createError) {
        showToast(createError instanceof Error ? createError.message : String(createError), {
          kind: 'error',
        });
        return null;
      }
    },
    [showToast],
  );

  const update = useCallback(
    async (id: string, body: UpdateTaskRequest) => {
      // 完了のトグルは見た目を先に変える。失敗したら下で巻き戻す。
      const before = tasks;
      if (body.isCompleted !== undefined) {
        setTasks((previous) =>
          previous.map((task) =>
            task.id === id ? { ...task, isCompleted: body.isCompleted! } : task,
          ),
        );
      }
      try {
        const { task, warning } = await api.updateTask(id, body);
        setTasks((previous) => previous.map((item) => (item.id === id ? task : item)));
        if (warning) showToast(warning, { kind: 'info' });
        return task;
      } catch (updateError) {
        setTasks(before);
        showToast(updateError instanceof Error ? updateError.message : String(updateError), {
          kind: 'error',
        });
        return null;
      }
    },
    [tasks, showToast],
  );

  const remove = useCallback(
    async (task: TaskDTO) => {
      const before = tasks;
      setTasks((previous) => previous.filter((item) => item.id !== task.id));
      try {
        const { warning } = await api.deleteTask(task.id);
        showToast(`「${task.title}」を削除しました`, {
          kind: warning ? 'info' : 'success',
        });
        if (warning) showToast(warning, { kind: 'info' });
        return true;
      } catch (deleteError) {
        setTasks(before);
        showToast(deleteError instanceof Error ? deleteError.message : String(deleteError), {
          kind: 'error',
        });
        return false;
      }
    },
    [tasks, showToast],
  );

  return {
    tasks,
    isLoading,
    isSyncing,
    error,
    /** 同期できなかった理由。未連携もここに入る（エラーではない） */
    syncNotice,
    reload,
    sync,
    create,
    update,
    remove,
  };
}

export type TasksApi = ReturnType<typeof useTasks>;
