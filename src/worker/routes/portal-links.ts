import { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import { portalLinks } from '../../db/schema';
import { getDb, type AppEnv, type Db } from '../lib/db';
import { toPortalLinkDto } from '../lib/dto';
import { newId } from '../lib/ids';
import { chunkRows, maxRowsPerInsert } from '../lib/quiz-insert';
import { getTableColumns } from 'drizzle-orm';
import { normalizeLinkInput, urlKey, type PortalLinkInput } from '../../shared/portal-links';
import { MAX_PORTAL_LINKS } from '../../shared/types';
import type {
  CreatePortalLinkRequest,
  ImportPortalLinksRequest,
  ImportPortalLinksResponse,
  PortalLinkResponse,
  PortalLinksResponse,
  UpdatePortalLinkRequest,
} from '../../shared/types';

/**
 * ポータル（リンク集約）。利用者ごとのブックマークを D1 に置き、全端末で同じ並びを見せる。
 *
 * **URL の検証は `shared/portal-links.ts` の `normalizeLinkInput` だけが持つ。**
 * ここで独自に受け取ると、画面を通らない POST から `javascript:` を保存できてしまう。
 */

/** 自分の行だけを並び順で引く */
function listRows(db: Db, userId: string) {
  return db
    .select()
    .from(portalLinks)
    .where(eq(portalLinks.userId, userId))
    .orderBy(asc(portalLinks.sortOrder), asc(portalLinks.createdAt));
}

/**
 * 件数と、末尾に置くための sortOrder を**1 往復で**まとめて引く。
 * 上限の判定と並び順の決定で別々に投げると、追加のたびに D1 へ 2 回行くことになる。
 */
async function countAndNextOrder(db: Db, userId: string): Promise<{ total: number; next: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      max: sql<number | null>`max(${portalLinks.sortOrder})`,
    })
    .from(portalLinks)
    .where(eq(portalLinks.userId, userId));
  return { total: Number(row?.total ?? 0), next: nextOrderFrom(row?.max ?? null) };
}

/** 末尾の次の位置。行が無ければ 0 から始める */
function nextOrderFrom(max: number | null): number {
  return max === null ? 0 : Number(max) + 1;
}

export const portalLinksRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const rows = await listRows(getDb(c.env), c.get('userId'));
    const response: PortalLinksResponse = { links: rows.map(toPortalLinkDto) };
    return c.json(response);
  })

  .post('/', async (c) => {
    const body = await c.req.json<Partial<CreatePortalLinkRequest>>().catch(() => null);
    const input = normalizeLinkInput(body ?? {});
    if (!input) {
      return c.json({ error: 'URL は http:// または https:// で指定してください' }, 400);
    }

    const db = getDb(c.env);
    const userId = c.get('userId');

    const { total, next } = await countAndNextOrder(db, userId);
    if (total >= MAX_PORTAL_LINKS) {
      return c.json({ error: `リンクは ${MAX_PORTAL_LINKS} 件までです` }, 400);
    }

    const [row] = await db
      .insert(portalLinks)
      .values({ id: newId('lnk'), userId, ...input, sortOrder: next })
      .returning();

    const response: PortalLinkResponse = { link: toPortalLinkDto(row) };
    return c.json(response, 201);
  })

  .put('/:id', async (c) => {
    const body = await c.req.json<Partial<UpdatePortalLinkRequest>>().catch(() => null);
    if (!body) return c.json({ error: 'リクエストボディが不正です' }, 400);

    const db = getDb(c.env);
    const userId = c.get('userId');
    const id = c.req.param('id');

    // **他人の id を触らせない。** 先に自分の行として引き、無ければ 404
    const [existing] = await db
      .select()
      .from(portalLinks)
      .where(and(eq(portalLinks.id, id), eq(portalLinks.userId, userId)))
      .limit(1);
    if (!existing) return c.json({ error: '指定されたリンクが見つかりません' }, 404);

    // 部分更新。省略された項目は今の値を使ってから、まとめて正規化に通す
    const input = normalizeLinkInput({
      title: body.title ?? existing.title,
      url: body.url ?? existing.url,
      category: body.category ?? existing.category,
      iconKind: body.iconKind ?? existing.iconKind,
      iconValue: body.iconValue ?? existing.iconValue,
    });
    if (!input) {
      return c.json({ error: 'URL は http:// または https:// で指定してください' }, 400);
    }

    const [row] = await db
      .update(portalLinks)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(portalLinks.id, id), eq(portalLinks.userId, userId)))
      .returning();

    const response: PortalLinkResponse = { link: toPortalLinkDto(row) };
    return c.json(response);
  })

  .delete('/:id', async (c) => {
    const db = getDb(c.env);
    const userId = c.get('userId');

    const deleted = await db
      .delete(portalLinks)
      .where(and(eq(portalLinks.id, c.req.param('id')), eq(portalLinks.userId, userId)))
      .returning({ id: portalLinks.id });

    if (deleted.length === 0) return c.json({ error: '指定されたリンクが見つかりません' }, 404);
    return c.json({ ok: true });
  })

  /**
   * まとめて取り込み。
   *
   * **同じ URL は飛ばし、上限を超えた分は入れずに件数で返す**（全部を拒否しない）。
   * 取り込みは「手元のファイルを寄せる」操作で、1 件の重複で全体が失敗すると使えない。
   */
  .post('/import', async (c) => {
    const body = await c.req.json<Partial<ImportPortalLinksRequest>>().catch(() => null);
    const rawList = Array.isArray(body?.links) ? body.links : null;
    if (!rawList) return c.json({ error: 'links は配列で指定してください' }, 400);

    const db = getDb(c.env);
    const userId = c.get('userId');

    const existing = await listRows(db, userId);
    const seen = new Set(existing.map((row) => urlKey(row.url)));

    const accepted: PortalLinkInput[] = [];
    let skipped = 0;
    let dropped = 0;
    for (const raw of rawList) {
      const input = normalizeLinkInput(raw ?? {});
      if (!input) {
        skipped++;
        continue;
      }
      const key = urlKey(input.url);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      if (existing.length + accepted.length >= MAX_PORTAL_LINKS) {
        dropped++;
        continue;
      }
      seen.add(key);
      accepted.push(input);
    }

    /*
     * 並び順は**引いてきた行から決める**（`max(sort_order)` をもう一度引かない）。
     * 入れた行は `returning()` で受け取り、一覧の引き直しもしない。
     * 取り込み 1 回あたりの D1 との往復が「読み 1 + 書き n + 読み 1」から「読み 1 + 書き n」に減る。
     */
    const inserted: (typeof existing)[number][] = [];
    if (accepted.length > 0) {
      const base = nextOrderFrom(
        existing.length === 0 ? null : Math.max(...existing.map((row) => row.sortOrder)),
      );
      const rows = accepted.map((input, index) => ({
        id: newId('lnk'),
        userId,
        ...input,
        sortOrder: base + index,
      }));
      // D1 はバインド変数が 1 クエリ 100 個まで。列数から行数を決めて分けて流す
      const size = maxRowsPerInsert(Object.keys(getTableColumns(portalLinks)).length);
      for (const chunk of chunkRows(rows, size)) {
        inserted.push(...(await db.insert(portalLinks).values(chunk).returning()));
      }
    }

    const response: ImportPortalLinksResponse = {
      added: inserted.length,
      skipped,
      dropped,
      // 既存は並び順で引いてあり、追加分はその後ろに続く
      links: [...existing, ...inserted].map(toPortalLinkDto),
    };
    return c.json(response);
  });
