import { describe, expect, it } from 'vitest';
import { D1_MAX_BOUND_PARAMS, chunkRows, maxRowsPerInsert } from './quiz-insert';

describe('maxRowsPerInsert', () => {
  it('行数 × 列数 が D1 の上限を越えない', () => {
    for (const columns of [1, 2, 5, 17, 18, 19, 50, 99, 100]) {
      expect(maxRowsPerInsert(columns) * columns).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    }
  });

  it('quiz_questions の 18 列では 5 行', () => {
    expect(maxRowsPerInsert(18)).toBe(5);
  });

  /**
   * 用語辞書で glossary_term_id / question_type / choices を足して 21 列になった。
   * CHUNK_SIZE はモジュール読み込み時に列数から導出しているので**勝手に下がる**が、
   * 誰かが列を足して境界を割ったときに気付けるよう、ここで固定しておく。
   */
  it('quiz_questions の 21 列では 4 行', () => {
    expect(maxRowsPerInsert(21)).toBe(4);
    // 10 問生成は 4 + 4 + 2 の 3 回に分かれる
    expect(
      chunkRows(
        Array.from({ length: 10 }, (_, i) => i),
        maxRowsPerInsert(21),
      ),
    ).toHaveLength(3);
  });

  it('列が上限より多くても 0 を返さない（無限ループになる）', () => {
    expect(maxRowsPerInsert(200)).toBe(1);
    expect(maxRowsPerInsert(0)).toBeGreaterThanOrEqual(1);
  });
});

describe('chunkRows', () => {
  it('上限以下ならそのまま 1 つ', () => {
    expect(chunkRows([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it('上限で切り、順番を保つ', () => {
    expect(chunkRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
    ]);
    expect(chunkRows([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7],
    ]);
  });

  it('空なら 1 つも作らない（空の INSERT を投げない）', () => {
    expect(chunkRows([], 5)).toEqual([]);
  });

  it('size が 0 でも進む', () => {
    expect(chunkRows([1, 2], 0)).toEqual([[1], [2]]);
  });
});
