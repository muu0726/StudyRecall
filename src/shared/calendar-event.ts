import type { CalendarEventDTO, CalendarEventInput } from './types';
import { MAX_DESCRIPTION_CHARS } from './types';
import { MAX_SPAN_DAYS, addDays, jstDayTimeToUtc } from './calendar-view';

/**
 * Google カレンダーへ送る形を組み立てる。
 *
 * HTTP は worker/lib/google-calendar.ts が担当し、ここは形を作るだけ。
 * 時刻と日付の変換が唯一やっかいな部分なので、切り出してテストできるようにしている。
 *
 * **Google の終日 `end.date` は排他**（9/8 だけの予定は end が 9/9）。この ±1 は
 * ここの `buildCalendarEventBody` と calendar-view.ts の `normalizeEvent` の
 * **2 箇所にしか存在しない**。片方だけ直すと全部 1 日ずれるので、往復テストで固定している。
 */

export interface StudyEventInput {
  categoryName: string;
  /** 学びのメモ。空なら説明を付けない */
  notes: string | null;
  durationMinutes: number;
  /**
   * 学習を終えた時刻。タイマー由来ならセッションの確定時刻、
   * 手書きの記録なら保存時刻を渡す。
   */
  endedAt: Date;
}

/** 終日は浮動の暦日、時刻ありは絶対時刻。Google はこの 2 択で受け取る */
export type EventTime = { date: string } | { dateTime: string; timeZone: string };

export interface CalendarEvent {
  summary: string;
  description?: string;
  start: EventTime;
  end: EventTime;
}

/**
 * `buildStudyEvent` は必ず時刻ありを返す、と型で言い切る。
 * 呼び出し側とテストが `.start.dateTime` を直接読んでいるため。
 */
export interface TimedCalendarEvent extends CalendarEvent {
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

/**
 * PATCH に送る形。**使わないほうのメンバを null で明示的に消せる**必要がある。
 * 時刻あり↔終日の切り替えは、片方を残したままだと Google の解釈が安定しない。
 */
export interface CalendarEventPatch {
  summary?: string;
  description?: string;
  start?: { date?: string | null; dateTime?: string | null; timeZone?: string };
  end?: { date?: string | null; dateTime?: string | null; timeZone?: string };
}

const TIME_ZONE = 'Asia/Tokyo';
/** 0 分の記録でもイベントとして成立させるための下限 */
const MIN_MINUTES = 1;

/**
 * 終了時刻から記録された長さぶん遡ってブロックを作る。
 *
 * **`timer_sessions.startedAt` は使わない。** あれは「現在の計測区間の開始時刻」で、
 * 一時停止して再開するたびに書き換わる。セッションの開始ではないので、
 * そこから終了までを取ると休憩まで含んだ長さになり、記録した学習時間と食い違う。
 * 「記録した長さのブロックが、終わった時刻に接して終わる」のが実態に一番近い。
 */
export function buildStudyEvent(input: StudyEventInput): TimedCalendarEvent {
  const minutes = Math.max(MIN_MINUTES, Math.round(input.durationMinutes));
  const end = input.endedAt;
  const start = new Date(end.getTime() - minutes * 60_000);

  const description = (input.notes ?? '').trim();

  return {
    summary: `学習: ${input.categoryName}`,
    // dateTime は Z 付きの絶対時刻なので、timeZone は表示上の目安として添えるだけ。
    // どちらか片方だと Google 側の解釈が環境で変わりうる。
    ...(description ? { description: description.slice(0, MAX_DESCRIPTION_CHARS) } : {}),
    start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
  };
}

// ---------------------------------------------------------------------------
// 画面から作る予定（作成・更新）
// ---------------------------------------------------------------------------

/** タイトルの上限。tasks.ts の TITLE_MAX に合わせる */
const TITLE_MAX = 500;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Google に送る本体を作る。
 *
 * `mode: 'patch'` のときだけ、使わないほうのメンバを **null で明示的に消す**。
 * これが無いと、時刻ありの予定を終日に変えたとき `dateTime` が残って解釈が壊れる。
 * 逆に `insert` で null を送ると Google に弾かれるので、モードで分ける。
 */
export function buildCalendarEventBody(
  input: CalendarEventInput,
  options: { mode: 'insert' },
): CalendarEvent;
export function buildCalendarEventBody(
  input: CalendarEventInput,
  options: { mode: 'patch' },
): CalendarEventPatch;
export function buildCalendarEventBody(
  input: CalendarEventInput,
  options: { mode: 'insert' | 'patch' },
): CalendarEvent | CalendarEventPatch {
  const clearing = options.mode === 'patch';

  const times = input.isAllDay
    ? {
        // 終日の end.date は排他。normalizeEvent の -1 と対になる +1。
        start: { date: input.startDay, ...(clearing ? { dateTime: null } : {}) },
        end: { date: addDays(input.endDay, 1), ...(clearing ? { dateTime: null } : {}) },
      }
    : {
        start: {
          dateTime: jstDayTimeToUtc(input.startDay, input.startTime ?? '00:00'),
          timeZone: TIME_ZONE,
          ...(clearing ? { date: null } : {}),
        },
        end: {
          dateTime: jstDayTimeToUtc(input.endDay, input.endTime ?? '00:00'),
          timeZone: TIME_ZONE,
          ...(clearing ? { date: null } : {}),
        },
      };

  return {
    summary: input.title.trim().slice(0, TITLE_MAX),
    // undefined は「触らない」なのでキーごと出さない。null と '' は「消す」。
    ...(input.description === undefined
      ? {}
      : { description: (input.description ?? '').slice(0, MAX_DESCRIPTION_CHARS) }),
    ...times,
  };
}

/**
 * DTO を編集フォームの形に戻す。
 *
 * **`normalizeEvent` の引き戻しをここで打ち消す。** あちらは JST 00:00 ちょうどに
 * 終わる予定の `endDay` を 1 日戻しているので、DTO の `endDay` と `endTime` を
 * そのままフォームに入れると**終了が開始の 24 時間前**になる。
 * ダイアログに日付の計算を書かせないため、打ち消しはここに置く。
 */
export function eventFormFrom(event: CalendarEventDTO): CalendarEventInput {
  if (event.isAllDay) {
    return {
      title: event.title,
      description: event.description ?? '',
      isAllDay: true,
      startDay: event.startDay,
      endDay: event.endDay,
      startTime: null,
      endTime: null,
    };
  }

  const endTime = event.endTime;
  return {
    title: event.title,
    description: event.description ?? '',
    isAllDay: false,
    startDay: event.startDay,
    // 終了時刻が分からないときは開始に寄せる。無い時間を作らない。
    endDay:
      endTime === null
        ? event.startDay
        : endTime === '00:00'
          ? addDays(event.endDay, 1)
          : event.endDay,
    startTime: event.startTime,
    endTime: endTime ?? event.startTime,
  };
}

/**
 * 書き込んだ内容から DTO を組み立てる。
 * Google のエコーが読めなかったときの保険で、**成功した書き込みをエラーにしない**ためにある。
 */
export function dtoFromInput(
  input: CalendarEventInput,
  created: { id: string; htmlLink: string | null },
): CalendarEventDTO {
  return {
    id: created.id,
    title: input.title.trim() || '（タイトルなし）',
    description: input.description ? input.description : null,
    startDay: input.startDay,
    endDay: input.endDay,
    startTime: input.isAllDay ? null : input.startTime,
    endTime: input.isAllDay ? null : input.endTime,
    isAllDay: input.isAllDay,
    isRecurring: false,
    // 自分で今書けたのだから編集もできる
    canEdit: true,
    htmlLink: created.htmlLink,
  };
}

/**
 * 実在する日付か。**形だけ合っている値を弾く。**
 *
 * `2026-02-31` は `Date` が 3/3 に丸めるので `addDays(day, 0)` と比べて気付ける。
 * `2026-13-01` は `Date.parse` が NaN を返し、そのまま `addDays` に渡すと
 * `RangeError: Invalid time value` で落ちるので、先に見る。
 */
function isRealDay(day: unknown): day is string {
  if (typeof day !== 'string' || !DAY_PATTERN.test(day)) return false;
  if (Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return false;
  return addDays(day, 0) === day;
}

/**
 * 受け取った本文を検証する。
 *
 * **日本語の文言をここで返す。** ルートはそれをそのまま 400 で返すだけ。
 * ルートはテストできないが、ここはできる。
 */
export function validateCalendarEventInput(
  raw: unknown,
): { ok: true; value: CalendarEventInput } | { ok: false; error: string } {
  // 配列も typeof は 'object' なので明示的に弾く（「タイトルが空」と誤報しないため）
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'リクエストボディが不正です' };
  }
  const body = raw as Record<string, unknown>;

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return { ok: false, error: 'タイトルを入力してください' };

