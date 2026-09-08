/**
 * API の入出力型。client / worker の双方から import する共有定義。
 * ここは Drizzle に依存させない（クライアントに ORM を引き込まないため）。
 * 日時は JSON 化された ISO 8601 文字列で受け渡す。
 */

/** 「わかった」がこの回数に達すると習得済みとみなす */
export const MASTERY_THRESHOLD = 3;

/**
 * 1 ユーザーが 1 か月に生成できる問題数の上限（JST の月で数える）。
 *
 * 誰でもサインインできる状態で公開しているので、第三者の生成が
 * API キーの持ち主に課金される。青天井だけは止めておく。
 * 変えるときはこの定数を直して再デプロイする（管理 UI は持たない）。
 */
export const MONTHLY_GENERATION_LIMIT = 300;

/** 1 回の生成で作れる問題数の上限 */
export const MAX_GENERATED_QUESTIONS = 10;

/** ノートからの生成で既定とする問題数 */
export const DEFAULT_GENERATED_QUESTIONS = 5;

export interface CategoryUsage {
  studyLogs: number;
  /** 生きているノート。ゴミ箱の分は含めない */
  notebooks: number;
  /** ゴミ箱にあるノート。見えないのに削除を止めるので、分けて出す */
  trashedNotebooks: number;
  quizzes: number;
}

export interface CategoryDTO {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  /** このカテゴリを参照している件数。削除可否の判断に使う。 */
  usage: CategoryUsage;
}

export interface StudyLogDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  durationMinutes: number;
  notes: string | null;
  createdAt: string;
}

export interface NotebookDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  /** 親ノート。null ならカテゴリ直下のルート。 */
  parentId: string | null;
  /** 兄弟間の並び順。小さいほど上。 */
  sortOrder: number;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** ノートの階層の深さの上限（ルートを 1 とする） */
export const MAX_NOTE_DEPTH = 5;

export interface QuizQuestionDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  /** 学習記録由来ならその ID。ノート由来・手動追加なら null。 */
  studyLogId: string | null;
  /** ノート由来ならその ID。ノート削除時は null になる。 */
  notebookId: string | null;
  question: string;
  answer: string;
  explanation: string | null;
  tags: string[];
  isMastered: boolean;
  correctCount: number;
  incorrectCount: number;
  lastAnsweredAt: string | null;
  /** 次に出題してよくなる時刻。null は未学習で常に出題対象。→ src/shared/srs.ts */
  dueAt: string | null;
  /** 現在の出題間隔（日） */
  intervalDays: number;
  createdAt: string;
}

