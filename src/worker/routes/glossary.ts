import { Hono } from 'hono';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { categories, glossaryTerms, quizQuestions } from '../../db/schema';
import { getDb, type AppEnv, type Db } from '../lib/db';
import { toGlossaryTermDto } from '../lib/dto';
import { newId } from '../lib/ids';
import { glossaryCardsJoin, glossarySelectWithStats } from '../lib/queries';
import { MAX_PROMPT_TAGS, defineTermWithAI, generateQuestionsFromGlossary } from '../lib/gemini';
import { insertQuizQuestions } from '../lib/quiz-insert';
import { insertGlossaryTerms } from '../lib/glossary-insert';
import { MAX_BULK_TERMS, prepareBulkTerms, type BulkTermInput } from '../../shared/glossary-bulk';
import { toQuizQuestionDto } from '../lib/dto';
import { getMonthlyQuota, quotaWarning } from '../lib/quota';
import { mirrorGlossary } from '../lib/glossary-mirror';
import { ensureBackupFolder } from '../lib/google-drive';
import { describeGoogleError } from '../lib/google-error';
import {
  GOOGLE_DRIVE_SCOPE,
  describeAccessFailure,
  getGoogleAccessToken,
} from '../lib/google-auth';
import { getSettings, saveSettings } from '../lib/user-settings';
import { normalizeForSearch } from '../../shared/glossary-search';
import {
  GLOSSARY_LIMIT,
  MAX_DEFINITION_LENGTH,
  MAX_TAGS_PER_TERM,
  GLOSSARY_SYNC_MIN_INTERVAL_MS,
  MAX_GLOSSARY_GENERATE_TERMS,
  MAX_TERM_LENGTH,
  type CreateGlossaryTermsRequest,
  type CreateGlossaryTermsResponse,
  type CreateGlossaryTermRequest,
  type GenerateGlossaryCardsRequest,
  type GenerateGlossaryCardsResponse,
  type GlossaryAiAssistRequest,
  type GlossaryAiAssistResponse,
  type DeleteGlossaryTermResponse,
  type GlossaryDuplicateResponse,
  type GlossaryTermResponse,
  type GlossarySyncResponse,
  type GlossaryTermsResponse,
  type UpdateGlossaryTermRequest,
} from '../../shared/types';

/**
 * 用語辞書。
 *
 * **検索（q）と習得ステータスの絞り込みはここで行わない。** クライアント側で畳む。
 * SQLite は ICU を持たず `LIKE`/`NOCASE` が ASCII しか畳めないので、
 * `ＴＣＰ`↔`TCP`、`ﾈｯﾄﾜｰｸ`↔`ネットワーク`↔`ねっとわーく` を D1 では一致させられない。
 * 理由と正規化の実装は src/shared/glossary-search.ts にある。
 *
 * ここが返すのは「カテゴリとタグで粗く絞った全件」で、上限を超えたら `truncated` を立てる。
 * 立てずに黙って切ると、**クライアント検索がコーパスの先頭しか見ていない**状態になる。
 */

/** タグを正規化して重複を落とし、上限で切る。空文字は捨てる。 */
function coerceTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim();
    if (!tag) continue;
    const key = normalizeForSearch(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS_PER_TERM) break;
  }
  return tags;
}

/** AI に渡す下書きの長さの上限。長すぎると指示より下書きが場を取る */
const MAX_ASSIST_DEFINITION_LENGTH = 500;

/**
 * そのユーザーが使っているタグを、よく使う順に集める。
 *
 * **用語だけでなく問題のタグも混ぜる。** 分けると、辞書を使い始めた直後は
 * 候補が空になり、AI が既存の言い回しを知らないまま新しいタグを作り始める。
 */
async function listUserTags(db: Db, userId: string): Promise<string[]> {
  const rows = await db.all<{ tag: string; count: number }>(sql`
    select tag, sum(count) as count from (
      select je.value as tag, count(*) as count
      from glossary_terms, json_each(glossary_terms.tags) as je
      where glossary_terms.user_id = ${userId}
      group by je.value
      union all
      select je.value as tag, count(*) as count
      from quiz_questions, json_each(quiz_questions.tags) as je
      where quiz_questions.user_id = ${userId}
      group by je.value
    )
    group by tag
    order by count desc, tag asc
    limit ${MAX_PROMPT_TAGS}
  `);
  return rows.map((row) => row.tag);
}

