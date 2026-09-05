import { drizzle } from 'drizzle-orm/d1';
import { createMiddleware } from 'hono/factory';
import * as schema from '../../db/schema';
import { createAuth } from './auth';

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;

/** Hono の型パラメータ。ルータ間で共有する。 */
export type AppEnv = {
  Bindings: Env;
  Variables: { userId: string };
};

/**
 * セッションを読んで userId をコンテキストに載せる。未ログインなら 401。
 * /api/auth/* 以外の API 全てに適用する。
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const auth = createAuth(c.env, c.req.url);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.user) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }

  c.set('userId', session.user.id);
  await next();
});
