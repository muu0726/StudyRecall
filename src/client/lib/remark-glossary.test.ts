import { describe, expect, it } from 'vitest';
import remarkGlossary, { buildTermPattern, transform } from './remark-glossary';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

const text = (value: string): MdNode => ({ type: 'text', value });
const para = (...children: MdNode[]): MdNode => ({ type: 'paragraph', children });
const root = (...children: MdNode[]): MdNode => ({ type: 'root', children });

/** 変換後の木を「文字列＋印」の並びに畳んで比べる */
function flatten(node: MdNode): string {
  if (node.type === 'text') return node.value ?? '';
  if (node.type === 'glossaryTerm') return `[${(node.children ?? []).map(flatten).join('')}]`;
  return (node.children ?? []).map(flatten).join('');
}

const run = (tree: MdNode, terms: string[]): string => {
  const pattern = buildTermPattern(terms);
  if (pattern) transform(tree, pattern);
  return flatten(tree);
};

describe('buildTermPattern', () => {
  it('用語が無ければ null', () => {
    expect(buildTermPattern([])).toBeNull();
  });

  /* 1 文字の語は本文のあちこちに当たる */
  it('1 文字の語は使わない', () => {
    expect(buildTermPattern(['A'])).toBeNull();
    expect(buildTermPattern(['A', 'TCP'])).not.toBeNull();
  });

  it('大小の違いだけの重複を畳む', () => {
    const pattern = buildTermPattern(['TCP', 'tcp']);
    expect(pattern?.source).toBe('TCP');
  });

  /* これが無いと 'TCP' が 'TCP/IP' を食う */
  it('長い語を先に当てる', () => {
    // source は / を \/ に直して返すので、並びではなく当たり方で確かめる
    const pattern = buildTermPattern(['TCP', 'TCP/IP']) as RegExp;
    expect('TCP/IP の階層'.match(pattern)).toEqual(['TCP/IP']);
  });

  it('正規表現の記号を含む用語でも壊れない', () => {
    const pattern = buildTermPattern(['C++', 'a.b']);
    expect(() => 'C++ と a.b'.replace(pattern as RegExp, 'x')).not.toThrow();
    expect('C++ と axb'.match(pattern as RegExp)).toEqual(['C++']);
  });
});

/**
 * **これが無くて画面を真っ白にした。**
 * unified は配列の関数をアタッチャとして呼び、その戻り値を変換関数として使う。
 * 変換関数を直接返すと `tree` が undefined のまま呼ばれて落ちる。
 * transform を直に叩くテストだけだと、この配線ミスは通り抜ける。
 */
describe('プラグインの形', () => {
  it('アタッチャを返し、その戻り値が変換関数になる', () => {
    const attach = remarkGlossary(buildTermPattern(['TCP']));
    expect(typeof attach).toBe('function');
    const transformer = attach();
    expect(typeof transformer).toBe('function');

    const tree = root(para(text('TCP の話')));
    transformer(tree);
    expect(flatten(tree)).toBe('[TCP] の話');
  });

  it('用語が無くても落ちない', () => {
    const tree = root(para(text('TCP の話')));
    remarkGlossary(null)()(tree);
    expect(flatten(tree)).toBe('TCP の話');
  });
});

describe('remarkGlossary', () => {
  it('本文の用語を囲む', () => {
    expect(run(root(para(text('TCPは信頼性がある'))), ['TCP'])).toBe('[TCP]は信頼性がある');
  });

  it('同じ語が何度出ても囲む', () => {
    expect(run(root(para(text('TCPとTCP'))), ['TCP'])).toBe('[TCP]と[TCP]');
  });

  it('大文字小文字を無視して当てる', () => {
    expect(run(root(para(text('tcp の話'))), ['TCP'])).toBe('[tcp] の話');
  });

  it('長い語を優先する', () => {
    expect(run(root(para(text('TCP/IP の階層'))), ['TCP', 'TCP/IP'])).toBe('[TCP/IP] の階層');
  });

  /* リンクの中を分断すると、リンク文字列そのものが壊れる */
  it('リンクの中は触らない', () => {
    const tree = root(para({ type: 'link', children: [text('TCP の解説')] }));
    expect(run(tree, ['TCP'])).toBe('TCP の解説');
  });

  it('コードと見出しの中も触らない', () => {
    const tree = root(
      { type: 'heading', children: [text('TCP について')] },
      { type: 'inlineCode', value: 'TCP' },
      para(text('本文の TCP')),
    );
    expect(run(tree, ['TCP'])).toBe('TCP について本文の [TCP]');
  });

  it('用語が本文に無ければ何も変わらない', () => {
    expect(run(root(para(text('UDP の話'))), ['TCP'])).toBe('UDP の話');
  });

  it('用語が空なら何も変わらない', () => {
    expect(run(root(para(text('TCP の話'))), [])).toBe('TCP の話');
  });

  it('出力先のタグとクラスを指定する', () => {
    const tree = root(para(text('TCP')));
    const pattern = buildTermPattern(['TCP']);
    transform(tree, pattern as RegExp);
    const marked = tree.children?.[0]?.children?.[0];
    expect(marked?.type).toBe('glossaryTerm');
    expect(marked?.data?.hName).toBe('span');
    expect(marked?.data?.hProperties?.className).toBe('studyrecall-term');
  });

  it('入れ子の中の text も辿る', () => {
    const tree = root(para({ type: 'strong', children: [text('TCP')] }));
    expect(run(tree, ['TCP'])).toBe('[TCP]');
  });
});
