import { cn } from '../lib/cn';

/**
 * 選択できる行の共通表現。サイドバーのナビ・ノートツリー・ジャンルタグで使う。
 *
 * 選択 = 弱い面 + 左の 2px バー + 濃い文字。ホバー = 無彩色の面だけ。
 * **バーの有無で 2 状態を分ける**のが肝で、面の濃さだけで区別しようとすると
 * 見分けがつかない（実際、作り直す前は選択中の項目を読み違えた）。
 *
 * バーは ::before の絶対配置にしてある。border-l だと行の幅が 2px 動き、
 * ツリーのインデント（インライン style で padding を計算している）とずれる。
 */
export function selectableRow(selected: boolean, className?: string): string {
  return cn(
    'relative rounded-control transition',
    // バーの器は常に置いて色だけ変える。出し入れするとレイアウトが揺れる。
    'before:absolute before:top-1/2 before:left-0 before:h-[calc(100%-8px)] before:w-[2px]',
    'before:-translate-y-1/2 before:rounded-full before:bg-transparent before:content-[""]',
    selected
      ? 'bg-row-selected font-medium text-fg before:bg-accent hover:bg-row-selected'
      : 'text-fg-muted hover:bg-row-hover hover:text-fg',
    className,
  );
}
