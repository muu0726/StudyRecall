import type { CalendarEventDTO, TaskDTO } from './types';
import { daysBetween } from './task-sync';

/**
 * 月カレンダーの組み立て。**純粋関数だけ。**
 *
 * `task-sync.ts` と同じ規律で書く:
 * 日付は `'YYYY-MM-DD'` の文字列で持ち、`Date` は UTC の算術にしか使わない。
 * 実行環境のタイムゾーンに答えを左右させないため（Workers は UTC、ブラウザは任意）。
 * Google API はここに持ち込まない。判断が要るところを全部この層に寄せてあるのは、
 * vitest が `environment: 'node'` で DOM を持たず、**描画側をテストできない**ため。
 */

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 月グリッドのセル数。**常にこれ**（可変にしない理由は buildMonthGrid のコメント） */
export const GRID_DAYS = 42;

/**
 * 1 件のイベントを何日ぶんまで展開するか。
 * 5 年続く終日イベントは実在するので、上限が無いとバケット作りが暴走する。
 */
const MAX_SPAN_DAYS = 62;

// ---------------------------------------------------------------------------
// 絶対時刻 → JST の暦日・時刻
// ---------------------------------------------------------------------------

/**
 * 絶対時刻を JST の暦日 'YYYY-MM-DD' にする。
 *
 * `todayInJst` と同じ手口。+9h してから `toISOString()`（＝常に UTC）を切るので、
 * **サーバーが UTC でもブラウザが Berlin でも同じ答えになる。**
 */
export function jstDayOf(epochMs: number): string {
  return new Date(epochMs + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 絶対時刻を JST の 'HH:MM' にする */
export function jstTimeOf(epochMs: number): string {
  return new Date(epochMs + JST_OFFSET_MS).toISOString().slice(11, 16);
}

/** JST のその日の 0:00 を RFC3339（UTC）にする。Google に渡す範囲の端 */
export function jstDayStartToUtc(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - JST_OFFSET_MS).toISOString();
}

// ---------------------------------------------------------------------------
// 'YYYY-MM-DD' / 'YYYY-MM' の算術
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' に n 日足す。UTC 深夜として数えるので夏時間にも引きずられない */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM' に n か月足す。'2026-12' + 1 → '2027-01' */
export function shiftMonth(month: string, n: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + n;
  const shifted = new Date(Date.UTC(year, index, 1));
  return shifted.toISOString().slice(0, 7);
}

/** 'YYYY-MM' の日数 */
function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  // 「翌月の 0 日」＝当月の末日
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// 月グリッド
// ---------------------------------------------------------------------------

export interface MonthGridDay {
  /** 'YYYY-MM-DD' */
  date: string;
  dayOfMonth: number;
  /** その月に属するか。false は前後の月から埋めたセル */
  inMonth: boolean;
}

/**
 * 月グリッドを作る。先頭は必ず日曜、**常に 42 セル（6 行）**。
 *
 * 行数を月ごとに変えない。2026-08 は土曜始まりの 31 日で 6 行要り、2026-09 は
 * 火曜始まりの 30 日で 5 行に収まる。可変にすると**月を送った瞬間に
 * 下のタスク一覧が 1 行ぶんずり上がる**。6 行目が丸ごと当月外になる月がある代償より、
 * レイアウトが動かないほうが読める。
 */
export function buildMonthGrid(month: string): MonthGridDay[] {
  const first = `${month}-01`;
  // Heatmap.tsx と同じく UTC 深夜として曜日を取る。ローカル TZ で 1 日ずれないように。
  const firstWeekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = addDays(first, -firstWeekday);
  const length = daysInMonth(month);

  const days: MonthGridDay[] = [];
  for (let i = 0; i < GRID_DAYS; i++) {
    const date = addDays(start, i);
    const offset = daysBetween(date, first);
    days.push({
      date,
      dayOfMonth: Number(date.slice(8, 10)),
      inMonth: offset >= 0 && offset < length,
    });
  }
  return days;
}

// ---------------------------------------------------------------------------
// Google のイベントを DTO にする
// ---------------------------------------------------------------------------

/** events.list の 1 件のうち、使う項目だけ */
interface RawEventTime {
  /** 終日のときだけ 'YYYY-MM-DD' */
  date?: string;
  /** 時刻ありのときだけ RFC3339。オフセットは +09:00 とは限らない */
  dateTime?: string;
}

const DAY_PATTERN = /^(\d{4}-\d{2}-\d{2})/;

function readTime(value: unknown): RawEventTime | null {
  if (typeof value !== 'object' || value === null) return null;
  const { date, dateTime } = value as { date?: unknown; dateTime?: unknown };
  return {
    date: typeof date === 'string' ? date : undefined,
    dateTime: typeof dateTime === 'string' ? dateTime : undefined,
  };
}

/**
 * events.list の 1 件を DTO にする。使えない行は null（呼び出し側が捨てる）。
 *
 * **終日と時刻ありで経路を分ける。同じ扱いにすると必ず 1 日ずれる。**
 *
 * - 終日の `date` は浮動の暦日であって瞬間ではない。+9h すると翌日になるので、
 *   `fromGoogleDue` と同じく**文字列を切るだけ**にする。
 * - 時刻ありの `dateTime` は絶対時刻。オフセットは**カレンダー次第で +09:00 とは限らない**
 *   （他人が作った予定、旅行先で作った予定）。先頭 10 文字を切ると別の日になるので、
 *   必ず epoch に直してから JST の暦日を求める。
 */
export function normalizeEvent(raw: unknown): CalendarEventDTO | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const event = raw as Record<string, unknown>;

  const id = typeof event.id === 'string' ? event.id : '';
  if (!id) return null;
  if (event.status === 'cancelled') return null;
  /*
   * Google Workspace の「勤務場所」は毎営業日の終日イベントとして返る。
   * 落とさないと**平日のセルが全部埋まって**、本物の予定が見えなくなる。
   */
  if (event.eventType === 'workingLocation') return null;

  const start = readTime(event.start);
  const end = readTime(event.end);
  if (!start) return null;

  const title = typeof event.summary === 'string' ? event.summary.trim() : '';
  const htmlLink = typeof event.htmlLink === 'string' ? event.htmlLink : null;
  const base = {
    id,
    title: title || '（タイトルなし）',
    htmlLink,
  };

  if (start.date) {
    const startDay = DAY_PATTERN.exec(start.date)?.[1];
    if (!startDay) return null;
    // 終日の end.date は**排他**。9/8 だけの予定は end.date が '2026-09-09' で返る。
    // そのまま使うと必ず 1 日多く塗る。
    const rawEnd = end?.date ? DAY_PATTERN.exec(end.date)?.[1] : undefined;
    const endDay = rawEnd ? addDays(rawEnd, -1) : startDay;
    return {
      ...base,
      startDay,
      endDay: endDay < startDay ? startDay : endDay,
      startTime: null,
      isAllDay: true,
    };
  }

  if (!start.dateTime) return null;
  const startMs = Date.parse(start.dateTime);
  if (Number.isNaN(startMs)) return null;
  const startDay = jstDayOf(startMs);

  let endDay = startDay;
  const endMs = end?.dateTime ? Date.parse(end.dateTime) : NaN;
  if (!Number.isNaN(endMs)) {
    endDay = jstDayOf(endMs);
    // JST のちょうど 0:00 に終わる予定は、翌日を占有していない。
    if (jstTimeOf(endMs) === '00:00') endDay = addDays(endDay, -1);
  }

  return {
    ...base,
    startDay,
    endDay: endDay < startDay ? startDay : endDay,
    startTime: jstTimeOf(startMs),
    isAllDay: false,
  };
}

