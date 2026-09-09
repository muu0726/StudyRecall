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
/**
 * バックアップ用。**`drive` ではなく `drive.file`。**
 * このアプリが作ったファイルしか見えないので、人の Drive 全体を覗く力を持たない。
 * `drive` は Google の制限付きスコープで、一般公開にはセキュリティ審査が要る。
 */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** そのトークンに何が降りているかを Google に聞く先 */
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const TOKENINFO_TIMEOUT_MS = 10_000;

/** 連携できない理由。そのまま UI の出し分けに使う。 */
export type GoogleAccessFailure = 'not-linked' | 'missing-scope' | 'refresh-failed';

export type GoogleAccess =
  { ok: true; accessToken: string } | { ok: false; reason: GoogleAccessFailure };

/** accounts に入っている scope 文字列（空白区切り）を集合にする */
export function parseScopes(scope: string | null | undefined): Set<string> {
  if (!scope) return new Set();
  return new Set(scope.split(/[\s,]+/).filter(Boolean));
}

/**
 * scope 集合を accounts.scope の形に戻す。
 *
 * **区切りはカンマ。** better-auth の mergeScopes が `split(",")` しか見ないので、
 * 空白で書くと次に linkSocial したとき全体が 1 個のスコープとして扱われる。
 */
export function serializeScopes(scopes: Iterable<string>): string {
  return [...new Set(scopes)].join(',');
}

/** Google の tokeninfo 応答から、実際に降りているスコープを取り出す */
export function parseTokenInfoScopes(payload: unknown): Set<string> {
  if (typeof payload !== 'object' || payload === null) return new Set();
  const scope = (payload as { scope?: unknown }).scope;
  return parseScopes(typeof scope === 'string' ? scope : null);
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
 * Google アカウントが紐付いているか。**スコープは見ない。**
 *
 * 「一度も連携していない」と「連携したが権限が足りない」を分けるための判定。
 * 前者にはタスク画面から Google を消すが、後者に同じことをすると
 * **同期が動かない理由を知る術が無くなる**ので、あちらには警告を出し続ける。
 */
export async function isGoogleLinked(env: Env, userId: string): Promise<boolean> {
  return Boolean(await findGoogleAccount(env, userId));
}

/** アクセストークンを 1 本取り出す。取れなければ null。 */
async function accessTokenFor(
  env: Env,
  requestUrl: string,
  userId: string,
  accountRowId: string,
): Promise<string | null> {
  try {
    const auth = createAuth(env, requestUrl);
    const tokens = await auth.api.getAccessToken({
      // **accounts.id（行の主キー）を渡す。** account_id（Google 側の sub）ではない。
      // better-auth の resolveUserAccount が candidate.id === accountId で引いている。
      body: { accountId: accountRowId, userId },
    });
    return tokens.accessToken ?? null;
  } catch (error) {
    // リフレッシュトークンが無い／失効した。再同意しか手が無い。
    console.error('[google-auth] failed to get access token:', error);
    return null;
  }
}

/** そのトークンに実際に降りているスコープを Google に聞く。聞けなければ null。 */
async function introspectScopes(accessToken: string): Promise<Set<string> | null> {
  try {
    const url = `${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(TOKENINFO_TIMEOUT_MS) });
    if (!response.ok) {
      // 本文にはトークンの情報が入りうる。**ステータスだけ残す。**
      console.error(`[google-auth] tokeninfo failed: ${response.status}`);
      return null;
    }
    return parseTokenInfoScopes(await response.json());
  } catch (error) {
    console.error('[google-auth] tokeninfo request failed:', error);
    return null;
  }
}

/**
 * いま実際に降りているスコープ。**accounts.scope をそのまま信じない。**
 *
 * better-auth は**サインインでは scope 列を更新しない**。意図的な仕様で、
 * `src/oauth2/link-account.ts` にそう書いてある:
 *
 *   `scope` intentionally omitted. Updated only via linkSocial.
 *
 * つまり後からスコープを増やして同意を取り直しても、列は**最初のサインイン時のまま**で、
 * 「同意画面は最後まで通ったのに、アプリ側はずっと未許可」という状態が固定される。
 *
 * そこで、列が足りないときだけ実トークンに問い合わせて事実に合わせ、列へ書き戻す。
 * 足りているときは追加の通信をしない。取り消された権限も同じ経路で消える。
 */
export async function resolveGrantedScopes(
  env: Env,
  requestUrl: string,
  userId: string,
  account: { id: string; scope: string | null },
  required: readonly string[],
): Promise<Set<string>> {
  const stored = parseScopes(account.scope);
  if (required.every((scope) => stored.has(scope))) return stored;

  const accessToken = await accessTokenFor(env, requestUrl, userId, account.id);
  if (!accessToken) return stored;

  const actual = await introspectScopes(accessToken);
  if (!actual) return stored;

  const next = serializeScopes(actual);
  if (next !== (account.scope ?? '')) {
    await getDb(env)
      .update(accounts)
      .set({ scope: next, updatedAt: new Date() })
      .where(eq(accounts.id, account.id));
  }
  return actual;
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

  const granted = await resolveGrantedScopes(env, requestUrl, userId, account, required);
  if (!required.every((scope) => granted.has(scope))) {
    return { ok: false, reason: 'missing-scope' };
  }

  const accessToken = await accessTokenFor(env, requestUrl, userId, account.id);
  if (!accessToken) return { ok: false, reason: 'refresh-failed' };
  return { ok: true, accessToken };
}

/** 未連携・権限不足を画面向けの一文にする */
export function describeAccessFailure(reason: GoogleAccessFailure): string {
  switch (reason) {
    case 'not-linked':
      return 'Google と連携していません。連携設定から Google でログインし直してください。';
    case 'missing-scope':
      // どの権限が要るかは呼ぶ側で違う。ここでは名指ししない。
      return 'Google の権限が足りません。連携設定から接続し直して、求められた項目をすべて許可してください。';
    case 'refresh-failed':
      return 'Google の認証が切れています。連携設定から接続し直してください。';
  }
}
