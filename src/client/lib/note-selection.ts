import { MAX_TERM_LENGTH } from '../../shared/types';

/**
 * 本文の選択範囲を「用語として登録できる形」に直す。
 *
 * **本文は書き換えない。** `markdown-edit.ts` は選択範囲を編集する操作だが、
 * こちらは読むだけ。だから戻り値もキャレット位置を持たない。
 *
 * 純粋関数にしてあるのは `markdown-edit.ts` と同じ理由で、
 * 「選択したのに登録できない」類は目視で気付きにくいから。
 */

const MARK = '==';

/** 用語として通す文字数の上限。DB の上限に合わせる */
export const MAX_SELECTION_LENGTH = MAX_TERM_LENGTH;

/**
 * 選択範囲から用語名を取り出す。登録に向かない選択なら null。
 *
 * 弾くもの:
 * - 空、または空白だけ
 * - **改行を含む**（文や段落を丸ごと選んでいる。用語ではない）
 * - 長すぎる（上限を超えるとサーバーが 400 を返すので、押す前に止める）
 *
 * 直すもの:
 * - 前後の空白
 * - `==マーカー==` の記号（マーカーを引いた語をそのまま選びがち）
 * - Markdown の強調記号とバッククォート（`**TCP**` や `` `TCP` `` を選びがち）
 */
export function readSelection(text: string, start: number, end: number): string | null {
  if (start > end) [start, end] = [end, start];

  let value = text.slice(start, end).trim();
  if (!value) return null;
  // 改行が入っていたら「語」ではない。ここで弾くとポップオーバーが空で開かない
  if (/[\r\n]/.test(value)) return null;

  value = stripWrapping(value);
  if (!value) return null;
  if (value.length > MAX_SELECTION_LENGTH) return null;

  return value;
}

/** 両端の装飾記号を、外側から順に剥がす */
function stripWrapping(value: string): string {
  let current = value;
  // 記号が重なっていることがある（`**==TCP==**` など）ので、変化が無くなるまで回す
  for (;;) {
    const next = stripOnce(current);
    if (next === current) return current;
    current = next;
  }
}

const WRAPPERS = [MARK, '**', '__', '`', '*', '_'];

function stripOnce(value: string): string {
  for (const wrapper of WRAPPERS) {
    if (value.length > wrapper.length * 2 && value.startsWith(wrapper) && value.endsWith(wrapper)) {
      return value.slice(wrapper.length, -wrapper.length).trim();
    }
  }
  return value;
}
