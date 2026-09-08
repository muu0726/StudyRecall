import { getTableColumns } from 'drizzle-orm';
import { quizQuestions } from '../../db/schema';
import type { Db } from './db';
import type { QuizQuestion } from '../../db/schema';

/**
 * quiz_questions への複数行 INSERT。
 *
 * **D1 は 1 クエリに渡せるバインド変数を 100 個までに制限している。**
 * 複数行 INSERT のバインド数は「行数 × 列数」なので、生成した問題をまとめて
 * 1 文で入れると行数しだいで上限を越え、こう落ちる:
 *
 *   D1_ERROR: too many SQL variables at offset 672: SQLITE_ERROR
 *
 * quiz_questions は 18 列あるので 6 行目あたりが境界で、
 * 「5 問なら通るのに 10 問だとサーバー内部エラー」という形で出る。
 * 上限に収まる行数へ分割して流す。
 */

/** D1 の 1 クエリあたりのバインド変数の上限 */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * 1 文に入れてよい行数。
 *
 * 列数を「1 行あたりのバインド数」の上限として使う。既定値を持つ列は `default`
 * キーワードになりバインドを消費しないので実際はこれより少ないが、**列が増えたときに
 * 黙って上限を越えないほう**を採る。
 */
export function maxRowsPerInsert(columnCount: number): number {
  return Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / Math.max(1, columnCount)));
}

/** rows を size 件ずつに切り分ける。size 以下ならそのまま 1 つ。 */
export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += Math.max(1, size)) {
    chunks.push(rows.slice(i, i + Math.max(1, size)));
  }
  return chunks;
}

const CHUNK_SIZE = maxRowsPerInsert(Object.keys(getTableColumns(quizQuestions)).length);

/**
 * 生成した問題をまとめて保存し、保存後の行を順番どおりに返す。
 *
 * D1 に対話的トランザクションは無いので、途中で失敗すると前のチャンクは残る。
 * 問題は独立して意味を持つ（部分的に増えても壊れない）ため、
 * 巻き戻さず例外をそのまま上へ投げる。
 */
export async function insertQuizQuestions(
  db: Db,
  rows: (typeof quizQuestions.$inferInsert)[],
): Promise<QuizQuestion[]> {
  const saved: QuizQuestion[] = [];
  for (const chunk of chunkRows(rows, CHUNK_SIZE)) {
    saved.push(...(await db.insert(quizQuestions).values(chunk).returning()));
  }
  return saved;
}
