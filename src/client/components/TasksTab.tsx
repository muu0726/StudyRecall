import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CloudOff,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { CalendarEventDTO, CategoryDTO, TaskDTO } from '../../shared/types';
import { daysBetween, groupTasks, todayInJst } from '../../shared/task-sync';
import { WEEKDAY_LABELS } from '../../shared/calendar-view';
import { cn } from '../lib/cn';
import { Banner, Button, IconButton, Input } from '../ui';
import type { TasksApi } from '../hooks/useTasks';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import TaskCalendar from './TaskCalendar';
import TaskEditDialog from './TaskEditDialog';
import ConfirmDialog from './ConfirmDialog';

/**
 * タスク画面。
 *
 * 期日で 5 つに仕分けて出す。**期日超過は先頭に置き、超過日数を添える**
 * （繰り越しは表示だけで、`dueDate` は書き換えない。Google 側の予定を勝手に動かさないため）。
 * 仕分けそのものは `shared/task-sync.ts` の groupTasks が持つ（テスト済み）。
 *
 * 上に月カレンダーを置き、**日を選んだあいだだけ**一覧をその日ぶんに畳む。
 * 5 つの仕分けは選択を解除すればそのまま戻る（既存の見え方を壊さない）。
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
  /** 削除の確認待ち。タスクにゴミ箱は無いので、消す前に一度止める。 */
  const [deleteTarget, setDeleteTarget] = useState<TaskDTO | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  /** カレンダーで選んでいる日。null なら通常の 5 セクション表示 */
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const today = todayInJst();
  const groups = groupTasks(tasks.tasks, today);
  const calendar = useCalendarEvents({ googleLinked: tasks.googleLinked });

  // 選択の解除は Esc でもできるようにする。カレンダーから戻る動作は頻繁に使う。
  useEffect(() => {
    if (selectedDay === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedDay(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDay]);

  const selectDay = (day: string) => {
    // 同じ日をもう一度押したら解除
    const next = day === selectedDay ? null : day;
    setSelectedDay(next);
    // 追加欄の期日を埋める。**入力済みのときは触らない。**
    if (next && draftDue === '') setDraftDue(next);
  };

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

      {/*
        同期の状況。**未連携のときは出さない。** 連携する気の無い人にとっては
        消せない注意書きにしかならず、毎回画面の一番上を占める。
        連携済みで失敗しているときだけ出す（そのときは理由を知る必要がある）。
      */}
      {tasks.googleLinked && tasks.syncNotice && (
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

      <TaskCalendar
        month={calendar.month}
        today={today}
        tasks={tasks.tasks}
        events={calendar.events}
        selectedDay={selectedDay}
        isLoading={calendar.isLoading}
        notice={calendar.notice}
        showGoogle={tasks.googleLinked}
        onStepMonth={calendar.stepMonth}
        onGoToday={calendar.goToday}
        onSelectDay={selectDay}
        onOpenIntegrations={onOpenIntegrations}
      />

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

        {/* 未連携なら行ごと出さない。導線はサイドバーの「連携設定」に一本化する。 */}
        {tasks.googleLinked && (
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
        )}

        {tasks.isLoading ? (
          <p className="flex items-center justify-center gap-2 px-4 py-16 text-body text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            読み込み中…
          </p>
        ) : tasks.tasks.length === 0 ? (
          <p className="px-4 py-16 text-center text-body text-fg-muted">
            タスクはありません。上の欄から追加してください。
          </p>
        ) : selectedDay !== null ? (
          <DaySection
            day={selectedDay}
            today={today}
            tasks={tasks.tasks.filter((task) => task.dueDate === selectedDay)}
            events={calendar.events.filter(
              (event) => event.startDay <= selectedDay && selectedDay <= event.endDay,
            )}
            showGoogle={tasks.googleLinked}
            onClear={() => setSelectedDay(null)}
            onToggle={(task) => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
            onEdit={setEditing}
            onDelete={setDeleteTarget}
          />
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
                    showSyncState={tasks.googleLinked}
                    overdueDays={overdueDays}
                    onToggle={() => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
                    onEdit={() => setEditing(task)}
                    onDelete={() => setDeleteTarget(task)}
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
                    showSyncState={tasks.googleLinked}
                    onToggle={() => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
                    onEdit={() => setEditing(task)}
                    onDelete={() => setDeleteTarget(task)}
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
                    showSyncState={tasks.googleLinked}
                    onToggle={() => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
                    onEdit={() => setEditing(task)}
                    onDelete={() => setDeleteTarget(task)}
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
                    showSyncState={tasks.googleLinked}
                    onToggle={() => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
                    onEdit={() => setEditing(task)}
                    onDelete={() => setDeleteTarget(task)}
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
                    showSyncState={tasks.googleLinked}
                    onToggle={() => void tasks.update(task.id, { isCompleted: !task.isCompleted })}
                    onEdit={() => setEditing(task)}
                    onDelete={() => setDeleteTarget(task)}
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
          setDeleteTarget(task);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`「${deleteTarget?.title ?? ''}」を削除しますか？`}
        description={[
          'タスクにゴミ箱はありません。元に戻せません。',
          'Google ToDo と連携している場合は、あちらからも削除されます。',
        ]}
        isBusy={isDeleting}
        onConfirm={() => {
          if (!deleteTarget) return;
          setIsDeleting(true);
          void tasks.remove(deleteTarget).finally(() => {
            setIsDeleting(false);
            setDeleteTarget(null);
          });
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/**
 * 1 日ぶんの表示。カレンダーで日を選んでいるあいだ、5 セクションの代わりに出る。
 *
 * **同じファイルに置く。** `TaskRow` と `Section` はこのファイルのローカルで、
 * 切り出すと export する改造が要る。既存の行の見た目をそのまま使えることのほうが大事。
 */
function DaySection({
  day,
  today,
  tasks,
  events,
  showGoogle,
  onClear,
  onToggle,
  onEdit,
  onDelete,
}: {
  day: string;
  today: string;
  tasks: TaskDTO[];
  events: CalendarEventDTO[];
  showGoogle: boolean;
  onClear: () => void;
  onToggle: (task: TaskDTO) => void;
  onEdit: (task: TaskDTO) => void;
  onDelete: (task: TaskDTO) => void;
}) {
  // ローカルの日付整形に Date を通さない（端末のタイムゾーンで前日になる）
  const weekday = WEEKDAY_LABELS[new Date(`${day}T00:00:00Z`).getUTCDay()];
  const label = `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日（${weekday}）`;
  const overdueDays = -daysBetween(day, today);
  const visibleEvents = showGoogle ? events : [];

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-body font-semibold text-fg">{label}</h2>
        <span className="text-caption text-fg-subtle tabular-nums">
          タスク {tasks.length}
          {showGoogle && ` / 予定 ${visibleEvents.length}`}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto flex items-center gap-1 rounded-control px-2 py-1 text-caption text-fg-muted transition hover:bg-row-hover hover:text-fg"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          選択を解除
        </button>
      </div>

      {tasks.length === 0 && visibleEvents.length === 0 ? (
        <p className="px-4 py-12 text-center text-body text-fg-muted">
          この日のタスクも予定もありません。
        </p>
      ) : (
        <>
          {tasks.length > 0 && (
            <ul>
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showSyncState={showGoogle}
                  // 過去日の未完了だけ「N日超過」を出す。既存のチップがそのまま効く。
                  overdueDays={overdueDays > 0 && !task.isCompleted ? overdueDays : undefined}
                  onToggle={() => onToggle(task)}
                  onEdit={() => onEdit(task)}
                  onDelete={() => onDelete(task)}
                />
              ))}
            </ul>
          )}

          {visibleEvents.length > 0 && (
            <ul className="border-t border-line">
              {visibleEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-body text-fg-muted"
                >
                  <CalendarDays className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  <span className="w-12 shrink-0 text-caption text-fg-subtle tabular-nums">
                    {event.startTime ?? '終日'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg">{event.title}</span>
                  {event.htmlLink && (
                    <a
                      href={event.htmlLink}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${event.title} を Google カレンダーで開く`}
                      className="shrink-0 rounded-control p-1 text-fg-subtle transition hover:bg-row-hover hover:text-fg"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
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
  showSyncState,
  overdueDays,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: TaskDTO;
  /** 未連携のときは「未反映」に意味が無い（全行が永久に pending になる） */
  showSyncState: boolean;
  overdueDays?: number;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
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
      {showSyncState && task.syncState === 'pending' && (
        <span title="Google ToDo に未反映" aria-label="Google ToDo に未反映">
          <CloudOff className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        </span>
      )}

      {/*
        編集と削除は**ホバーで隠さず常に出す**。ツリーの行は ⋯ を隠しているが、
        あれは既に見つかっている機能の整理。ここは「できない」と思われていた側なので、
        まず見えることを優先する。タイトルのクリックでも編集は開く（近道は残す）。
      */}
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          size="sm"
          onClick={onEdit}
          aria-label={`${task.title} を編集`}
          icon={<Pencil className="h-3.5 w-3.5" aria-hidden />}
        />
        <IconButton
          size="sm"
          onClick={onDelete}
          aria-label={`${task.title} を削除`}
          icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
          className="hover:bg-danger-soft hover:text-danger"
        />
      </div>
    </li>
  );
}
