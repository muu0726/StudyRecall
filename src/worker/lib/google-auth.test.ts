import { describe, expect, it } from 'vitest';
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_TASKS_SCOPE,
  parseScopes,
  parseTokenInfoScopes,
  serializeScopes,
} from './google-auth';

describe('parseScopes', () => {
  it('better-auth のカンマ区切りを読む', () => {
    expect([...parseScopes('openid,email,profile')]).toEqual(['openid', 'email', 'profile']);
  });

  it('Google の空白区切りも読む（tokeninfo はこちら）', () => {
    expect([...parseScopes('openid email profile')]).toEqual(['openid', 'email', 'profile']);
  });

  it('「カンマ＋空白」で余分な空要素を作らない', () => {
    expect([...parseScopes('openid, email, profile')]).toEqual(['openid', 'email', 'profile']);
  });

  it('未設定は空集合', () => {
    expect(parseScopes(null).size).toBe(0);
    expect(parseScopes('').size).toBe(0);
  });
});

describe('serializeScopes', () => {
  /*
   * better-auth の mergeScopes は split(',') しか見ない。空白で書くと、
   * 次に linkSocial したとき全体が 1 個のスコープとして扱われる。
   */
  it('カンマで繋ぐ（空白ではない）', () => {
    expect(serializeScopes(['openid', 'email'])).toBe('openid,email');
  });

  it('往復しても中身が変わらない', () => {
    const scopes = ['openid', 'email', GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE];
    expect([...parseScopes(serializeScopes(scopes))]).toEqual(scopes);
  });

  it('重複を落とす', () => {
    expect(serializeScopes(['openid', 'openid', 'email'])).toBe('openid,email');
  });
});

describe('parseTokenInfoScopes', () => {
  it('tokeninfo の scope（空白区切り）を集合にする', () => {
    const granted = parseTokenInfoScopes({
      scope: `openid email ${GOOGLE_TASKS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`,
      expires_in: '3599',
    });
    expect(granted.has(GOOGLE_TASKS_SCOPE)).toBe(true);
    expect(granted.has(GOOGLE_CALENDAR_SCOPE)).toBe(true);
  });

  it('scope が無い・形が違う応答で落ちない', () => {
    expect(parseTokenInfoScopes({ error: 'invalid_token' }).size).toBe(0);
    expect(parseTokenInfoScopes({ scope: 42 }).size).toBe(0);
    expect(parseTokenInfoScopes(null).size).toBe(0);
    expect(parseTokenInfoScopes('openid').size).toBe(0);
  });
});
