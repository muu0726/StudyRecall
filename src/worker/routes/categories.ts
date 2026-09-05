import { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import { categories } from '../../db/schema';
import { getDb, type AppEnv, type Db } from '../lib/db';
import { toCategoryDto } from '../lib/dto';
import { newId } from '../lib/ids';
import type {
  CategoryInUseResponse,
  CategoryUsage,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '../../shared/types';

const DEFAULT_COLOR = '#3b82f6';
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * カテゴリごとの参照件数を相関サブクエリでまとめて取る。
 * 削除可否の判断と、管理 UI での表示に使う。
 */
function usageSelect() {
  return {
    studyLogs: sql<number>`(select count(*) from study_logs where study_logs.category_id = categories.id)`,
    notebooks: sql<number>`(select count(*) from notebooks where notebooks.category_id = categories.id)`,
    quizzes: sql<number>`(select count(*) from quiz_questions where quiz_questions.category_id = categories.id)`,
  };
}

const toUsage = (row: { studyLogs: number; notebooks: number; quizzes: number }): CategoryUsage => ({
  studyLogs: Number(row.studyLogs),
  notebooks: Number(row.notebooks),
  quizzes: Number(row.quizzes),
});

const isInUse = (usage: CategoryUsage) =>
  usage.studyLogs > 0 || usage.notebooks > 0 || usage.quizzes > 0;

async function findUsage(db: Db, categoryId: string, userId: string) {
  const [row] = await db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      createdAt: categories.createdAt,
      userId: categories.userId,
      ...usageSelect(),
    })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return row;
}

export const categoriesRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env);
    const rows = await db
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
        createdAt: categories.createdAt,
        userId: categories.userId,
        ...usageSelect(),
      })
      .from(categories)
      .where(eq(categories.userId, c.get('userId')))
      .orderBy(asc(categories.createdAt));

    return c.json({ categories: rows.map((row) => toCategoryDto(row, toUsage(row))) });
  })

  .post('/', async (c) => {
    const body = await c.req.json<Partial<CreateCategoryRequest>>().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return c.json({ error: 'name は必須です' }, 400);
    }
    const color =
      typeof body?.color === 'string' && COLOR_PATTERN.test(body.color) ? body.color : DEFAULT_COLOR;

    const db = getDb(c.env);
    const [row] = await db
      .insert(categories)
      .values({ id: newId('cat'), userId: c.get('userId'), name, color })
      .returning();

    return c.json({ category: toCategoryDto(row) }, 201);
  })

  .put('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<Partial<UpdateCategoryRequest>>().catch(() => null);
    if (!body) return c.json({ error: 'リクエストボディが不正です' }, 400);

    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    if (name === '') return c.json({ error: 'name は空にできません' }, 400);

    const color = typeof body.color === 'string' ? body.color : undefined;
    if (color !== undefined && !COLOR_PATTERN.test(color)) {
      return c.json({ error: 'color は #rrggbb 形式で指定してください' }, 400);
    }

    if (name === undefined && color === undefined) {
      return c.json({ error: '更新する項目がありません' }, 400);
    }

    const db = getDb(c.env);
    const userId = c.get('userId');

    const updated = await db
      .update(categories)
      .set({ ...(name !== undefined ? { name } : {}), ...(color !== undefined ? { color } : {}) })
      .where(and(eq(categories.id, id), eq(categories.userId, userId)))
      .returning();

    if (updated.length === 0) {
      return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);
    }

    const row = await findUsage(db, id, userId);
    return c.json({ category: toCategoryDto(row, toUsage(row)) });
  })

  .delete('/:id', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');
    const id = c.req.param('id');

    const row = await findUsage(db, id, userId);
    if (!row) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);

    // 使用中のカテゴリは消さない。消すと学習記録・ノート・問題まで
    // ON DELETE CASCADE で巻き込んで失われるため。
    const usage = toUsage(row);
    if (isInUse(usage)) {
      const response: CategoryInUseResponse = {
        error: `使用中のため削除できません（学習記録 ${usage.studyLogs}件 / ノート ${usage.notebooks}件 / 問題 ${usage.quizzes}件）`,
        usage,
      };
      return c.json(response, 409);
    }

    await db.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, userId)));
    return c.json({ ok: true });
  });
