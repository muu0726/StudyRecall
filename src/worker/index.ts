import { Hono } from 'hono';
import { requireAuth, type AppEnv } from './lib/db';
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

const app = new Hono<AppEnv>();

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

app.route('/api/categories', categoriesRoute);
app.route('/api/study-logs', studyLogsRoute);
app.route('/api/quizzes', quizzesRoute);
app.route('/api/notebooks', notebooksRoute);
app.route('/api/tags', tagsRoute);
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

export default app;
