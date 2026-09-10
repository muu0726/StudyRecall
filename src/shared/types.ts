/**
 * API の入出力型。client / worker の双方から import する共有定義。
 * ここは Drizzle に依存させない（クライアントに ORM を引き込まないため）。
 * 日時は JSON 化された ISO 8601 文字列で受け渡す。
 */

import type { MasteryStatus } from './glossary-mastery';

export type { MasteryStatus };

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

/**
 * 出題形式。
 * 'qa' = 一問一答 / 'cloze' = 穴埋め（question の中の `____`）/ 'quiz' = 4択。
 */
export type QuestionType = 'qa' | 'cloze' | 'quiz';

export interface QuizQuestionDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  /** 学習記録由来ならその ID。ノート由来・手動追加なら null。 */
  studyLogId: string | null;
  /** ノート由来ならその ID。ノート削除時は null になる。 */
  notebookId: string | null;
  /** 用語辞書由来ならその ID。用語削除時は null になる。 */
  glossaryTermId: string | null;
  question: string;
  answer: string;
  explanation: string | null;
  /** 出題形式。既存の問題はすべて 'qa'。 */
  questionType: QuestionType;
  /** 'quiz'（4択）のときだけ 4 要素。正解は answer と文字列一致で判定する。 */
  choices: string[];
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
    /**
     * 今月これまでの AI 利用件数（JST の月）。
     * 生成した問題と登録した用語の合計 → src/worker/lib/quota.ts
     */
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

// --- 用語辞書 ---------------------------------------------------------------

/**
 * 一覧で返せる用語の上限。
 *
 * 検索と習得ステータスの絞り込みはクライアント側で畳むので（→ shared/glossary-search.ts）、
 * ここで切ったぶんは**検索の対象からも外れる**。黙って一部だけ検索するのが最悪なので、
 * 超えたら `truncated` を立てて画面で知らせる。
 */
export const GLOSSARY_LIMIT = 500;

/** 用語名の長さの上限 */
export const MAX_TERM_LENGTH = 60;
/** 意味の長さの上限 */
export const MAX_DEFINITION_LENGTH = 1_000;
/** 1 用語に付けられるタグの数 */
export const MAX_TAGS_PER_TERM = 3;

export interface GlossaryTermDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  /** ノートの選択範囲から登録した場合の出所。ノート削除時は null になる。 */
  notebookId: string | null;
  term: string;
  definition: string;
  tags: string[];
  /** カードの状態から導いた値。この用語の行には保存していない。 */
  masteryStatus: MasteryStatus;
  /** この用語から生成されたカードの枚数 */
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GlossaryTermsResponse {
  terms: GlossaryTermDTO[];
  /** GLOSSARY_LIMIT で打ち切られたか。true ならクライアント検索が全件を見ていない。 */
  truncated: boolean;
}

export interface GlossaryTermResponse {
  term: GlossaryTermDTO;
}

export interface CreateGlossaryTermRequest {
  categoryId: string;
  term: string;
  definition?: string;
  tags?: string[];
  /** ノートから登録したときの出所 */
  notebookId?: string | null;
}

export interface UpdateGlossaryTermRequest {
  term?: string;
  definition?: string;
  tags?: string[];
  categoryId?: string;
}

/** 同じカテゴリに同じ用語が既にあるときの 409 レスポンス */
export interface GlossaryDuplicateResponse {
  error: string;
  /** 既にある用語。「開いて編集する」へ誘導するために返す。 */
  term: GlossaryTermDTO;
}

/** AI 補完への入力。`definition` が空なら意味も作らせる。 */
export interface GlossaryAiAssistRequest {
  categoryId: string;
  term: string;
  /** 書きかけの意味。渡すと「これを土台に整える」動きになる */
  definition?: string;
}

export interface GlossaryAiAssistResponse {
  definition: string;
  tags: string[];
  /** 補完できなかった理由。**入力は消さずにそのまま残す** */
  warning?: string;
}

