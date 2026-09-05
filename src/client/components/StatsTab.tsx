import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, Clock, Layers, Trophy } from 'lucide-react';
import type { StudyLogsResponse } from '../../shared/types';
import { cn } from '../lib/cn';
import type { HeatmapResponse } from '../../shared/types';
import { api } from '../lib/api';
import { formatDateTime, formatMinutes } from '../lib/format';
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
          accent="bg-blue-50 text-blue-700"
        />
        <SummaryCard
          icon={<CalendarDays className="h-5 w-5" aria-hidden />}
          label="今週の学習時間"
          value={formatMinutes(stats.weekMinutes)}
          accent="bg-sky-50 text-sky-700"
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
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">科目別の学習時間</h2>
        {stats.byCategory.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">カテゴリがまだありません。</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {stats.byCategory.map((category) => (
              <li key={category.categoryId}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium text-slate-700">{category.name}</span>
                  <span className="text-slate-500 tabular-nums">
                    {formatMinutes(category.totalMinutes)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">最近の学習記録</h2>
        {logs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">まだ記録がありません。</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {logs.slice(0, 10).map((log) => (
              <li key={log.id} className="flex items-center gap-3 py-3">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: log.categoryColor }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{log.categoryName}</p>
                  {log.notes && (
                    <p className="truncate text-xs text-slate-500">{log.notes.split('\n')[0]}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-slate-700 tabular-nums">
                    {formatMinutes(log.durationMinutes)}
                  </p>
                  <p className="text-xs text-slate-400">{formatDateTime(log.createdAt)}</p>
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={cn('inline-flex rounded-xl p-2', accent)}>{icon}</div>
      <p className="mt-3 text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function Badge({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <span className="text-slate-400">{icon}</span>
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-bold text-slate-900">{value}</span>
    </div>
  );
}
