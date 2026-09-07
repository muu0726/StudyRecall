import { describe, expect, it } from 'vitest';
import { describeGeminiError, isRetryable, retryDelayMs, statusOf } from './gemini-error';

/**
 * ここが壊れると、AI 側の障害がそのまま**読めない文字列**として画面に出る。
 * 実際に 503 のとき、レスポンス JSON がまるごとバナーに表示された。
 *
 * SDK は import しない。`ApiError` は `message` に本文の JSON、`status` に
 * HTTP ステータスを入れるだけなので、同じ形を手で組めば十分に固定できる。
 */

/** `@google/genai` の ApiError と同じ形 */
function apiError(body: unknown, status?: number): Error {
  const error = new Error(JSON.stringify(body));
  error.name = 'ApiError';
  if (status !== undefined) Object.assign(error, { status });
  return error;
}

/** `AbortSignal.timeout` が投げるもの */
function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

/** 今回ユーザーが実際に見た本文 */
const HIGH_DEMAND = {
  error: {
    code: 503,
    message:
      'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
    status: 'UNAVAILABLE',
  },
};

describe('statusOf', () => {
  it('status プロパティから読む', () => {
    expect(statusOf(apiError(HIGH_DEMAND, 503))).toBe(503);
  });

  it('status が無ければ本文の code から読む', () => {
    expect(statusOf(apiError(HIGH_DEMAND))).toBe(503);
  });

  it('どちらも無ければ null', () => {
    expect(statusOf(new TypeError('fetch failed'))).toBeNull();
    expect(statusOf(null)).toBeNull();
    expect(statusOf('文字列')).toBeNull();
  });
});

describe('isRetryable', () => {
  it('混雑・サーバー側の一時障害は投げ直す', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryable(apiError({ error: { code: status } }, status))).toBe(true);
    }
  });

  it('こちらの誤りは投げ直さない', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(isRetryable(apiError({ error: { code: status } }, status))).toBe(false);
    }
  });

  /**
   * 期限は全試行で 1 つなので、timeout はもう予算切れという意味。
   * 投げ直しても同じ signal ですぐ落ちる。
   */
  it('中断は投げ直さない', () => {
    expect(isRetryable(timeoutError())).toBe(false);
  });

  it('ステータスが分からないものは投げ直さない', () => {
    expect(isRetryable(new TypeError('fetch failed'))).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('RetryInfo の秒数を ms にする', () => {
    const error = apiError({
      error: { code: 429, details: [{ '@type': 'RetryInfo', retryDelay: '25s' }] },
    });
    expect(retryDelayMs(error)).toBe(25_000);
  });

  it('小数の秒も扱える', () => {
    const error = apiError({ error: { details: [{ retryDelay: '1.5s' }] } });
    expect(retryDelayMs(error)).toBe(1_500);
  });

  it('指定が無ければ null', () => {
    expect(retryDelayMs(apiError(HIGH_DEMAND, 503))).toBeNull();
  });
});

describe('describeGeminiError', () => {
  /** これが今回の退行そのもの */
  it('生のレスポンス本文を画面文言に混ぜない', () => {
    const message = describeGeminiError(apiError(HIGH_DEMAND, 503));
    expect(message).not.toContain('{');
    expect(message).not.toContain('high demand');
    expect(message).not.toContain('UNAVAILABLE');
    // 何が起きたかは特定できるようにコードだけ残す
    expect(message).toContain('503');
    expect(message).toContain('混み合っています');
  });

  it('ステータスごとに言い分けている', () => {
    expect(describeGeminiError(apiError({}, 429))).toContain('無料枠');
    expect(describeGeminiError(apiError({}, 403))).toContain('APIキー');
    expect(describeGeminiError(apiError({}, 404))).toContain('モデル');
    expect(describeGeminiError(apiError({}, 500))).toContain('一時的な不具合');
  });

  it('知らないステータスでも読める文にする', () => {
    const message = describeGeminiError(apiError({}, 418));
    expect(message).toContain('418');
    expect(message).not.toContain('{');
  });

  it('中断は待ち時間の話にする', () => {
    expect(describeGeminiError(timeoutError())).toContain('時間内に返りませんでした');
  });

  it('ステータスが取れなくても文言を返す', () => {
    expect(describeGeminiError(new TypeError('fetch failed'))).toBe('AI に接続できませんでした。');
  });
});
