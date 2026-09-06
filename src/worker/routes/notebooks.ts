import { Hono } from 'hono';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { categories, notebooks, quizQuestions } from '../../db/schema';
import { getDb, type AppEnv, type Db } from '../lib/db';
import { toNotebookDto, toQuizQuestionDto } from '../lib/dto';
import { newId } from '../lib/ids';
import { clampQuestionCount, generateQuizFromNotebook } from '../lib/gemini';
import { canMove, collectSubtreeIds } from '../../shared/note-tree';
import { buildPromptSource } from '../../shared/note-sanitize';
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
  deletedAt: notebooks.deletedAt,
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

/**
 * 生きているノートだけを対象にする条件。
 *
 * **ゴミ箱の中身を混ぜないこと。** ここを 1 箇所でも漏らすと、
 * 消したノートが移動先の候補やツリーの深さ計算に紛れ込み、
 * 「見えないノートのせいで移動できない」という追いにくい不具合になる。
 */
const alive = () => isNull(notebooks.deletedAt);

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
    .where(and(eq(notebooks.userId, userId), alive()));
}

/** 兄弟の末尾に置くための sortOrder */
async function nextSortOrder(db: Db, userId: string, parentId: string | null): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${notebooks.sortOrder})` })
    .from(notebooks)
    .where(
      and(
        eq(notebooks.userId, userId),
        alive(),
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
      .where(and(eq(notebooks.userId, c.get('userId')), alive()))
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
        .where(and(eq(notebooks.id, parentId), eq(notebooks.userId, userId), alive()))
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
      .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId), alive()))
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
    const conditions = [eq(notebooks.id, id), eq(notebooks.userId, userId), alive()];
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
          .where(and(eq(notebooks.userId, userId), inArray(notebooks.id, subtree), alive()));
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
      .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId), alive()));

    // カテゴリを子孫へ伝播（部分木ごとカテゴリが変わる）
    if (nextCategoryId !== target.categoryId) {
      const subtree = collectSubtreeIds(shape, id).filter((childId) => childId !== id);
      if (subtree.length > 0) {
        await db
          .update(notebooks)
          .set({ categoryId: nextCategoryId })
          .where(and(eq(notebooks.userId, userId), inArray(notebooks.id, subtree), alive()));
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
        .where(and(eq(notebooks.id, siblingId), eq(notebooks.userId, userId), alive()));
    }

    const [row] = await db
      .select(notebookSelectWithCategory)
      .from(notebooks)
      .innerJoin(categories, eq(notebooks.categoryId, categories.id))
      .where(eq(notebooks.id, id))
      .limit(1);

    return c.json({ notebook: toNotebookDto(row) });
  })

  /**
   * ゴミ箱へ移す（論理削除）。
   *
   * 物理削除だと、親を消したときに子孫ごと取り返しがつかない。
   * 論理削除なら FK の `onDelete: 'set null'` が発火しないので、
   * **生成済みの問題との紐付けが保たれたまま復元できる**。
   */
  .delete('/:id', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');
    const id = c.req.param('id');

    const shape = await loadTreeShape(db, userId);
    if (!shape.some((n) => n.id === id)) {
      return c.json({ error: '指定されたノートが見つかりません' }, 404);
    }

    // 自己参照 FK の cascade は当てにせず、子孫 ID を自分で集める。件数も返せる。
    const ids = collectSubtreeIds(shape, id);
    // 部分木を同じ時刻で印付けする。この時刻が「まとめて消した単位」になる。
    const deleted = await db
      .update(notebooks)
      .set({ deletedAt: new Date() })
      .where(and(eq(notebooks.userId, userId), inArray(notebooks.id, ids), alive()))
      .returning({ id: notebooks.id });

    const response: DeleteNotebookResponse = { ok: true, deleted: deleted.length };
    return c.json(response);
  })

  /**
   * ゴミ箱の一覧。**「削除の起点」だけを返す。**
   * 子まで並べると、親と一緒に消したはずのものが何件も見えて数え間違える。
   */
  .get('/trash/list', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');

    const rows = await db
      .select(notebookSelectWithCategory)
      .from(notebooks)
      .innerJoin(categories, eq(notebooks.categoryId, categories.id))
      .where(and(eq(notebooks.userId, userId), sql`${notebooks.deletedAt} is not null`))
      .orderBy(asc(notebooks.deletedAt));

    const deletedIds = new Set(rows.map((row) => row.id));
    // 親も一緒に消えているなら、それは起点ではない（親を復元すれば付いてくる）
    const roots = rows.filter((row) => row.parentId === null || !deletedIds.has(row.parentId));

    return c.json({
      notebooks: roots.map(toNotebookDto),
      /** 起点ごとに、子孫を含めて何件消えているか */
      totals: Object.fromEntries(
        roots.map((root) => [
          root.id,
          collectSubtreeIds(
            rows.map((r) => ({ id: r.id, parentId: r.parentId })),
            root.id,
          ).length,
        ]),
      ),
    });
  })

  /** ゴミ箱から戻す。部分木ごと復元する。 */
  .post('/:id/restore', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');
    const id = c.req.param('id');

    const trashed = await db
      .select({ id: notebooks.id, parentId: notebooks.parentId })
      .from(notebooks)
      .where(and(eq(notebooks.userId, userId), sql`${notebooks.deletedAt} is not null`));

    const target = trashed.find((n) => n.id === id);
    if (!target) return c.json({ error: 'ゴミ箱にそのノートがありません' }, 404);

    const ids = collectSubtreeIds(trashed, id);
    await db
      .update(notebooks)
      .set({ deletedAt: null })
      .where(and(eq(notebooks.userId, userId), inArray(notebooks.id, ids)));

    /*
     * 迷子を作らない。
     * 親がまだゴミ箱に残っているなら、カテゴリ直下へ引き上げる。
     * そうしないと「復元したのにツリーのどこにも出てこない」状態になる。
     */
    const parentStillTrashed = target.parentId !== null && trashed.some((n) => n.id === target.parentId);
    if (parentStillTrashed) {
      await db
        .update(notebooks)
        .set({ parentId: null, sortOrder: await nextSortOrder(db, userId, null) })
        .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId)));
    }

    return c.json({ ok: true, restored: ids.length, movedToRoot: parentStillTrashed });
  })

  /** ゴミ箱から完全に消す。ここだけが物理削除。 */
  .delete('/:id/purge', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');
    const id = c.req.param('id');

    const trashed = await db
      .select({ id: notebooks.id, parentId: notebooks.parentId })
      .from(notebooks)
      .where(and(eq(notebooks.userId, userId), sql`${notebooks.deletedAt} is not null`));

    if (!trashed.some((n) => n.id === id)) {
      return c.json({ error: 'ゴミ箱にそのノートがありません' }, 404);
    }

    // ここで初めて FK の onDelete: 'set null' が効き、問題の notebookId が外れる
    const ids = collectSubtreeIds(trashed, id);
    const purged = await db
      .delete(notebooks)
      .where(and(eq(notebooks.userId, userId), inArray(notebooks.id, ids)))
      .returning({ id: notebooks.id });

    return c.json({ ok: true, purged: purged.length });
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
      .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId), alive()))
      .limit(1);

    if (!notebook) return c.json({ error: '指定されたノートが見つかりません' }, 404);
    if (!notebook.content.trim()) {
      return c.json({ error: 'ノートの本文が空です' }, 400);
    }

    // 画像・コードブロックを落として 2,500 文字で切る。
    // 無料枠だと長いノートがそのままレート制限（429）に効くため。
    // 空文字の判定は上（サニタイズ前）で済ませてあるので、ここでは挙動が変わらない。
    const source = buildPromptSource(notebook.content);
    if (source.truncated) {
      // 内容は出さない。切ったという事実と長さだけ残す。
      console.log(
        `[generate-quiz] 本文を切り詰めました notebook=${notebook.id} ${notebook.content.length} -> ${source.text.length} 文字`,
      );
    }

    const { questions: generated, warning } = await generateQuizFromNotebook(
      c.env.GEMINI_API_KEY,
      notebook.title,
      source.text,
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
