/**
 * ノートを物理削除するときの順番。**深いノートから先に消す。**
 *
 * 子孫が多いフォルダは D1 の変数上限のため塊に分けて DELETE する（→ worker/lib/d1-in.ts）。
 * 親子の順で塊にすると、親だけ先に消えた瞬間に残りの子が「存在しない親」を指し、
 * `FOREIGN KEY constraint failed` で落ちる（111 件のフォルダの完全削除で実際に踏んだ）。
 * 子から先に消せば、どの塊を消した時点でも宙に浮く子がいない。
 *
 * 外部キーのカスケードや、子孫 id の並び順には頼らない。**深さを数えて並べ直す。**
 */

export interface PurgeNode {
  id: string;
  parentId: string | null;
}

/**
 * `ids` を深い順（葉から根へ）に並べ直した新しい配列を返す。
 * 同じ深さの中では元の順を保つ。`nodes` に無い id は深さ 0 として最後に回す。
 */
export function orderDeepestFirst(nodes: readonly PurgeNode[], ids: readonly string[]): string[] {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const depthCache = new Map<string, number>();

  const depthOf = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    let depth = 0;
    let current = parentOf.get(id) ?? null;
    const seen = new Set<string>([id]);
    // 壊れたデータで循環していても止まるように、訪れた id を覚えておく
    while (current !== null && parentOf.has(current) && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      current = parentOf.get(current) ?? null;
    }
    depthCache.set(id, depth);
    return depth;
  };

  return ids
    .map((id, index) => ({ id, index, depth: depthOf(id) }))
    .sort((a, b) => b.depth - a.depth || a.index - b.index)
    .map((entry) => entry.id);
}
