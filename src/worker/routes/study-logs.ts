import { Hono } from 'hono';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { categories, quizQuestions, studyLogs, timerSessions } from '../../db/schema';
import { getDb, type AppEnv, type Db } from '../lib/db';
import { toQuizQuestionDto, toStudyLogDto } from '../lib/dto';
import { newId } from '../lib/ids';
import { insertQuizQuestions } from '../lib/quiz-insert';
import { startOfTodayJst, startOfWeekJst } from '../lib/time';
import { CONTENT_KEPT, generateQuizFromStudyLog } from '../lib/gemini';
import { buildStudyEvent } from '../../shared/calendar-event';
import { insertEvent } from '../lib/google-calendar';
import { describeGoogleError } from '../lib/google-error';
import {
  GOOGLE_CALENDAR_SCOPE,
  describeAccessFailure,
  getGoogleAccessToken,
} from '../lib/google-auth';
import { getSettings } from '../lib/user-settings';
import { getMonthlyQuota, quotaWarning } from '../lib/quota';
import { MONTHLY_GENERATION_LIMIT } from '../../shared/types';
import type {
  CategoryTotal,
  CreateStudyLogRequest,
  CreateStudyLogResponse,
  StudyStats,
} from '../../shared/types';

const LOG_LIMIT = 100;
/** 学習メモから作る問題数の上限 */
const QUESTIONS_PER_LOG = 5;

/** timestamp モードのカラムは UNIX 秒で格納されるため、生 SQL 比較用に秒へ変換する */
const toUnixSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

async function buildStats(db: Db, userId: string): Promise<StudyStats> {
  const todaySec = toUnixSeconds(startOfTodayJst());
  const weekSec = toUnixSeconds(startOfWeekJst());

  const [duration] = await db
    .select({
      total: sql<number>`coalesce(sum(${studyLogs.durationMinutes}), 0)`,
      today: sql<number>`coalesce(sum(case when ${studyLogs.createdAt} >= ${todaySec} then ${studyLogs.durationMinutes} else 0 end), 0)`,
      week: sql<number>`coalesce(sum(case when ${studyLogs.createdAt} >= ${weekSec} then ${studyLogs.durationMinutes} else 0 end), 0)`,
    })
    .from(studyLogs)
    .where(eq(studyLogs.userId, userId));

  // 記録が 0 件のカテゴリも 0 分として出したいので categories 起点の leftJoin
  const byCategory: CategoryTotal[] = await db
    .select({
      categoryId: categories.id,
      name: categories.name,
      color: categories.color,
      totalMinutes: sql<number>`coalesce(sum(${studyLogs.durationMinutes}), 0)`,
    })
    .from(categories)
    .leftJoin(studyLogs, eq(studyLogs.categoryId, categories.id))
    .where(eq(categories.userId, userId))
    .groupBy(categories.id, categories.name, categories.color)
    .orderBy(desc(sql`coalesce(sum(${studyLogs.durationMinutes}), 0)`));

  const nowMs = Date.now();
  // due_at は秒精度の unixepoch で入っている（drizzle の timestamp モード）
  const nowSec = Math.floor(nowMs / 1000);

  const [quiz] = await db
    .select({
      total: sql<number>`count(*)`,
      mastered: sql<number>`coalesce(sum(case when ${quizQuestions.isMastered} = 1 then 1 else 0 end), 0)`,
      // 未学習（due_at が NULL）も出題対象に数える
      dueNow: sql<number>`coalesce(sum(case when ${quizQuestions.dueAt} is null or ${quizQuestions.dueAt} <= ${nowSec} then 1 else 0 end), 0)`,
      // まだ来ていないもののうち最も早い出題日
      nextDueSec: sql<
        number | null
      >`min(case when ${quizQuestions.dueAt} > ${nowSec} then ${quizQuestions.dueAt} else null end)`,
    })
    .from(quizQuestions)
    .where(eq(quizQuestions.userId, userId));

  const quizTotal = Number(quiz?.total ?? 0);
  const quizMastered = Number(quiz?.mastered ?? 0);
  const nextDueSec = quiz?.nextDueSec ?? null;

  // 今月の生成数（上限の目安として出す）
  const monthly = await getMonthlyQuota(db, userId);

  return {
    todayMinutes: Number(duration?.today ?? 0),
    weekMinutes: Number(duration?.week ?? 0),
    totalMinutes: Number(duration?.total ?? 0),
    byCategory: byCategory.map((row) => ({ ...row, totalMinutes: Number(row.totalMinutes) })),
    quiz: {
      total: quizTotal,
      mastered: quizMastered,
      masteryRate: quizTotal === 0 ? 0 : quizMastered / quizTotal,
      dueNow: Number(quiz?.dueNow ?? 0),
      generatedThisMonth: Number(monthly?.used ?? 0),
      monthlyLimit: MONTHLY_GENERATION_LIMIT,
      nextDueAt: nextDueSec === null ? null : new Date(Number(nextDueSec) * 1000).toISOString(),
    },
  };
}

