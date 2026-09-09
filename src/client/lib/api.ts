import type {
  ApiErrorResponse,
  BackupFilesResponse,
  MirrorNotesResponse,
  RestoreBackupResponse,
  RunBackupResponse,
  CalendarEventInput,
  CalendarEventResponse,
  CalendarEventsResponse,
  CategoryInUseResponse,
  CategoryDTO,
  CreateCategoryRequest,
  CreateNotebookRequest,
  CreateStudyLogRequest,
  CreateStudyLogResponse,
  GenerateNotebookQuizResponse,
  ManualAddQuizResponse,
  NotebookDTO,
  NotebookResponse,
  NotebooksResponse,
  QuizResultResponse,
  QuizzesResponse,
  NotebookConflictResponse,
  StudyLogsResponse,
  SyncTasksResponse,
  TagsResponse,
  TaskResponse,
  TasksResponse,
  CreateTaskRequest,
  UpdateTaskRequest,
  IntegrationsDTO,
  UpdateIntegrationsRequest,
  TimerMode,
  TimerResponse,
  HeatmapResponse,
  UpdateCategoryRequest,
  UpdateNotebookRequest,
  DeleteNotebookResponse,
  MoveNotebookRequest,
} from '../../shared/types';

/**
 * HTTP は届いたがサーバーが拒否した場合のエラー。
 * ステータスと本文を保持し、409（競合）や 400（二重記録）を呼び出し側で分岐できるようにする。
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * サーバーに届かなかった場合のエラー（オフライン・DNS 失敗など）。
 * 再送すれば成功しうるので、ApiError と明確に区別する。
 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('ネットワークに接続できませんでした');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch (cause) {
    // fetch が例外を投げるのは接続自体に失敗したときだけ
    throw new NetworkError(cause);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    throw new ApiError(
      body?.error ?? `リクエストに失敗しました (HTTP ${response.status})`,
      response.status,
      body,
    );
  }
  return (await response.json()) as T;
}

export interface AuthConfig {
  googleEnabled: boolean;
  devLoginEnabled: boolean;
}

export interface QuizFilters {
  categoryId?: string;
  notebookId?: string;
  tag?: string;
  unmasteredOnly?: boolean;
  /** 出題期限が来ているものだけ（未学習を含む） */
  dueOnly?: boolean;
}

