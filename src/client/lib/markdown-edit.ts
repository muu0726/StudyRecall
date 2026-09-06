/**
 * 本文の選択範囲を書き換える操作。
 *
 * textarea を直接いじらず純粋関数にしてあるのは、キャレットの位置計算が
 * 一番間違えやすいから。「囲んだのにカーソルが末尾に飛ぶ」「もう一度押しても
 * 外れない」は目視だと気付きにくく、再現手順も面倒になる。
 */

const MARK = '==';

export interface EditResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * 選択範囲を `==…==` で囲む。既に囲まれていれば外す。
 *
 * 前後の空白は囲みの外に出す。`== 語 ==` は多くの Markdown 実装
 * （Obsidian を含む）でマーカーとして描画されないため。
 */
export function toggleMarker(text: string, start: number, end: number): EditResult {
  if (start > end) [start, end] = [end, start];
  const selected = text.slice(start, end);

  // 1) ==語== ごと選択している → 記号を外す
  if (selected.length >= MARK.length * 2 && selected.startsWith(MARK) && selected.endsWith(MARK)) {
    const inner = selected.slice(MARK.length, -MARK.length);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }

  // 2) 中身だけ選択していて、外側が == で挟まれている → 記号を外す
  if (
    start >= MARK.length &&
    text.slice(start - MARK.length, start) === MARK &&
    text.slice(end, end + MARK.length) === MARK
  ) {
    const from = start - MARK.length;
    return {
      text: text.slice(0, from) + selected + text.slice(end + MARK.length),
      selectionStart: from,
      selectionEnd: from + selected.length,
    };
  }

  // 3) 選択が無い（または空白だけ）→ ==== を置いて間にカーソルを入れる
  if (selected.trim() === '') {
    return {
      text: text.slice(0, start) + MARK + MARK + text.slice(end),
      selectionStart: start + MARK.length,
      selectionEnd: start + MARK.length,
    };
  }

  // 4) 前後の空白は外に出して囲む
  const leading = selected.length - selected.trimStart().length;
  const trailing = selected.length - selected.trimEnd().length;
  const core = selected.slice(leading, selected.length - trailing);
  const from = start + leading;

  return {
    text: text.slice(0, from) + MARK + core + MARK + text.slice(from + core.length),
    selectionStart: from + MARK.length,
    selectionEnd: from + MARK.length + core.length,
  };
}
