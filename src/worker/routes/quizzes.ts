import { Hono } from 'hono';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { categories, quizQuestions } from '../../db/schema';
import { getDb, type AppEnv } from '../lib/db';
import { toQuizQuestionDto } from '../lib/dto';
import { newId } from '../lib/ids';
import { quizSelectWithCategory } from '../lib/queries';
import { generateQuizFromTerm } from '../lib/gemini';
import {
  MASTERY_THRESHOLD,
  type ManualAddQuizRequest,
  type ManualAddQuizResponse,
  type QuizResultRequest,
} from '../../shared/types';

const QUIZ_LIMIT = 200;

export const quizzesRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');

    const categoryId = c.req.query('categoryId');
    const notebookId = c.req.query('notebookId');
    const tag = c.req.query('tag');
    const unmasteredOnly = c.req.query('unmasteredOnly') === 'true';

    const filters: SQL[] = [eq(quizQuestions.userId, userId)];
    if (categoryId) filters.push(eq(quizQuestions.categoryId, categoryId));
    if (notebookId) filters.push(eq(quizQuestions.notebookId, notebookId));
    if (unmasteredOnly) filters.push(eq(quizQuestions.isMastered, false));
    if (tag) {
      // tags は JSON 配列の文字列。json_each で配列要素へ展開して一致を見る。
      filters.push(
        sql`exists (select 1 from json_each(${quizQuestions.tags}) where value = ${tag})`,
      );
    }

    const rows = await db
      .select(quizSelectWithCategory)
      .from(quizQuestions)
      .innerJoin(categories, eq(quizQuestions.categoryId, categories.id))
      .where(and(...filters))
      // 未回答（lastAnsweredAt が NULL）が先頭に来る。SQLite の ASC は NULL が先。
      .orderBy(asc(quizQuestions.lastAnsweredAt), desc(quizQuestions.createdAt))
      .limit(QUIZ_LIMIT);

    return c.json({ questions: rows.map(toQuizQuestionDto) });
  })

  /** 用語のクイック追加。Gemini で 1 問だけ生成して保存する。 */
  .post('/manual-add', async (c) => {
    const body = await c.req.json<Partial<ManualAddQuizRequest>>().catch(() => null);

    const categoryId = typeof body?.categoryId === 'string' ? body.categoryId : '';
    const term = typeof body?.term === 'string' ? body.term.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';

    if (!categoryId) return c.json({ error: 'categoryId は必須です' }, 400);
    if (!term) return c.json({ error: 'term は必須です' }, 400);
    if (!description) return c.json({ error: 'description は必須です' }, 400);

    const db = getDb(c.env);
    const userId = c.get('userId');

    const [category] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .limit(1);

    if (!category) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);

    const { questions, warning } = await generateQuizFromTerm(
      c.env.GEMINI_API_KEY,
      term,
      description,
      category.name,
    );

    const generated = questions[0];
    if (!generated) {
      // 生成できなかった場合は保存しない。用語追加は生成が本体のため。
      const failed: ManualAddQuizResponse = {
        question: null,
        warning: warning ?? '問題を生成できませんでした。',
      };
      return c.json(failed, 502);
    }

    const [saved] = await db
      .insert(quizQuestions)
      .values({
        id: newId('qz'),
        userId,
        categoryId,
        // 学習記録にもノートにも属さない、手動追加の問題
        studyLogId: null,
        notebookId: null,
        question: generated.question,
        answer: generated.answer,
        explanation: generated.explanation || null,
        tags: generated.tags,
      })
      .returning();

    const response: ManualAddQuizResponse = {
      question: toQuizQuestionDto({
        ...saved,
        categoryName: category.name,
        categoryColor: category.color,
      }),
    };
    return c.json(response, 201);
  })

  .post('/:id/result', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<Partial<QuizResultRequest>>().catch(() => null);

    if (typeof body?.correct !== 'boolean') {
      return c.json({ error: 'correct は boolean で指定してください' }, 400);
    }

    const db = getDb(c.env);
    const userId = c.get('userId');
    const now = new Date();

    // カウントは SQL 側でインクリメントし、読み取り→書き込みの競合を避ける
    const updated = await db
      .update(quizQuestions)
      .set(
        body.correct
          ? {
              correctCount: sql`${quizQuestions.correctCount} + 1`,
              lastAnsweredAt: now,
              isMastered: sql`case when ${quizQuestions.correctCount} + 1 >= ${MASTERY_THRESHOLD} then 1 else 0 end`,
            }
          : {
              incorrectCount: sql`${quizQuestions.incorrectCount} + 1`,
              lastAnsweredAt: now,
              // 「まだ不安」なら習得済みを取り消す
              isMastered: false,
            },
      )
      .where(and(eq(quizQuestions.id, id), eq(quizQuestions.userId, userId)))
      .returning();

    if (updated.length === 0) {
      return c.json({ error: '指定された問題が見つかりません' }, 404);
    }

    const [row] = await db
      .select(quizSelectWithCategory)
      .from(quizQuestions)
      .innerJoin(categories, eq(quizQuestions.categoryId, categories.id))
      .where(eq(quizQuestions.id, id))
      .limit(1);

    return c.json({ question: toQuizQuestionDto(row) });
  });
