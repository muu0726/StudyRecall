import { describe, expect, it } from 'vitest';
import { startOfMonthJst, startOfTodayJst, startOfWeekJst } from './time';

/**
 * Worker は UTC で動く。日境界を間違えると、深夜の記録が前日・翌日にズレて
 * 「今日の学習時間が 0 のまま」といった、原因の見えない不具合になる。
 */

/** JST での表示に直して確かめる */
const asJst = (d: Date) =>
  d.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(' ', 'T');

describe('startOfTodayJst', () => {
  it('JST の 0:00 を返す', () => {
    expect(asJst(startOfTodayJst(new Date('2026-09-06T05:00:00Z')))).toBe('2026-09-06T00:00:00');
  });

  it('UTC で前日でも JST の当日を基準にする', () => {
    // UTC 2026-09-05 16:00 は JST では 9/6 の 1:00
    expect(asJst(startOfTodayJst(new Date('2026-09-05T16:00:00Z')))).toBe('2026-09-06T00:00:00');
  });

  it('JST 0:00 ちょうどはその日の始まり', () => {
    expect(asJst(startOfTodayJst(new Date('2026-09-05T15:00:00Z')))).toBe('2026-09-06T00:00:00');
  });
});

describe('startOfWeekJst', () => {
  it('週の始まりは月曜', () => {
    // 2026-09-06 は日曜 → 直前の月曜は 8/31
    expect(asJst(startOfWeekJst(new Date('2026-09-06T05:00:00Z')))).toBe('2026-08-31T00:00:00');
  });

  it('月曜そのものはその日を返す', () => {
    expect(asJst(startOfWeekJst(new Date('2026-08-31T05:00:00Z')))).toBe('2026-08-31T00:00:00');
  });
});

describe('startOfMonthJst', () => {
  it('JST の月初 0:00 を返す', () => {
    expect(asJst(startOfMonthJst(new Date('2026-09-06T05:00:00Z')))).toBe('2026-09-01T00:00:00');
  });

  it('UTC では前月末でも JST の月初を基準にする', () => {
    // UTC 2026-08-31 16:00 は JST では 9/1 の 1:00
    expect(asJst(startOfMonthJst(new Date('2026-08-31T16:00:00Z')))).toBe('2026-09-01T00:00:00');
  });

  it('JST の月末は当月の 1 日を返す', () => {
    expect(asJst(startOfMonthJst(new Date('2026-09-30T14:00:00Z')))).toBe('2026-09-01T00:00:00');
  });

  it('年をまたいでも壊れない', () => {
    // UTC 2025-12-31 16:00 は JST では 2026/1/1
    expect(asJst(startOfMonthJst(new Date('2025-12-31T16:00:00Z')))).toBe('2026-01-01T00:00:00');
  });
});