// ---------------------------------------------------------------------------
// 日ごとに畳む
// ---------------------------------------------------------------------------

export interface DayBucket {
  tasks: TaskDTO[];
  events: CalendarEventDTO[];
  /** 未完了かつ期日超過が 1 件でもあるか。セルを赤にする判断に使う */
  hasOverdue: boolean;
}

function bucketOf(map: Map<string, DayBucket>, day: string): DayBucket | undefined {
  return map.get(day);
}

/**
 * グリッドの各日に、その日のタスクと予定を集める。
 *
 * 期間のあるイベントは 1 日ずつに展開する。窓の外は捨て、1 件あたりの展開も
 * `MAX_SPAN_DAYS` で打ち切る（長期の終日イベントで数千回まわさないため）。
 */
export function bucketByDay(
  days: readonly string[],
  tasks: readonly TaskDTO[],
  events: readonly CalendarEventDTO[],
  today: string,
): Map<string, DayBucket> {
  const map = new Map<string, DayBucket>();
  for (const day of days) {
    map.set(day, { tasks: [], events: [], hasOverdue: false });
  }

  for (const task of tasks) {
    if (!task.dueDate) continue;
    const bucket = bucketOf(map, task.dueDate);
    if (!bucket) continue;
    bucket.tasks.push(task);
    if (!task.isCompleted && daysBetween(task.dueDate, today) < 0) bucket.hasOverdue = true;
  }

  for (const event of events) {
    const span = Math.min(daysBetween(event.endDay, event.startDay), MAX_SPAN_DAYS - 1);
    for (let i = 0; i <= span; i++) {
      const bucket = bucketOf(map, addDays(event.startDay, i));
      if (bucket) bucket.events.push(event);
    }
  }

  return map;
}