export const api = {
  // --- 認証 ---
  getAuthConfig: () => request<AuthConfig>('/api/auth-config'),

  devLogin: () => request<unknown>('/api/auth/dev-login', { method: 'POST' }),

  // --- カテゴリ ---
  listCategories: () => request<{ categories: CategoryDTO[] }>('/api/categories'),

  createCategory: (body: CreateCategoryRequest) =>
    request<{ category: CategoryDTO }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateCategory: (id: string, body: UpdateCategoryRequest) =>
    request<{ category: CategoryDTO }>(`/api/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  /**
   * フォルダを削除する。
   * options 無し = 未使用のときだけ。move = 中身を移してから。purge = 中身ごと。
   */
  deleteCategory: (id: string, options?: { mode: 'move'; moveTo: string } | { mode: 'purge' }) => {
    const params = new URLSearchParams();
    if (options) {
      params.set('mode', options.mode);
      if (options.mode === 'move') params.set('to', options.moveTo);
    }
    const query = params.toString();
    return request<{ ok: true }>(`/api/categories/${id}${query ? `?${query}` : ''}`, {
      method: 'DELETE',
    });
  },

  // --- タイマー ---
  getTimer: () => request<TimerResponse>('/api/timer'),
  startTimer: (mode: TimerMode = 'free') =>
    request<TimerResponse>('/api/timer/start', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  pauseTimer: () => request<TimerResponse>('/api/timer/pause', { method: 'POST' }),
  resumeTimer: () => request<TimerResponse>('/api/timer/resume', { method: 'POST' }),
  resetTimer: () => request<TimerResponse>('/api/timer/reset', { method: 'POST' }),

  // --- 学習記録 ---
  getStudyLogs: () => request<StudyLogsResponse>('/api/study-logs'),

  createStudyLog: (body: CreateStudyLogRequest) =>
    request<CreateStudyLogResponse>('/api/study-logs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // --- タスク（Google Tasks 連携） ---
  listTasks: () => request<TasksResponse>('/api/tasks'),

  createTask: (body: CreateTaskRequest) =>
    request<TaskResponse>('/api/tasks', { method: 'POST', body: JSON.stringify(body) }),

  updateTask: (id: string, body: UpdateTaskRequest) =>
    request<TaskResponse>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteTask: (id: string) =>
    request<{ ok: true; warning?: string }>(`/api/tasks/${id}`, { method: 'DELETE' }),

  /** 双方向の突き合わせ。未連携でもエラーにはならず warning で返る。 */
  syncTasks: () => request<SyncTasksResponse>('/api/tasks/sync', { method: 'POST' }),

  // --- カレンダー（Google Calendar の読み取り） ---
  /** その月のグリッドに載る予定。未連携でもエラーにはならず warning で返る。 */
  listCalendarEvents: (month: string) =>
    request<CalendarEventsResponse>(`/api/calendar/events?month=${encodeURIComponent(month)}`),

  /*
   * 読み取りと違い、**書き込みは失敗をそのまま失敗として返す**。
   * ローカルに置き場所が無いので、劣化した成功が作れない（routes/calendar.ts 参照）。
   */
  createCalendarEvent: (body: CalendarEventInput) =>
    request<CalendarEventResponse>('/api/calendar/events', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateCalendarEvent: (id: string, body: CalendarEventInput) =>
    request<CalendarEventResponse>(`/api/calendar/events/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteCalendarEvent: (id: string) =>
    request<{ ok: true; warning?: string }>(`/api/calendar/events/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // --- バックアップ（Google ドライブ） ---
  /**
   * バックアップを実行する。`auto` は 1 日 1 回の自動実行で、
   * **条件に合わなければ 200 + skipped で返る**（エラーにはしない）。
   */
  runBackup: (body: { auto?: boolean } = {}) =>
    request<RunBackupResponse>('/api/backup/run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listBackups: () => request<BackupFilesResponse>('/api/backup/files'),

  /** ノートを .md として Drive にミラーする。**一方通行**（Drive 側の編集は上書きされる） */
  mirrorNotes: () => request<MirrorNotesResponse>('/api/backup/notes', { method: 'POST' }),

  /** **いまの中身を消して置き換える。** 呼ぶ前に必ず確認を取ること。 */
  restoreBackup: (fileId: string) =>
    request<RestoreBackupResponse>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ fileId }),
    }),

  // --- 外部サービス連携 ---
  getIntegrations: () => request<IntegrationsDTO>('/api/integrations'),

  updateIntegrations: (body: UpdateIntegrationsRequest) =>
    request<IntegrationsDTO>('/api/integrations', { method: 'PUT', body: JSON.stringify(body) }),

  // --- クイズ ---
  listQuizzes: (options: QuizFilters = {}) => {
    const params = new URLSearchParams();
    if (options.categoryId) params.set('categoryId', options.categoryId);
    if (options.notebookId) params.set('notebookId', options.notebookId);
    if (options.tag) params.set('tag', options.tag);
    if (options.unmasteredOnly) params.set('unmasteredOnly', 'true');
    if (options.dueOnly) params.set('dueOnly', 'true');
    const query = params.toString();
    return request<QuizzesResponse>(`/api/quizzes${query ? `?${query}` : ''}`);
  },

  submitQuizResult: (id: string, correct: boolean) =>
    request<QuizResultResponse>(`/api/quizzes/${id}/result`, {
      method: 'POST',
      body: JSON.stringify({ correct }),
    }),

  manualAddQuiz: (body: { categoryId: string; term: string; description: string }) =>
    request<ManualAddQuizResponse>('/api/quizzes/manual-add', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // --- タグ ---
  listTags: () => request<TagsResponse>('/api/tags'),

  // --- 統計 ---
  getHeatmap: () => request<HeatmapResponse>('/api/stats/heatmap'),

  // --- ノートブック ---
  listNotebooks: () => request<NotebooksResponse>('/api/notebooks'),

  createNotebook: (body: CreateNotebookRequest) =>
    request<NotebookResponse>('/api/notebooks', { method: 'POST', body: JSON.stringify(body) }),

  updateNotebook: (id: string, body: UpdateNotebookRequest) =>
    request<NotebookResponse>(`/api/notebooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  /** ゴミ箱へ移す（論理削除）。完全に消すのは purgeNotebook。 */
  deleteNotebook: (id: string) =>
    request<DeleteNotebookResponse>(`/api/notebooks/${id}`, { method: 'DELETE' }),

  listTrash: () =>
    request<{ notebooks: NotebookDTO[]; totals: Record<string, number> }>(
      '/api/notebooks/trash/list',
    ),

  restoreNotebook: (id: string) =>
    request<{ ok: true; restored: number; movedToRoot: boolean }>(`/api/notebooks/${id}/restore`, {
      method: 'POST',
    }),

  purgeNotebook: (id: string) =>
    request<{ ok: true; purged: number }>(`/api/notebooks/${id}/purge`, { method: 'DELETE' }),

  moveNotebook: (id: string, body: MoveNotebookRequest) =>
    request<NotebookResponse>(`/api/notebooks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  generateNotebookQuiz: (id: string, count: number) =>
    request<GenerateNotebookQuizResponse>(`/api/notebooks/${id}/generate-quiz`, {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),
};

/** PUT /api/notebooks/:id が競合を返したか判定し、本文を型付きで取り出す */
export function asNotebookConflict(error: unknown): NotebookConflictResponse | null {
  if (error instanceof ApiError && error.status === 409) {
    const body = error.body as Partial<NotebookConflictResponse> | null;
    if (body && typeof body.currentContent === 'string' && body.notebook) {
      return body as NotebookConflictResponse;
    }
  }
  return null;
}

/** DELETE /api/categories/:id が「使用中」を返したか判定する */
export function asCategoryInUse(error: unknown): CategoryInUseResponse | null {
  if (error instanceof ApiError && error.status === 409) {
    const body = error.body as Partial<CategoryInUseResponse> | null;
    if (body && body.usage) return body as CategoryInUseResponse;
  }
  return null;
}
