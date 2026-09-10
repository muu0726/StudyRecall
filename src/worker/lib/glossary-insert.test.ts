import { describe, expect, it } from 'vitest';
import { D1_MAX_BOUND_PARAMS, chunkRows } from './quiz-insert';
import { GLOSSARY_INSERT_CHUNK_SIZE } from './glossary-insert';

/**
 * D1 を用意できないので、確かめられるのは分割の境界だけ。
 * ここが動くと `too many SQL variables` が出るので、テーブル定義の変更に気付けるようにする。
 */

describe('GLOSSARY_INSERT_CHUNK_SIZE', () => {
  /**
   * glossary_terms は 10 列。10 行 × 10 列 = ちょうど 100 で**余白がゼロ**。
   * 列が 1 本増えれば 9 行に下がる（`getTableColumns` から数えているので自動）。
   * 増えたことにここで気付けるよう固定する。
   */
  it('10 行ずつになる', () => {
    expect(GLOSSARY_INSERT_CHUNK_SIZE).toBe(10);
  });

  it('行数 × 列数が D1 の上限を越えない', () => {
    expect(GLOSSARY_INSERT_CHUNK_SIZE * 10).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
  });

  it('上限いっぱいの 100 件は 10 回に分かれる', () => {
    const rows = Array.from({ length: 100 }, (_, i) => i);
    expect(chunkRows(rows, GLOSSARY_INSERT_CHUNK_SIZE)).toHaveLength(10);
  });

  it('端数が出ても順番を保つ', () => {
    const rows = Array.from({ length: 15 }, (_, i) => i);
    const chunks = chunkRows(rows, GLOSSARY_INSERT_CHUNK_SIZE);
    expect(chunks).toHaveLength(2);
    expect(chunks.flat()).toEqual(rows);
  });

  it('空なら 1 文も投げない', () => {
    expect(chunkRows([], GLOSSARY_INSERT_CHUNK_SIZE)).toEqual([]);
  });
});
