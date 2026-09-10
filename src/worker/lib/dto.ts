import type {
  CategoryDTO,
  CategoryUsage,
  GlossaryTermDTO,
  NotebookDTO,
  QuizQuestionDTO,
  StudyLogDTO,
  TaskDTO,
  TimerSessionDTO,
} from '../../shared/types';
import type {
  Category,
  GlossaryTerm,
  Notebook,
  QuizQuestion,
  StudyLog,
  Task,
  TimerSession,
} from '../../db/schema';
import { deriveMasteryStatus } from '../../shared/glossary-mastery';

/** Date → ISO 文字列。null はそのまま通す。 */
export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

const isoOrEpoch = (value: Date | null | undefined): string =>
  toIso(value) ?? new Date(0).toISOString();

const NO_USAGE: CategoryUsage = { studyLogs: 0, notebooks: 0, trashedNotebooks: 0, quizzes: 0 };

export function toCategoryDto(row: Category, usage: CategoryUsage = NO_USAGE): CategoryDTO {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    examName: row.examName,
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

/**
 * DTO を作るのに要る列だけ。**`$inferSelect` 全体を要求しない。**
 * テーブルに列を足すたびに、その列を選んでいない projection が型エラーになるため
 * （Drive のミラー用に 3 列足したときに実際そうなった）。
 */
export type NotebookRow = Pick<
  Notebook,
  'id' | 'categoryId' | 'parentId' | 'sortOrder' | 'title' | 'content' | 'createdAt' | 'updatedAt'
> &
  WithCategory;

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
    glossaryTermId: row.glossaryTermId,
    question: row.question,
    answer: row.answer,
    explanation: row.explanation,
    questionType: row.questionType,
    choices: Array.isArray(row.choices) ? row.choices : [],
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

/**
 * `glossarySelectWithStats` が返す形。**`GlossaryTerm` 全体を要求しない。**
 * termKey・userId は DTO に出さないので、選ばない projection が型エラーにならないよう
 * `NotebookRow` と同じく Pick で narrow する。
 */
export type GlossaryTermRow = Pick<
  GlossaryTerm,
  'id' | 'categoryId' | 'notebookId' | 'term' | 'definition' | 'tags' | 'createdAt' | 'updatedAt'
> &
  WithCategory & {
    cardCount: number;
    masteredCardCount: number;
    answeredCardCount: number;
  };

export function toGlossaryTermDto(row: GlossaryTermRow): GlossaryTermDTO {
  // 集計は SQL 由来で、カードが 0 枚のとき sum() が null を返す
  const cardCount = Number(row.cardCount ?? 0);
  const summary = {
    cardCount,
    masteredCardCount: Number(row.masteredCardCount ?? 0),
    answeredCardCount: Number(row.answeredCardCount ?? 0),
  };

  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    notebookId: row.notebookId,
    term: row.term,
    definition: row.definition,
    tags: Array.isArray(row.tags) ? row.tags : [],
    masteryStatus: deriveMasteryStatus(summary),
    cardCount,
    createdAt: isoOrEpoch(row.createdAt),
    updatedAt: isoOrEpoch(row.updatedAt),
  };
}

/** カテゴリは任意の紐付けなので、join で付かないこともある */
export type TaskRow = Task & { categoryName: string | null; categoryColor: string | null };

export function toTaskDto(row: TaskRow): TaskDTO {
  return {
    id: row.id,
    googleTaskId: row.googleTaskId,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    notebookId: row.notebookId,
    title: row.title,
    memo: row.memo,
    // 'YYYY-MM-DD' の文字列をそのまま通す。Date にすると日がずれる。
    dueDate: row.dueDate,
    isCompleted: row.isCompleted,
    completedAt: toIso(row.completedAt),
    syncState: row.syncState,
    createdAt: isoOrEpoch(row.createdAt),
    updatedAt: isoOrEpoch(row.updatedAt),
  };
}
