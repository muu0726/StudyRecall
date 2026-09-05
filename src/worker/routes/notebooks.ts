import { Hono } from 'hono';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { categories, notebooks, quizQuestions } from '../../db/schema';
import { getDb, type AppEnv, type Db } from '../lib/db';
import { toNotebookDto, toQuizQuestionDto } from '../lib/dto';
import { newId } from '../lib/ids';
import { clampQuestionCount, generateQuizFromNotebook } from '../lib/gemini';
import { canMove, collectSubtreeIds } from '../../shared/note-tree';
import {
  DEFAULT_GENERATED_QUESTIONS,
  type CreateNotebookRequest,
  type DeleteNotebookResponse,
  type GenerateNotebookQuizRequest,
  type GenerateNotebookQuizResponse,
  type MoveNotebookRequest,
  type UpdateNotebookRequest,
} from '../../shared/types';

/** ISO 文字列でもミリ秒数値でも受け取れるようにする。不正なら null。 */
function parseExpectedUpdatedAt(value: string | number | undefined): Date | null {
  if (value === undefined || value === null) return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

const notebookSelectWithCategory = {
  id: notebooks.id,
  userId: notebooks.userId,
  categoryId: notebooks.categoryId,
  parentId: notebooks.parentId,
  sortOrder: notebooks.sortOrder,
  title: notebooks.title,
  content: notebooks.content,
  createdAt: notebooks.createdAt,
  updatedAt: notebooks.updatedAt,
  categoryName: categories.name,
  categoryColor: categories.color,
};

/** 階層の判定に使う最小限の一覧。ツリー操作は必ずこれを起点にする。 */
function loadTreeShape(db: Db, userId: string) {
  return db
    .select({
      id: notebooks.id,
      parentId: notebooks.parentId,
      categoryId: notebooks.categoryId,
      sortOrder: notebooks.sortOrder,
    })
    .from(notebooks)
    .where(eq(notebooks.userId, userId));
}

/** 兄弟の末尾に置くための sortOrder */
async function nextSortOrder(db: Db, userId: string, parentId: string | null): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${notebooks.sortOrder})` })
    .from(notebooks)
    .where(
      and(
        eq(notebooks.userId, userId),
        parentId === null ? sql`${notebooks.parentId} is null` : eq(notebooks.parentId, parentId),
      ),
    );
  return (Number(row?.max ?? -1) || 0) + (row?.max === null ? 1 : 1);
}

export const notebooksRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env);
    // ツリーの組み立ては描画側に任せ、ここはフラットな配列を返す。
    // 並び順が確定していれば、同じ親の子は必ずこの順で並ぶ。
    const rows = await db
      .select(notebookSelectWithCategory)
      .from(notebooks)
      .innerJoin(categories, eq(notebooks.categoryId, categories.id))
      .where(eq(notebooks.userId, c.get('userId')))
      .orderBy(asc(notebooks.sortOrder), asc(notebooks.createdAt));

    return c.json({ notebooks: rows.map(toNotebookDto) });
  })

  .post('/', async (c) => {
    const body = await c.req.json<Partial<CreateNotebookRequest>>().catch(() => null);

    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const content = typeof body?.content === 'string' ? body.content : '';
    const parentId = typeof body?.parentId === 'string' ? body.parentId : null;
    let categoryId = typeof body?.categoryId === 'string' ? body.categoryId : '';

    if (!title) return c.json({ error: 'title は必須です' }, 400);

    const db = getDb(c.env);
    const userId = c.get('userId');

    if (parentId) {
      // 子は親のカテゴリを継承する（カテゴリが最上位という不変条件）
      const [parent] = await db
        .select({ id: notebooks.id, categoryId: notebooks.categoryId })
        .from(notebooks)
        .where(and(eq(notebooks.id, parentId), eq(notebooks.userId, userId)))
        .limit(1);
      if (!parent) return c.json({ error: '指定された親ノートが見つかりません' }, 404);

      const shape = await loadTreeShape(db, userId);
      // 新しいノートを仮に置いて深さを見る
      const check = canMove([...shape, { id: '__new__', parentId }], '__new__', parentId);
      if (!check.ok) {
        return c.json({ error: 'これ以上深い階層にはノートを作れません' }, 400);
      }
      categoryId = parent.categoryId;
    }

    if (!categoryId) return c.json({ error: 'categoryId は必須です' }, 400);

    const [category] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .limit(1);
    if (!category) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);

    const [row] = await db
      .insert(notebooks)
      .values({
        id: newId('nb'),
        userId,
        categoryId,
        parentId,
        sortOrder: await nextSortOrder(db, userId, parentId),
        title,
        content,
      })
      .returning();

    return c.json(
      {
        notebook: toNotebookDto({
          ...row,
          categoryName: category.name,
          categoryColor: category.color,
        }),
      },
      201,
    );
  })

  .put('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<Partial<UpdateNotebookRequest>>().catch(() => null);
    if (!body) return c.json({ error: 'リクエストボディが不正です' }, 400);

    const db = getDb(c.env);
    const userId = c.get('userId');

    const [existing] = await db
      .select()
      .from(notebooks)
      .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId)))
      .limit(1);
    if (!existing) return c.json({ error: '指定されたノートが見つかりません' }, 404);

    const title = typeof body.title === 'string' ? body.title.trim() : undefined;
    if (title === '') return c.json({ error: 'title は空にできません' }, 400);

    const categoryId = typeof body.categoryId === 'string' ? body.categoryId : undefined;
    if (categoryId) {
      // 子は親のカテゴリに従うので、ルート以外はカテゴリを直接変えさせない
      if (existing.parentId !== null) {
        return c.json(
          { error: '子ノートのカテゴリは親に従います。移動でカテゴリを変えてください' },
          400,
        );
      }
      const [category] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
        .limit(1);
      if (!category) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);
    }

    // 楽観的ロック。読み込んだ時点の updatedAt を突き合わせて、
    // 他端末の更新を無言で踏み潰さないようにする。
    const force = body.force === true;
    const expected = parseExpectedUpdatedAt(body.expectedUpdatedAt);
    if (!force && expected === null) {
      return c.json(
        { error: 'expectedUpdatedAt（読み込み時点の updatedAt）または force が必要です' },
        400,
      );
    }

    const changes = {
      ...(title !== undefined ? { title } : {}),
      ...(typeof body.content === 'string' ? { content: body.content } : {}),
      ...(categoryId ? { categoryId } : {}),
      updatedAt: new Date(),
    };

    // D1 には対話的トランザクションが無いため、「読んでから書く」ではなく
    // 条件付き UPDATE の返り件数で勝者を決める（compare-and-swap）。
    const conditions = [eq(notebooks.id, id), eq(notebooks.userId, userId)];
    if (!force && expected !== null) {
      conditions.push(eq(notebooks.updatedAt, expected));
    }

    const updated = await db
      .update(notebooks)
      .set(changes)
      .where(and(...conditions))
      .returning({ id: notebooks.id });

    // ルートのカテゴリを変えたら、子孫にも伝播させる
    if (updated.length > 0 && categoryId && existing.parentId === null) {
      const shape = await loadTreeShape(db, userId);
      const subtree = collectSubtreeIds(shape, id).filter((childId) => childId !== id);
      if (subtree.length > 0) {
        await db
          .update(notebooks)
          .set({ categoryId })
          .where(and(eq(notebooks.userId, userId), inArray(notebooks.id, subtree)));
      }
    }

    const [row] = await db
      .select(notebookSelectWithCategory)
      .from(notebooks)
      .innerJoin(categories, eq(notebooks.categoryId, categories.id))
      .where(eq(notebooks.id, id))
      .limit(1);

    if (updated.length === 0) {
      // 対象は存在する（上で確認済み）ので、0 件 = トークン不一致 = 競合
      return c.json(
        {
          error: '他の端末でこのノートが更新されています',
          currentContent: row.content,
          notebook: toNotebookDto(row),
        },
        409,
      );
    }

    return c.json({ notebook: toNotebookDto(row) });
  })

  /**
   * ツリー内での移動。本文の楽観的ロックと衝突させたくないので PUT とは分ける。
   * 移動は「親の付け替え」と「兄弟内での並び替え」の両方を兼ねる。
   */
  .post('/:id/move', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<Partial<MoveNotebookRequest>>().catch(() => null);
    if (!body) return c.json({ error: 'リクエストボディが不正です' }, 400);

    const parentId = typeof body.parentId === 'string' ? body.parentId : null;
    const index = Number.isFinite(Number(body.index)) ? Math.max(0, Number(body.index)) : 0;

    const db = getDb(c.env);
    const userId = c.get('userId');
    const shape = await loadTreeShape(db, userId);

    const target = shape.find((n) => n.id === id);
    if (!target) return c.json({ error: '指定されたノートが見つかりません' }, 404);

    // 循環と深さの検証。クライアントと同じ規則を共有モジュールから使う。
    const check = canMove(shape, id, parentId);
    if (!check.ok) {
      if (check.reason === 'not-found') {
        return c.json({ error: '移動先のノートが見つかりません' }, 404);
      }
      return c.json(
        {
          error:
            check.reason === 'cycle'
              ? '自分自身や子ノートの下へは移動できません'
              : 'これ以上深い階層には移動できません',
        },
        400,
      );
    }

    // 移動後のカテゴリを決める。親がいれば継承、ルートなら指定 or 現状維持。
    let nextCategoryId = target.categoryId;
    if (parentId !== null) {
      nextCategoryId = shape.find((n) => n.id === parentId)?.categoryId ?? target.categoryId;
    } else if (typeof body.categoryId === 'string') {
      const [category] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, body.categoryId), eq(categories.userId, userId)))
        .limit(1);
      if (!category) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);
      nextCategoryId = body.categoryId;
    }

    // 親の付け替え
    await db
      .update(notebooks)
      .set({ parentId, categoryId: nextCategoryId, updatedAt: new Date() })
      .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId)));

    // カテゴリを子孫へ伝播（部分木ごとカテゴリが変わる）
    if (nextCategoryId !== target.categoryId) {
      const subtree = collectSubtreeIds(shape, id).filter((childId) => childId !== id);
      if (subtree.length > 0) {
        await db
          .update(notebooks)
          .set({ categoryId: nextCategoryId })
          .where(and(eq(notebooks.userId, userId), inArray(notebooks.id, subtree)));
      }
    }

    // 移動先の兄弟を 0,1,2… で振り直す。
    // 少数のノートしか扱わないので、素朴な再採番で十分。
    const siblings = shape
      .filter((n) => n.parentId === parentId && n.id !== id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((n) => n.id);
    siblings.splice(Math.min(index, siblings.length), 0, id);

    for (const [position, siblingId] of siblings.entries()) {
      await db
        .update(notebooks)
        .set({ sortOrder: position })
        .where(and(eq(notebooks.id, siblingId), eq(notebooks.userId, userId)));
    }

    const [row] = await db
      .select(notebookSelectWithCategory)
      .from(notebooks)
      .innerJoin(categories, eq(notebooks.categoryId, categories.id))
      .where(eq(notebooks.id, id))
      .limit(1);

    return c.json({ notebook: toNotebookDto(row) });
  })

  .delete('/:id', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');
    const id = c.req.param('id');

    const shape = await loadTreeShape(db, userId);
    if (!shape.some((n) => n.id === id)) {
      return c.json({ error: '指定されたノートが見つかりません' }, 404);
    }

    // 自己参照 FK の cascade が D1 で再帰的に効くかは当てにせず、
    // 子孫 ID を自分で集めてから一括で消す。件数も返せる。
    const ids = collectSubtreeIds(shape, id);
    // 生成済みの問題は notebook_id が null になって残る（onDelete: 'set null'）
    const deleted = await db
      .delete(notebooks)
      .where(and(eq(notebooks.userId, userId), inArray(notebooks.id, ids)))
      .returning({ id: notebooks.id });

    const response: DeleteNotebookResponse = { ok: true, deleted: deleted.length };
    return c.json(response);
  })

  /** ノート本文から一問一答を生成して notebookId 付きで保存する */
  .post('/:id/generate-quiz', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<Partial<GenerateNotebookQuizRequest>>().catch(() => null);
    const count = clampQuestionCount(body?.count, DEFAULT_GENERATED_QUESTIONS);

    const db = getDb(c.env);
    const userId = c.get('userId');

    const [notebook] = await db
      .select(notebookSelectWithCategory)
      .from(notebooks)
      .innerJoin(categories, eq(notebooks.categoryId, categories.id))
      .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId)))
      .limit(1);

    if (!notebook) return c.json({ error: '指定されたノートが見つかりません' }, 404);
    if (!notebook.content.trim()) {
      return c.json({ error: 'ノートの本文が空です' }, 400);
    }

    const { questions: generated, warning } = await generateQuizFromNotebook(
      c.env.GEMINI_API_KEY,
      notebook.title,
      notebook.content,
      notebook.categoryName,
      count,
    );

    const saved =
      generated.length === 0
        ? []
        : await db
            .insert(quizQuestions)
            .values(
              generated.map((q) => ({
                id: newId('qz'),
                userId,
                categoryId: notebook.categoryId,
                studyLogId: null,
                notebookId: notebook.id,
                question: q.question,
                answer: q.answer,
                explanation: q.explanation || null,
                tags: q.tags,
              })),
            )
            .returning();

    const response: GenerateNotebookQuizResponse = {
      questions: saved.map((q) =>
        toQuizQuestionDto({
          ...q,
          categoryName: notebook.categoryName,
          categoryColor: notebook.categoryColor,
        }),
      ),
      ...(warning ? { warning } : {}),
    };
    return c.json(response, 201);
  });
