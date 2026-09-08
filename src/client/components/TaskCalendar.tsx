import { useMemo } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { CalendarEventDTO, TaskDTO } from '../../shared/types';
import { WEEKDAY_LABELS, bucketByDay, buildMonthGrid } from '../../shared/calendar-view';
import { cn } from '../lib/cn';
import { Banner, IconButton } from '../ui';

/**
 * 月カレンダー。**データを持たない。もらった配列を並べるだけ。**
 *
 * 日付の判断（JST の暦日・期間の展開・グリッドの組み立て）は全部
 * `shared/calendar-view.ts` に置いてある。vitest が `environment: 'node'` で
 * DOM を持たないため、**ここに判断を書くとテストできなくなる**。
 *
 * セルの中に予定のタイトルは出さない。7 列だとセル幅は 320px の端末で 45px ほどで、
 * 日本語は 2〜3 文字で切れて読めない。点で在り処だけ示し、中身は日を選んで下の一覧で見る。
 */

interface Props {
  /** 'YYYY-MM' */
  month: string;
  /** JST の今日 'YYYY-MM-DD' */
  today: string;
  tasks: TaskDTO[];
  events: CalendarEventDTO[];
  selectedDay: string | null;
  /** Google 側の読み込み中。タスクの点は先に出すので、グリッドは空にしない */
  isLoading: boolean;
  /** Google 由来の但し書き。未連携なら呼び出し側が null にする */
  notice: string | null;
  /** false なら Google の点・凡例・但し書きを一切出さない */
  showGoogle: boolean;
  onStepMonth: (delta: number) => void;
  onGoToday: () => void;
  onSelectDay: (day: string) => void;
  onOpenIntegrations: () => void;
}

export default function TaskCalendar({
  month,
  today,
  tasks,
  events,
  selectedDay,
  isLoading,
  notice,
  showGoogle,
  onStepMonth,
  onGoToday,
  onSelectDay,
  onOpenIntegrations,
}: Props) {
  const grid = useMemo(() => buildMonthGrid(month), [month]);
  const buckets = useMemo(
    () =>
      bucketByDay(
        grid.map((d) => d.date),
        tasks,
        showGoogle ? events : [],
        today,
      ),
    [grid, tasks, events, showGoogle, today],
  );

  const [year, monthNumber] = [month.slice(0, 4), Number(month.slice(5, 7))];
  // 空の月は点が 1 つも無い。理由を書かないと壊れているように見える。
  const isMonthEmpty = [...buckets.values()].every(
    (bucket) => bucket.tasks.length === 0 && bucket.events.length === 0,
  );

  return (
    <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-1">
        <IconButton
          size="sm"
          onClick={() => onStepMonth(-1)}
          aria-label="前の月"
          icon={<ChevronLeft className="h-4 w-4" aria-hidden />}
        />
        <p className="flex items-center gap-2 text-body font-semibold text-fg tabular-nums">
          {year}年{monthNumber}月
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-subtle" aria-hidden />}
        </p>
        <IconButton
          size="sm"
          onClick={() => onStepMonth(1)}
          aria-label="次の月"
          icon={<ChevronRight className="h-4 w-4" aria-hidden />}
        />
        <button
          type="button"
          onClick={onGoToday}
          className="ml-auto rounded-control px-2 py-1 text-caption text-fg-muted transition hover:bg-row-hover hover:text-fg"
        >
          今日
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {WEEKDAY_LABELS.map((label, index) => (
          <span
            key={label}
            className={cn(
              'text-center text-caption',
              index === 0 ? 'text-danger' : index === 6 ? 'text-accent-text' : 'text-fg-subtle',
            )}
          >
            {label}
          </span>
        ))}
      </div>

      {/* gap-px と親の地色で罫線を出す。42 個のセルに枠線を描かない。 */}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-control bg-line">
        {grid.map((day) => {
          const bucket = buckets.get(day.date);
          const dayTasks = bucket?.tasks ?? [];
          const dayEvents = bucket?.events ?? [];
          const isToday = day.date === today;
          const isSelected = day.date === selectedDay;

          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelectDay(day.date)}
              aria-pressed={isSelected}
              aria-label={`${Number(day.date.slice(5, 7))}月${day.dayOfMonth}日 タスク${dayTasks.length}件 予定${dayEvents.length}件`}
              className={cn(
                'flex min-h-11 flex-col items-start gap-1 p-1 transition sm:min-h-14',
                day.inMonth ? 'bg-surface' : 'bg-surface-2',
                'hover:bg-row-hover',
                isSelected && 'ring-2 ring-accent ring-inset',
              )}
            >
              <span
                className={cn(
                  'text-caption tabular-nums',
                  isToday
                    ? 'rounded-full bg-accent-soft px-1.5 font-semibold text-accent-text'
                    : day.inMonth
                      ? 'px-1.5 text-fg'
                      : 'px-1.5 text-fg-subtle',
                )}
              >
                {day.dayOfMonth}
              </span>

              <span className="flex flex-wrap items-center gap-0.5 px-1">
                {/* タスクは四角、予定は丸。色だけだと色覚特性やグレースケールで潰れる。 */}
                {dayTasks.slice(0, 3).map((task) => (
                  <span
                    key={task.id}
                    className={cn(
                      'h-1.5 w-1.5 rounded-[2px]',
                      task.isCompleted
                        ? 'bg-fg-subtle'
                        : bucket?.hasOverdue
                          ? 'bg-danger'
                          : 'bg-accent',
                    )}
                    aria-hidden
                  />
                ))}
                {dayEvents.slice(0, 3).map((event) => (
                  <span
                    key={event.id}
                    className="h-1.5 w-1.5 rounded-full bg-success"
                    aria-hidden
                  />
                ))}
                {dayTasks.length + dayEvents.length > 6 && (
                  <span className="text-[10px] leading-none text-fg-subtle tabular-nums">
                    +{dayTasks.length + dayEvents.length - 6}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* 2 種類の点は、凡例が無いと当てずっぽうになる。 */}
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-subtle">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-[2px] bg-accent" aria-hidden />
          タスクの期日
        </span>
        {showGoogle && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            Google カレンダー
          </span>
        )}
        {isMonthEmpty && (
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            この月に予定はありません
          </span>
        )}
      </p>

      {/* 連携しているのに読めていないときだけ。未連携の人に消せない注意書きは出さない。 */}
      {showGoogle && notice && (
        <Banner tone="info" size="sm" className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span>{notice}</span>
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
    </section>
  );
}
