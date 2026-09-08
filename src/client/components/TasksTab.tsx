import { useState } from 'react';
import { AlertTriangle, CloudOff, Loader2, Plus, RefreshCw } from 'lucide-react';
import type { CategoryDTO, TaskDTO } from '../../shared/types';
import { groupTasks, todayInJst } from '../../shared/task-sync';
import { cn } from '../lib/cn';
import { Banner, Button, Input } from '../ui';
import type { TasksApi } from '../hooks/useTasks';
import TaskEditDialog from './TaskEditDialog';

/**
 * タスク画面。
 *
 * 期日で 5 つに仕分けて出す。**期日超過は先頭に置き、超過日数を添える**
 * （繰り越しは表示だけで、`dueDate` は書き換えない。Google 側の予定を勝手に動かさないため）。
 * 仕分けそのものは `shared/task-sync.ts` の groupTasks が持つ（テスト済み）。
 */

interface Props {
  tasks: TasksApi;
  categories: CategoryDTO[];
  onOpenIntegrations: () => void;
}

export default function TasksTab({ tasks, categories, onOpenIntegrations }: Props) {
  const [draft, setDraft] = useState('');
  const [draftDue, setDraftDue] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editing, setEditing] = useState<TaskDTO | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const today = todayInJst();
  const groups = groupTasks(tasks.tasks, today);

  const add = async () => {
    const title = draft.trim();
    if (!title || isAdding) return;
    setIsAdding(true);
    const created = await tasks.create({ title, dueDate: draftDue || null });
    if (created) {
      setDraft('');
      setDraftDue('');
    }
    setIsAdding(false);
  };

  const save = async (patch: Parameters<Parameters<typeof TaskEditDialog>[0]['onSave']>[0]) => {
    if (!editing) return;
    setIsSaving(true);
    const updated = await tasks.update(editing.id, patch);
    setIsSaving(false);
    if (updated) setEditing(null);
  };

  return (
    <div className="space-y-4">
      {tasks.error && <Banner tone="error">{tasks.error}</Banner>}

      {/* 未連携も含めた同期の状況。エラーではないので warning ではなく info で出す。 */}
      {tasks.syncNotice && (
        <Banner tone="info">
          <div className="flex flex-wrap items-center gap-2">
            <span>{tasks.syncNotice}</span>
            <button
              type="button"
              onClick={onOpenIntegrations}
              className="rounded-control px-2 py-0.5 font-semibold underline underline-offset-2"
            >
              連携設定を開く
            </button>
          </div>
        </Banner>
      )}

      <div className="rounded-card border border-line bg-surface">
        {/* 追加。まず打てる状態にしておく。 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                void add();
              }
            }}
            placeholder="やることを追加"
            aria-label="やることを追加"
            className="min-w-40 flex-1"
          />
          <Input
            type="date"
            value={draftDue}
            onChange={(event) => setDraftDue(event.target.value)}
            aria-label="期日"
            className="w-40"
          />
          <Button
            variant="primary"
            onClick={() => void add()}
            disabled={draft.trim() === ''}
            loading={isAdding}
            icon={<Plus className="h-4 w-4" aria-hidden />}
          >
            追加
          </Button>
        </div>

        <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-caption text-fg-subtle">
          <button
            type="button"
            onClick={() => void tasks.sync(true)}
            disabled={tasks.isSyncing}
            className="flex items-center gap-1.5 rounded-control px-2 py-1 transition hover:bg-row-hover hover:text-fg disabled:opacity-45"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', tasks.isSyncing && 'animate-spin')}
              aria-hidden
            />
            Google ToDo と同期
          </button>
          {tasks.syncNotice && (
            <span className="flex items-center gap-1">
              <CloudOff className="h-3.5 w-3.5" aria-hidden />
              未同期
            </span>
          )}
        </div>

        {tasks.isLoading ? (
          <p className="flex items-center justify-center gap-2 px-4 py-16 text-body text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            読み込み中…
          </p>
        ) : tasks.tasks.length === 0 ? (
          <p className="px-4 py-16 text-center text-body text-fg-muted">
            タスクはありません。上の欄から追加してください。
          </p>
        ) : (
          <div>
            {groups.overdue.length > 0 && (
              <Section
                title="期日を過ぎています"
                count={groups.overdue.length}
                tone="danger"
                icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
              >
                {groups.overdue.map(({ task, overdueDays }) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    overdueDays={overdueDays}
                    onToggle={() => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
                    onEdit={() => setEditing(task)}
                  />
                ))}
              </Section>
            )}

            <Section title="今日" count={groups.today.length}>
              {groups.today.length === 0 ? (
                <p className="px-4 py-3 text-caption text-fg-subtle">今日の期限はありません。</p>
              ) : (
                groups.today.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
                    onEdit={() => setEditing(task)}
                  />
                ))
              )}
            </Section>

            {groups.upcoming.length > 0 && (
              <Section title="これから" count={groups.upcoming.length}>
                {groups.upcoming.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
                    onEdit={() => setEditing(task)}
                  />
                ))}
              </Section>
            )}

            {groups.noDue.length > 0 && (
              <Section title="期日なし" count={groups.noDue.length}>
                {groups.noDue.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
                    onEdit={() => setEditing(task)}
                  />
                ))}
              </Section>
            )}

            {groups.completed.length > 0 && (
              <Section title="完了" count={groups.completed.length}>
                {groups.completed.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
                    onEdit={() => setEditing(task)}
                  />
                ))}
              </Section>
            )}
          </div>
        )}
      </div>

      <TaskEditDialog
        task={editing}
        categories={categories}
        isBusy={isSaving}
        onClose={() => setEditing(null)}
        onSave={(patch) => void save(patch)}
        onDelete={(task) => {
          setEditing(null);
          void tasks.remove(task);
        }}
      />
    </div>
  );
}

function Section({
  title,
  count,
  tone = 'normal',
  icon,
  children,
}: {
  title: string;
  count: number;
  tone?: 'normal' | 'danger';
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line last:border-b-0">
      <h2
        className={cn(
          'flex items-center gap-1.5 px-4 pt-3 pb-1 text-caption font-semibold tracking-wide uppercase',
          tone === 'danger' ? 'text-danger' : 'text-fg-subtle',
        )}
      >
        {icon}
        {title}
        <span className="tabular-nums">（{count}）</span>
      </h2>
      <ul>{children}</ul>
    </section>
  );
}

function TaskRow({
  task,
  overdueDays,
  onToggle,
  onEdit,
}: {
  task: TaskDTO;
  overdueDays?: number;
  onToggle: () => void;
  onEdit: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 px-4 py-2 transition hover:bg-row-hover">
      <input
        type="checkbox"
        checked={task.isCompleted}
        onChange={onToggle}
        aria-label={`${task.title} を${task.isCompleted ? '未完了に戻す' : '完了にする'}`}
        className="h-4 w-4 shrink-0 accent-accent"
      />

      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-0.5 text-left"
      >
        <span
          className={cn(
            'w-full truncate text-body',
            task.isCompleted ? 'text-fg-subtle line-through' : 'text-fg',
          )}
        >
          {task.title}
        </span>
        {(task.memo || task.categoryName) && (
          <span className="flex w-full items-center gap-2 truncate text-caption text-fg-subtle">
            {task.categoryName && (
              <span className="font-medium" style={{ color: task.categoryColor ?? undefined }}>
                {task.categoryName}
              </span>
            )}
            {task.memo && <span className="truncate">{task.memo}</span>}
          </span>
        )}
      </button>

      {overdueDays !== undefined && (
        <span className="shrink-0 rounded-control bg-danger-soft px-1.5 py-0.5 text-caption font-semibold text-danger tabular-nums">
          {overdueDays}日超過
        </span>
      )}

      {task.dueDate && overdueDays === undefined && (
        <span className="shrink-0 text-caption text-fg-subtle tabular-nums">
          {task.dueDate.slice(5).replace('-', '/')}
        </span>
      )}

      {/* まだ Google に届いていない印。同期すれば消える。 */}
      {task.syncState === 'pending' && (
        <span title="Google ToDo に未反映" aria-label="Google ToDo に未反映">
          <CloudOff className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        </span>
      )}
    </li>
  );
}
