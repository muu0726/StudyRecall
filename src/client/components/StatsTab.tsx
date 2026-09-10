import { useEffect, useState, type ReactNode } from 'react';
import { CalendarClock, CalendarDays, Clock, Layers, Trophy } from 'lucide-react';
import type { StudyLogsResponse } from '../../shared/types';
import { cn } from '../lib/cn';
import type { HeatmapResponse } from '../../shared/types';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatMinutes } from '../lib/format';
import { daysUntil } from '../../shared/srs';
import Heatmap from './Heatmap';

interface Props {
  data: StudyLogsResponse;
}

export default function StatsTab({ data }: Props) {
  const { stats, logs } = data;
  const masteryPercent = Math.round(stats.quiz.masteryRate * 100);
  // 0 除算を避けつつ、最長カテゴリを 100% 幅にする
  const maxCategoryMinutes = Math.max(1, ...stats.byCategory.map((c) => c.totalMinutes));

  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  useEffect(() => {
    // ヒートマップは 365 日分と重いので、統計タブを開いたときだけ取りに行く
    api
      .getHeatmap()
      .then(setHeatmap)
      .catch(() => setHeatmap(null));
  }, []);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <SummaryCard
          icon={<Clock className="h-5 w-5" aria-hidden />}
          label="本日の学習時間"
          value={formatMinutes(stats.todayMinutes)}
          accent="bg-accent-soft text-accent-text"
        />
        <SummaryCard
          icon={<CalendarDays className="h-5 w-5" aria-hidden />}
          label="今週の学習時間"
          value={formatMinutes(stats.weekMinutes)}
          accent="bg-surface-3 text-fg-muted"
        />
      </section>

      {heatmap && <Heatmap data={heatmap} />}

      <section className="flex flex-wrap gap-3">
        <Badge
          icon={<Layers className="h-4 w-4" aria-hidden />}
          label="蓄積された問題"
          value={`${stats.quiz.total} 問`}
        />
        <Badge
          icon={<Trophy className="h-4 w-4" aria-hidden />}
          label="習得率"
          value={`${masteryPercent}%（${stats.quiz.mastered}/${stats.quiz.total}）`}
        />
        {/* 間隔反復の予定。今日やるべき量が一目で分かるようにする。 */}
        <Badge
          icon={<CalendarClock className="h-4 w-4" aria-hidden />}
          label="今日の復習"
          value={
            stats.quiz.dueNow > 0
              ? `${stats.quiz.dueNow} 問`
              : stats.quiz.nextDueAt
                ? `なし（次は ${formatDate(stats.quiz.nextDueAt)}）`
                : 'なし'
          }
          highlight={stats.quiz.dueNow > 0}
        />
      </section>

      {/*
        今月の AI 利用量。上限に近づいたときだけ色を付ける。
        **問題だけでなく用語の登録も同じ枠を食う**ので「問題生成」とは呼べない
        （→ src/worker/lib/quota.ts）。
      */}
      <p
        className={cn(
          'text-caption',
          stats.quiz.generatedThisMonth >= stats.quiz.monthlyLimit * 0.8
            ? 'text-warning'
            : 'text-fg-muted',
        )}
      >
        今月の AI 利用 {stats.quiz.generatedThisMonth} / {stats.quiz.monthlyLimit} 件
        {stats.quiz.generatedThisMonth >= stats.quiz.monthlyLimit &&
          '（上限に達しました。来月まで新しく生成できません）'}
      </p>

      {stats.quiz.dueNow === 0 && stats.quiz.nextDueAt && (
        <p className="text-caption text-fg-muted">
          次の出題は {formatDate(stats.quiz.nextDueAt)}（
          {daysUntil(stats.quiz.nextDueAt, new Date())}日後）。 間隔は正解するほど伸びます。
        </p>
      )}

      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-body font-semibold text-fg">科目別の学習時間</h2>
        {stats.byCategory.length === 0 ? (
          <p className="mt-4 text-body text-fg-muted">カテゴリがまだありません。</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {stats.byCategory.map((category) => (
              <li key={category.categoryId}>
                <div className="flex items-baseline justify-between text-body">
                  <span className="font-medium text-fg">{category.name}</span>
                  <span className="text-fg-muted tabular-nums">
                    {formatMinutes(category.totalMinutes)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(category.totalMinutes / maxCategoryMinutes) * 100}%`,
                      backgroundColor: category.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-body font-semibold text-fg">最近の学習記録</h2>
        {logs.length === 0 ? (
          <p className="mt-4 text-body text-fg-muted">まだ記録がありません。</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {logs.slice(0, 10).map((log) => (
              <li key={log.id} className="flex items-center gap-3 py-3">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: log.categoryColor }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-fg">{log.categoryName}</p>
                  {log.notes && (
                    <p className="truncate text-caption text-fg-muted">
                      {log.notes.split('\n')[0]}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-body font-semibold text-fg tabular-nums">
                    {formatMinutes(log.durationMinutes)}
                  </p>
                  <p className="text-caption text-fg-subtle">{formatDateTime(log.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <div className={cn('inline-flex rounded-control p-2', accent)}>{icon}</div>
      <p className="mt-3 text-body text-fg-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold text-fg">{value}</p>
    </div>
  );
}

function Badge({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  /** 今すぐ手を動かすべきものだけ色を付ける */
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-full border px-4 py-2',
        highlight ? 'border-blue-200 bg-accent-soft' : 'border-line bg-surface',
      )}
    >
      <span className={highlight ? 'text-accent-text' : 'text-fg-subtle'}>{icon}</span>
      <span className={cn('text-body', highlight ? 'text-accent-text' : 'text-fg-muted')}>
        {label}
      </span>
      <span className={cn('text-body font-bold', highlight ? 'text-accent-text' : 'text-fg')}>
        {value}
      </span>
    </div>
  );
}
