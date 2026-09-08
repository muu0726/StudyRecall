import { Hono } from 'hono';
import { getDb, type AppEnv } from '../lib/db';
import { getSettings } from '../lib/user-settings';
import {
  GOOGLE_CALENDAR_SCOPE,
  describeAccessFailure,
  getGoogleAccessToken,
  isGoogleLinked,
} from '../lib/google-auth';
import { listEvents } from '../lib/google-calendar';
import { describeGoogleError } from '../lib/google-error';
import { addDays, buildMonthGrid, jstDayStartToUtc } from '../../shared/calendar-view';
import { todayInJst } from '../../shared/task-sync';
import type { CalendarEventsResponse } from '../../shared/types';

/**
 * Google カレンダーの読み取り。**表示専用で、書き込みはしない。**
 *
 * `tasks.ts` には足さない。あちらは全体が「Google Tasks との双方向同期」で
 * 筋が通っており、読み取り専用・月スコープの別物を混ぜると読めなくなる。
 *
 * **失敗しても 200 で返す。** 予定が読めないことは、タスク画面が使えない理由に
 * ならない（`/api/tasks/sync` と同じ方針）。理由は warning に日本語で入れる。
 */

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** 今月から前後これだけ。月を機械的に歩いて Google を叩き続けるのを止める */
const MAX_MONTHS_AWAY = 24;

/** 'YYYY-MM' どうしの月差（a - b） */
function monthsBetween(a: string, b: string): number {
  const years = Number(a.slice(0, 4)) - Number(b.slice(0, 4));
  return years * 12 + (Number(a.slice(5, 7)) - Number(b.slice(5, 7)));
}

export const calendarRoute = new Hono<AppEnv>().get('/events', async (c) => {
  const userId = c.get('userId');
  const month = c.req.query('month') ?? todayInJst().slice(0, 7);

  if (!MONTH_PATTERN.test(month)) {
    return c.json({ error: 'month は YYYY-MM の形式で指定してください' }, 400);
  }
  if (Math.abs(monthsBetween(month, todayInJst().slice(0, 7))) > MAX_MONTHS_AWAY) {
    return c.json({ error: `表示できるのは前後 ${MAX_MONTHS_AWAY} か月までです` }, 400);
  }

  const googleLinked = await isGoogleLinked(c.env, userId);

  const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_CALENDAR_SCOPE]);
  if (!access.ok) {
    const failed: CalendarEventsResponse = {
      month,
      events: [],
      googleLinked,
      warning: describeAccessFailure(access.reason),
    };
    // 未連携でも warning は返す。出すかどうかは googleLinked を見て画面側が決める。
    return c.json(failed);
  }

  /*
   * 聞く範囲は「月」ではなく**グリッドの 42 日**。
   * 月で切ると、前後の月から埋めたセル（8/30・8/31 など）だけ予定が消えて、
   * 見ている側には理由が分からない。
   */
  const grid = buildMonthGrid(month);
  const timeMin = jstDayStartToUtc(grid[0].date);
  const timeMax = jstDayStartToUtc(addDays(grid[grid.length - 1].date, 1));

  const settings = await getSettings(getDb(c.env), userId);

  try {
    const events = await listEvents(access.accessToken, settings.calendarId, timeMin, timeMax);
    const response: CalendarEventsResponse = { month, events, googleLinked };
    return c.json(response);
  } catch (error) {
    // 生の中身はここに残す。画面には出さないが、調べるときに要る。
    console.error('[calendar] list failed:', error);
    const failed: CalendarEventsResponse = {
      month,
      events: [],
      googleLinked,
      warning: describeGoogleError(error),
    };
    return c.json(failed);
  }
});
