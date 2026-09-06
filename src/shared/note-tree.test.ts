import { describe, expect, it } from 'vitest';
import {
  buildTree,
  canMove,
  collectSubtreeIds,
  getAncestorPath,
  getDepth,
  getSubtreeHeight,
  type TreeNodeLike,
} from './note-tree';
import { MAX_NOTE_DEPTH } from './types';

/**
 * この判定はサーバーの移動 API とクライアントの DnD が同じ関数を使っている。
 * 壊れると「UI では落とせるのにサーバーが 400 を返す」ではなく、
 * 「両方が同時に間違う」という気付きにくい壊れ方をするので、ここだけは固めておく。
 */

const node = (id: string, parentId: string | null = null): TreeNodeLike => ({ id, parentId });

/** a > b > c > d > e の 5 階層と、独立したルート x */
const chain = (length: number): TreeNodeLike[] =>
  Array.from({ length }, (_, i) => node(`n${i + 1}`, i === 0 ? null : `n${i}`));

describe('buildTree', () => {
  it('親子関係からツリーを組み、depth はルートを 1 として数える', () => {
    const tree = buildTree([node('a'), node('b', 'a'), node('c', 'b')]);

    expect(tree).toHaveLength(1);
    expect(tree[0].node.id).toBe('a');
    expect(tree[0].depth).toBe(1);
    expect(tree[0].children[0].node.id).toBe('b');
    expect(tree[0].children[0].depth).toBe(2);
    expect(tree[0].children[0].children[0].depth).toBe(3);
  });

  it('入力の順序をそのまま保つ（並び順は呼び出し側が sortOrder で担保する）', () => {
    const tree = buildTree([node('b'), node('a'), node('c')]);
    expect(tree.map((t) => t.node.id)).toEqual(['b', 'a', 'c']);
  });

  it('親が存在しないノードはルートとして現れない（孤児は落ちる）', () => {
    const tree = buildTree([node('a'), node('orphan', 'missing')]);
    expect(tree.map((t) => t.node.id)).toEqual(['a']);
  });

  it('空配列を渡しても落ちない', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('collectSubtreeIds', () => {
  it('自分自身を含めて子孫をすべて集める', () => {
    const items = [node('a'), node('b', 'a'), node('c', 'b'), node('d', 'a'), node('x')];
    expect(collectSubtreeIds(items, 'a').sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('葉なら自分だけを返す（削除ダイアログの「子ノート 0 件」がこれに依存する）', () => {
    const items = [node('a'), node('b', 'a')];
    expect(collectSubtreeIds(items, 'b')).toEqual(['b']);
  });

  it('存在しない ID でも自分だけを返して落ちない', () => {
    expect(collectSubtreeIds([node('a')], 'missing')).toEqual(['missing']);
  });
});

describe('getDepth / getSubtreeHeight', () => {
  it('ルートは深さ 1、孫は 3', () => {
    const items = [node('a'), node('b', 'a'), node('c', 'b')];
    expect(getDepth(items, 'a')).toBe(1);
    expect(getDepth(items, 'c')).toBe(3);
  });

  it('部分木の高さは自分だけなら 1', () => {
    const items = [node('a'), node('b', 'a'), node('c', 'b')];
    expect(getSubtreeHeight(items, 'c')).toBe(1);
    expect(getSubtreeHeight(items, 'a')).toBe(3);
  });

  it('高さは最も深い枝を採る', () => {
    const items = [node('a'), node('b', 'a'), node('c', 'b'), node('d', 'a')];
    expect(getSubtreeHeight(items, 'a')).toBe(3);
  });

  it('データが循環していても無限ループしない', () => {
    // 壊れたデータ: a の親が b、b の親が a
    const broken = [node('a', 'b'), node('b', 'a')];
    expect(getDepth(broken, 'a')).toBeLessThanOrEqual(MAX_NOTE_DEPTH + 2);
    expect(getSubtreeHeight(broken, 'a')).toBeLessThanOrEqual(MAX_NOTE_DEPTH + 2);
  });
});

describe('getAncestorPath', () => {
  it('ルートから対象自身までを順に返す（パンくずの並び）', () => {
    const items = [node('a'), node('b', 'a'), node('c', 'b')];
    expect(getAncestorPath(items, 'c').map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('存在しない ID なら空配列', () => {
    expect(getAncestorPath([node('a')], 'missing')).toEqual([]);
  });
});

describe('canMove', () => {
  const items = [node('a'), node('b', 'a'), node('c', 'b'), node('x')];

  it('別のルートの下へは移せる', () => {
    expect(canMove(items, 'b', 'x')).toEqual({ ok: true });
  });

  it('ルート（parentId = null）へは常に移せる', () => {
    expect(canMove(items, 'c', null)).toEqual({ ok: true });
  });

  it('自分自身の下へは移せない', () => {
    expect(canMove(items, 'a', 'a')).toEqual({ ok: false, reason: 'cycle' });
  });

  it('自分の子孫の下へは移せない（ツリーが輪になる）', () => {
    expect(canMove(items, 'a', 'c')).toEqual({ ok: false, reason: 'cycle' });
  });

  it('存在しないノード・存在しない移動先は not-found', () => {
    expect(canMove(items, 'missing', 'a')).toEqual({ ok: false, reason: 'not-found' });
    expect(canMove(items, 'a', 'missing')).toEqual({ ok: false, reason: 'not-found' });
  });

  it(`深さの上限 ${MAX_NOTE_DEPTH} をちょうど使い切る移動は許す`, () => {
    // n1 > n2 > n3 > n4 の 4 階層 + 独立した leaf
    const deep = [...chain(4), node('leaf')];
    // leaf を n4 の下へ → 深さ 5。上限ちょうど。
    expect(canMove(deep, 'leaf', 'n4')).toEqual({ ok: true });
  });

  it(`上限 ${MAX_NOTE_DEPTH} を 1 でも超える移動は too-deep`, () => {
    const deep = [...chain(MAX_NOTE_DEPTH), node('leaf')];
    // leaf を n5 の下へ → 深さ 6。超過。
    expect(canMove(deep, 'leaf', `n${MAX_NOTE_DEPTH}`)).toEqual({
      ok: false,
      reason: 'too-deep',
    });
  });

  it('移動する部分木の高さも数える（葉ではなく枝ごと動かす場合）', () => {
    // n1 > n2 > n3 の 3 階層。別に高さ 3 の部分木 s1 > s2 > s3
    const items3 = [...chain(3), node('s1'), node('s2', 's1'), node('s3', 's2')];
    // s1（高さ3）を n3（深さ3）の下へ → 3 + 3 = 6 で超過
    expect(canMove(items3, 's1', 'n3')).toEqual({ ok: false, reason: 'too-deep' });
    // s1 を n2（深さ2）の下へ → 2 + 3 = 5 でちょうど収まる
    expect(canMove(items3, 's1', 'n2')).toEqual({ ok: true });
  });
});
