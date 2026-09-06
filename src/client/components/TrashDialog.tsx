import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import type { NotebookDTO } from '../../shared/types';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import ConfirmDialog from './ConfirmDialog';

/**
 * ゴミ箱。**「削除の起点」だけを並べる。**
 * 親と一緒に消した子まで出すと、同じものが何件も見えて数え間違える。
 */

interface Props {
  open: boolean;
  onClose: () => void;
  onRestore: (id: string) => Promise<unknown>;
  onPurge: (id: string) => Promise<unknown>;
}

export default function TrashDialog({ open, onClose, onRestore, onPurge }: Props) {
  const [items, setItems] = useState<NotebookDTO[]>([]);
  /** 起点ごとの「子孫を含めた件数」 */
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 完全削除の確認待ち。取り返しがつかないので必ず挟む。 */
  const [purgeTarget, setPurgeTarget] = useState<NotebookDTO | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.listTrash();
      setItems(result.notebooks);
      setTotals(result.totals);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const run = async (id: string, action: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await action();
      await load();
      setPurgeTarget(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ゴミ箱"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center dark:bg-slate-950/70"
    >
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">ゴミ箱</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-400"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {error && (
          <p
            className="mx-5 mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            role="alert"
          >
            {error}
          </p>
        )}

        {isLoading ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            読み込み中…
          </p>
        ) : items.length === 0 ? (
          <p className="px-5 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
            ゴミ箱は空です。
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 px-5 py-2 dark:divide-slate-800">
            {items.map((item) => {
              const total = totals[item.id] ?? 1;
              const isBusy = busyId === item.id;
              return (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                      {item.title}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {item.categoryName}
                      {total > 1 && ` ・ 子ノート ${total - 1} 件を含む`}
                      {item.updatedAt && ` ・ ${formatDateTime(item.updatedAt)}`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void run(item.id, () => onRestore(item.id))}
                    disabled={isBusy}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    )}
                    戻す
                  </button>

                  <button
                    type="button"
                    onClick={() => setPurgeTarget(item)}
                    disabled={isBusy}
                    aria-label={`${item.title} を完全に削除`}
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:text-slate-500 dark:hover:bg-red-950"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={purgeTarget !== null}
        title={`「${purgeTarget?.title ?? ''}」を完全に削除しますか？`}
        description={[
          ...(purgeTarget && (totals[purgeTarget.id] ?? 1) > 1
            ? [`子ノート ${(totals[purgeTarget.id] ?? 1) - 1} 件も一緒に消えます。`]
            : []),
          'この操作は取り消せません。',
        ]}
        confirmLabel="完全に削除する"
        isBusy={busyId !== null}
        onConfirm={() => {
          if (purgeTarget) void run(purgeTarget.id, () => onPurge(purgeTarget.id));
        }}
        onCancel={() => setPurgeTarget(null)}
      />
    </div>
  );
}
