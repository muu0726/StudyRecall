import { describe, expect, it } from 'vitest';
import remarkMark from './remark-mark';

/**
 * `==テキスト==` → <mark> の変換。
 *
 * unified を通さず mdast の木を直接渡している。プラグインがやるのは
 * 木の書き換えだけなので、これで十分に固定できる（依存も増えない）。
 */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string };
}

const text = (value: string): MdNode => ({ type: 'text', value });
const para = (...children: MdNode[]): MdNode => ({ type: 'paragraph', children });
const root = (...children: MdNode[]): MdNode => ({ type: 'root', children });

function run(tree: MdNode): MdNode {
  remarkMark()(tree as never);
  return tree;
}

/** 木を「マーカーは【】で囲む」形の文字列にして読みやすく比べる */
function render(node: MdNode): string {
  if (node.type === 'text') return node.value ?? '';
  if (node.type === 'inlineCode' || node.type === 'code') return `\`${node.value ?? ''}\``;
  const inner = (node.children ?? []).map(render).join('');
  return node.type === 'mark' ? `【${inner}】` : inner;
}

describe('remarkMark', () => {
  it('== で囲まれた部分を mark にする', () => {
    const tree = run(root(para(text('TCPは==3ウェイ==で接続する'))));
    expect(render(tree)).toBe('TCPは【3ウェイ】で接続する');
  });

  it('mark ノードに hName を持たせる（react-markdown が mark 要素にするため）', () => {
    const tree = run(root(para(text('a==b==c'))));
    const mark = tree.children?.[0]?.children?.find((n) => n.type === 'mark');
    expect(mark?.data?.hName).toBe('mark');
    expect(mark?.children?.[0]?.value).toBe('b');
  });

  it('1 行に複数あってもすべて変換する', () => {
    const tree = run(root(para(text('==あ==と==い=='))));
    expect(render(tree)).toBe('【あ】と【い】');
  });

  it('前後に空白があるものは対象外（Obsidian と同じ振る舞い）', () => {
    const tree = run(root(para(text('== あ =='))));
    expect(render(tree)).toBe('== あ ==');
  });

  it('== が閉じていなければ触らない', () => {
    const tree = run(root(para(text('a==b'))));
    expect(render(tree)).toBe('a==b');
  });

  /**
   * ここが一番効く。code / inlineCode は value を持つだけで text の子を持たないので、
   * 素朴な walk で自動的に避けられる。この性質が壊れたら気付けるようにしておく。
   */
  it('インラインコードの中は変換しない', () => {
    const tree = run(root(para(text('前'), { type: 'inlineCode', value: '==code==' }, text('後'))));
    expect(render(tree)).toBe('前`==code==`後');
  });

  it('コードブロックの中は変換しない', () => {
    const tree = run(root({ type: 'code', value: 'const a = "==x==";' }));
    expect(render(tree)).toBe('`const a = "==x==";`');
  });

  it('入れ子（強調の中）でも変換する', () => {
    const tree = run(root(para({ type: 'strong', children: [text('==太字マーカー==')] })));
    expect(render(tree)).toBe('【太字マーカー】');
  });

  it('== を含まない木は変えない', () => {
    const before = root(para(text('ただの本文')));
    expect(render(run(before))).toBe('ただの本文');
  });
});
