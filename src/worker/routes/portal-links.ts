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

/** 末尾に置くための sortOrder */
async function nextSortOrder(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${portalLinks.sortOrder})` })
    .from(portalLinks)
    .where(eq(portalLinks.userId, userId));
  return (Number(row?.max ?? -1) || 0) + 1;
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

    const [count] = await db
      .select({ total: sql<number>`count(*)` })
      .from(portalLinks)
      .where(eq(portalLinks.userId, userId));
    if (Number(count?.total ?? 0) >= MAX_PORTAL_LINKS) {
      return c.json({ error: `リンクは ${MAX_PORTAL_LINKS} 件までです` }, 400);
    }

    const [row] = await db
      .insert(portalLinks)
      .values({
        id: newId('lnk'),
        userId,
        ...input,
        sortOrder: await nextSortOrder(db, userId),
      })
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

    if (accepted.length > 0) {
      const base = await nextSortOrder(db, userId);
      const rows = accepted.map((input, index) => ({
        id: newId('lnk'),
        userId,
        ...input,
        sortOrder: base + index,
      }));
      // D1 はバインド変数が 1 クエリ 100 個まで。列数から行数を決めて分けて流す
      const size = maxRowsPerInsert(Object.keys(getTableColumns(portalLinks)).length);
      for (const chunk of chunkRows(rows, size)) {
        await db.insert(portalLinks).values(chunk);
      }
    }

    const links = await listRows(db, userId);
    const response: ImportPortalLinksResponse = {
      added: accepted.length,
      skipped,
      dropped,
      links: links.map(toPortalLinkDto),
    };
    return c.json(response);
  });
