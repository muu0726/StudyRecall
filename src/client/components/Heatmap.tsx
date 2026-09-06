import { useEffect, useMemo, useState } from 'react';
import { Flame } from 'lucide-react';
import type { HeatmapDay, HeatmapResponse } from '../../shared/types';
import { cn } from '../lib/cn';

/**
 * GitHub 風のコントリビューション・グリッド。
 *
 * API は常に 1 年分を返し、表示週数は画面幅で切り替える（PC=53週 / モバイル=27週）。
 * 横スクロールを出さずに収めるための割り切り。
 */

const DESKTOP_WEEKS = 53;
const MOBILE_WEEKS = 27;
const MOBILE_BREAKPOINT = 768;

/**
 * 草の濃さ。**ダークでは向きを反転させる。**
 * ライトは「薄い → 濃い青」で濃いほど学習量が多いが、暗い背景に濃い青を置くと
 * 沈んで見えなくなる。ダークは「暗い → 明るい青」にして濃淡の意味を保つ。
 */
const LEVEL_CLASS: Record<HeatmapDay['level'], string> = {
  0: 'bg-heat-0',
  1: 'bg-heat-1',
  2: 'bg-heat-2',
  3: 'bg-heat-3',
  4: 'bg-heat-4',
};

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function useWeeksToShow(): number {
  const [weeks, setWeeks] = useState(DESKTOP_WEEKS);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const apply = () => setWeeks(query.matches ? MOBILE_WEEKS : DESKTOP_WEEKS);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return weeks;
}

function formatDayLabel(day: HeatmapDay): string {
  const [, month, date] = day.date.split('-');
  const parts: string[] = [];
  if (day.minutes > 0) parts.push(`学習${day.minutes}分`);
  if (day.quizzes > 0) parts.push(`復習${day.quizzes}問`);
  return `${Number(month)}月${Number(date)}日: ${parts.length ? parts.join(' / ') : '記録なし'}`;
}

export default function Heatmap({ data }: { data: HeatmapResponse }) {
  const weeksToShow = useWeeksToShow();
  const [hovered, setHovered] = useState<HeatmapDay | null>(null);

  /**
   * 週ごとの列に畳む。列の先頭を日曜に揃えるため、先頭の欠けを null で埋める。
   */
  const { columns, monthLabels } = useMemo(() => {
    const sliced = data.days.slice(-(weeksToShow * 7));
    if (sliced.length === 0) return { columns: [] as (HeatmapDay | null)[][], monthLabels: [] };

    // 先頭の曜日ぶんだけ空セルを足す
    const firstWeekday = new Date(`${sliced[0].date}T00:00:00Z`).getUTCDay();
    const padded: (HeatmapDay | null)[] = [...Array<null>(firstWeekday).fill(null), ...sliced];

    const cols: (HeatmapDay | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
      cols.push(padded.slice(i, i + 7));
    }

    // 月が変わる列にラベルを置く
    const labels: { columnIndex: number; label: string }[] = [];
    let lastMonth = '';
    cols.forEach((column, columnIndex) => {
      const firstDay = column.find((d): d is HeatmapDay => d !== null);
      if (!firstDay) return;
      const month = firstDay.date.slice(0, 7);
      if (month !== lastMonth) {
        lastMonth = month;
        labels.push({ columnIndex, label: `${Number(firstDay.date.split('-')[1])}月` });
      }
    });

    return { columns: cols, monthLabels: labels };
  }, [data.days, weeksToShow]);

  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body font-semibold text-fg">学習の記録</h2>
        <div className="flex items-center gap-3 text-caption text-fg-muted">
          <span className="flex items-center gap-1 font-medium text-orange-600">
            <Flame className="h-3.5 w-3.5" aria-hidden />
            {data.currentStreak}日連続
          </span>
          <span>最長 {data.longestStreak}日</span>
        </div>
      </div>

      {/* ツールチップ代わりの固定表示。狭い画面でも見切れない。 */}
      <p className="mt-2 h-5 text-caption text-fg-muted">
        {hovered ? formatDayLabel(hovered) : `直近 ${weeksToShow} 週間`}
      </p>

      <div className="mt-2 flex gap-1.5">
        {/* 曜日ラベルは月・水・金だけ出す（GitHub と同じ間引き） */}
        <div className="flex shrink-0 flex-col gap-[3px] pt-[15px]">
          {WEEKDAY_LABELS.map((label, i) => (
            <span
              key={label}
              className="h-[11px] text-[9px] leading-[11px] text-fg-subtle"
              aria-hidden
            >
              {i % 2 === 1 ? label : ''}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative mb-1 h-3">
            {monthLabels.map(({ columnIndex, label }) => (
              <span
                key={`${columnIndex}-${label}`}
                className="absolute text-[9px] text-fg-subtle"
                style={{ left: `${(columnIndex / columns.length) * 100}%` }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="flex gap-[3px]">
            {columns.map((column, columnIndex) => (
              <div key={columnIndex} className="flex flex-1 flex-col gap-[3px]">
                {column.map((day, dayIndex) =>
                  day === null ? (
                    <span key={dayIndex} className="aspect-square w-full" aria-hidden />
                  ) : (
                    <button
                      key={day.date}
                      type="button"
                      title={formatDayLabel(day)}
                      aria-label={formatDayLabel(day)}
                      onMouseEnter={() => setHovered(day)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(day)}
                      onBlur={() => setHovered(null)}
                      className={cn(
                        'aspect-square w-full rounded-[2px] transition hover:ring-2 hover:ring-line-strong',
                        LEVEL_CLASS[day.level],
                      )}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-fg-subtle">
        <span>少ない</span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span key={level} className={cn('h-2.5 w-2.5 rounded-[2px]', LEVEL_CLASS[level])} />
        ))}
        <span>多い</span>
      </div>
    </section>
  );
}
