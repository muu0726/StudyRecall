import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { CategoryDTO, TaskDTO } from '../../shared/types';
import { Button, Field, Input, Modal, Select, Textarea } from '../ui';

/**
 * タスク 1 件の編集。追加は一覧のインライン入力でできるので、ここは編集専用。
 *
 * 期日は `<input type="date">` の値をそのまま扱う。**Date を経由しない**ので、
 * 端末のタイムゾーンで日がずれない（`shared/task-sync.ts` と同じ方針）。
 */

interface Props {
  /** null なら閉じている */
  task: TaskDTO | null;
  categories: CategoryDTO[];
  isBusy: boolean;
  onClose: () => void;
  onSave: (patch: {
    title: string;
    memo: string | null;
    dueDate: string | null;
    categoryId: string | null;
  }) => void;
  onDelete: (task: TaskDTO) => void;
}

export default function TaskEditDialog({
  task,
  categories,
  isBusy,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  // 開いたタスクが変わるたびに読み込み直す
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setMemo(task.memo ?? '');
    setDueDate(task.dueDate ?? '');
    setCategoryId(task.categoryId ?? '');
    titleRef.current?.select();
  }, [task]);

  if (!task) return null;

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSave({
      title: trimmed,
      memo: memo.trim() || null,
      dueDate: dueDate || null,
      categoryId: categoryId || null,
    });
  };

  return (
    <Modal
      open
      title="タスクを編集"
      size="sm"
      onClose={onClose}
      closeDisabled={isBusy}
      footer={
        <>
          <Button
            variant="primary"
            className="flex-1"
            onClick={submit}
            disabled={title.trim() === ''}
            loading={isBusy}
          >
            保存
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={isBusy}>
            取消
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="やること" htmlFor="task-title">
          <Input
            id="task-title"
            ref={titleRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              // 日本語入力の変換確定の Enter で保存してしまわないようにする
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
        </Field>

        <Field label="メモ" htmlFor="task-memo" hint="Google ToDo の「詳細」に入ります">
          <Textarea
            id="task-memo"
            rows={3}
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="期日" htmlFor="task-due">
            <Input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>

          <Field label="カテゴリ" htmlFor="task-category">
            <Select
              id="task-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">なし</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <button
          type="button"
          onClick={() => onDelete(task)}
          disabled={isBusy}
          className="flex items-center gap-1.5 rounded-control px-2 py-1.5 text-caption text-fg-subtle transition hover:bg-danger-soft hover:text-danger disabled:opacity-45"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          このタスクを削除
        </button>
      </div>
    </Modal>
  );
}
