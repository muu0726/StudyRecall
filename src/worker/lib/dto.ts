import type {
  CategoryDTO,
  CategoryUsage,
  NotebookDTO,
  QuizQuestionDTO,
  StudyLogDTO,
  TimerSessionDTO,
} from '../../shared/types';
import type {
  Category,
  Notebook,
  QuizQuestion,
  StudyLog,
  TimerSession,
} from '../../db/schema';

/** Date → ISO 文字列。null はそのまま通す。 */
export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

const isoOrEpoch = (value: Date | null | undefined): string =>
  toIso(value) ?? new Date(0).toISOString();

const NO_USAGE: CategoryUsage = { studyLogs: 0, notebooks: 0, quizzes: 0 };

export function toCategoryDto(row: Category, usage: CategoryUsage = NO_USAGE): CategoryDTO {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: isoOrEpoch(row.createdAt),
    usage,
  };
}

/**
 * 経過時間はサーバー側で確定させて返す。
 * 端末の時計がずれていても表示が食い違わないようにするため。
 */
export function toTimerSessionDto(row: TimerSession, now: Date = new Date()): TimerSessionDTO {
  const runningMs = row.isRunning ? now.getTime() - row.startedAt.getTime() : 0;
  return {
    id: row.id,
    startedAt: isoOrEpoch(row.startedAt),
    isRunning: row.isRunning,
    elapsedMs: Math.max(0, row.accumulatedMs + runningMs),
    mode: row.mode,
    createdAt: isoOrEpoch(row.createdAt),
  };
}

/** カテゴリ名・色を join したときに付く追加フィールド */
type WithCategory = { categoryName: string; categoryColor: string };

export type StudyLogRow = StudyLog & WithCategory;

export function toStudyLogDto(row: StudyLogRow): StudyLogDTO {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    durationMinutes: row.durationMinutes,
    notes: row.notes,
    createdAt: isoOrEpoch(row.createdAt),
  };
}

export type NotebookRow = Notebook & WithCategory;

export function toNotebookDto(row: NotebookRow): NotebookDTO {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    title: row.title,
    content: row.content,
    createdAt: isoOrEpoch(row.createdAt),
    updatedAt: isoOrEpoch(row.updatedAt),
  };
}

export type QuizQuestionRow = QuizQuestion & WithCategory;

export function toQuizQuestionDto(row: QuizQuestionRow): QuizQuestionDTO {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    studyLogId: row.studyLogId,
    notebookId: row.notebookId,
    question: row.question,
    answer: row.answer,
    explanation: row.explanation,
    // json モードのカラムだが、古い行や手書き SQL 由来で配列でない可能性を潰しておく
    tags: Array.isArray(row.tags) ? row.tags : [],
    isMastered: row.isMastered,
    correctCount: row.correctCount,
    incorrectCount: row.incorrectCount,
    lastAnsweredAt: toIso(row.lastAnsweredAt),
    dueAt: toIso(row.dueAt),
    intervalDays: row.intervalDays,
    createdAt: isoOrEpoch(row.createdAt),
  };
}
