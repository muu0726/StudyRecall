import { Hono } from 'hono';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { categories, tasks } from '../../db/schema';
import { getDb, type AppEnv, type Db } from '../lib/db';
import { toTaskDto } from '../lib/dto';
import { newId } from '../lib/ids';
import { getSettings, saveSettings } from '../lib/user-settings';
import {
  GOOGLE_TASKS_SCOPE,
  describeAccessFailure,
  getGoogleAccessToken,
  isGoogleLinked,
} from '../lib/google-auth';
import {
  deleteTask,
  insertTask,
  listTasks,
  patchTask,
  type TaskPayload,
} from '../lib/google-tasks';
import { describeGoogleError } from '../lib/google-error';
import {
  fromGoogleDue,
  reconcile,
  toGoogleDue,
  type LocalTask,
  type RemoteTask,
} from '../../shared/task-sync';
import type {
  CreateTaskRequest,
  SyncTasksResponse,
  TaskResponse,
  UpdateTaskRequest,
} from '../../shared/types';

/**
 * タスク（ToDo）。Google Tasks の `@default` リストと双方向に同期する。
 *
 * **書き込みは必ず D1 を先に確定させる。** Google への送信は best-effort で、
 * 失敗しても 200 を返し `syncState='pending'` のまま残す。ここを同期的に扱うと、
 * Google が混んでいるだけでタスクを 1 つも追加できなくなる。
 * 送れなかったぶんは次の同期が拾う（そのための `syncState`）。
 */

const TITLE_MAX = 500;
const DUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** カテゴリ名・色を付けて 1 件引く */
function selectTasks(db: Db, userId: string) {
  return db
    .select({
      task: tasks,
      categoryName: categories.name,
      categoryColor: categories.color,
    })
    .from(tasks)
    .leftJoin(categories, eq(tasks.categoryId, categories.id))
    .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.dueDate), asc(tasks.sortOrder), asc(tasks.createdAt));
}

async function listDto(db: Db, userId: string) {
  const rows = await selectTasks(db, userId);
  return rows.map((row) =>
    toTaskDto({ ...row.task, categoryName: row.categoryName, categoryColor: row.categoryColor }),
  );
}

async function findOne(db: Db, userId: string, id: string) {
  const [row] = await db
    .select({ task: tasks, categoryName: categories.name, categoryColor: categories.color })
    .from(tasks)
    .leftJoin(categories, eq(tasks.categoryId, categories.id))
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) return null;
  return { ...row.task, categoryName: row.categoryName, categoryColor: row.categoryColor };
}

/** Google へ送る形。ローカルの行がそのまま材料になる。 */
function payloadOf(row: {
  title: string;
  memo: string | null;
  dueDate: string | null;
  isCompleted: boolean;
}): TaskPayload {
  return {
    title: row.title,
    notes: row.memo,
    due: toGoogleDue(row.dueDate),
    status: row.isCompleted ? 'completed' : 'needsAction',
  };
}

/** カテゴリ・ノートの所有者確認。他人の ID を紐付けさせない。 */
async function ownsCategory(db: Db, userId: string, categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return Boolean(row);
}

function normalizeDue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !DUE_PATTERN.test(value)) return undefined;
  return value;
}

/**
 * 追加・更新のあとに 1 件だけ Google へ送る。
 * **例外を投げない。** 送れなければ理由の文言を返し、行は pending のまま残す。
 */
async function pushOne(
  env: Env,
  requestUrl: string,
  userId: string,
  db: Db,
  taskId: string,
): Promise<string | undefined> {
  const access = await getGoogleAccessToken(env, requestUrl, userId, [GOOGLE_TASKS_SCOPE]);
  if (!access.ok) {
    // 未連携は「失敗」ではない。黙って pending のままにする。
    return access.reason === 'not-linked' ? undefined : describeAccessFailure(access.reason);
  }

  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) return undefined;

  try {
    const remote = row.googleTaskId
      ? await patchTask(access.accessToken, row.googleTaskId, payloadOf(row))
      : await insertTask(access.accessToken, payloadOf(row));
    if (!remote) return undefined;

    await db
      .update(tasks)
      .set({
        googleTaskId: remote.id,
        googleUpdatedAt: new Date(remote.updated),
        syncState: 'synced',
      })
      .where(eq(tasks.id, taskId));
    return undefined;
  } catch (error) {
    console.error('[tasks] push failed:', error);
    return describeGoogleError(error);
  }
}

