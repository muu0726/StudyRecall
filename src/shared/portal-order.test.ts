import { describe, expect, it } from 'vitest';
import { moveTo, sameOrder, shiftVisible } from './portal-order';

/**
 * 並べ替えは入口が 2 つある（PC のドラッグ / メニューの「前へ・後ろへ」）。
 * 食い違うと「ドラッグでは 1 つ、メニューでは 2 つ動く」のような分かりにくい壊れ方をするので、
 * どちらの経路も同じ関数を通していることをここで固定する。
 */

const ids = ['a', 'b', 'c', 'd'];

describe('moveTo', () => {
  it('前に入れる', () => {
    expect(moveTo(ids, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('後ろに入れる', () => {
    expect(moveTo(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('隣どうしの入れ替えで 2 つ飛ばない', () => {
    expect(moveTo(ids, 'a', 'b', 'after')).toEqual(['b', 'a', 'c', 'd']);
    expect(moveTo(ids, 'c', 'b', 'before')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('自分自身・知らない id では並びを変えない', () => {
    expect(moveTo(ids, 'a', 'a', 'before')).toEqual(ids);
    expect(moveTo(ids, 'z', 'b', 'before')).toEqual(ids);
    expect(moveTo(ids, 'a', 'z', 'after')).toEqual(ids);
  });

  it('元の配列を書き換えない', () => {
    const original = [...ids];
    moveTo(original, 'd', 'a', 'before');
    expect(original).toEqual(ids);
  });
});

describe('shiftVisible', () => {
  it('絞っていないときは隣と入れ替わる', () => {
    expect(shiftVisible(ids, ids, 'c', 'prev')).toEqual(['a', 'c', 'b', 'd']);
    expect(shiftVisible(ids, ids, 'c', 'next')).toEqual(['a', 'b', 'd', 'c']);
  });

  /* 絞り込み中に「全体での隣」と入れ替えると、押しても画面が動かないように見える */
  it('絞っているときは見えている隣と入れ替わる', () => {
    const visible = ['a', 'd'];
    expect(shiftVisible(ids, visible, 'd', 'prev')).toEqual(['d', 'a', 'b', 'c']);
  });

  it('端では何も起きない', () => {
    expect(shiftVisible(ids, ids, 'a', 'prev')).toEqual(ids);
    expect(shiftVisible(ids, ids, 'd', 'next')).toEqual(ids);
  });

  it('見えていない id は動かさない', () => {
    expect(shiftVisible(ids, ['a', 'b'], 'd', 'prev')).toEqual(ids);
  });
});

describe('sameOrder', () => {
  it('同じ並びなら true', () => {
    expect(sameOrder(ids, ['a', 'b', 'c', 'd'])).toBe(true);
  });

  it('違えば false', () => {
    expect(sameOrder(ids, ['b', 'a', 'c', 'd'])).toBe(false);
    expect(sameOrder(ids, ['a', 'b', 'c'])).toBe(false);
  });
});
