import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { NotebookDTO } from '../../shared/types';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import ConfirmDialog from './ConfirmDialog';
import { Banner, Button, IconButton, Modal } from '../ui';

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
    <>
      <Modal open={open} title="ゴミ箱" onClose={onClose} bodyClassName="px-0 py-0">
        {error && (
          <Banner tone="error" size="sm" className="mx-5 mt-4">
            {error}
          </Banner>
        )}

        {isLoading ? (
          <p className="flex items-center justify-center gap-2 py-16 text-body text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            読み込み中…
          </p>
        ) : items.length === 0 ? (
          <p className="px-5 py-16 text-center text-body text-fg-muted">ゴミ箱は空です。</p>
        ) : (
          <ul className="divide-y divide-line px-5 py-2">
            {items.map((item) => {
              const total = totals[item.id] ?? 1;
              const isBusy = busyId === item.id;
              return (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-fg">{item.title}</p>
                    <p className="text-caption text-fg-subtle">
                      {item.categoryName}
                      {total > 1 && ` ・ 子ノート ${total - 1} 件を含む`}
                      {item.updatedAt && ` ・ ${formatDateTime(item.updatedAt)}`}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    className="shrink-0"
                    onClick={() => void run(item.id, () => onRestore(item.id))}
                    loading={isBusy}
                    icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                  >
                    戻す
                  </Button>

                  <IconButton
                    size="sm"
                    icon={<Trash2 className="h-4 w-4" aria-hidden />}
                    onClick={() => setPurgeTarget(item)}
                    disabled={isBusy}
                    aria-label={`${item.title} を完全に削除`}
                    className="shrink-0 hover:bg-danger-soft hover:text-danger"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

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
    </>
  );
}
