import { getTableColumns } from 'drizzle-orm';
import { glossaryTerms } from '../../db/schema';
import { chunkRows, maxRowsPerInsert } from './quiz-insert';
import type { Db } from './db';

/**
 * 用語をまとめて流し込む。
 *
 * **D1 のバインド変数の上限（1 クエリ 100 個）に当たるので、必ずここを通す。**
 * 上限そのものと分割の道具は `quiz-insert.ts` にあるものを使い回す
 * （`backup-data.ts` も同じ import をしている）。あちらの冒頭コメントは
 * `quiz_questions` の話に閉じているので、テーブルごとの入口はこちらに分ける。
 *
 * **一意インデックス `glossary_terms_user_category_key_unq` に当たっても落とさない。**
 * 事前に重複を弾いてはいるが、
 *   - 別のタブが同じ用語を先に登録した
 *   - 画面が持っている一覧が `GLOSSARY_LIMIT` で切れていた
 * のような取りこぼしは残る。そのまま流すと**競合した 1 行が 10 行のチャンクごと落とす**ので、
 * `onConflictDoNothing()` にして「例外」ではなく「数えられる結果」にしてある。
 */

/**
 * 1 文あたりの行数。
 *
 * glossary_terms は 10 列なので `floor(100 / 10) = 10`。
 * **ちょうど 100 で余白がゼロ。** 列が 1 本増えれば 9 行に下がる（列数はテーブル定義から数える）。
 */
export const GLOSSARY_INSERT_CHUNK_SIZE = maxRowsPerInsert(
  Object.keys(getTableColumns(glossaryTerms)).length,
);

export interface GlossaryInsertResult {
  /** 実際に入った行の id。渡した id との差が、一意インデックスに弾かれた行 */
  insertedIds: string[];
}

export async function insertGlossaryTerms(
  db: Db,
  rows: (typeof glossaryTerms.$inferInsert)[],
): Promise<GlossaryInsertResult> {
  const insertedIds: string[] = [];

  /*
   * D1 に対話的トランザクションが無いので、途中で落ちれば一部だけ入る。
   * 用語は 1 件ずつ独立して意味を持つ（部分的に増えても壊れない）ため、
   * 巻き戻さずそのまま上へ投げる。quiz-insert.ts と同じ判断。
   */
  for (const chunk of chunkRows(rows, GLOSSARY_INSERT_CHUNK_SIZE)) {
    const saved = await db
      .insert(glossaryTerms)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: glossaryTerms.id });
    insertedIds.push(...saved.map((row) => row.id));
  }

  return { insertedIds };
}