export interface DeleteGlossaryTermResponse {
  ok: true;
  /** cards=delete を指定したときに消したカードの枚数 */
  deletedCards: number;
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

// --- カレンダー -------------------------------------------------------------

/** カレンダーに載せる説明文の上限。ノートを丸ごと貼らない。 */
export const MAX_DESCRIPTION_CHARS = 1000;

export interface CalendarEventDTO {
  id: string;
  /** 空タイトルは「（タイトルなし）」に寄せる */
  title: string;
  /** JST の 'YYYY-MM-DD' */
  startDay: string;
  /** 最終日。**含む**（Google の終日 end は排他なので 1 日戻してある） */
  endDay: string;
  /** JST の 'HH:MM'。終日なら null。端末のタイムゾーンで整形させないためサーバーで作る */
  startTime: string | null;
  /** JST の 'HH:MM'。終日なら null。これが無いと編集画面が終了時刻を復元できない */
  endTime: string | null;
  /** Google の「説明」。空欄で保存して消してしまわないために持つ */
  description: string | null;
  isAllDay: boolean;
  /** 繰り返しの 1 回か。「この回だけ変わる」と伝えるために要る */
  isRecurring: boolean;
  /** このアプリから編集・削除してよいか。判定は shared/calendar-view.ts */
  canEdit: boolean;
  htmlLink: string | null;
}

/**
 * 予定の作成・更新に送る形。
 *
 * **`endDay` は DTO と同じく「最終日を含む」。** Google の排他 end への変換は
 * shared/calendar-event.ts の中だけで起きる。
 */
export interface CalendarEventInput {
  title: string;
  /** undefined は「触らない」。null と '' は「説明を消す」 */
  description?: string | null;
  isAllDay: boolean;
  startDay: string;
  endDay: string;
  /** 'HH:MM'。終日なら無視される */
  startTime: string | null;
  endTime: string | null;
}

export interface CalendarEventResponse {
  event: CalendarEventDTO;
}

export interface CalendarEventsResponse {
  /** 要求された月のエコーバック。遅れて届いた応答を捨てるのに使う */
  month: string;
  events: CalendarEventDTO[];
  /** Google と紐付いているか。未連携ならカレンダーから Google の要素を消す */
  googleLinked: boolean;
  /** 読めなかった理由。未連携もここに入る（エラーにはしない）。 */
  warning?: string;
}

// --- 外部サービス連携 -------------------------------------------------------

export interface IntegrationsDTO {
  /** Google アカウントと紐付いているか */
  linked: boolean;
  hasTasksScope: boolean;
  hasCalendarScope: boolean;
  hasDriveScope: boolean;
  /** タイマー確定時にカレンダーへ書くか */
  calendarSyncEnabled: boolean;
  /** 最後に Google Tasks を取り込んだ時刻 */
  tasksSyncedAt: string | null;
  /** 1 日 1 回、自動でバックアップするか */
  driveBackupEnabled: boolean;
  /** ノートを .md としてもミラーするか */
  driveNotesEnabled: boolean;
  /** 最後にバックアップした時刻。**裏の失敗に気付く唯一の手掛かり** */
  driveBackupAt: string | null;
}

export interface UpdateIntegrationsRequest {
  calendarSyncEnabled?: boolean;
  driveBackupEnabled?: boolean;
  driveNotesEnabled?: boolean;
}

// --- バックアップ -----------------------------------------------------------

export interface BackupFileDTO {
  id: string;
  name: string;
  createdAt: string;
  size: number | null;
}

export interface BackupFolderDTO {
  id: string;
  name: string;
  url: string | null;
}

export interface RunBackupResponse {
  /** 自動実行の条件に合わなかった。エラーではない */
  skipped?: boolean;
  reason?: string;
  file?: BackupFileDTO;
  folder?: BackupFolderDTO;
  backedUpAt?: string;
}

export interface BackupFilesResponse {
  files: BackupFileDTO[];
  folder: BackupFolderDTO | null;
}

export interface MirrorNotesResponse {
  /** 自動実行の条件に合わなかった。エラーではない */
  skipped?: boolean;
  reason?: string;
  created?: number;
  updated?: number;
  moved?: number;
  deleted?: number;
  /** 予算に入りきらなかった件数。0 になるまで押せば追いつく */
  remaining?: number;
}

export interface RestoreBackupResponse {
  ok: true;
  /** 復元した件数 */
  counts: Record<string, number>;
  /** 復元の直前に取った安全用のバックアップ */
  safetyBackup: BackupFileDTO | null;
}
