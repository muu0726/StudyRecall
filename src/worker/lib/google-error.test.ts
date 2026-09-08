import { describe, expect, it } from 'vitest';
import { GoogleApiError, describeGoogleError, isRetryable, statusOf } from './google-error';

/**
 * `gemini-error.test.ts` と同じ趣旨。**生のレスポンス本文が画面に出ないこと**を固定する。
 * 以前 Gemini の 503 でレスポンス JSON がそのままバナーに出たので、ここでも先に釘を刺す。
 */

/** Google の REST API が返すエラー本文 */
const FORBIDDEN_BODY = JSON.stringify({
  error: {
    code: 403,
    message:
      'Request had insufficient authentication scopes. Google Tasks API has not been used in project 12345 before or it is disabled.',
    status: 'PERMISSION_DENIED',
  },
});

function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

describe('statusOf', () => {
  it('GoogleApiError から読む', () => {
    expect(statusOf(new GoogleApiError(403, FORBIDDEN_BODY))).toBe(403);
  });

  it('status を持つだけの値からも読む', () => {
    expect(statusOf({ status: 429 })).toBe(429);
  });

  it('分からなければ null', () => {
    expect(statusOf(new TypeError('fetch failed'))).toBeNull();
    expect(statusOf(null)).toBeNull();
  });
});

describe('isRetryable', () => {
  it('混雑とサーバー側の一時障害は投げ直す', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryable(new GoogleApiError(status, ''))).toBe(true);
    }
  });

  it('権限や指定の誤りは投げ直さない', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(isRetryable(new GoogleApiError(status, ''))).toBe(false);
    }
  });

  it('中断は投げ直さない', () => {
    expect(isRetryable(timeoutError())).toBe(false);
  });
});

describe('describeGoogleError', () => {
  /** これが本題 */
  it('生のレスポンス本文を画面文言に混ぜない', () => {
    const message = describeGoogleError(new GoogleApiError(403, FORBIDDEN_BODY));
    expect(message).not.toContain('{');
    expect(message).not.toContain('insufficient authentication scopes');
    expect(message).not.toContain('PERMISSION_DENIED');
    expect(message).toContain('403');
  });

  it('401 と 403 は再連携へ導く', () => {
    expect(describeGoogleError(new GoogleApiError(401, ''))).toContain('連携設定');
    expect(describeGoogleError(new GoogleApiError(403, ''))).toContain('連携設定');
  });

  it('混雑と一時障害は待つよう伝える', () => {
    expect(describeGoogleError(new GoogleApiError(429, ''))).toContain('しばらく待って');
    expect(describeGoogleError(new GoogleApiError(503, ''))).toContain('しばらく待って');
  });

  it('知らないステータスでも読める文にする', () => {
    const message = describeGoogleError(new GoogleApiError(418, ''));
    expect(message).toContain('418');
    expect(message).not.toContain('{');
  });

  it('ステータスが取れなくても文言を返す', () => {
    expect(describeGoogleError(new TypeError('fetch failed'))).toBe(
      'Google に接続できませんでした。',
    );
  });
});
