/**
 * Worker は UTC で動くため、統計の日境界は Asia/Tokyo (UTC+9) 固定オフセットで計算する。
 * これを入れないと深夜の記録が前日／翌日にズレる。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** JST における当日 0:00 を UTC の Date として返す */
export function startOfTodayJst(now: Date = new Date()): Date {
  const shifted = now.getTime() + JST_OFFSET_MS;
  const dayStart = Math.floor(shifted / DAY_MS) * DAY_MS;
  return new Date(dayStart - JST_OFFSET_MS);
}

/** JST における今週月曜 0:00 を UTC の Date として返す */
export function startOfWeekJst(now: Date = new Date()): Date {
  const todayStart = startOfTodayJst(now);
  // JST の曜日は「+9h した時刻の UTC 曜日」と一致する
  const jstDayOfWeek = new Date(now.getTime() + JST_OFFSET_MS).getUTCDay(); // 0=日曜
  const daysSinceMonday = (jstDayOfWeek + 6) % 7;
  return new Date(todayStart.getTime() - daysSinceMonday * DAY_MS);
}

/**
 * JST における今月 1 日 0:00 を UTC の Date として返す。
 * 月次の生成上限を数える起点。
 */
export function startOfMonthJst(now: Date = new Date()): Date {
  // +9h した時刻の UTC 年月が、JST の年月と一致する
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  const monthStartShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1);
  return new Date(monthStartShifted - JST_OFFSET_MS);
}