export const tasksRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const userId = c.get('userId');
    // 連携状態を一覧に相乗りさせる。一覧は必ず取るので追加の往復が要らない。
    const [list, googleLinked] = await Promise.all([
      listDto(getDb(c.env), userId),
      isGoogleLinked(c.env, userId),
    ]);
    return c.json({ tasks: list, googleLinked });
  })

  .post('/', async (c) => {
    const body = await c.req.json<Partial<CreateTaskRequest>>().catch(() => null);
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, TITLE_MAX) : '';
    if (!title) return c.json({ error: 'title は必須です' }, 400);

    const dueDate = normalizeDue(body?.dueDate);
    if (dueDate === undefined && body?.dueDate !== undefined) {
      return c.json({ error: 'dueDate は YYYY-MM-DD で指定してください' }, 400);
    }

    const db = getDb(c.env);
    const userId = c.get('userId');

    const categoryId = typeof body?.categoryId === 'string' ? body.categoryId : null;
    if (categoryId && !(await ownsCategory(db, userId, categoryId))) {
      return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);
    }

    const id = newId('tsk');
    await db.insert(tasks).values({
      id,
      userId,
      title,
      memo: typeof body?.memo === 'string' ? body.memo : null,
      dueDate: dueDate ?? null,
      categoryId,
      notebookId: typeof body?.notebookId === 'string' ? body.notebookId : null,
      syncState: 'pending',
    });

    const warning = await pushOne(c.env, c.req.url, userId, db, id);
    const task = await findOne(db, userId, id);
    const response: TaskResponse = { task: toTaskDto(task!), ...(warning ? { warning } : {}) };
    return c.json(response, 201);
  })

  .put('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<Partial<UpdateTaskRequest>>().catch(() => null);
    if (!body) return c.json({ error: 'リクエストボディが不正です' }, 400);

    const db = getDb(c.env);
    const userId = c.get('userId');

    const existing = await findOne(db, userId, id);
    if (!existing) return c.json({ error: '指定されたタスクが見つかりません' }, 404);

    const title =
      typeof body.title === 'string' ? body.title.trim().slice(0, TITLE_MAX) : undefined;
    if (title === '') return c.json({ error: 'title は空にできません' }, 400);

    const dueDate = normalizeDue(body.dueDate);
    if (dueDate === undefined && body.dueDate !== undefined) {
      return c.json({ error: 'dueDate は YYYY-MM-DD で指定してください' }, 400);
    }

    if (typeof body.categoryId === 'string' && !(await ownsCategory(db, userId, body.categoryId))) {
      return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);
    }

    const now = new Date();
    const completing = typeof body.isCompleted === 'boolean' ? body.isCompleted : undefined;

    await db
      .update(tasks)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(body.memo !== undefined ? { memo: body.memo } : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.notebookId !== undefined ? { notebookId: body.notebookId } : {}),
        ...(completing !== undefined
          ? { isCompleted: completing, completedAt: completing ? now : null }
          : {}),
        // Google へ送るのはこの後。届くまでは pending。
        syncState: 'pending',
        updatedAt: now,
      })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));

    const warning = await pushOne(c.env, c.req.url, userId, db, id);
    const task = await findOne(db, userId, id);
    const response: TaskResponse = { task: toTaskDto(task!), ...(warning ? { warning } : {}) };
    return c.json(response);
  })

  /**
   * 削除。**行は消さず墓標を立てる。**
   * すぐ消すと「Google 側も消す」という事実まで失われ、
   * 次の同期で消したはずのタスクが Google から復活する。
   */
  .delete('/:id', async (c) => {
    const id = c.req.param('id');
    const db = getDb(c.env);
    const userId = c.get('userId');

    const existing = await findOne(db, userId, id);
    if (!existing) return c.json({ error: '指定されたタスクが見つかりません' }, 404);

    const now = new Date();
    await db
      .update(tasks)
      .set({ deletedAt: now, syncState: 'pending', updatedAt: now })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));

    let warning: string | undefined;
    if (existing.googleTaskId) {
      const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_TASKS_SCOPE]);
      if (access.ok) {
        try {
          await deleteTask(access.accessToken, existing.googleTaskId);
          // 向こうにも伝わったので、墓標を残す理由が無くなった
          await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
        } catch (error) {
          console.error('[tasks] remote delete failed:', error);
          warning = describeGoogleError(error);
        }
      } else if (access.reason !== 'not-linked') {
        warning = describeAccessFailure(access.reason);
      }
    } else {
      // Google に出したことが無いなら、墓標を残す意味も無い
      await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    }

    return c.json({ ok: true, ...(warning ? { warning } : {}) });
  })

  /** 双方向の突き合わせ。判断は shared/task-sync.ts の reconcile が持つ。 */
  .post('/sync', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');

    const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_TASKS_SCOPE]);
    if (!access.ok) {
      // 未連携でもエラーにしない。タスク機能自体はローカルだけで完結する。
      const response: SyncTasksResponse = {
        tasks: await listDto(db, userId),
        pulled: 0,
        pushed: 0,
        syncedAt: null,
        warning: describeAccessFailure(access.reason),
      };
      return c.json(response);
    }

    const settings = await getSettings(db, userId);
    /*
     * 一覧を取りに行く**前**の時刻を次回の updatedMin にする。
     * 取得後の時刻にすると、同期の最中に向こうで起きた変更を永久に取りこぼす。
     */
    const syncStartedAt = new Date();

    let remotes: RemoteTask[];
    try {
      remotes = await listTasks(access.accessToken, settings.tasksSyncedAt);
    } catch (error) {
      console.error('[tasks] pull failed:', error);
      const response: SyncTasksResponse = {
        tasks: await listDto(db, userId),
        pulled: 0,
        pushed: 0,
        syncedAt: settings.tasksSyncedAt?.toISOString() ?? null,
        warning: describeGoogleError(error),
      };
      return c.json(response);
    }

    // 墓標も含めて全部渡す。reconcile が生死ごと判断する。
    const rows = await db.select().from(tasks).where(eq(tasks.userId, userId));
    const locals: LocalTask[] = rows.map((row) => ({
      id: row.id,
      googleTaskId: row.googleTaskId,
      title: row.title,
      memo: row.memo,
      dueDate: row.dueDate,
      isCompleted: row.isCompleted,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      googleUpdatedAt: row.googleUpdatedAt?.toISOString() ?? null,
      syncState: row.syncState,
    }));
    const byId = new Map(rows.map((row) => [row.id, row]));

    let pulled = 0;
    let pushed = 0;
    const failures: string[] = [];

    for (const action of reconcile(locals, remotes)) {
      try {
        switch (action.kind) {
          case 'create-local': {
            await db.insert(tasks).values({
              id: newId('tsk'),
              userId,
              googleTaskId: action.remote.id,
              title: action.remote.title || '（無題）',
              memo: action.remote.notes,
              dueDate: fromGoogleDue(action.remote.due),
              isCompleted: action.remote.status === 'completed',
              completedAt:
                action.remote.status === 'completed' ? new Date(action.remote.updated) : null,
              googleUpdatedAt: new Date(action.remote.updated),
              syncState: 'synced',
            });
            pulled++;
            break;
          }
          case 'update-local': {
            const completed = action.remote.status === 'completed';
            await db
              .update(tasks)
              .set({
                title: action.remote.title || '（無題）',
                memo: action.remote.notes,
                dueDate: fromGoogleDue(action.remote.due),
                isCompleted: completed,
                completedAt: completed ? new Date(action.remote.updated) : null,
                googleUpdatedAt: new Date(action.remote.updated),
                syncState: 'synced',
                updatedAt: new Date(action.remote.updated),
              })
              .where(eq(tasks.id, action.id));
            pulled++;
            break;
          }
          case 'delete-local':
          case 'purge-local': {
            await db.delete(tasks).where(eq(tasks.id, action.id));
            if (action.kind === 'delete-local') pulled++;
            break;
          }
          case 'create-remote': {
            const row = byId.get(action.id);
            if (!row) break;
            const remote = await insertTask(access.accessToken, payloadOf(row));
            if (remote) {
              await db
                .update(tasks)
                .set({
                  googleTaskId: remote.id,
                  googleUpdatedAt: new Date(remote.updated),
                  syncState: 'synced',
                })
                .where(eq(tasks.id, action.id));
              pushed++;
            }
            break;
          }
          case 'update-remote': {
            const row = byId.get(action.id);
            if (!row) break;
            const remote = await patchTask(access.accessToken, action.googleTaskId, payloadOf(row));
            if (remote) {
              await db
                .update(tasks)
                .set({ googleUpdatedAt: new Date(remote.updated), syncState: 'synced' })
                .where(eq(tasks.id, action.id));
              pushed++;
            }
            break;
          }
          case 'delete-remote': {
            await deleteTask(access.accessToken, action.googleTaskId);
            await db.delete(tasks).where(eq(tasks.id, action.id));
            pushed++;
            break;
          }
        }
      } catch (error) {
        // 1 件の失敗で同期全体を止めない。残りは進め、まとめて伝える。
        console.error(`[tasks] sync action ${action.kind} failed:`, error);
        failures.push(describeGoogleError(error));
      }
    }

    await saveSettings(db, userId, { tasksSyncedAt: syncStartedAt });

    const response: SyncTasksResponse = {
      tasks: await listDto(db, userId),
      pulled,
      pushed,
      syncedAt: syncStartedAt.toISOString(),
      ...(failures.length > 0
        ? { warning: `${failures[0]}（${failures.length} 件が同期できませんでした）` }
        : {}),
    };
    return c.json(response);
  });
