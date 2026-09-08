/**
 * Google API の失敗を「画面に出せる日本語」と「再試行の可否」に読み替える。
 *
 * `gemini-error.ts` と同じ作り。**生のレスポンス本文を画面に出さない**という
 * 一点のためにあり、以前 Gemini の 503 でレスポンス JSON がそのままバナーに出た
 * のと同じことを繰り返さないようにしている。
 *
 * Google の REST API はエラーを
 * `{"error":{"code":403,"message":"...","status":"PERMISSION_DENIED"}}` で返す。
 */

/** 待てば直る類のステータス */
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

const ABORT_NAMES = ['TimeoutError', 'AbortError'];

/** HTTP の失敗を運ぶ。status を持たせて呼び出し側が分岐できるようにする。 */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    /** レスポンス本文。**ログ専用。画面には出さない** */
    readonly body: string,
  ) {
    super(`Google API ${status}`);
    this.name = 'GoogleApiError';
  }
}

function nameOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

/** HTTP ステータスを取り出す。取れなければ null */
export function statusOf(error: unknown): number | null {
  if (error instanceof GoogleApiError) return error.status;
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }
  return null;
}

/**
 * 投げ直す価値があるか。
 * 中断系は false（期限は操作全体で 1 つなので、もう予算切れを意味する）。
 */
export function isRetryable(error: unknown): boolean {
  if (ABORT_NAMES.includes(nameOf(error))) return false;
  const status = statusOf(error);
  return status !== null && RETRYABLE_STATUSES.includes(status);
}

/**
 * 画面に出す一文。**生のレスポンス本文は絶対に混ぜない。**
 * 末尾の（コード）だけ残すのは、報告を受けたときに特定できるようにするため。
 */
export function describeGoogleError(error: unknown): string {
  if (ABORT_NAMES.includes(nameOf(error))) {
    return 'Google の応答が時間内に返りませんでした。もう一度お試しください。';
  }

  const status = statusOf(error);
  if (status === null) return 'Google に接続できませんでした。';

  const code = `（${status}）`;
  switch (status) {
    case 400:
      return `Google へのリクエストが受け付けられませんでした${code}。`;
    case 401:
      return `Google の認証が切れています${code}。連携設定から接続し直してください。`;
    case 403:
      // スコープ不足も、API 自体が無効なときもここに来る
      return `Google へのアクセスが許可されていません${code}。連携設定から接続し直すか、API が有効か確認してください。`;
    case 404:
      return `Google 側に対象が見つかりませんでした${code}。`;
    case 429:
      return `Google の利用が集中しています${code}。しばらく待ってからお試しください。`;
    case 500:
    case 502:
    case 503:
    case 504:
      return `Google 側で一時的な不具合が起きています${code}。しばらく待ってからお試しください。`;
    default:
      return `Google の呼び出しに失敗しました${code}。`;
  }
}
