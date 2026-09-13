import { describe, expect, it } from 'vitest';
import { orderDeepestFirst, type PurgeNode } from './note-purge-order';

/**
 *   root
 *   ├─ a
 *   │  └─ a1
 *   │     └─ a1x
 *   └─ b
 */
const tree: PurgeNode[] = [
  { id: 'root', parentId: null },
  { id: 'a', parentId: 'root' },
  { id: 'a1', parentId: 'a' },
  { id: 'a1x', parentId: 'a1' },
  { id: 'b', parentId: 'root' },
];

/** どの時点で切っても、消した行を親に持つ子が残っていないか */
const everyPrefixIsSafe = (nodes: PurgeNode[], ordered: string[]) => {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  for (let cut = 1; cut <= ordered.length; cut++) {
    const deleted = new Set(ordered.slice(0, cut));
    const remaining = ordered.slice(cut);
    if (remaining.some((id) => deleted.has(parentOf.get(id) ?? ''))) return false;
  }
  return true;
};

describe('orderDeepestFirst', () => {
  it('深いノートから先に並ぶ', () => {
    const ordered = orderDeepestFirst(tree, ['root', 'a', 'a1', 'a1x', 'b']);
    expect(ordered[0]).toBe('a1x');
    expect(ordered.at(-1)).toBe('root');
  });

  /* ここが本題。どこで塊を切っても、消えた親を指す子が残らない */
  it('どこで切っても、宙に浮く子がいない', () => {
    const ordered = orderDeepestFirst(tree, ['root', 'a', 'a1', 'a1x', 'b']);
    expect(everyPrefixIsSafe(tree, ordered)).toBe(true);
  });

  /* 111 件のフォルダ（ルート + 子 110）を 90 件で切ったときに落ちた形 */
  it('ルートと大量の子でも、子が先でルートが最後', () => {
    const nodes: PurgeNode[] = [
      { id: 'root', parentId: null },
      ...Array.from({ length: 110 }, (_, i) => ({ id: `c${i}`, parentId: 'root' })),
    ];
    const ordered = orderDeepestFirst(
      nodes,
      nodes.map((n) => n.id),
    );
    expect(ordered.at(-1)).toBe('root');
    expect(ordered.slice(0, 90)).not.toContain('root');
    expect(everyPrefixIsSafe(nodes, ordered)).toBe(true);
  });

  it('同じ深さの中では元の順を保つ', () => {
    expect(orderDeepestFirst(tree, ['b', 'a'])).toEqual(['b', 'a']);
  });

  it('入力の順に頼らない（子が先に渡されても同じ規則）', () => {
    const shuffled = ['b', 'a1x', 'root', 'a1', 'a'];
    const ordered = orderDeepestFirst(tree, shuffled);
    expect(everyPrefixIsSafe(tree, ordered)).toBe(true);
    expect(ordered.at(-1)).toBe('root');
  });

  it('元の配列を変えず、中身も変えない', () => {
    const ids = ['root', 'a', 'b'];
    const ordered = orderDeepestFirst(tree, ids);
    expect(ids).toEqual(['root', 'a', 'b']);
    expect([...ordered].sort()).toEqual(['a', 'b', 'root']);
  });

  it('壊れたデータで循環していても止まる', () => {
    const loop: PurgeNode[] = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ];
    expect([...orderDeepestFirst(loop, ['x', 'y'])].sort()).toEqual(['x', 'y']);
  });

  it('空なら空', () => {
    expect(orderDeepestFirst(tree, [])).toEqual([]);
  });
});