/** 1 件だけ DTO の形で読み直す。作成・更新の応答は必ずここを通す（集計を含めるため）。 */
async function findTerm(db: Db, userId: string, id: string) {
  const [row] = await db
    .select(glossarySelectWithStats)
    .from(glossaryTerms)
    .innerJoin(categories, eq(glossaryTerms.categoryId, categories.id))
    .leftJoin(quizQuestions, glossaryCardsJoin(userId))
    .where(and(eq(glossaryTerms.id, id), eq(glossaryTerms.userId, userId)))
    .groupBy(glossaryTerms.id)
    .limit(1);

  return row ? toGlossaryTermDto(row) : null;
}

/** 同じカテゴリの同じ用語。`exceptId` を渡すと自分自身は除く（更新用）。 */
async function findDuplicate(
  db: Db,
  userId: string,
  categoryId: string,
  termKey: string,
  exceptId?: string,
) {
  const conditions = [
    eq(glossaryTerms.userId, userId),
    eq(glossaryTerms.categoryId, categoryId),
    eq(glossaryTerms.termKey, termKey),
  ];
  if (exceptId) conditions.push(ne(glossaryTerms.id, exceptId));

  const [row] = await db
    .select({ id: glossaryTerms.id })
    .from(glossaryTerms)
    .where(and(...conditions))
    .limit(1);

  return row?.id ?? null;
}

