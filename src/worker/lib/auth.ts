import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { accounts, categories, users } from '../../db/schema';
import { getDb } from './db';
import { newId } from './ids';

/**
 * Better Auth の設定。
 *
 * Workers では env バインディングがリクエスト単位でしか取れないため、
 * auth インスタンスはリクエストごとに生成する（モジュールトップで作れない）。
 */

/** フェーズ1 でシードしたデモユーザー。モックログインはこのユーザーとしてサインインする。 */
export const DEMO_USER_ID = 'user_demo_1';
export const DEMO_USER_EMAIL = 'demo@studyrecall.local';
/** 開発専用。ALLOW_DEV_LOGIN が立っているローカル環境でしか使われない。 */
const DEMO_PASSWORD = 'studyrecall-dev-only';
/**
 * Better Auth の createLocalAccountIssuer('credential') と同じ値。
 * `local:${encodeURIComponent(providerId)}` という規約。
 * 本体からは re-export されていないため、ここで同じ値を定義する。
 */
const CREDENTIAL_ISSUER = 'local:credential';

/**
 * 新規ユーザーに用意する初期カテゴリ。
 * カテゴリが 0 件だと記録・ノート作成・用語追加のすべてが選択肢を持てず、
 * サインインしても何も始められないため、ユーザー作成時に必ず作る。
 * （デモユーザーの分はシードマイグレーションが作っている）
 */
const STARTER_CATEGORIES = [
  { name: 'ネットワーク', color: '#3b82f6' },
  { name: '基本情報', color: '#8b5cf6' },
  { name: '英語', color: '#10b981' },
] as const;

/**
 * .dev.vars.example のプレースホルダ（"your-..."）がそのまま入っている場合は未設定とみなす。
 * これをしないと、雛形のままでも Google ボタンが有効に見えてしまう。
 */
function configured(value: string | undefined): value is string {
  return Boolean(value) && !value!.startsWith('your-');
}

export function isGoogleConfigured(env: Env): boolean {
  return configured(env.GOOGLE_CLIENT_ID) && configured(env.GOOGLE_CLIENT_SECRET);
}

export function createAuth(env: Env, requestUrl: string) {
  const hasGoogle = isGoogleConfigured(env);

  return betterAuth({
    // localhost と本番の両方で動くよう、リクエストの origin をそのまま使う
    baseURL: new URL(requestUrl).origin,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(env), {
      provider: 'sqlite',
      schema,
      // schema のキーが users / sessions / ... と複数形のため
      usePlural: true,
      // Drizzle テーブルのプロパティ名が camelCase (emailVerified / userId / createdAt) のため。
      // 既定は snake_case を期待するので、これが無いとフィールドを解決できない。
      camelCase: true,
      // D1 は対話的トランザクションを持たないので逐次実行させる
      transaction: false,
    }),
    // 開発用モックログインの土台。Google が未設定でもログインできる経路を残す。
    emailAndPassword: { enabled: true },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await getDb(env)
              .insert(categories)
              .values(
                STARTER_CATEGORIES.map((category) => ({
                  id: newId('cat'),
                  userId: user.id,
                  name: category.name,
                  color: category.color,
                })),
              );
          },
        },
      },
    },
    socialProviders: hasGoogle
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {},
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * 開発用モックログイン。
 *
 * 既存のデモユーザー `user_demo_1`（とそのカテゴリ・学習記録）をそのまま引き継ぐため、
 * 新規サインアップではなく「デモユーザーに credential アカウントを用意してサインインする」形にしている。
 * hashPassword は better-auth/crypto の公開 API を使い、内部 API には触れない。
 */
export async function devLogin(env: Env, requestUrl: string): Promise<Response> {
  const db = getDb(env);

  const [demoUser] = await db.select().from(users).where(eq(users.id, DEMO_USER_ID)).limit(1);
  if (!demoUser) {
    return Response.json(
      { error: 'デモユーザーが存在しません。マイグレーションのシードを確認してください。' },
      { status: 404 },
    );
  }

  const [credential] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, DEMO_USER_ID),
        eq(accounts.providerId, 'credential'),
        eq(accounts.issuer, CREDENTIAL_ISSUER),
      ),
    )
    .limit(1);

  if (!credential) {
    await db.insert(accounts).values({
      id: `acc_${crypto.randomUUID()}`,
      // signInEmail は accountId === user.id の credential アカウントを探す
      accountId: DEMO_USER_ID,
      providerId: 'credential',
      issuer: CREDENTIAL_ISSUER,
      userId: DEMO_USER_ID,
      password: await hashPassword(DEMO_PASSWORD),
    });
  }

  const auth = createAuth(env, requestUrl);
  // asResponse: true で Set-Cookie ヘッダごとそのまま返せる
  return auth.api.signInEmail({
    body: { email: demoUser.email, password: DEMO_PASSWORD },
    asResponse: true,
  });
}
