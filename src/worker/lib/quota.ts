import { and, eq, gte, sql } from 'drizzle-orm';
import { quizQuestions } from '../../db/schema';
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
 */

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  exceeded: boolean;
}

export async function getMonthlyQuota(db: Db, userId: string): Promise<QuotaState> {
  const [row] = await db
    .select({ used: sql<number>`count(*)` })
    .from(quizQuestions)
    .where(
      and(eq(quizQuestions.userId, userId), gte(quizQuestions.createdAt, startOfMonthJst())),
    );

  const used = Number(row?.used ?? 0);
  const remaining = Math.max(0, MONTHLY_GENERATION_LIMIT - used);
  return { used, limit: MONTHLY_GENERATION_LIMIT, remaining, exceeded: remaining === 0 };
}

/** 上限に当たったときに返す文言。保存は通したうえで warning に載せる。 */
export function quotaWarning(quota: QuotaState): string {
  return `今月の問題生成は上限（${quota.limit} 問）に達しました。来月まで新しい問題は作れません。`;
}