export const studyLogsRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');

    const rows = await db
      .select({
        id: studyLogs.id,
        userId: studyLogs.userId,
        categoryId: studyLogs.categoryId,
        durationMinutes: studyLogs.durationMinutes,
        notes: studyLogs.notes,
        createdAt: studyLogs.createdAt,
        categoryName: categories.name,
        categoryColor: categories.color,
      })
      .from(studyLogs)
      .innerJoin(categories, eq(studyLogs.categoryId, categories.id))
      .where(eq(studyLogs.userId, userId))
      .orderBy(desc(studyLogs.createdAt))
      .limit(LOG_LIMIT);

    const stats = await buildStats(db, userId);
    return c.json({ logs: rows.map(toStudyLogDto), stats });
  })

  .post('/', async (c) => {
    const body = await c.req.json<Partial<CreateStudyLogRequest>>().catch(() => null);

    const categoryId = typeof body?.categoryId === 'string' ? body.categoryId : '';
    const durationMinutes = Number(body?.durationMinutes);
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';

    if (!categoryId) return c.json({ error: 'categoryId は必須です' }, 400);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
      return c.json({ error: 'durationMinutes は 1 以上の整数で指定してください' }, 400);
    }
    if (!notes) return c.json({ error: 'notes は必須です' }, 400);

    const db = getDb(c.env);
    const userId = c.get('userId');

    const [category] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .limit(1);

    if (!category) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);

    // タイマー由来なら、学習記録を作る「前」にセッションを確保する。
    // D1 に対話的トランザクションが無いため、条件付き UPDATE の返り件数で勝者を決める。
    // 先に記録を作ってしまうと、2端末同時終了で学習時間が二重計上される。
    const timerSessionId = typeof body?.timerSessionId === 'string' ? body.timerSessionId : '';
    if (timerSessionId) {
      const now = new Date();
      const claimed = await db
        .update(timerSessions)
        .set({ completedAt: now, isRunning: false, updatedAt: now })
        .where(
          and(
            eq(timerSessions.id, timerSessionId),
            eq(timerSessions.userId, userId),
            isNull(timerSessions.completedAt),
          ),
        )
        .returning({ id: timerSessions.id });

      if (claimed.length === 0) {
        // 存在しないか、既に他端末が確定済み
        return c.json({ error: 'すでにこの学習セッションは記録済みです' }, 400);
      }
    }

    const [log] = await db
      .insert(studyLogs)
      .values({ id: newId('log'), userId, categoryId, durationMinutes, notes })
      .returning();

    if (timerSessionId) {
      // 確保済みのセッションに、作成した学習記録を紐づける
      await db
        .update(timerSessions)
        .set({ studyLogId: log.id })
        .where(eq(timerSessions.id, timerSessionId));
    }

    /*
     * 月次の上限を超えていたら生成だけを飛ばす。**学習記録は保存する。**
     * 「生成の失敗が保存を巻き込まない」という既存の方針（API キー未設定・
     * API エラーと同じ扱い）をそのまま当てる。
     */
    const quota = await getMonthlyQuota(db, userId);
    const { questions: generated, warning } = quota.exceeded
      ? { questions: [], warning: quotaWarning(quota) }
      : // 生成に失敗しても保存は成功として扱う（generateQuizFromStudyLog は例外を投げない）
        await generateQuizFromStudyLog(
          c.env.GEMINI_API_KEY,
          notes,
          { categoryName: category.name, examName: category.examName },
          QUESTIONS_PER_LOG,
        );

    const savedQuestions = await insertQuizQuestions(
      db,
      generated.map((q) => ({
        id: newId('qz'),
        userId,
        categoryId,
        studyLogId: log.id,
        question: q.question,
        answer: q.answer,
        explanation: q.explanation || null,
        questionType: 'quiz',
        choices: q.choices,
        tags: q.tags,
      })),
    );

    /*
     * カレンダーへの実績登録。**既定は OFF**（user_settings）。
     *
     * ここも AI 生成と同じ方針で、失敗しても学習記録は保存したままにする。
     * カレンダーが書けないことは、学習を記録できない理由にならない。
     */
    const calendarWarning = await recordToCalendar(c.env, c.req.url, userId, db, {
      categoryName: category.name,
      notes,
      durationMinutes,
    });

    const notices = [warning, calendarWarning].filter((v): v is string => Boolean(v));

    const response: CreateStudyLogResponse = {
      log: toStudyLogDto({
        ...log,
        categoryName: category.name,
        categoryColor: category.color,
      }),
      questions: savedQuestions.map((q) =>
        toQuizQuestionDto({ ...q, categoryName: category.name, categoryColor: category.color }),
      ),
      // 学習記録は保存済みなので、生成やカレンダーが失敗してもそれを伝える
      ...(notices.length > 0 ? { warning: `${notices.join(' ')}${CONTENT_KEPT}` } : {}),
    };

    return c.json(response, 201);
  });

/**
 * 学習実績を Google カレンダーへ書く。**例外を投げない。**
 *
 * 未連携・OFF のときは黙って何もしない（毎回「連携していません」と出しても
 * 使っていない機能の警告が出続けるだけ）。書こうとして失敗したときだけ伝える。
 */
async function recordToCalendar(
  env: Env,
  requestUrl: string,
  userId: string,
  db: Db,
  input: { categoryName: string; notes: string; durationMinutes: number },
): Promise<string | undefined> {
  const settings = await getSettings(db, userId);
  if (!settings.calendarSyncEnabled) return undefined;

  const access = await getGoogleAccessToken(env, requestUrl, userId, [GOOGLE_CALENDAR_SCOPE]);
  if (!access.ok) return describeAccessFailure(access.reason);

  try {
    await insertEvent(
      access.accessToken,
      settings.calendarId,
      buildStudyEvent({
        categoryName: input.categoryName,
        notes: input.notes,
        durationMinutes: input.durationMinutes,
        // 記録した長さのブロックが「いま」に接して終わる。理由は calendar-event.ts。
        endedAt: new Date(),
      }),
    );
    return undefined;
  } catch (error) {
    console.error('[study-logs] calendar insert failed:', error);
    return describeGoogleError(error);
  }
}
