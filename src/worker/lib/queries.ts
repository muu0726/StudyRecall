import { categories, quizQuestions } from '../../db/schema';

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
  question: quizQuestions.question,
  answer: quizQuestions.answer,
  explanation: quizQuestions.explanation,
  tags: quizQuestions.tags,
  isMastered: quizQuestions.isMastered,
  correctCount: quizQuestions.correctCount,
  incorrectCount: quizQuestions.incorrectCount,
  lastAnsweredAt: quizQuestions.lastAnsweredAt,
  createdAt: quizQuestions.createdAt,
  categoryName: categories.name,
  categoryColor: categories.color,
};
