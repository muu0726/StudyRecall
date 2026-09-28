import { lt } from 'drizzle-orm';
import { sessions, verifications } from '../../db/schema';
import type { Db } from './db';

/**
 * 期限切れの行の掃除。cron（1 日 1 回）から呼ぶ。
 *
 * Better Auth はサインアウトしたセッションを消すが、**期限切れを掃く仕組みは持たない。**
 * 放っておくと `sessions` と `verifications` は増える一方になる。
 *
 * **`expires_at` は秒で入っている**（`{ mode: 'timestamp' }`。ms の列と混在しているので要注意）。
 * 生 SQL で `unixepoch()` と比べると単位を間違えるので、Drizzle に Date のまま渡して変換させる。
 */
export async function purgeExpired(
  db: Db,
  now: Date,
): Promise<{ sessions: number; verifications: number }> {
  // 消えた件数は returning で数える（D1 は affected rows を返さない）
  const [deadSessions, deadVerifications] = await Promise.all([
    db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id }),
    db.delete(verifications).where(lt(verifications.expiresAt, now)).returning({
      id: verifications.id,
    }),
  ]);

  return { sessions: deadSessions.length, verifications: deadVerifications.length };
}
