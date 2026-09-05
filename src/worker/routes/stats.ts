import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb, type AppEnv } from '../lib/db';
import { startOfTodayJst } from '../lib/time';
import type { HeatmapDay, HeatmapResponse } from '../../shared/types';

/**
 * GitHub 風コントリビューション・ヒートマップ用の日別集計。
 *
 * 集計は必ず JST の日境界で行う（Worker は UTC で動くため）。
 * SQLite の date(x, 'unixepoch', '+9 hours') で JST の YYYY-MM-DD を得る。
 * API は常に 1 年分を返し、表示期間の切り替えは描画側の責務にする。
 */

const DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 学習時間（分）から濃淡を決める。0 分は level 0。 */
function toLevel(minutes: number): HeatmapDay['level'] {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

/** JST の YYYY-MM-DD。Date は JST 当日 0:00 を指す UTC 時刻。 */
function toJstDateKey(utcDate: Date): string {
  return new Date(utcDate.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const statsRoute = new Hono<AppEnv>().get('/heatmap', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId');

  // 今日（JST）を含む 365 日分。範囲の下限を秒で渡し、index を効かせる。
  const todayStart = startOfTodayJst();
  const rangeStart = new Date(todayStart.getTime() - (DAYS - 1) * DAY_MS);
  const rangeStartSec = Math.floor(rangeStart.getTime() / 1000);

  // study_logs と quiz_questions は集計軸が違う（createdAt / lastAnsweredAt）ので
  // 別々に日別へ畳んでから、日付をキーにマージする。
  const [minuteRows, quizRows] = await Promise.all([
    db.all<{ day: string; minutes: number }>(sql`
      select date(created_at, 'unixepoch', '+9 hours') as day,
             sum(duration_minutes) as minutes
      from study_logs
      where user_id = ${userId} and created_at >= ${rangeStartSec}
      group by day
    `),
    db.all<{ day: string; quizzes: number }>(sql`
      select date(last_answered_at, 'unixepoch', '+9 hours') as day,
             count(*) as quizzes
      from quiz_questions
      where user_id = ${userId}
        and last_answered_at is not null
        and last_answered_at >= ${rangeStartSec}
      group by day
    `),
  ]);

  const minutesByDay = new Map(minuteRows.map((r) => [r.day, Number(r.minutes) || 0]));
  const quizzesByDay = new Map(quizRows.map((r) => [r.day, Number(r.quizzes) || 0]));

  // 学習が無い日も level 0 として埋める（グリッドに穴を作らない）
  const days: HeatmapDay[] = [];
  let totalMinutes = 0;
  let totalQuizzes = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let runningStreak = 0;

  for (let i = DAYS - 1; i >= 0; i--) {
    const date = toJstDateKey(new Date(todayStart.getTime() - i * DAY_MS));
    const minutes = minutesByDay.get(date) ?? 0;
    const quizzes = quizzesByDay.get(date) ?? 0;
    totalMinutes += minutes;
    totalQuizzes += quizzes;

    // 学習時間か復習のどちらかがあれば「学習した日」とみなす
    const active = minutes > 0 || quizzes > 0;
    if (active) {
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 0;
    }
    // 末尾（今日）まで来た時点の連続数が現在のストリーク
    currentStreak = runningStreak;

    days.push({ date, minutes, quizzes, count: minutes, level: toLevel(minutes) });
  }

  const response: HeatmapResponse = {
    days,
    totalMinutes,
    totalQuizzes,
    currentStreak,
    longestStreak,
  };
  return c.json(response);
});
