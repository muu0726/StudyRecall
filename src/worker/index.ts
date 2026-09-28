import { Hono } from 'hono';
import { getDb, requireAuth, type AppEnv } from './lib/db';
import { purgeExpired } from './lib/cleanup';
import { createAuth, devLogin, isGoogleConfigured } from './lib/auth';
import { categoriesRoute } from './routes/categories';
import { studyLogsRoute } from './routes/study-logs';
import { quizzesRoute } from './routes/quizzes';
import { notebooksRoute } from './routes/notebooks';
import { glossaryRoute } from './routes/glossary';
import { tagsRoute } from './routes/tags';
import { timerRoute } from './routes/timer';
import { statsRoute } from './routes/stats';
import { tasksRoute } from './routes/tasks';
import { integrationsRoute } from './routes/integrations';
import { calendarRoute } from './routes/calendar';
import { backupRoute } from './routes/backup';
import { portalLinksRoute } from './routes/portal-links';
import { iconRoute } from './routes/icon';
import { bootstrapRoute } from './routes/bootstrap';

const app = new Hono<AppEnv>();

/*
 * **静的ファイルの安全ヘッダーは `_headers`（vite-plugins/security-headers.ts）が付ける。**
 * あれは Cloudflare の静的配信の設定なので、Worker が返す `/api/*` には効かない。
 * 内容の取り違え（JSON を script として読ませる類）だけはここで塞いでおく。
 */
app.use('/api/*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
});

/** ログイン画面がどの手段を出すか判断するための設定。認証不要。 */
app.get('/api/auth-config', (c) =>
  c.json({
    googleEnabled: isGoogleConfigured(c.env),
    devLoginEnabled: c.env.ALLOW_DEV_LOGIN === 'true',
  }),
);

/**
 * 開発用モックログイン。
 * Better Auth のワイルドカードより先に登録する必要がある（Hono は登録順にマッチするため）。
 */
app.post('/api/auth/dev-login', async (c) => {
  if (c.env.ALLOW_DEV_LOGIN !== 'true') {
    return c.json({ error: 'Not Found' }, 404);
  }
  return devLogin(c.env, c.req.url);
});

// Better Auth 本体（Google OAuth・セッション・サインアウトなど）
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env, c.req.url).handler(c.req.raw));

// ここから下はすべてログイン必須
app.use('/api/*', requireAuth);

app.route('/api/bootstrap', bootstrapRoute);
app.route('/api/categories', categoriesRoute);
app.route('/api/study-logs', studyLogsRoute);
app.route('/api/quizzes', quizzesRoute);
app.route('/api/notebooks', notebooksRoute);
app.route('/api/tags', tagsRoute);
app.route('/api/portal-links', portalLinksRoute);
app.route('/api/icon', iconRoute);
app.route('/api/glossary', glossaryRoute);
app.route('/api/timer', timerRoute);
app.route('/api/stats', statsRoute);
app.route('/api/tasks', tasksRoute);
app.route('/api/integrations', integrationsRoute);
app.route('/api/calendar', calendarRoute);
app.route('/api/backup', backupRoute);

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

app.onError((err, c) => {
  console.error('[worker] unhandled error:', err);
  return c.json({ error: 'サーバー内部でエラーが発生しました' }, 500);
});

/**
 * 1 日 1 回の掃除（`wrangler.jsonc` の `triggers.crons`）。
 * 失敗しても次の日に取り返せる作業なので、例外はログに残すだけで握りつぶす。
 */
async function scheduled(_controller: ScheduledController, env: Env): Promise<void> {
  try {
    const removed = await purgeExpired(getDb(env), new Date());
    console.log(
      `[cron] purged expired rows: sessions=${removed.sessions} verifications=${removed.verifications}`,
    );
  } catch (error) {
    console.error('[cron] purge failed:', error);
  }
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
