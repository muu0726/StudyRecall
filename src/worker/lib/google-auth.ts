import { and, eq } from 'drizzle-orm';
import { accounts } from '../../db/schema';
import { createAuth } from './auth';
import { getDb } from './db';

/**
 * Google のアクセストークンを取り出す。
 *
 * **リフレッシュを自前で書かない。** Better Auth の `auth.api.getAccessToken` が
 * 期限の 5 秒前を切っていれば `refresh_token` で取り直し、**accounts へ書き戻す**
 * （better-auth/dist/api/routes/account.mjs の getValidAccessToken）。
 * 同じことを二重に持つと、どちらが正しいトークンか分からなくなる。
 */

export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** 連携できない理由。そのまま UI の出し分けに使う。 */
export type GoogleAccessFailure = 'not-linked' | 'missing-scope' | 'refresh-failed';

export type GoogleAccess =
  { ok: true; accessToken: string } | { ok: false; reason: GoogleAccessFailure };

/** accounts に入っている scope 文字列（空白区切り）を集合にする */
export function parseScopes(scope: string | null | undefined): Set<string> {
  if (!scope) return new Set();
  return new Set(scope.split(/[\s,]+/).filter(Boolean));
}

/** そのユーザーの Google アカウント行。未連携なら undefined。 */
export async function findGoogleAccount(env: Env, userId: string) {
  const [account] = await getDb(env)
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'google')))
    .limit(1);
  return account;
}

/**
 * 必要なスコープ付きのアクセストークンを返す。
 *
 * スコープの不足は**呼ぶ前に**弾く。Google に投げてから 403 で気付くより、
 * 「連携し直してください」と言えたほうが早い。
 */
export async function getGoogleAccessToken(
  env: Env,
  requestUrl: string,
  userId: string,
  required: string[],
): Promise<GoogleAccess> {
  const account = await findGoogleAccount(env, userId);
  if (!account) return { ok: false, reason: 'not-linked' };

  const granted = parseScopes(account.scope);
  if (!required.every((scope) => granted.has(scope))) {
    return { ok: false, reason: 'missing-scope' };
  }

  try {
    const auth = createAuth(env, requestUrl);
    const tokens = await auth.api.getAccessToken({
      // **accounts.id（行の主キー）を渡す。** account_id（Google 側の sub）ではない。
      // better-auth の resolveUserAccount が candidate.id === accountId で引いている。
      body: { accountId: account.id, userId },
    });
    if (!tokens.accessToken) return { ok: false, reason: 'refresh-failed' };
    return { ok: true, accessToken: tokens.accessToken };
  } catch (error) {
    // リフレッシュトークンが無い／失効した。再同意しか手が無い。
    console.error('[google-auth] failed to get access token:', error);
    return { ok: false, reason: 'refresh-failed' };
  }
}

/** 未連携・権限不足を画面向けの一文にする */
export function describeAccessFailure(reason: GoogleAccessFailure): string {
  switch (reason) {
    case 'not-linked':
      return 'Google と連携していません。連携設定から Google でログインし直してください。';
    case 'missing-scope':
      return 'Google の権限が足りません。連携設定から接続し直して、カレンダーとToDoへのアクセスを許可してください。';
    case 'refresh-failed':
      return 'Google の認証が切れています。連携設定から接続し直してください。';
  }
}
