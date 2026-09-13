import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { timerSessions } from '../../db/schema';
import { getDb, type AppEnv, type Db } from '../lib/db';
import { newId } from '../lib/ids';
import { toTimerSessionDto } from '../lib/dto';
import { getSettings, pomodoroColumns, pomodoroOf, saveSettings } from '../lib/user-settings';
import { normalizePomodoroConfig } from '../../shared/pomodoro-config';
import type {
  StartTimerRequest,
  TimerMode,
  TimerResponse,
  TimerSettingsResponse,
  UpdateTimerSettingsRequest,
} from '../../shared/types';

/**
 * 稼働中タイマーのサーバー同期。
 *
 * 複数端末は同じアクティブセッションを共有する（ミラーリング）。
 * 経過時間はサーバーが算出して返すため、端末ごとの時計ずれの影響を受けない。
 * 確定（学習記録への変換）は POST /api/study-logs 側が担当する。
 */

/** completedAt が NULL の最新セッション。無ければ undefined。 */
async function findActiveSession(db: Db, userId: string) {
  const [session] = await db
    .select()
    .from(timerSessions)
    .where(and(eq(timerSessions.userId, userId), isNull(timerSessions.completedAt)))
    .orderBy(desc(timerSessions.createdAt))
    .limit(1);
  return session;
}

const empty: TimerResponse = { session: null };

export const timerRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const session = await findActiveSession(getDb(c.env), c.get('userId'));
    return c.json(session ? { session: toTimerSessionDto(session) } : empty);
  })

  /**
   * 次に開始するセッションのポモドーロの周期。
   * **走っているセッションの周期はここではなく `session.pomodoro`**（開始時に写してある）。
   */
  .get('/settings', async (c) => {
    const settings = await getSettings(getDb(c.env), c.get('userId'));
    const response: TimerSettingsResponse = { pomodoro: pomodoroOf(settings) };
    return c.json(response);
  })

  /** 送った項目だけ変える。範囲外は丸める（400 にしない。入力欄の打ち間違いで操作を止めない） */
  .put('/settings', async (c) => {
    const body = await c.req.json<Partial<UpdateTimerSettingsRequest>>().catch(() => null);
    if (!body || typeof body.pomodoro !== 'object' || body.pomodoro === null) {
      return c.json({ error: 'pomodoro を指定してください' }, 400);
    }

    const db = getDb(c.env);
    const userId = c.get('userId');
    const current = pomodoroOf(await getSettings(db, userId));
    const next = normalizePomodoroConfig(body.pomodoro, current);
    const saved = await saveSettings(db, userId, pomodoroColumns(next));

    const response: TimerSettingsResponse = { pomodoro: pomodoroOf(saved) };
    return c.json(response);
  })

  /** 既にアクティブなセッションがあれば新規作成せず、それに合流する */
  .post('/start', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');

    const body = await c.req.json<Partial<StartTimerRequest>>().catch(() => null);
    const mode: TimerMode = body?.mode === 'pomodoro' ? 'pomodoro' : 'free';

    const existing = await findActiveSession(db, userId);
    if (existing) {
      // 合流する側のモード指定は無視する。走っているセッションのモードが正。
      return c.json({ session: toTimerSessionDto(existing) });
    }

    /*
     * **開始した時点の周期をセッションに写す。** 走っている最中に設定を変えても
     * 進行中のフェーズが飛ばず、あとから合流した端末も同じ周期で計算できる。
     * フリー計測でも写しておく（途中でモードは変わらないが、値が無い行を作らない）。
     */
    const settings = await getSettings(db, userId);

    const now = new Date();
    const [created] = await db
      .insert(timerSessions)
      .values({
        id: newId('tmr'),
        userId,
        startedAt: now,
        accumulatedMs: 0,
        isRunning: true,
        mode,
        ...pomodoroColumns(pomodoroOf(settings)),
      })
      .returning();

    return c.json({ session: toTimerSessionDto(created) }, 201);
  })

  .post('/pause', async (c) => {
    const db = getDb(c.env);
    const session = await findActiveSession(db, c.get('userId'));
    if (!session) return c.json(empty);

    // 既に停止済みなら何もしない（冪等）
    if (!session.isRunning) {
      return c.json({ session: toTimerSessionDto(session) });
    }

    const now = new Date();
    const accumulatedMs = session.accumulatedMs + (now.getTime() - session.startedAt.getTime());
    const [updated] = await db
      .update(timerSessions)
      .set({ accumulatedMs, isRunning: false, updatedAt: now })
      .where(eq(timerSessions.id, session.id))
      .returning();

    return c.json({ session: toTimerSessionDto(updated) });
  })

  .post('/resume', async (c) => {
    const db = getDb(c.env);
    const session = await findActiveSession(db, c.get('userId'));
    if (!session) return c.json(empty);

    // 既に稼働中なら何もしない（冪等）。再開すると startedAt がずれて経過時間が巻き戻る。
    if (session.isRunning) {
      return c.json({ session: toTimerSessionDto(session) });
    }

    const now = new Date();
    const [updated] = await db
      .update(timerSessions)
      .set({ startedAt: now, isRunning: true, updatedAt: now })
      .where(eq(timerSessions.id, session.id))
      .returning();

    return c.json({ session: toTimerSessionDto(updated) });
  })

  /** 記録せずに破棄する（UI の「リセット」） */
  .post('/reset', async (c) => {
    const db = getDb(c.env);
    const session = await findActiveSession(db, c.get('userId'));
    if (session) {
      await db.delete(timerSessions).where(eq(timerSessions.id, session.id));
    }
    return c.json(empty);
  });
