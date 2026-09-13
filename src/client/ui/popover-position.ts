/**
 * ポップオーバーのパネルを、画面に固定（`position: fixed`）して置く位置。
 *
 * **パネルはトリガの親の中に置かない。** 親に `overflow-x: auto` があると、CSS の仕様で
 * `overflow-y` も切り取りになり、絶対配置のパネルが行の高さに閉じ込められて見えなくなる
 * （フラッシュカードと用語辞書の絞り込みが「押しても開かない」ように見えていた原因）。
 * そこで `document.body` へ出し、トリガの画面上の位置から座標を決める。
 */

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

export interface PopoverPosition {
  /** `bottom-*` のとき。トリガの下端からの距離 */
  top?: number;
  /** `top-*` のとき。画面の下端からの距離（パネルの高さを知らなくても上に出せる） */
  bottom?: number;
  left: number;
}

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** トリガとパネルの隙間 */
export const POPOVER_GAP = 4;
/** 画面の端から最低これだけ離す */
export const POPOVER_MARGIN = 8;

export function computePopoverPosition(
  trigger: Rect,
  placement: Placement,
  viewport: { width: number; height: number },
  panelWidth: number,
): PopoverPosition {
  const alignEnd = placement.endsWith('-end');
  const rawLeft = alignEnd ? trigger.right - panelWidth : trigger.left;

  // 左右は画面内に収める。画面より広いパネルは左端に寄せる
  const maxLeft = viewport.width - POPOVER_MARGIN - panelWidth;
  const left =
    maxLeft < POPOVER_MARGIN
      ? POPOVER_MARGIN
      : Math.min(Math.max(rawLeft, POPOVER_MARGIN), maxLeft);

  return placement.startsWith('top-')
    ? { bottom: viewport.height - trigger.top + POPOVER_GAP, left }
    : { top: trigger.bottom + POPOVER_GAP, left };
}
