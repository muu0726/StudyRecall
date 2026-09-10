/**
 * 辞書に登録した用語を、プレビューの中で目立たせる remark プラグイン。
 *
 * `remark-mark.ts` と同じ作りで、**依存を足していない**（text ノードを辿って
 * 分割するだけ）。型も mdast から取らず構造だけで受ける。
 *
 * **正規表現は 1 本にまとめる。** 用語ごとに `String.replace` を回すと、
 * 数百件 × テキストノードの数だけ走査することになる。長い語を先に置くのは、
 * 「TCP」と「TCP/IP」が両方あるときに短いほうで切ってしまわないため。
 *
 * **できないこと（承知のうえ）**: 全角・半角やカナの揺れは吸収しない。
 * 吸収するには本文を正規化する必要があり、そうすると元の文字列の位置が
 * ずれて、どこを囲むか決められなくなる。検索（glossary-search.ts）とは
 * 目的が違うので、ここは素直な一致だけにしてある。
 */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

/** 装飾しない親。**リンクの中を触るとリンク文字列が分断される** */
const SKIP_PARENTS = new Set(['link', 'linkReference', 'code', 'inlineCode', 'heading']);

/** 一度に扱う用語の数。多すぎる正規表現は組み立て自体が重くなる */
const MAX_TERMS = 300;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * 用語の一覧から照合用の正規表現を 1 本作る。使える語が無ければ null。
 * **呼び出し側で必ずメモ化すること**（毎レンダーで組み直さない）。
 */
export function buildTermPattern(terms: readonly string[]): RegExp | null {
  const seen = new Set<string>();
  const usable: string[] = [];

  for (const term of terms) {
    const value = term.trim();
    // 1 文字の語は本文のあちこちに当たってしまう
    if (value.length < 2) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    usable.push(value);
    if (usable.length >= MAX_TERMS) break;
  }

  if (usable.length === 0) return null;

  // 長い語を先に。'TCP' が 'TCP/IP' を食わないようにする
  usable.sort((a, b) => b.length - a.length);
  return new RegExp(usable.map(escapeRegExp).join('|'), 'gi');
}

function splitText(node: MdNode, pattern: RegExp): MdNode[] | null {
  const value = node.value ?? '';
  if (!value) return null;

  const parts: MdNode[] = [];
  let last = 0;
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    // 空文字に当たると lastIndex が進まず無限ループになる
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    if (match.index > last) parts.push({ type: 'text', value: value.slice(last, match.index) });
    parts.push({
      type: 'glossaryTerm',
      // react-markdown は hast を描くので、出力先のタグ名をここで指定する
      data: { hName: 'span', hProperties: { className: 'studyrecall-term' } },
      children: [{ type: 'text', value: match[0] }],
    });
    last = match.index + match[0].length;
  }

  if (parts.length === 0) return null;
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

function walk(node: MdNode, pattern: RegExp): void {
  if (!node.children) return;

  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text') {
      const parts = splitText(child, pattern);
      if (parts) {
        next.push(...parts);
        continue;
      }
      next.push(child);
      continue;
    }
    // リンク・コード・見出しの中は触らない
    if (!SKIP_PARENTS.has(child.type)) walk(child, pattern);
    next.push(child);
  }
  node.children = next;
}

/**
 * 用語の正規表現を束ねた remark プラグインを作る。
 *
 * **返すのは「プラグイン」であって「変換関数」ではない。**
 * unified は配列に入れた関数を*アタッチャ*として呼び、その戻り値を変換関数として使う。
 * ここで変換関数を直接返すと、unified がそれをアタッチャとして呼んでしまい、
 * `tree` が undefined のまま走って落ちる（実際に画面が真っ白になった）。
 */
export default function remarkGlossary(pattern: RegExp | null) {
  return function attach() {
    return (tree: MdNode): void => {
      if (pattern) walk(tree, pattern);
    };
  };
}

/** テスト用に内部の walk を公開する */
export const transform = walk;
