import { describe, expect, it } from 'vitest';
import { MAX_IDS_PER_IN, chunkIds } from './d1-in';
import { D1_MAX_BOUND_PARAMS } from './quiz-insert';

describe('chunkIds', () => {
  /* ノートの更新では userId と SET の値が 1 つずつ足される。余白を削ると上限を越える */
  it('1 回に入れる数は、他の変数の余白を残して上限より少ない', () => {
    expect(MAX_IDS_PER_IN).toBe(90);
    expect(MAX_IDS_PER_IN + 2).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
  });

  /* 110 件の子孫を持つフォルダで 500 になったのを再現した件数 */
  it('111 件は 2 回に分かれ、どの塊も上限に収まる', () => {
    const ids = Array.from({ length: 111 }, (_, i) => `nb_${i}`);
    const chunks = chunkIds(ids);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= MAX_IDS_PER_IN)).toBe(true);
  });

  it('順番と中身を保つ', () => {
    const ids = Array.from({ length: 200 }, (_, i) => i);
    expect(chunkIds(ids).flat()).toEqual(ids);
  });

  it('上限ちょうどは 1 回', () => {
    expect(chunkIds(Array.from({ length: MAX_IDS_PER_IN }, (_, i) => i))).toHaveLength(1);
  });

  /* 空の IN (...) を投げない */
  it('空なら 1 つも作らない', () => {
    expect(chunkIds([])).toEqual([]);
  });
});
