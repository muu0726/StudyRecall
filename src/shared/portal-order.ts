/**
 * ポータルの並べ替えの判断。**純粋関数だけ。**
 *
 * 並べ替えには 2 つの入口がある（PC のドラッグと、どの端末でも使えるメニューの「前へ / 後ろへ」）。
 * 扱いが揃っていないと「ドラッグでは動くのにメニューでは 2 つ飛ぶ」のような食い違いが出るので、
 * どちらもここを通す。
 */

export type DropPosition = 'before' | 'after';
export type ShiftDirection = 'prev' | 'next';

/**
 * `draggedId` を `targetId` の前／後ろへ動かした並びを返す。
 * 動かす意味が無いとき（同じ id、知らない id）は**元の配列をそのまま返す**。
 */
export function moveTo(
  ids: readonly string[],
  draggedId: string,
  targetId: string,
  position: DropPosition,
): string[] {
  if (draggedId === targetId) return [...ids];
  if (!ids.includes(draggedId) || !ids.includes(targetId)) return [...ids];

  const rest = ids.filter((id) => id !== draggedId);
  const at = rest.indexOf(targetId);
  rest.splice(position === 'before' ? at : at + 1, 0, draggedId);
  return rest;
}

/**
 * メニューの「前へ / 後ろへ」。**見えている中での隣**と入れ替える。
 *
 * 検索やカテゴリで絞っているとき、全体での隣は画面に出ていない。
 * そこと入れ替えると「押したのに何も動かない」ように見えるので、見えている隣を基準にする。
 * 端にいるときは元の並びをそのまま返す。
 */
export function shiftVisible(
  allIds: readonly string[],
  visibleIds: readonly string[],
  id: string,
  direction: ShiftDirection,
): string[] {
  const at = visibleIds.indexOf(id);
  if (at === -1) return [...allIds];

  const neighbor = visibleIds[direction === 'prev' ? at - 1 : at + 1];
  if (neighbor === undefined) return [...allIds];

  return moveTo(allIds, id, neighbor, direction === 'prev' ? 'before' : 'after');
}

/** 並びが実際に変わったか（変わっていないなら送らない） */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