export const glossaryRoute = new Hono<AppEnv>()
  /** 一覧。カテゴリとタグだけで絞る（q と習得ステータスはクライアント側） */
  .get('/', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');

    const categoryId = c.req.query('categoryId');
    const tag = c.req.query('tag');

    const filters = [eq(glossaryTerms.userId, userId)];
    if (categoryId) filters.push(eq(glossaryTerms.categoryId, categoryId));
    if (tag) {
      // quizzes.ts と同じ json_each の書き方に揃える
      filters.push(
        sql`exists (select 1 from json_each(${glossaryTerms.tags}) where value = ${tag})`,
      );
    }

    const rows = await db
      .select(glossarySelectWithStats)
      .from(glossaryTerms)
      .innerJoin(categories, eq(glossaryTerms.categoryId, categories.id))
      .leftJoin(quizQuestions, glossaryCardsJoin(userId))
      .where(and(...filters))
      .groupBy(glossaryTerms.id)
      .orderBy(desc(glossaryTerms.updatedAt))
      // 1 件多く取って、切れたかどうかを判定する
      .limit(GLOSSARY_LIMIT + 1);

    const truncated = rows.length > GLOSSARY_LIMIT;
    const response: GlossaryTermsResponse = {
      terms: rows.slice(0, GLOSSARY_LIMIT).map(toGlossaryTermDto),
      truncated,
    };
    return c.json(response);
  })

  .post('/', async (c) => {
    const body = await c.req.json<Partial<CreateGlossaryTermRequest>>().catch(() => null);

    const categoryId = typeof body?.categoryId === 'string' ? body.categoryId : '';
    const term = typeof body?.term === 'string' ? body.term.trim() : '';
    const definition = typeof body?.definition === 'string' ? body.definition.trim() : '';
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId : null;

    if (!categoryId) return c.json({ error: 'categoryId は必須です' }, 400);
    if (!term) return c.json({ error: '用語を入力してください' }, 400);
    if (term.length > MAX_TERM_LENGTH) {
      return c.json({ error: `用語は ${MAX_TERM_LENGTH} 文字以内で入力してください` }, 400);
    }
    if (definition.length > MAX_DEFINITION_LENGTH) {
      return c.json({ error: `意味は ${MAX_DEFINITION_LENGTH} 文字以内で入力してください` }, 400);
    }

    const db = getDb(c.env);
    const userId = c.get('userId');

    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .limit(1);
    if (!category) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);

    const termKey = normalizeForSearch(term);

    /*
     * 一意インデックスに任せて例外を拾う手もあるが、そうすると
     * 「既にあるのはどれか」を返せない。先に引いておいて 409 に載せる。
     */
    const duplicateId = await findDuplicate(db, userId, categoryId, termKey);
    if (duplicateId) {
      const existing = await findTerm(db, userId, duplicateId);
      if (existing) {
        const conflict: GlossaryDuplicateResponse = {
          error: 'このカテゴリには同じ用語が既に登録されています',
          term: existing,
        };
        return c.json(conflict, 409);
      }
    }

    const id = newId('gt');
    await db.insert(glossaryTerms).values({
      id,
      userId,
      categoryId,
      notebookId,
      term,
      termKey,
      definition,
      tags: coerceTags(body?.tags),
    });

    const saved = await findTerm(db, userId, id);
    if (!saved) return c.json({ error: '用語を保存できませんでした' }, 500);

    const response: GlossaryTermResponse = { term: saved };
    return c.json(response, 201);
  })

  /**
   * 意味とタグを AI に補ってもらう。**保存はしない。**
   *
   * 既存タグを一緒に渡すのが要点で、渡さないと同じ分野が
   * 「通信 / 通信技術 / ネットワーク」に割れていく（→ lib/gemini.ts）。
   *
   * ここは補完そのものが目的なので、上限に当たったら 429 で断る
   * （生成が失敗しても保存だけは通す、というノートの経路とは立場が違う）。
   */
  .post('/ai-assist', async (c) => {
    const body = await c.req.json<Partial<GlossaryAiAssistRequest>>().catch(() => null);

    const categoryId = typeof body?.categoryId === 'string' ? body.categoryId : '';
    const term = typeof body?.term === 'string' ? body.term.trim() : '';
    const definition = typeof body?.definition === 'string' ? body.definition.trim() : '';

    if (!categoryId) return c.json({ error: 'categoryId は必須です' }, 400);
    if (!term) return c.json({ error: '用語を入力してください' }, 400);
    if (term.length > MAX_TERM_LENGTH) {
      return c.json({ error: `用語は ${MAX_TERM_LENGTH} 文字以内で入力してください` }, 400);
    }

    const db = getDb(c.env);
    const userId = c.get('userId');

    const [category] = await db
      .select({ name: categories.name })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .limit(1);
    if (!category) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);

    const quota = await getMonthlyQuota(db, userId);
    if (quota.exceeded) return c.json({ error: quotaWarning(quota) }, 429);

    const existingTags = await listUserTags(db, userId);

    const result = await defineTermWithAI(
      c.env.GEMINI_API_KEY,
      term,
      // 長い下書きをそのまま渡すと本文が押し出されるので、ここで切る
      definition.slice(0, MAX_ASSIST_DEFINITION_LENGTH),
      existingTags,
      category.name,
    );

    /*
     * 失敗しても 200 で返す。**手で書けば済む補助**なので、
     * エラーにして入力を巻き戻すほうが損（defineTermWithAI は例外を投げない）。
     */
    const response: GlossaryAiAssistResponse = {
      definition: result.term?.definition ?? '',
      tags: result.term?.tags ?? [],
      warning: result.warning,
    };
    return c.json(response);
  })

  /**
   * 選んだ用語からカードを作る。
   *
   * **対象はクライアントが選んで id で送る。** サーバーで条件から選び直すと、
   * 画面に出ている件数と作られる件数が食い違いうる。
   *
   * 生成は 1 カテゴリぶんずつ回す。プロンプトにカテゴリ名を載せているのと、
   * カードの categoryId が用語ごとに違うため。
   */
  .post('/generate-cards', async (c) => {
    const body = await c.req.json<Partial<GenerateGlossaryCardsRequest>>().catch(() => null);

    const termIds = Array.isArray(body?.termIds)
      ? body.termIds.filter((id): id is string => typeof id === 'string')
      : [];
    const questionType =
      body?.questionType === 'cloze' || body?.questionType === 'quiz' ? body.questionType : 'qa';

    if (termIds.length === 0) return c.json({ error: '用語を選んでください' }, 400);
    if (termIds.length > MAX_GLOSSARY_GENERATE_TERMS) {
      return c.json(
        { error: `一度に生成できるのは ${MAX_GLOSSARY_GENERATE_TERMS} 件までです` },
        400,
      );
    }

    const db = getDb(c.env);
    const userId = c.get('userId');

    const rows = await db
      .select({
        id: glossaryTerms.id,
        categoryId: glossaryTerms.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        term: glossaryTerms.term,
        definition: glossaryTerms.definition,
        tags: glossaryTerms.tags,
      })
      .from(glossaryTerms)
      .innerJoin(categories, eq(glossaryTerms.categoryId, categories.id))
      .where(and(eq(glossaryTerms.userId, userId), inArray(glossaryTerms.id, termIds)));

    if (rows.length === 0) return c.json({ error: '指定された用語が見つかりません' }, 404);

    const quota = await getMonthlyQuota(db, userId);
    if (quota.exceeded) {
      const exceeded: GenerateGlossaryCardsResponse = {
        questions: [],
        warning: quotaWarning(quota),
      };
      return c.json(exceeded);
    }

    // カテゴリごとにまとめる（4択の誤答も同じカテゴリの用語から作りたい）
    const byCategory = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = byCategory.get(row.categoryId);
      if (group) group.push(row);
      else byCategory.set(row.categoryId, [row]);
    }

    const inserts: (typeof quizQuestions.$inferInsert)[] = [];
    const meta = new Map<string, { categoryName: string; categoryColor: string }>();
    const warnings: string[] = [];

    for (const group of byCategory.values()) {
      const first = group[0];
      if (!first) continue;

      const { questions, warning } = await generateQuestionsFromGlossary(
        c.env.GEMINI_API_KEY,
        group.map((row) => ({
          term: row.term,
          definition: row.definition,
          tags: Array.isArray(row.tags) ? row.tags : [],
        })),
        questionType,
        first.categoryName,
      );
      if (warning) warnings.push(warning);

      const idByTerm = new Map(group.map((row) => [row.term, row.id]));
      for (const generated of questions) {
        const glossaryTermId = idByTerm.get(generated.sourceTerm);
        // coerce 側で弾いているはずだが、対応付かないものは保存しない
        if (!glossaryTermId) continue;

        const id = newId('qz');
        meta.set(id, { categoryName: first.categoryName, categoryColor: first.categoryColor });
        inserts.push({
          id,
          userId,
          categoryId: first.categoryId,
          studyLogId: null,
          notebookId: null,
          glossaryTermId,
          question: generated.question,
          answer: generated.answer,
          explanation: generated.explanation || null,
          questionType,
          choices: generated.choices,
          tags: generated.tags,
        });
      }
    }

    // D1 のバインド変数上限（100）に当たるので、必ずここを通す
    const saved = await insertQuizQuestions(db, inserts);

    const response: GenerateGlossaryCardsResponse = {
      questions: saved.map((row) => {
        const found = meta.get(row.id);
        return toQuizQuestionDto({
          ...row,
          categoryName: found?.categoryName ?? '',
          categoryColor: found?.categoryColor ?? '#3b82f6',
        });
      }),
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    };
    return c.json(response, 201);
  })

  /**
   * 用語辞書を Drive に書き出す。**一方通行。**
   *
   * `auto: true` は裏で走る同期。**条件に合わなければ 200 + skipped で返す**
   * （頼んでいない処理でエラーのトーストを出さない。backup/run と同じ契約）。
   * 手動の ☁️ は間隔の床を素通りする。
   */
  .post('/sync-drive', async (c) => {
    const userId = c.get('userId');
    const body = await c.req.json<{ auto?: unknown }>().catch(() => null);
    const auto = body?.auto === true;
    const db = getDb(c.env);

    const settings = await getSettings(db, userId);

    if (auto) {
      if (!settings.driveGlossaryEnabled) {
        return c.json<GlossarySyncResponse>({ skipped: true, reason: 'disabled' });
      }
      /*
       * サーバー側の床。クライアントのデバウンスが壊れても Drive を叩き続けない。
       * **これが本体の防御**で、待つこと自体はクライアントの仕事。
       */
      const since = settings.glossarySyncedAt
        ? Date.now() - settings.glossarySyncedAt.getTime()
        : Infinity;
      if (since < GLOSSARY_SYNC_MIN_INTERVAL_MS) {
        return c.json<GlossarySyncResponse>({ skipped: true, reason: 'recent' });
      }
    }

    const access = await getGoogleAccessToken(c.env, c.req.url, userId, [GOOGLE_DRIVE_SCOPE]);
    if (!access.ok) {
      if (auto) return c.json<GlossarySyncResponse>({ skipped: true, reason: access.reason });
      return c.json({ error: describeAccessFailure(access.reason) }, 403);
    }

    try {
      const folder = await ensureBackupFolder(access.accessToken, settings.driveFolderId);
      if (folder.id !== settings.driveFolderId) {
        await saveSettings(db, userId, { driveFolderId: folder.id });
      }
      const result = await mirrorGlossary(db, userId, access.accessToken, folder.id);
      return c.json<GlossarySyncResponse>({ terms: result.terms, syncedAt: result.syncedAt });
    } catch (error) {
      console.error('[glossary] drive sync failed:', error);
      if (auto) return c.json<GlossarySyncResponse>({ skipped: true, reason: 'failed' });
      return c.json({ error: describeGoogleError(error) }, 502);
    }
  })

  /**
   * まとめて登録する。**`POST /` とは別の入口。**
   *
   * あちらを配列でも受けるようにすると、409 で既存を返す契約・`useGlossary.create`・
   * ノートからのクイック登録が全部巻き込まれる。分けておけば波及がゼロで済む。
   *
   * **部分成功で返す。** D1 に対話的トランザクションが無いのもあるが、
   * そもそも 40 行のうち 3 行が登録済みだからといって残り 37 行を捨てるのは損。
   * 保存しなかった行は理由付きで返し、画面がそのまま出す。
   */
  .post('/bulk', async (c) => {
    const body = await c.req.json<Partial<CreateGlossaryTermsRequest>>().catch(() => null);

    const categoryId = typeof body?.categoryId === 'string' ? body.categoryId : '';
    const terms: BulkTermInput[] = Array.isArray(body?.terms)
      ? (body.terms as BulkTermInput[])
      : [];

    if (!categoryId) return c.json({ error: 'categoryId は必須です' }, 400);
    if (terms.length === 0) return c.json({ error: '用語を入力してください' }, 400);
    if (terms.length > MAX_BULK_TERMS) {
      return c.json({ error: `一度に登録できるのは ${MAX_BULK_TERMS} 件までです` }, 400);
    }

    const db = getDb(c.env);
    const userId = c.get('userId');

    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .limit(1);
    if (!category) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);

    /*
     * このカテゴリの termKey を 1 クエリで全部取る。
     *
     * **`inArray(termKey, 送られてきたキー)` にしない。** 100 件だと
     * userId と categoryId を足して 102 個になり、D1 のバインド上限 100 を超える。
     * こちらは短い 1 列だけの読み取りで、件数も GLOSSARY_LIMIT で実質頭打ち。
     *
     * **limit を付けない。** 付けると判定が黙って不完全になり、
     * 取りこぼしが一意インデックスまで流れてしまう。
     */
    const existing = await db
      .select({ termKey: glossaryTerms.termKey })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.userId, userId), eq(glossaryTerms.categoryId, categoryId)));
    const existingKeys = new Set(existing.map((row) => row.termKey));

    // 画面と同じ関数を通す（→ src/shared/glossary-bulk.ts）
    const prepared = prepareBulkTerms(terms, existingKeys);

    const rows = prepared.accepted.map((term) => ({
      id: newId('gt'),
      userId,
      categoryId,
      // 貼り付けにノートの出所は無い。notebookId を持つのはノートからの登録だけ
      notebookId: null,
      term: term.term,
      termKey: term.termKey,
      definition: term.definition,
      tags: coerceTags(term.tags),
    }));

    const { insertedIds } = await insertGlossaryTerms(db, rows);

    /*
     * 入れようとした id と入った id の差が、一意インデックスに弾かれた行。
     * 事前の重複チェックをすり抜けたぶん（別タブ・切り詰められた一覧）がここに出る。
     */
    const inserted = new Set(insertedIds);
    const skipped = [...prepared.skipped];
    rows.forEach((row, position) => {
      if (inserted.has(row.id)) return;
      const source = prepared.accepted[position];
      if (source) skipped.push({ index: source.index, term: source.term, reason: 'duplicate' });
    });

    const response: CreateGlossaryTermsResponse = {
      created: insertedIds.length,
      skipped: skipped.sort((a, b) => a.index - b.index),
    };
    return c.json(response, 201);
  })

  .put('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<Partial<UpdateGlossaryTermRequest>>().catch(() => null);
    if (!body || Array.isArray(body)) return c.json({ error: 'リクエストボディが不正です' }, 400);

    const db = getDb(c.env);
    const userId = c.get('userId');

    const [current] = await db
      .select({
        categoryId: glossaryTerms.categoryId,
        term: glossaryTerms.term,
      })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.id, id), eq(glossaryTerms.userId, userId)))
      .limit(1);
    if (!current) return c.json({ error: '指定された用語が見つかりません' }, 404);

    const changes: Partial<typeof glossaryTerms.$inferInsert> = { updatedAt: new Date() };

    if (typeof body.term === 'string') {
      const term = body.term.trim();
      if (!term) return c.json({ error: '用語を入力してください' }, 400);
      if (term.length > MAX_TERM_LENGTH) {
        return c.json({ error: `用語は ${MAX_TERM_LENGTH} 文字以内で入力してください` }, 400);
      }
      changes.term = term;
      changes.termKey = normalizeForSearch(term);
    }

    if (typeof body.definition === 'string') {
      const definition = body.definition.trim();
      if (definition.length > MAX_DEFINITION_LENGTH) {
        return c.json({ error: `意味は ${MAX_DEFINITION_LENGTH} 文字以内で入力してください` }, 400);
      }
      changes.definition = definition;
    }

    if (body.tags !== undefined) changes.tags = coerceTags(body.tags);

    if (typeof body.categoryId === 'string' && body.categoryId !== current.categoryId) {
      const [category] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, body.categoryId), eq(categories.userId, userId)))
        .limit(1);
      if (!category) return c.json({ error: '指定されたカテゴリが見つかりません' }, 404);
      changes.categoryId = body.categoryId;
    }

    // 用語名かカテゴリが動いたら、移動先で重複しないか確かめる
    const nextCategoryId = changes.categoryId ?? current.categoryId;
    const nextTermKey = changes.termKey ?? normalizeForSearch(current.term);
    const duplicateId = await findDuplicate(db, userId, nextCategoryId, nextTermKey, id);
    if (duplicateId) {
      const existing = await findTerm(db, userId, duplicateId);
      if (existing) {
        const conflict: GlossaryDuplicateResponse = {
          error: 'このカテゴリには同じ用語が既に登録されています',
          term: existing,
        };
        return c.json(conflict, 409);
      }
    }

    await db
      .update(glossaryTerms)
      .set(changes)
      .where(and(eq(glossaryTerms.id, id), eq(glossaryTerms.userId, userId)));

    const saved = await findTerm(db, userId, id);
    if (!saved) return c.json({ error: '指定された用語が見つかりません' }, 404);

    const response: GlossaryTermResponse = { term: saved };
    return c.json(response);
  })

  /**
   * 削除。`?cards=delete` を付けると、この用語から作ったカードも消す。
   *
   * 既定は `keep`。カードには利用者が積み上げた SRS の状態が乗っているので、
   * 辞書の整理で黙って消さない（notebooks の `onDelete: 'set null'` と同じ考え方）。
   * **FK の発火に頼らず明示的に打つ**（backup-data.ts と同じ規律）。
   */
  .delete('/:id', async (c) => {
    const id = c.req.param('id');
    const mode = c.req.query('cards') === 'delete' ? 'delete' : 'keep';

    const db = getDb(c.env);
    const userId = c.get('userId');

    const [current] = await db
      .select({ id: glossaryTerms.id })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.id, id), eq(glossaryTerms.userId, userId)))
      .limit(1);
    if (!current) return c.json({ error: '指定された用語が見つかりません' }, 404);

    const owned = and(eq(quizQuestions.glossaryTermId, id), eq(quizQuestions.userId, userId));

    let deletedCards = 0;
    if (mode === 'delete') {
      const removed = await db
        .delete(quizQuestions)
        .where(owned)
        .returning({ id: quizQuestions.id });
      deletedCards = removed.length;
    } else {
      await db.update(quizQuestions).set({ glossaryTermId: null }).where(owned);
    }

    await db
      .delete(glossaryTerms)
      .where(and(eq(glossaryTerms.id, id), eq(glossaryTerms.userId, userId)));

    const response: DeleteGlossaryTermResponse = { ok: true, deletedCards };
    return c.json(response);
  });