export interface CategoryTotal {
  categoryId: string;
  name: string;
  color: string;
  totalMinutes: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface StudyStats {
  /** JST 当日 0:00 以降の合計分数 */
  todayMinutes: number;
  /** JST 今週月曜 0:00 以降の合計分数 */
  weekMinutes: number;
  totalMinutes: number;
  byCategory: CategoryTotal[];
  quiz: {
    total: number;
    mastered: number;
    /** 0〜1。total が 0 のときは 0 */
    masteryRate: number;
    /** いま出題対象になっている問題数（未学習を含む） */
    dueNow: number;
    /** まだ期限が来ていないもののうち、最も早い出題日。無ければ null */
    nextDueAt: string | null;
    /** 今月これまでに生成した問題数（JST の月） */
    generatedThisMonth: number;
    /** 月次の上限 */
    monthlyLimit: number;
  };
}

// --- 認証 -------------------------------------------------------------------

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

// --- カテゴリ ---------------------------------------------------------------

export interface CreateCategoryRequest {
  name: string;
  color?: string;
}

export interface UpdateCategoryRequest {
  name?: string;
  color?: string;
}

/** DELETE /api/categories/:id が 409 を返したときのボディ */
export interface CategoryInUseResponse {
  error: string;
  usage: CategoryUsage;
}

// --- 学習記録 ---------------------------------------------------------------

export interface StudyLogsResponse {
  logs: StudyLogDTO[];
  stats: StudyStats;
}

export interface CreateStudyLogRequest {
  categoryId: string;
  durationMinutes: number;
  notes: string;
  /** タイマー由来の記録なら、確定するセッション ID。二重記録の防止に使う。 */
  timerSessionId?: string;
}

export interface CreateStudyLogResponse {
  log: StudyLogDTO;
  questions: QuizQuestionDTO[];
  /** 問題生成だけが失敗したときの注意文言。記録自体は保存済み。 */
  warning?: string;
}

// --- クイズ -----------------------------------------------------------------

export interface QuizzesResponse {
  questions: QuizQuestionDTO[];
}

export interface QuizResultRequest {
  correct: boolean;
}

export interface QuizResultResponse {
  question: QuizQuestionDTO;
}

/** 用語のクイック追加 */
export interface ManualAddQuizRequest {
  categoryId: string;
  term: string;
  description: string;
}

export interface ManualAddQuizResponse {
  question: QuizQuestionDTO | null;
  warning?: string;
}

// --- タグ -------------------------------------------------------------------

export interface TagsResponse {
  tags: TagCount[];
}

// --- ノートブック -----------------------------------------------------------

export interface NotebooksResponse {
  notebooks: NotebookDTO[];
}

export interface NotebookResponse {
  notebook: NotebookDTO;
}

export interface CreateNotebookRequest {
  categoryId: string;
  title: string;
  content: string;
  /** 指定するとその子として作る。カテゴリは親から継承される。 */
  parentId?: string | null;
}

export interface MoveNotebookRequest {
  /** 移動先の親。null ならカテゴリ直下のルートへ。 */
  parentId: string | null;
  /** 移動先の兄弟の中での挿入位置（0 始まり） */
  index: number;
  /** ルートへ移す場合に指定するカテゴリ。親がいる場合は無視される。 */
  categoryId?: string;
}

export interface DeleteNotebookResponse {
  ok: true;
  /** 子孫を含めて実際に削除した件数 */
  deleted: number;
}

export interface UpdateNotebookRequest {
  categoryId?: string;
  title?: string;
  content?: string;
  /** 読み込んだ時点の updatedAt（ISO 文字列 or ミリ秒）。楽観的ロックのトークン。 */
  expectedUpdatedAt?: string | number;
  /** 競合を承知で上書きする場合に true。expectedUpdatedAt より優先される。 */
  force?: boolean;
}

/** PUT /api/notebooks/:id が 409 を返したときのボディ */
export interface NotebookConflictResponse {
  error: string;
  /** サーバー側の最新本文 */
  currentContent: string;
  /** サーバー側の最新状態 */
  notebook: NotebookDTO;
}

export interface GenerateNotebookQuizRequest {
  count?: number;
}

export interface GenerateNotebookQuizResponse {
  questions: QuizQuestionDTO[];
  warning?: string;
}

// --- タイマー ---------------------------------------------------------------

export type TimerMode = 'free' | 'pomodoro';

/** ポモドーロ 1 サイクル: 25分集中 + 5分休憩 */
export const POMODORO_WORK_MS = 25 * 60 * 1000;
export const POMODORO_BREAK_MS = 5 * 60 * 1000;
export const POMODORO_CYCLE_MS = POMODORO_WORK_MS + POMODORO_BREAK_MS;

export interface TimerSessionDTO {
  id: string;
  /** 現在の計測区間の開始時刻（ISO） */
  startedAt: string;
  isRunning: boolean;
  /** サーバーが算出した経過ミリ秒。端末の時計ずれを避けるためこれを基準にする。 */
  elapsedMs: number;
  mode: TimerMode;
  createdAt: string;
}

export interface StartTimerRequest {
  mode?: TimerMode;
}

// --- ヒートマップ -----------------------------------------------------------

export interface HeatmapDay {
  /** JST の日付 YYYY-MM-DD */
  date: string;
  /** 学習時間（分） */
  minutes: number;
  /** その日に解いた問題数 */
  quizzes: number;
  /** 濃淡の基準に使う値 = minutes */
  count: number;
  /** 0（なし）〜 4（最も濃い） */
  level: 0 | 1 | 2 | 3 | 4;
}

export interface HeatmapResponse {
  /** 古い順。今日までの連続した日付が全て入る（学習が無い日も level 0 で含む） */
  days: HeatmapDay[];
  totalMinutes: number;
  totalQuizzes: number;
  /** 今日まで連続して学習した日数 */
  currentStreak: number;
  longestStreak: number;
}

export interface TimerResponse {
  /** 稼働中のセッション。無ければ null */
  session: TimerSessionDTO | null;
}

// --- 共通 -------------------------------------------------------------------

export interface ApiErrorResponse {
  error: string;
}

// --- タスク（Google Tasks 連携） --------------------------------------------

export interface TaskDTO {
  id: string;
  /** Google Tasks 側の ID。null なら「まだ Google に送れていない」 */
  googleTaskId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  notebookId: string | null;
  title: string;
  memo: string | null;
  /** 期日。'YYYY-MM-DD'（JST の日付）。Date を経由させないため文字列で持つ。 */
  dueDate: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  /** 'pending' なら、この変更はまだ Google に届いていない */
  syncState: 'pending' | 'synced';
  createdAt: string;
  updatedAt: string;
}

export interface TasksResponse {
  tasks: TaskDTO[];
  /**
   * Google アカウントが紐付いているか。**スコープの有無は見ない。**
   * 一度も連携していない人には、タスク画面から Google 関連の表示を全て外すために使う。
   */
  googleLinked: boolean;
}

export interface CreateTaskRequest {
  title: string;
  memo?: string | null;
  dueDate?: string | null;
  categoryId?: string | null;
  notebookId?: string | null;
}

export interface UpdateTaskRequest {
  title?: string;
  memo?: string | null;
  dueDate?: string | null;
  categoryId?: string | null;
  notebookId?: string | null;
  isCompleted?: boolean;
}

export interface TaskResponse {
  task: TaskDTO;
  /** Google への送信だけが失敗したときの但し書き。保存自体は成功している。 */
  warning?: string;
}

export interface SyncTasksResponse {
  tasks: TaskDTO[];
  /** 取り込み・送信した件数。0 でも失敗ではない。 */
  pulled: number;
  pushed: number;
  syncedAt: string | null;
  /** 同期できなかった理由。未連携もここに入る（エラーにはしない）。 */
  warning?: string;
}

// --- 外部サービス連携 -------------------------------------------------------

export interface IntegrationsDTO {
  /** Google アカウントと紐付いているか */
  linked: boolean;
  hasTasksScope: boolean;
  hasCalendarScope: boolean;
  /** タイマー確定時にカレンダーへ書くか */
  calendarSyncEnabled: boolean;
  /** 最後に Google Tasks を取り込んだ時刻 */
  tasksSyncedAt: string | null;
}

export interface UpdateIntegrationsRequest {
  calendarSyncEnabled?: boolean;
}
