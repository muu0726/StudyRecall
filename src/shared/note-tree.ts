import { MAX_NOTE_DEPTH } from './types';

/**
 * ノートの階層を扱うロジック。
 *
 * サーバー（移動の検証）とクライアント（ツリー描画・ドロップ可否の判定）で
 * まったく同じ規則を使うため、shared に置いて両方から import する。
 * ここが食い違うと「UI では落とせるのにサーバーが 400 を返す」という嫌なズレが出る。
 */

/** 親子関係を持てば何でも扱える最小の形 */
export interface TreeNodeLike {
  id: string;
  parentId: string | null;
}

export interface NoteTreeNode<T extends TreeNodeLike> {
  node: T;
  /** ルートを 1 とする深さ */
  depth: number;
  children: NoteTreeNode<T>[];
}

/** 親 ID をキーに子を引ける Map を作る。sortOrder 順は呼び出し側で担保する。 */
export function groupByParent<T extends TreeNodeLike>(items: T[]): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const item of items) {
    const key = item.parentId;
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/**
 * フラット配列をツリーへ組み立てる。
 * @param rootParentId この親の直下をルートとして扱う
 */
export function buildTree<T extends TreeNodeLike>(
  items: T[],
  rootParentId: string | null = null,
): NoteTreeNode<T>[] {
  const byParent = groupByParent(items);

  const build = (parentId: string | null, depth: number): NoteTreeNode<T>[] =>
    (byParent.get(parentId) ?? []).map((node) => ({
      node,
      depth,
      children: build(node.id, depth + 1),
    }));

  return build(rootParentId, 1);
}

/** 自分自身を含む子孫の ID をすべて集める */
export function collectSubtreeIds<T extends TreeNodeLike>(items: T[], rootId: string): string[] {
  const byParent = groupByParent(items);
  const result: string[] = [];
  const stack = [rootId];

  while (stack.length > 0) {
    const id = stack.pop() as string;
    result.push(id);
    for (const child of byParent.get(id) ?? []) {
      stack.push(child.id);
    }
  }
  return result;
}

/** ルート（深さ 1）から数えたノードの深さ */
export function getDepth<T extends TreeNodeLike>(items: T[], id: string): number {
  const byId = new Map(items.map((item) => [item.id, item]));
  let depth = 1;
  let current = byId.get(id)?.parentId ?? null;
  // 壊れたデータで無限ループしないよう上限を切る
  while (current !== null && depth <= MAX_NOTE_DEPTH + 1) {
    depth += 1;
    current = byId.get(current)?.parentId ?? null;
  }
  return depth;
}

/** 部分木の高さ（自分だけなら 1） */
export function getSubtreeHeight<T extends TreeNodeLike>(items: T[], rootId: string): number {
  const byParent = groupByParent(items);

  const walk = (id: string, depth: number): number => {
    const children = byParent.get(id) ?? [];
    if (children.length === 0 || depth > MAX_NOTE_DEPTH + 1) return depth;
    return Math.max(...children.map((child) => walk(child.id, depth + 1)));
  };

  return walk(rootId, 1);
}

/** ルートから対象までの祖先（対象自身を含む） */
export function getAncestorPath<T extends TreeNodeLike>(items: T[], id: string): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const path: T[] = [];
  let current = byId.get(id);
  while (current && path.length <= MAX_NOTE_DEPTH + 1) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export type MoveRejection =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'cycle' | 'too-deep' };

/**
 * 移動が許されるか判定する。
 *
 * - 自分自身や自分の子孫の下へは移せない（ツリーが輪になって復元できなくなる）
 * - 移動後の深さが上限を超えない
 */
export function canMove<T extends TreeNodeLike>(
  items: T[],
  movingId: string,
  newParentId: string | null,
): MoveRejection {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (!byId.has(movingId)) return { ok: false, reason: 'not-found' };

  if (newParentId !== null) {
    if (!byId.has(newParentId)) return { ok: false, reason: 'not-found' };

    // 新しい親から根まで辿り、途中に自分が出てきたら循環
    let cursor: string | null = newParentId;
    let guard = 0;
    while (cursor !== null && guard <= MAX_NOTE_DEPTH + 1) {
      if (cursor === movingId) return { ok: false, reason: 'cycle' };
      cursor = byId.get(cursor)?.parentId ?? null;
      guard += 1;
    }
  }

  const parentDepth = newParentId === null ? 0 : getDepth(items, newParentId);
  if (parentDepth + getSubtreeHeight(items, movingId) > MAX_NOTE_DEPTH) {
    return { ok: false, reason: 'too-deep' };
  }

  return { ok: true };
}
