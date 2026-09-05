import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { CategoryDTO } from '../../shared/types';
import { api, asCategoryInUse } from '../lib/api';
import { cn } from '../lib/cn';
import { useToast } from './Toast';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  open: boolean;
  categories: CategoryDTO[];
  onClose: () => void;
  /** 変更を全タブへ反映させる */
  onChanged: () => void;
}

const PALETTE = [
  '#3b82f6',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#64748b',
];

export default function CategoryManagerModal({ open, categories, onClose, onChanged }: Props) {
  const { showToast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(PALETTE[0]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PALETTE[0]);
  /** 処理中のカテゴリ ID。連打と多重リクエストを防ぐ。 */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 削除の確認待ち。window.confirm はブラウザに抑制されると無言で失敗するため使わない。 */
  const [deleteTarget, setDeleteTarget] = useState<CategoryDTO | null>(null);

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setNewName('');
    setError(null);
  }, [open]);

  if (!open) return null;

  const startEdit = (category: CategoryDTO) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditColor(category.color);
    setError(null);
  };

  const handleUpdate = async (id: string) => {
    const name = editName.trim();
    if (!name || busyId) return;
    setBusyId(id);
    setError(null);
    try {
      await api.updateCategory(id, { name, color: editColor });
      setEditingId(null);
      onChanged();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      await api.createCategory({ name, color: newColor });
      setNewName('');
      onChanged();
      showToast(`「${name}」を追加しました`, { kind: 'success' });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (category: CategoryDTO) => {
    if (busyId) return;
    setBusyId(category.id);
    setError(null);
    try {
      await api.deleteCategory(category.id);
      setDeleteTarget(null);
      onChanged();
      showToast(`「${category.name}」を削除しました`, { kind: 'success' });
    } catch (deleteError) {
      const inUse = asCategoryInUse(deleteError);
      if (inUse) {
        // 消すと学習記録・ノート・問題まで巻き込むので拒否されている
        setError(inUse.error);
      } else {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 dark:bg-slate-950/70 p-4 sm:items-center">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">カテゴリの管理</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-lg p-1 text-slate-400 dark:text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-400"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {error && (
          <p className="mx-5 mt-4 rounded-xl bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
            {error}
          </p>
        )}

        <ul className="divide-y divide-slate-100 dark:divide-slate-800 px-5 py-2">
          {categories.map((category) => {
            const inUse =
              category.usage.studyLogs + category.usage.notebooks + category.usage.quizzes;
            const isEditing = editingId === category.id;
            const isBusy = busyId === category.id;

            return (
              <li key={category.id} className="py-3">
                {isEditing ? (
                  <div className="space-y-2.5">
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      aria-label="カテゴリ名"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
                    />
                    <ColorPicker value={editColor} onChange={setEditColor} />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleUpdate(category.id)}
                        disabled={isBusy || editName.trim() === ''}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        )}
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: category.color }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{category.name}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        {inUse === 0
                          ? '未使用'
                          : `記録 ${category.usage.studyLogs} / ノート ${category.usage.notebooks} / 問題 ${category.usage.quizzes}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(category)}
                      aria-label={`${category.name} を編集`}
                      className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(category)}
                      disabled={isBusy}
                      aria-label={`${category.name} を削除`}
                      className="rounded-lg p-1.5 text-slate-400 dark:text-slate-500 transition hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600 disabled:opacity-40"
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="space-y-2.5 border-t border-slate-100 dark:border-slate-800 px-5 py-4">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">カテゴリを追加</p>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="例: データベース"
            aria-label="新しいカテゴリ名"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          />
          <ColorPicker value={newColor} onChange={setNewColor} />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={isCreating || newName.trim() === ''}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            追加
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`「${deleteTarget?.name ?? ''}」を削除しますか？`}
        description="学習記録・ノート・問題で使われている場合は削除できません。"
        isBusy={busyId !== null}
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={`色 ${color}`}
          aria-pressed={value === color}
          className={cn(
            'h-6 w-6 rounded-full transition',
            value === color ? 'ring-2 ring-slate-900 ring-offset-2' : 'hover:scale-110',
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
