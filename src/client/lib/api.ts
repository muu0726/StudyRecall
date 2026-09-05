import type {
  ApiErrorResponse,
  CategoryInUseResponse,
  CategoryDTO,
  CreateCategoryRequest,
  CreateNotebookRequest,
  CreateStudyLogRequest,
  CreateStudyLogResponse,
  GenerateNotebookQuizResponse,
  ManualAddQuizResponse,
  NotebookResponse,
  NotebooksResponse,
  QuizResultResponse,
  QuizzesResponse,
  NotebookConflictResponse,
  StudyLogsResponse,
  TagsResponse,
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

  deleteCategory: (id: string) =>
    request<{ ok: true }>(`/api/categories/${id}`, { method: 'DELETE' }),

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

  // --- クイズ ---
  listQuizzes: (options: QuizFilters = {}) => {
    const params = new URLSearchParams();
    if (options.categoryId) params.set('categoryId', options.categoryId);
    if (options.notebookId) params.set('notebookId', options.notebookId);
    if (options.tag) params.set('tag', options.tag);
    if (options.unmasteredOnly) params.set('unmasteredOnly', 'true');
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

  deleteNotebook: (id: string) =>
    request<DeleteNotebookResponse>(`/api/notebooks/${id}`, { method: 'DELETE' }),

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
