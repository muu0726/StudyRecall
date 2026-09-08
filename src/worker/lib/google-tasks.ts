import type { RemoteTask } from '../../shared/task-sync';
import { GoogleApiError, isRetryable } from './google-error';

/**
 * Google Tasks REST API の薄いラッパ。
 *
 * SDK は入れない。使うのは 4 本のエンドポイントだけで、依存を 1 つ増やす価値がない
 * （Workers で確実に動くことも自分で確かめられる）。
 *
 * 対象リストは **`@default`**（Google ToDo を開いて最初に見えるリスト）に固定する。
 */

const BASE = 'https://tasks.googleapis.com/tasks/v1';
/** Google ToDo の既定リスト。ID を引かなくても指せる予約語。 */
const LIST = '@default';
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1_500];
/** 1 回の同期で取り込む上限。Google の最大は 100。 */
const PAGE_SIZE = 100;
/** 暴走を止める。これを超えるページがあるなら、そもそも運用が破綻している。 */
const MAX_PAGES = 10;

/** Google が返す 1 件。使う項目だけ拾う。 */
interface RawTask {
  id?: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
  updated?: string;
  deleted?: boolean;
}

/** 送るときの形。null を渡すと「消す」意味になるので、型で区別する。 */
export interface TaskPayload {
  title: string;
  notes: string | null;
  due: string | null;
  status: 'needsAction' | 'completed';
}

async function call(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown | null> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${BASE}${path}`, {
        ...init,
        signal: deadline,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });

      if (!response.ok) {
        // 本文はログ用にだけ持つ。画面には describeGoogleError の文言しか出さない。
        throw new GoogleApiError(response.status, await response.text().catch(() => ''));
      }
      // DELETE は 204 を返す
      if (response.status === 204) return null;
      return await response.json();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS - 1 || !isRetryable(error)) throw error;
      const wait = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      console.warn(`[google-tasks] retrying in ${wait}ms (${attempt + 1}):`, error);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/** 実行時に形を確かめる。id と updated が無いものは突き合わせに使えないので捨てる。 */
function toRemoteTask(raw: RawTask): RemoteTask | null {
  if (typeof raw.id !== 'string' || typeof raw.updated !== 'string') return null;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    due: typeof raw.due === 'string' ? raw.due : null,
    status: raw.status === 'completed' ? 'completed' : 'needsAction',
    updated: raw.updated,
    deleted: raw.deleted === true,
  };
}

/**
 * 差分を取る。
 *
 * **`showDeleted` を必ず付ける。** 付けないと削除済みが一覧から消えるだけになり、
 * 「一覧に無い＝変更なし」と区別が付かず、Google 側の削除を取り込めない。
 * `showHidden` は完了して隠されたものを拾うために要る。
 */
export async function listTasks(
  accessToken: string,
  updatedMin: Date | null,
): Promise<RemoteTask[]> {
  const results: RemoteTask[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      maxResults: String(PAGE_SIZE),
      showCompleted: 'true',
      showDeleted: 'true',
      showHidden: 'true',
    });
    if (updatedMin) params.set('updatedMin', updatedMin.toISOString());
    if (pageToken) params.set('pageToken', pageToken);

    const body = (await call(accessToken, `/lists/${LIST}/tasks?${params}`)) as {
      items?: RawTask[];
      nextPageToken?: string;
    } | null;

    for (const raw of body?.items ?? []) {
      const task = toRemoteTask(raw);
      if (task) results.push(task);
    }

    pageToken = body?.nextPageToken;
    if (!pageToken) break;
  }

  return results;
}

function toBody(payload: TaskPayload): Record<string, unknown> {
  return {
    title: payload.title,
    // null を明示的に送ると Google 側の値が消える。undefined では消えない。
    notes: payload.notes ?? null,
    due: payload.due ?? null,
    status: payload.status,
    // 完了に落とすときは completed を送らない（Google が自分で埋める）
  };
}

export async function insertTask(
  accessToken: string,
  payload: TaskPayload,
): Promise<RemoteTask | null> {
  const raw = (await call(accessToken, `/lists/${LIST}/tasks`, {
    method: 'POST',
    body: JSON.stringify(toBody(payload)),
  })) as RawTask | null;
  return raw ? toRemoteTask(raw) : null;
}

export async function patchTask(
  accessToken: string,
  googleTaskId: string,
  payload: TaskPayload,
): Promise<RemoteTask | null> {
  const raw = (await call(accessToken, `/lists/${LIST}/tasks/${encodeURIComponent(googleTaskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(toBody(payload)),
  })) as RawTask | null;
  return raw ? toRemoteTask(raw) : null;
}

export async function deleteTask(accessToken: string, googleTaskId: string): Promise<void> {
  try {
    await call(accessToken, `/lists/${LIST}/tasks/${encodeURIComponent(googleTaskId)}`, {
      method: 'DELETE',
    });
  } catch (error) {
    // 既に向こうで消えている。消したい結果は達成されているので通す。
    if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}
