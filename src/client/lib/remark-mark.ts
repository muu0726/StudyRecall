/**
 * `==テキスト==` を `<mark>` にする remark プラグイン。
 *
 * **依存を足していない。** `mdast-util-find-and-replace` は node_modules に
 * 居るが package.json に無い推移依存で、直接 import すると npm の解決次第で壊れる
 * （このリポジトリは過去に npm ci の peer 解決で本番ビルドを壊している）。
 * text ノードを辿って分割するだけなので、import 無しで書ける。
 *
 * 型も mdast から取らず構造だけで受ける。型は消えるとはいえ、
 * 宣言していない依存を参照しないほうが素直。
 */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string };
}

/**
 * 前後に空白を挟んだ `== 語 ==` は対象にしない。
 * Obsidian など多くの実装がそう振る舞うので、ここだけ独自にすると見え方がずれる。
 */
const PATTERN = /==(?!\s)([^=]+?)(?<!\s)==/g;

function splitText(node: MdNode): MdNode[] | null {
  const value = node.value ?? '';
  if (!value.includes('==')) return null;

  const parts: MdNode[] = [];
  let last = 0;
  PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = PATTERN.exec(value)) !== null) {
    if (match.index > last) parts.push({ type: 'text', value: value.slice(last, match.index) });
    parts.push({
      type: 'mark',
      // react-markdown は hast を描くので、出力先のタグ名をここで指定する
      data: { hName: 'mark' },
      children: [{ type: 'text', value: match[1] }],
    });
    last = match.index + match[0].length;
  }

  if (parts.length === 0) return null;
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

function walk(node: MdNode): void {
  if (!node.children) return;

  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text') {
      const parts = splitText(child);
      if (parts) {
        next.push(...parts);
        continue;
      }
      next.push(child);
      continue;
    }
    // code / inlineCode は value を持つだけで text の子を持たないので、
    // ここを素通りする＝コードの中の == は変換されない。
    walk(child);
    next.push(child);
  }
  node.children = next;
}

export default function remarkMark() {
  return (tree: MdNode): void => {
    walk(tree);
  };
}

/** テスト用に内部の walk を公開する（プラグインの戻り値と同じもの） */
export const transform = walk;
