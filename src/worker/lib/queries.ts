import { and, eq, sql } from 'drizzle-orm';
import { categories, glossaryTerms, quizQuestions } from '../../db/schema';

/**
 * quiz_questions をカテゴリ名・色付きで取得するときの共通 projection。
 * quizzes / notebooks / study-logs の各ルートで同じ形の DTO を返すために共有する。
 */
export const quizSelectWithCategory = {
  id: quizQuestions.id,
  userId: quizQuestions.userId,
  categoryId: quizQuestions.categoryId,
  studyLogId: quizQuestions.studyLogId,
  notebookId: quizQuestions.notebookId,
  glossaryTermId: quizQuestions.glossaryTermId,
  question: quizQuestions.question,
  answer: quizQuestions.answer,
  explanation: quizQuestions.explanation,
  questionType: quizQuestions.questionType,
  choices: quizQuestions.choices,
  tags: quizQuestions.tags,
  isMastered: quizQuestions.isMastered,
  correctCount: quizQuestions.correctCount,
  incorrectCount: quizQuestions.incorrectCount,
  lastAnsweredAt: quizQuestions.lastAnsweredAt,
  dueAt: quizQuestions.dueAt,
  intervalDays: quizQuestions.intervalDays,
  easeFactor: quizQuestions.easeFactor,
  repetitions: quizQuestions.repetitions,
  createdAt: quizQuestions.createdAt,
  categoryName: categories.name,
  categoryColor: categories.color,
};

/**
 * glossary_terms をカテゴリ名・色と、その用語から作ったカードの集計付きで取る。
 *
 * 習得ステータスはこの 3 つのカウントから `deriveMasteryStatus()` が決める
 * （→ src/shared/glossary-mastery.ts）。**用語の行には保存しない。**
 *
 * 使い方:
 *   .from(glossaryTerms)
 *   .innerJoin(categories, eq(glossaryTerms.categoryId, categories.id))
 *   .leftJoin(quizQuestions, glossaryCardsJoin(userId))
 *   .groupBy(glossaryTerms.id)
 */
export const glossarySelectWithStats = {
  id: glossaryTerms.id,
  categoryId: glossaryTerms.categoryId,
  notebookId: glossaryTerms.notebookId,
  term: glossaryTerms.term,
  definition: glossaryTerms.definition,
  tags: glossaryTerms.tags,
  createdAt: glossaryTerms.createdAt,
  updatedAt: glossaryTerms.updatedAt,
  categoryName: categories.name,
  categoryColor: categories.color,
  cardCount: sql<number>`count(${quizQuestions.id})`,
  masteredCardCount: sql<number>`sum(case when ${quizQuestions.isMastered} then 1 else 0 end)`,
  answeredCardCount: sql<number>`sum(case when ${quizQuestions.correctCount} + ${quizQuestions.incorrectCount} > 0 then 1 else 0 end)`,
};

/**
 * 集計する側の join 条件。
 * **userId を条件に入れる。** 入れないと、万一 glossary_term_id が他人の行を
 * 指していたときに他人のカードを数えてしまう。
 */
export function glossaryCardsJoin(userId: string) {
  return and(eq(quizQuestions.glossaryTermId, glossaryTerms.id), eq(quizQuestions.userId, userId));
}
