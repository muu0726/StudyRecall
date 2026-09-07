/**
 * Gemini の失敗を「画面に出せる日本語」と「再試行の可否」に読み替える。
 *
 * **`gemini.ts` から切り離してあるのは、`@google/genai` を読み込まずにテストするため。**
 * ここが壊れていたせいで、503 のときに API のレスポンス JSON がそのまま画面へ出た。
 * SDK の `ApiError` は `message` に **`JSON.stringify(errorBody)` をそのまま入れる**
 * （`@google/genai/dist/index.mjs` の `throwErrorIfNotOK`）ので、
 * message を文言に埋めると必ず生の JSON が漏れる。
 *
 * 生の中身は捨てない。呼び出し側が `console.error` に出す。画面に出さないだけ。
 */

/** 待てば直る類のステータス */
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

/** 中断系の例外名。`AbortSignal.timeout` は TimeoutError を投げる */
const ABORT_NAMES = ['TimeoutError', 'AbortError'];

function nameOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

function messageOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error ?? '');
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

/**
 * HTTP ステータスを取り出す。取れなければ null。
 *
 * `error.status` を先に見る。ストリーミング経路の `ApiError` はここにレスポンス本文の
 * `code` を入れてくるが、値は同じなので区別しなくてよい。
 */
export function statusOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }
  // status を持たない形で飛んでくることがあるので、本文の JSON からも拾う
  const matched = /"code"\s*:\s*(\d{3})\b/.exec(messageOf(error));
  return matched ? Number(matched[1]) : null;
}

/**
 * 投げ直す価値があるか。
 *
 * **中断系は false。** 期限は全試行で 1 つなので、timeout はもう予算切れを意味する。
 * そこで投げ直しても同じ signal ですぐ落ちるだけ。
 */
export function isRetryable(error: unknown): boolean {
  if (ABORT_NAMES.includes(nameOf(error))) return false;
  const status = statusOf(error);
  return status !== null && RETRYABLE_STATUSES.includes(status);
}

/**
 * サーバーが RetryInfo で指定してきた待ち時間（ms）。無ければ null。
 * 429 のときに `"retryDelay": "25s"` の形で入ってくることがある。
 */
export function retryDelayMs(error: unknown): number | null {
  const matched = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(messageOf(error));
  if (!matched) return null;
  return Math.round(Number(matched[1]) * 1000);
}

/**
 * 画面に出す一文。
 *
 * **生のレスポンス本文は絶対に混ぜない。** 末尾の `（コード）` だけ残すのは、
 * 「うまくいきません」と報告されたときに何が起きたか特定できるようにするため。
 */
export function describeGeminiError(error: unknown): string {
  if (ABORT_NAMES.includes(nameOf(error))) {
    return 'AI の応答が時間内に返りませんでした。もう一度お試しください。';
  }

  const status = statusOf(error);
  if (status === null) return 'AI に接続できませんでした。';

  const code = `（${status}）`;
  switch (status) {
    case 400:
      return `AI へのリクエストが受け付けられませんでした${code}。`;
    case 401:
    case 403:
      return `AI の認証に失敗しました${code}。APIキーの設定を確認してください。`;
    case 404:
      return `AI モデルが見つかりませんでした${code}。`;
    case 429:
      return `AI の利用が集中しています${code}。無料枠の上限に当たった可能性があります。しばらく待ってからお試しください。`;
    case 503:
      return `AI が混み合っています${code}。しばらく待ってからもう一度お試しください。`;
    case 500:
    case 502:
    case 504:
      return `AI 側で一時的な不具合が起きています${code}。しばらく待ってからお試しください。`;
    default:
      return `AI の呼び出しに失敗しました${code}。`;
  }
}
