import { describe, expect, it } from 'vitest';
import { formatClock, sameSecond } from './format';

describe('sameSecond', () => {
  it('同じ秒の中なら true（表示が変わらないので再描画しない）', () => {
    expect(sameSecond(1000, 1999)).toBe(true);
    expect(sameSecond(0, 999)).toBe(true);
  });

  it('秒の境目をまたいだら false', () => {
    expect(sameSecond(999, 1000)).toBe(false);
    expect(sameSecond(59_999, 60_000)).toBe(false);
  });

  it('同じ秒と判定した 2 つは、時計の表示も同じ', () => {
    for (const [a, b] of [
      [1000, 1999],
      [3_599_001, 3_599_999],
    ]) {
      expect(sameSecond(a, b)).toBe(true);
      expect(formatClock(a)).toBe(formatClock(b));
    }
  });
});
