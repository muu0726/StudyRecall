import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  INITIAL_SRS_STATE,
  SRS_INITIAL_EASE,
  SRS_MAX_INTERVAL_DAYS,
  SRS_MIN_EASE,
  daysUntil,
  isDue,
  nextSchedule,
  type SrsState,
} from './srs';

/**
 * 出題間隔がズレると、学習の設計そのものが狂う。
 * しかも「間違っていること」が数週間後にしか現れないので、テストでしか気付けない。
 */

const NOW = new Date('2026-09-06T00:00:00.000Z');
const state = (overrides: Partial<SrsState> = {}): SrsState => ({
  ...INITIAL_SRS_STATE,
  ...overrides,
});

/** dueAt が now から何日後か */
const daysAfterNow = (dueAt: Date) => Math.round((dueAt.getTime() - NOW.getTime()) / DAY_MS);

describe('nextSchedule: 正解したとき', () => {
  it('1 回目の正解は 1 日後', () => {
    const s = nextSchedule(state(), true, NOW);
    expect(s.intervalDays).toBe(1);
    expect(s.repetitions).toBe(1);
    expect(daysAfterNow(s.dueAt)).toBe(1);
  });

  it('2 回目の正解は 6 日後（SM-2 の既定）', () => {
    const s = nextSchedule(state({ repetitions: 1, intervalDays: 1 }), true, NOW);
    expect(s.intervalDays).toBe(6);
    expect(s.repetitions).toBe(2);
  });

  it('3 回目以降は 間隔 × 難易度係数 で伸びる', () => {
    // 6 日 × 2.50 = 15 日
    const s = nextSchedule(state({ repetitions: 2, intervalDays: 6 }), true, NOW);
    expect(s.intervalDays).toBe(15);
    expect(s.repetitions).toBe(3);
  });

  it('正解では難易度係数が下がらない（quality=4 は EF 変化なし）', () => {
    const s = nextSchedule(state({ repetitions: 2, intervalDays: 6 }), true, NOW);
    expect(s.easeFactor).toBe(SRS_INITIAL_EASE);
  });

  it('難易度係数が下限でも間隔は必ず 1 日以上伸びる', () => {
    // 1 日 × 1.30 = 1.3 → 四捨五入で 1 日のまま止まってしまうのを防ぐ
    const s = nextSchedule(
      state({ repetitions: 2, intervalDays: 1, easeFactor: SRS_MIN_EASE }),
      true,
      NOW,
    );
    expect(s.intervalDays).toBeGreaterThan(1);
  });

  it('間隔は上限で頭打ちになる', () => {
    const s = nextSchedule(
      state({ repetitions: 9, intervalDays: SRS_MAX_INTERVAL_DAYS }),
      true,
      NOW,
    );
    expect(s.intervalDays).toBe(SRS_MAX_INTERVAL_DAYS);
  });
});

describe('nextSchedule: 間違えたとき', () => {
  it('間隔と連続正解回数をリセットする', () => {
    const s = nextSchedule(state({ repetitions: 5, intervalDays: 60 }), false, NOW);
    expect(s.repetitions).toBe(0);
    expect(s.intervalDays).toBe(0);
  });

  it('翌日送りにせず、同じセッション内でもう一度出せるようにする', () => {
    // 「まだ不安」と答えた直後に消えてしまうと、覚え直す機会が無い
    const s = nextSchedule(state({ repetitions: 3, intervalDays: 15 }), false, NOW);
    expect(s.dueAt.getTime()).toBe(NOW.getTime());
    expect(isDue(s.dueAt, NOW)).toBe(true);
  });

  it('難易度係数を 0.32 下げる（quality=2）', () => {
    const s = nextSchedule(state(), false, NOW);
    expect(s.easeFactor).toBe(SRS_INITIAL_EASE - 32);
  });

  it('難易度係数は下限 1.30 を割らない', () => {
    let current = state({ easeFactor: SRS_MIN_EASE + 10 });
    for (let i = 0; i < 5; i += 1) {
      current = nextSchedule(current, false, NOW);
    }
    expect(current.easeFactor).toBe(SRS_MIN_EASE);
  });
});

describe('nextSchedule: 積み重ね', () => {
  it('正解を続けると 1 → 6 → 15 → 38 日と伸びる', () => {
    let current: SrsState = state();
    const intervals: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const next = nextSchedule(current, true, NOW);
      intervals.push(next.intervalDays);
      current = next;
    }
    expect(intervals).toEqual([1, 6, 15, 38]);
  });

  it('途中で間違えると振り出しに戻るが、難易度係数は下がったまま残る', () => {
    let current: SrsState = state();
    current = nextSchedule(current, true, NOW); // 1
    current = nextSchedule(current, true, NOW); // 6
    current = nextSchedule(current, false, NOW); // リセット
    expect(current.intervalDays).toBe(0);
    expect(current.easeFactor).toBeLessThan(SRS_INITIAL_EASE);

    const again = nextSchedule(current, true, NOW);
    expect(again.intervalDays).toBe(1);
    // 一度つまずいたカードは、以降の伸びが緩やかになる
    expect(again.easeFactor).toBeLessThan(SRS_INITIAL_EASE);
  });
});

describe('isDue', () => {
  it('未学習（dueAt が null）は常に出題対象', () => {
    expect(isDue(null, NOW)).toBe(true);
  });

  it('期限ちょうどは出題対象', () => {
    expect(isDue(NOW, NOW)).toBe(true);
  });

  it('未来の期限は対象外', () => {
    expect(isDue(new Date(NOW.getTime() + DAY_MS), NOW)).toBe(false);
  });

  it('ISO 文字列でも判定できる（DTO はこちらで来る）', () => {
    expect(isDue('2026-09-05T00:00:00.000Z', NOW)).toBe(true);
    expect(isDue('2026-09-07T00:00:00.000Z', NOW)).toBe(false);
  });
});

describe('daysUntil', () => {
  it('3 日後なら 3', () => {
    expect(daysUntil(new Date(NOW.getTime() + 3 * DAY_MS), NOW)).toBe(3);
  });

  it('端数は切り上げる（「あと 0 日」と言わない）', () => {
    expect(daysUntil(new Date(NOW.getTime() + DAY_MS + 1000), NOW)).toBe(2);
  });

  it('過去なら 0', () => {
    expect(daysUntil(new Date(NOW.getTime() - DAY_MS), NOW)).toBe(0);
  });
});
