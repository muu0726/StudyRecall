import { describe, expect, it } from 'vitest';
import { countFreshTerms, pickGenerateTargets } from './glossary-generate-targets';

/** 並びを固定して確かめるための擬似乱数（テスト内だけ） */
const seeded = (seed: number) => {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
};

const term = (id: string, cardCount: number) => ({ id, cardCount });

/** 0 枚 `fresh` 件と、カードあり `used` 件を並べる（カードありを先頭に置く＝旧実装なら先頭が選ばれる） */
const makePool = (used: number, fresh: number) => [
  ...Array.from({ length: used }, (_, i) => term(`used${i}`, i + 1)),
  ...Array.from({ length: fresh }, (_, i) => term(`fresh${i}`, 0)),
];

const ids = (terms: { id: string }[]) => terms.map((t) => t.id);

describe('pickGenerateTargets', () => {
  it('件数は上限と範囲の小さいほう', () => {
    expect(pickGenerateTargets(makePool(10, 10), 10, seeded(1))).toHaveLength(10);
    expect(pickGenerateTargets(makePool(2, 3), 10, seeded(1))).toHaveLength(5);
  });

  it('空の範囲は空', () => {
    expect(pickGenerateTargets([], 10, seeded(1))).toEqual([]);
  });

  /* ここが本題。カードありが先頭に並んでいても、0 枚の用語が選ばれる */
  it('カードの無い用語が上限以上あれば、それだけから選ぶ', () => {
    const picked = pickGenerateTargets(makePool(10, 12), 10, seeded(3));
    expect(picked.every((t) => t.cardCount === 0)).toBe(true);
  });

  it('カードの無い用語が足りなければ全部入れ、残りをカードありから埋める', () => {
    const picked = pickGenerateTargets(makePool(10, 4), 10, seeded(5));
    expect(picked.filter((t) => t.cardCount === 0)).toHaveLength(4);
    expect(picked.filter((t) => t.cardCount > 0)).toHaveLength(6);
  });

  it('重複しない', () => {
    const picked = pickGenerateTargets(makePool(15, 5), 10, seeded(9));
    expect(new Set(ids(picked)).size).toBe(picked.length);
  });

  it('元の配列を変えない', () => {
    const pool = makePool(8, 8);
    const before = ids(pool);
    pickGenerateTargets(pool, 10, seeded(2));
    expect(ids(pool)).toEqual(before);
  });

  /* 先頭 10 件固定に戻っていないこと。乱数が違えば選ばれる集合も変わる */
  it('先頭から切るのではなくランダムに選ぶ', () => {
    const pool = Array.from({ length: 30 }, (_, i) => term(`t${i}`, 0));
    const head = ids(pool.slice(0, 10)).sort().join(',');
    const sets = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      sets.add(
        ids(pickGenerateTargets(pool, 10, seeded(seed)))
          .sort()
          .join(','),
      );
    }
    expect(sets.size).toBeGreaterThan(1);
    expect([...sets].every((set) => set === head)).toBe(false);
  });

  it('カードありからの補充もランダム', () => {
    const pool = makePool(30, 0);
    const sets = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      sets.add(
        ids(pickGenerateTargets(pool, 10, seeded(seed)))
          .sort()
          .join(','),
      );
    }
    expect(sets.size).toBeGreaterThan(1);
  });
});

describe('countFreshTerms', () => {
  it('カードが 0 枚の用語だけを数える', () => {
    expect(countFreshTerms(makePool(3, 7))).toBe(7);
    expect(countFreshTerms([])).toBe(0);
  });
});
