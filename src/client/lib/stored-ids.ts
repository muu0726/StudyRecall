/**
 * id の集合を localStorage に置く。開閉状態などの、**消えても困らない端末ごとの覚え書き**用。
 *
 * ノートツリーのカテゴリ開閉と、用語辞書のカテゴリ開閉が同じ形で使う。
 * 読めない・書けない（プライベートモード、容量、壊れた JSON）ときは黙って空に倒す。
 */

export function readIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

export function writeIds(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // プライベートモード等での失敗は無視
  }
}
