/**
 * 用語の習得ステータス。
 *
 * **列に持たず、カードの状態から毎回導く。**
 *
 * 持つと、書き戻す場所が `POST /api/quizzes/:id/result` になる。そこは
 * 読み取り→書き込みになるので、同じ用語の 2 枚を続けて答えると取りこぼす余地が出る。
 * さらにこのアプリはオフラインの判定を `offline-queue` に溜めて後から流すので、
 * 「列は古いまま、カードだけ新しい」状態が普通に起きる。
 * 導出なら、次に辞書を開いた時点で必ず正しい。修復も移行も要らない。
 */

export type MasteryStatus = 'unlearned' | 'reviewing' | 'mastered';

export interface CardMasterySummary {
  /** その用語から生成されたカードの枚数 */
  cardCount: number;
  /** そのうち isMastered が立っている枚数 */
  masteredCardCount: number;
  /** そのうち一度でも解答された枚数（correctCount + incorrectCount > 0） */
  answeredCardCount: number;
}

/**
 * カードが 0 枚          → 'unlearned'（まだ問題を作っていない）
 * 1 枚も解答していない    → 'unlearned'
 * **全部**が isMastered → 'mastered'
 * それ以外              → 'reviewing'
 *
 * 「全部」にしているのは、1 形式だけ覚えた状態を習得と呼ばないため。
 * 穴埋めは通るが 4 択だと落とす、は「まだ覚えていない」に近い。
 * 逆に一度でも間違えると quiz_questions.isMastered が false に戻る
 * （routes/quizzes.ts）ので、この式は自然に 'reviewing' へ落ちる。
 */
export function deriveMasteryStatus(summary: CardMasterySummary): MasteryStatus {
  if (summary.cardCount <= 0) return 'unlearned';
  if (summary.answeredCardCount <= 0) return 'unlearned';
  return summary.masteredCardCount >= summary.cardCount ? 'mastered' : 'reviewing';
}

export const MASTERY_LABELS: Record<MasteryStatus, string> = {
  unlearned: '未習得',
  reviewing: '復習中',
  mastered: 'マスター',
};

/** 一覧のバッジに出す件数。 */
export function countByMastery(statuses: readonly MasteryStatus[]): Record<MasteryStatus, number> {
  const counts: Record<MasteryStatus, number> = { unlearned: 0, reviewing: 0, mastered: 0 };
  for (const status of statuses) counts[status] += 1;
  return counts;
}
