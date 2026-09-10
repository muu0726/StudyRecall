import { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import { categories, notebooks, quizQuestions, studyLogs, tasks } from '../../db/schema';
import { getDb, type AppEnv, type Db } from '../lib/db';
import { toCategoryDto } from '../lib/dto';
import { newId } from '../lib/ids';
import { MAX_EXAM_NAME_LENGTH } from '../../shared/types';
import type {
  CategoryInUseResponse,
  CategoryUsage,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '../../shared/types';

const DEFAULT_COLOR = '#3b82f6';
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * 資格試験名を読む。
 *
 * - 文字列でなければ `undefined`（＝触らない）
 * - **空文字は `null`**（＝設定を消す）。消せない設定にすると、一度入れた試験名から降りられない
 * - 長すぎるものは `'tooLong'`。呼び出し側が 400 にする
 */
function readExamName(raw: unknown): string | null | undefined | 'tooLong' {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length > MAX_EXAM_NAME_LENGTH) return 'tooLong';
  return trimmed === '' ? null : trimmed;
}

/**
 * カテゴリごとの参照件数を相関サブクエリでまとめて取る。
 * 削除可否の判断と、管理 UI での表示に使う。
 */
function usageSelect() {
  return {
    studyLogs: sql<number>`(select count(*) from study_logs where study_logs.category_id = categories.id)`,
    // 生きているノートとゴミ箱のノートを分けて数える。一緒くたにすると、
    // ツリーに 1 件も見えないのに「ノート 3 件で使用中」と言われる
    // （ゴミ箱の分も category を参照しているため）。
    notebooks: sql<number>`(select count(*) from notebooks where notebooks.category_id = categories.id and notebooks.deleted_at is null)`,
    trashedNotebooks: sql<number>`(select count(*) from notebooks where notebooks.category_id = categories.id and notebooks.deleted_at is not null)`,
    quizzes: sql<number>`(select count(*) from quiz_questions where quiz_questions.category_id = categories.id)`,
  };
}

const toUsage = (row: {
  studyLogs: number;
  notebooks: number;
  trashedNotebooks: number;
  quizzes: number;
}): CategoryUsage => ({
  studyLogs: Number(row.studyLogs),
  notebooks: Number(row.notebooks),
  trashedNotebooks: Number(row.trashedNotebooks),
  quizzes: Number(row.quizzes),
});

/** 何か参照が残っているか。**ゴミ箱のノートも数える**（あれも category を参照している）。 */
const isInUse = (usage: CategoryUsage) =>
  usage.studyLogs > 0 || usage.notebooks > 0 || usage.trashedNotebooks > 0 || usage.quizzes > 0;

/** 画面に出す内訳。0 の項目は書かない。 */
function describeUsage(usage: CategoryUsage): string {
  return [
    usage.notebooks > 0 ? `ノート ${usage.notebooks}件` : '',
    usage.trashedNotebooks > 0 ? `ゴミ箱のノート ${usage.trashedNotebooks}件` : '',
    usage.studyLogs > 0 ? `学習記録 ${usage.studyLogs}件` : '',
    usage.quizzes > 0 ? `問題 ${usage.quizzes}件` : '',
  ]
    .filter(Boolean)
    .join(' / ');
}

async function findUsage(db: Db, categoryId: string, userId: string) {
  const [row] = await db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      examName: categories.examName,
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
        examName: categories.examName,
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
      typeof body?.color === 'string' && COLOR_PATTERN.test(body.color)
        ? body.color
        : DEFAULT_COLOR;

    const examName = readExamName(body?.examName);
    if (examName === 'tooLong') {
      return c.json({ error: `試験名は ${MAX_EXAM_NAME_LENGTH} 文字以内で入力してください` }, 400);
    }

    const db = getDb(c.env);
    const [row] = await db
      .insert(categories)
      .values({
        id: newId('cat'),
        userId: c.get('userId'),
        name,
        color,
        examName: examName ?? null,
      })
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

    const examName = readExamName(body.examName);
    if (examName === 'tooLong') {
      return c.json({ error: `試験名は ${MAX_EXAM_NAME_LENGTH} 文字以内で入力してください` }, 400);
    }

    if (name === undefined && color === undefined && examName === undefined) {
      return c.json({ error: '更新する項目がありません' }, 400);
    }

    const db = getDb(c.env);
    const userId = c.get('userId');

    const updated = await db
      .update(categories)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(examName !== undefined ? { examName } : {}),
      })
      .where(and(eq(categories.id, id), eq(categories.userId, userId)))
      .returning();

    if (updated.length === 0) {
      return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);
    }

    const row = await findUsage(db, id, userId);
    return c.json({ category: toCategoryDto(row, toUsage(row)) });
  })

  /**
   * カテゴリ（フォルダ）を削除する。
   *
   * `mode` で中身の扱いを選ぶ。**素で呼ぶと従来どおり、未使用のときしか消えない**
   * （「カテゴリを管理」からの削除がこの経路）。
   *
   *   なし           未使用のときだけ削除
   *   mode=move&to=  中身を to へ付け替えてから削除。何も失われない
   *   mode=purge     中身ごと削除。**学習記録と問題も消える**
   */
  .delete('/:id', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');
    const id = c.req.param('id');
    const mode = c.req.query('mode');
    const moveTo = c.req.query('to');

    const row = await findUsage(db, id, userId);
    if (!row) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);

    /*
     * 最後の 1 つは消させない。カテゴリが 0 件になると、記録もノートも用語も
     * 「どこに入れるか」を選べなくなり、サインインしても何も始められない。
     */
    const [counted] = await db
      .select({ total: sql<number>`count(*)` })
      .from(categories)
      .where(eq(categories.userId, userId));
    if (Number(counted?.total ?? 0) <= 1) {
      return c.json(
        { error: '最後のフォルダは削除できません。先に別のフォルダを作ってください。' },
        400,
      );
    }

    const usage = toUsage(row);

    if (mode === 'move') {
      if (!moveTo || moveTo === id) {
        return c.json({ error: '移動先のフォルダを指定してください' }, 400);
      }
      const [destination] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, moveTo), eq(categories.userId, userId)))
        .limit(1);
      if (!destination) return c.json({ error: '移動先のフォルダが見つかりません' }, 404);

      /*
       * 中身を付け替えてから消す。**ノートの木は触らなくてよい。**
       * 「子は親と同じ categoryId」という不変条件があるので、その categoryId の行を
       * まとめて付け替えれば parent_id は保たれる。
       */
      await db
        .update(notebooks)
        .set({ categoryId: moveTo })
        .where(and(eq(notebooks.categoryId, id), eq(notebooks.userId, userId)));
      await db
        .update(studyLogs)
        .set({ categoryId: moveTo })
        .where(and(eq(studyLogs.categoryId, id), eq(studyLogs.userId, userId)));
      await db
        .update(quizQuestions)
        .set({ categoryId: moveTo })
        .where(and(eq(quizQuestions.categoryId, id), eq(quizQuestions.userId, userId)));
      // tasks.categoryId は nullable だが、外すより移すほうが親切
      await db
        .update(tasks)
        .set({ categoryId: moveTo })
        .where(and(eq(tasks.categoryId, id), eq(tasks.userId, userId)));

      await db.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, userId)));
      return c.json({ ok: true, moved: usage });
    }

    if (mode === 'purge') {
      /*
       * **CASCADE に頼らず自分で消す。** D1 で外部キー制約が効いているかに挙動を
       * 依存させたくない（効いていなければ親だけ消えて孤児が残り、一覧の
       * innerJoin から静かに落ちる）。参照される側を後に消す。
       */
      await db
        .delete(quizQuestions)
        .where(and(eq(quizQuestions.categoryId, id), eq(quizQuestions.userId, userId)));
      await db
        .delete(studyLogs)
        .where(and(eq(studyLogs.categoryId, id), eq(studyLogs.userId, userId)));
      await db
        .delete(notebooks)
        .where(and(eq(notebooks.categoryId, id), eq(notebooks.userId, userId)));
      await db.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, userId)));
      return c.json({ ok: true, purged: usage });
    }

    // モード指定なし。使用中なら断る（消すと学習記録・問題まで失われるため）。
    if (isInUse(usage)) {
      const response: CategoryInUseResponse = {
        error: `使用中のため削除できません（${describeUsage(usage)}）`,
        usage,
      };
      return c.json(response, 409);
    }

    await db.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, userId)));
    return c.json({ ok: true });
  });
