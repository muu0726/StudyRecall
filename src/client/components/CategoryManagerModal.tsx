import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CategoryDTO } from '../../shared/types';
import { api, asCategoryInUse } from '../lib/api';
import { useToast } from './Toast';
import ConfirmDialog from './ConfirmDialog';
import { Banner, Button, IconButton, Input, Modal } from '../ui';
import { ColorPicker, PALETTE } from './CategoryColorPicker';

interface Props {
  open: boolean;
  categories: CategoryDTO[];
  onClose: () => void;
  /** 変更を全タブへ反映させる */
  onChanged: () => void;
}

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
    <>
      <Modal open={open} title="カテゴリの管理" onClose={onClose} bodyClassName="px-0 py-0">
        {error && (
          <Banner tone="error" size="sm" className="mx-5 mt-4">
            {error}
          </Banner>
        )}

        <ul className="divide-y divide-line px-5 py-2">
          {categories.map((category) => {
            const inUse =
              category.usage.studyLogs + category.usage.notebooks + category.usage.quizzes;
            const isEditing = editingId === category.id;
            const isBusy = busyId === category.id;

            return (
              <li key={category.id} className="py-3">
                {isEditing ? (
                  <div className="space-y-2.5">
                    <Input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      aria-label="カテゴリ名"
                    />
                    <ColorPicker value={editColor} onChange={setEditColor} />
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        className="flex-1"
                        onClick={() => void handleUpdate(category.id)}
                        disabled={editName.trim() === ''}
                        loading={isBusy}
                        icon={<Check className="h-3.5 w-3.5" aria-hidden />}
                      >
                        保存
                      </Button>
                      <Button variant="ghost" onClick={() => setEditingId(null)}>
                        取消
                      </Button>
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
                      <p className="truncate text-body font-medium text-fg">{category.name}</p>
                      <p className="text-caption text-fg-subtle">
                        {inUse === 0
                          ? '未使用'
                          : `記録 ${category.usage.studyLogs} / ノート ${category.usage.notebooks} / 問題 ${category.usage.quizzes}`}
                      </p>
                    </div>
                    <IconButton
                      size="sm"
                      onClick={() => startEdit(category)}
                      aria-label={`${category.name} を編集`}
                      icon={<Pencil className="h-4 w-4" aria-hidden />}
                    />
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(category)}
                      disabled={isBusy}
                      aria-label={`${category.name} を削除`}
                      className="hover:bg-danger-soft hover:text-danger"
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

        <div className="space-y-2.5 border-t border-line px-5 py-4">
          <p className="text-body font-medium text-fg">カテゴリを追加</p>
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="例: データベース"
            aria-label="新しいカテゴリ名"
          />
          <ColorPicker value={newColor} onChange={setNewColor} />
          <Button
            variant="primary"
            fullWidth
            onClick={() => void handleCreate()}
            disabled={newName.trim() === ''}
            loading={isCreating}
            icon={<Plus className="h-4 w-4" aria-hidden />}
          >
            追加
          </Button>
        </div>
      </Modal>

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
    </>
  );
}
