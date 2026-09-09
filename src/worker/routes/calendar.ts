import { Hono, type Context } from 'hono';
import { getDb, type AppEnv } from '../lib/db';
import { getSettings } from '../lib/user-settings';
import {
  GOOGLE_CALENDAR_SCOPE,
  describeAccessFailure,
  getGoogleAccessToken,
  isGoogleLinked,
} from '../lib/google-auth';
import { deleteEvent, insertEvent, listEvents, patchEvent } from '../lib/google-calendar';
import { describeGoogleError, statusOf } from '../lib/google-error';
import {
  addDays,
  buildMonthGrid,
  jstDayStartToUtc,
  normalizeEvent,
} from '../../shared/calendar-view';
import {
  buildCalendarEventBody,
  dtoFromInput,
  validateCalendarEventInput,
} from '../../shared/calendar-event';
import { todayInJst } from '../../shared/task-sync';
import type { CalendarEventResponse, CalendarEventsResponse } from '../../shared/types';

/**
 * Google カレンダーの読み書き。
 *
 * `tasks.ts` には足さない。あちらは全体が「Google Tasks との双方向同期」で
 * 筋が通っており、月スコープの別物を混ぜると読めなくなる。
 *
 * **読み取りは失敗しても 200 で返す。** 予定が読めないことは、タスク画面が
 * 使えない理由にならない（`/api/tasks/sync` と同じ方針）。理由は warning に入れる。
 *
 * **書き込みは違う。同期的に Google へ書き、失敗はそのまま失敗として返す。**
 * `tasks.ts` の「D1 を先に確定させて Google は best-effort」はここでは使えない —
 * カレンダーには **D1 のテーブルが無い**。再送元も `syncState` も無いので、
 * best-effort にすると「200 なのにどこにも存在しない予定」が画面に残る。
 * 同じ理由で、未連携・権限不足も warning ではなく **403**（劣化した状態が無い）。
 */

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** 今月から前後これだけ。月を機械的に歩いて Google を叩き続けるのを止める */
const MAX_MONTHS_AWAY = 24;

/** 'YYYY-MM' どうしの月差（a - b） */
function monthsBetween(a: string, b: string): number {
  const years = Number(a.slice(0, 4)) - Number(b.slice(0, 4));
  return years * 12 + (Number(a.slice(5, 7)) - Number(b.slice(5, 7)));
}

/** Google のイベント ID の上限。これを超えるものは投げる前に断る */
const EVENT_ID_MAX = 1024;

const GONE_MESSAGE =
  'この予定は Google カレンダー上に見つかりませんでした（すでに削除されている可能性があります）。';

/** もう向こうに無い。404 と 410 の両方が来る */
function isGone(error: unknown): boolean {
  const status = statusOf(error);
  return status === 404 || status === 410;
}

/**
 * 書き込みの失敗を HTTP に割り当てる。
 *
 * 403 に `describeGoogleError` を使わないのは、あちらの文言が
 * **OAuth スコープのせいにする**ため。ここでのスコープは足りていて、
 * 問題はその予定の権限なので、連携設定へ無駄足を踏ませることになる。
 * それ以外の上流の失敗は **502**（自前の 4xx の意味を汚さない）。
 */
function writeFailure(c: Context<AppEnv>, error: unknown, action: string) {
  // 生の中身はここに残す。画面には出さないが、調べるときに要る。
  console.error(`[calendar] ${action} failed:`, error);
  const status = statusOf(error);

  if (status === 404 || status === 410) {
    return c.json(
      { error: 'この予定は Google カレンダー上に見つかりませんでした。画面を更新してください。' },
      404,
    );
  }
  if (status === 403) {
    return c.json(
      {
        error: 'この予定を変更する権限がありません。Google カレンダーで直接編集してください。',
      },
      403,
    );
  }
  return c.json({ error: describeGoogleError(error) }, 502);
}

export const calendarRoute = new Hono<AppEnv>()
  .get('/events', async (c) => {
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
  })

  /** 予定を作る */
  .post('/events', async (c) => {
    const userId = c.get('userId');
    const parsed = validateCalendarEventInput(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_CALENDAR_SCOPE]);
    if (!access.ok) return c.json({ error: describeAccessFailure(access.reason) }, 403);

    const settings = await getSettings(getDb(c.env), userId);

    try {
      const created = await insertEvent(
        access.accessToken,
        settings.calendarId,
        buildCalendarEventBody(parsed.value, { mode: 'insert' }),
      );
      /*
       * Google のエコーを正規化したものが、書き込み後の日付の唯一の正しい出どころ。
       * 読めなかったら送った内容から組み立ててでも **201 を返す** —
       * 成功した書き込みをエラーにすると再送されて予定が二重になる。
       */
      const event =
        normalizeEvent(created.raw, { calendarWritable: true }) ??
        dtoFromInput(parsed.value, created);
      const response: CalendarEventResponse = { event };
      return c.json(response, 201);
    } catch (error) {
      return writeFailure(c, error, '作成');
    }
  })

  /** 予定を書き換える。繰り返しの予定は**この回だけ**変わる */
  .put('/events/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id || id.length > EVENT_ID_MAX) {
      return c.json({ error: '予定の ID が不正です' }, 400);
    }

    const parsed = validateCalendarEventInput(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_CALENDAR_SCOPE]);
    if (!access.ok) return c.json({ error: describeAccessFailure(access.reason) }, 403);

    const settings = await getSettings(getDb(c.env), userId);

    /*
     * 存在確認をしてから書く、はしない（`tasks.ts` とは逆）。存在は Google に
     * 聞かないと分からないうえ、id 空間は本人のカレンダーでアクセス制御は Google 側が
     * やる。往復 1 回で済ませ、消えていれば 404 がそのまま返る。
     */
    try {
      const { raw } = await patchEvent(
        access.accessToken,
        settings.calendarId,
        id,
        buildCalendarEventBody(parsed.value, { mode: 'patch' }),
      );
      const event =
        normalizeEvent(raw, { calendarWritable: true }) ??
        dtoFromInput(parsed.value, { id, htmlLink: null });
      const response: CalendarEventResponse = { event };
      return c.json(response);
    } catch (error) {
      return writeFailure(c, error, '変更');
    }
  })

  /** 予定を消す。繰り返しの予定は**この回だけ**消える */
  .delete('/events/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!id || id.length > EVENT_ID_MAX) {
      return c.json({ error: '予定の ID が不正です' }, 400);
    }

    const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_CALENDAR_SCOPE]);
    if (!access.ok) return c.json({ error: describeAccessFailure(access.reason) }, 403);

    const settings = await getSettings(getDb(c.env), userId);

    try {
      await deleteEvent(access.accessToken, settings.calendarId, id);
      return c.json({ ok: true });
    } catch (error) {
      /*
       * すでに無いなら**消したい**という意図は満たされている。ここで失敗にすると、
       * 画面から永久に消せない行が残る。warning を添えて成功として返す。
       */
      if (isGone(error)) {
        console.warn('[calendar] delete: already gone');
        return c.json({ ok: true, warning: GONE_MESSAGE });
      }
      return writeFailure(c, error, '削除');
    }
  });