  if (typeof body.isAllDay !== 'boolean') {
    return { ok: false, error: '終日の指定が不正です' };
  }
  const isAllDay = body.isAllDay;

  if (!isRealDay(body.startDay) || !isRealDay(body.endDay)) {
    return { ok: false, error: '日付は YYYY-MM-DD で指定してください' };
  }
  const { startDay, endDay } = body as { startDay: string; endDay: string };

  let startTime: string | null = null;
  let endTime: string | null = null;
  if (!isAllDay) {
    if (typeof body.startTime !== 'string' || !TIME_PATTERN.test(body.startTime)) {
      return { ok: false, error: '時刻は HH:MM で指定してください' };
    }
    if (typeof body.endTime !== 'string' || !TIME_PATTERN.test(body.endTime)) {
      return { ok: false, error: '時刻は HH:MM で指定してください' };
    }
    startTime = body.startTime;
    endTime = body.endTime;
  }

  // 同時刻は許す（長さ 0 の予定は Google でも作れる）。前後が逆のときだけ弾く。
  const startKey = `${startDay} ${startTime ?? ''}`;
  const endKey = `${endDay} ${endTime ?? ''}`;
  if (endKey < startKey) {
    return { ok: false, error: '終了は開始より前にできません' };
  }

  // bucketByDay が MAX_SPAN_DAYS で展開を打ち切るので、描けない長さは作らせない
  if (
    Math.round(
      (Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / 86_400_000,
    ) >= MAX_SPAN_DAYS
  ) {
    return { ok: false, error: `予定の期間が長すぎます（${MAX_SPAN_DAYS} 日まで）` };
  }

  const description =
    body.description === undefined
      ? undefined
      : typeof body.description === 'string'
        ? body.description.slice(0, MAX_DESCRIPTION_CHARS)
        : null;

  return {
    ok: true,
    value: {
      title: title.slice(0, TITLE_MAX),
      ...(description === undefined ? {} : { description }),
      isAllDay,
      startDay,
      endDay,
      startTime,
      endTime,
    },
  };
}
