import { and, eq, gte, sql } from 'drizzle-orm';
import { glossaryTerms, quizQuestions } from '../../db/schema';
import { MONTHLY_GENERATION_LIMIT } from '../../shared/types';
import { startOfMonthJst } from './time';
import type { Db } from './db';

/**
 * Gemini の月次利用上限。
 *
 * このアプリは誰でもサインインできる状態で公開しているので、
 * URL を知った第三者の生成が**鍵の持ち主に課金される**。青天井だけは止めておく。
 *
 * **専用のカラムは持たない。** `quiz_questions.created_at` を数えれば足りる。
 * カウンタを別に持つと、生成の失敗や巻き戻しのたびにズレていく。
 * 生成が失敗して 0 件だったぶんは数えられないが、
 * ここで見たいのは「使いすぎ」であって正確な API 呼び出し回数ではない。
 *
 * **用語辞書の行も同じ数に足す。** 用語の登録は AI 補完を伴うことが多いのに
 * quiz_questions は増えないので、数えないと辞書経由の利用が丸ごと素通りする。
 * 1 行 = 1 回以上の呼び出しとみなす、という粗い見積もりで足りる。
 */

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  exceeded: boolean;
  /** 内訳。上限の判定には使わないが、どちらで食ったかを画面に出せる */
  breakdown: { cards: number; terms: number };
}

export async function getMonthlyQuota(db: Db, userId: string): Promise<QuotaState> {
  const since = startOfMonthJst();

  const [cardRow, termRow] = await Promise.all([
    db
      .select({ used: sql<number>`count(*)` })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.userId, userId), gte(quizQuestions.createdAt, since))),
    db
      .select({ used: sql<number>`count(*)` })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.userId, userId), gte(glossaryTerms.createdAt, since))),
  ]);

  const cards = Number(cardRow[0]?.used ?? 0);
  const terms = Number(termRow[0]?.used ?? 0);
  const used = cards + terms;
  const remaining = Math.max(0, MONTHLY_GENERATION_LIMIT - used);
  return {
    used,
    limit: MONTHLY_GENERATION_LIMIT,
    remaining,
    exceeded: remaining === 0,
    breakdown: { cards, terms },
  };
}

/** 上限に当たったときに返す文言。保存は通したうえで warning に載せる。 */
export function quotaWarning(quota: QuotaState): string {
  return `今月の AI 利用は上限（${quota.limit} 件）に達しました。来月まで新しく生成できません。`;
}
