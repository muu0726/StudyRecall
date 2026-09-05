import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb, type AppEnv } from '../lib/db';
import type { TagCount, TagsResponse } from '../../shared/types';

/**
 * 使用中のジャンルタグと、そのタグが付いた問題数を返す。
 * tags は JSON 配列の文字列なので json_each で展開して集計する。
 */
export const tagsRoute = new Hono<AppEnv>().get('/', async (c) => {
  const db = getDb(c.env);

  const rows = await db.all<{ tag: string; count: number }>(sql`
    select je.value as tag, count(*) as count
    from quiz_questions, json_each(quiz_questions.tags) as je
    where quiz_questions.user_id = ${c.get('userId')}
    group by je.value
    order by count desc, tag asc
  `);

  const tags: TagCount[] = rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
  const response: TagsResponse = { tags };
  return c.json(response);
});
