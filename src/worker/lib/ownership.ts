import { and, eq } from 'drizzle-orm';
import { notebooks } from '../../db/schema';
import type { Db } from './db';

/**
 * そのユーザーのノートか。
 *
 * **他人のノートの id を、自分の行（タスク・用語）に結び付けさせない。**
 * 題名などが漏れるわけではないが、自分のバックアップに他人のノートの id が混ざると、
 * 復元のときに外部キー違反で落ちる。所有者を見ずに受け取っていた（全機能の調査で見つけた）。
 *
 * **ゴミ箱の中のノートも自分のものとして数える。** 出所の記録として持っているだけで、
 * ゴミ箱に入れた瞬間に結び付けが弾かれるのは困る。
 */
export async function ownsNotebook(db: Db, userId: string, notebookId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notebooks.id })
    .from(notebooks)
    .where(and(eq(notebooks.id, notebookId), eq(notebooks.userId, userId)))
    .limit(1);
  return Boolean(row);
}
