import { Hono } from 'hono';
import { getDb, type AppEnv } from '../lib/db';
import { getSettings, saveSettings } from '../lib/user-settings';
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_TASKS_SCOPE,
  findGoogleAccount,
  parseScopes,
  resolveGrantedScopes,
} from '../lib/google-auth';
import type { IntegrationsDTO, UpdateIntegrationsRequest } from '../../shared/types';

/**
 * 外部サービス連携の状態と設定。
 *
 * **権限の有無はここで返す。** 画面側が「連携済みだが権限が足りない」を
 * 見分けられないと、Google が 403 を返してから初めて気付くことになる。
 */

const REQUIRED_SCOPES = [GOOGLE_TASKS_SCOPE, GOOGLE_CALENDAR_SCOPE];

async function buildDto(env: Env, requestUrl: string, userId: string): Promise<IntegrationsDTO> {
  const db = getDb(env);
  const [account, settings] = await Promise.all([
    findGoogleAccount(env, userId),
    getSettings(db, userId),
  ]);

  /*
   * **accounts.scope は当てにならない。** better-auth はサインインでは scope 列を
   * 更新しないので、権限を許可し直しても列は古いままになる。足りないときは
   * 実トークンに問い合わせて直す（resolveGrantedScopes 参照）。
   */
  const granted = account
    ? await resolveGrantedScopes(env, requestUrl, userId, account, REQUIRED_SCOPES)
    : parseScopes(null);

  return {
    linked: Boolean(account),
    hasTasksScope: granted.has(GOOGLE_TASKS_SCOPE),
    hasCalendarScope: granted.has(GOOGLE_CALENDAR_SCOPE),
    calendarSyncEnabled: settings.calendarSyncEnabled,
    tasksSyncedAt: settings.tasksSyncedAt?.toISOString() ?? null,
  };
}

export const integrationsRoute = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await buildDto(c.env, c.req.url, c.get('userId'))))

  .put('/', async (c) => {
    const body = await c.req.json<Partial<UpdateIntegrationsRequest>>().catch(() => null);
    if (!body) return c.json({ error: 'リクエストボディが不正です' }, 400);

    const userId = c.get('userId');

    if (typeof body.calendarSyncEnabled === 'boolean') {
      // ON にできるのは権限がある場合だけ。UI 側でも塞ぐが、
      // ここで弾かないと「ON なのに毎回失敗する」状態を保存できてしまう。
      if (body.calendarSyncEnabled) {
        const current = await buildDto(c.env, c.req.url, userId);
        if (!current.hasCalendarScope) {
          return c.json(
            { error: 'カレンダーの権限がありません。Google と接続し直してください。' },
            400,
          );
        }
      }
      await saveSettings(getDb(c.env), userId, {
        calendarSyncEnabled: body.calendarSyncEnabled,
      });
    }

    return c.json(await buildDto(c.env, c.req.url, userId));
  });
