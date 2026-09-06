import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * 自前のトークンを tailwind-merge に教える。
 *
 * これが無いと `text-title`（文字サイズ）と `text-fg-muted`（文字色）が
 * 同じグループとみなされ、**後に書いたほうが前を黙って消す**。
 * 見た目のバグとしては「見出しだけ本文サイズに戻っている」という形で出て、
 * クラス名は両方書いてあるので原因が追いにくい。cn.test.ts で釘を刺してある。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // 文字サイズ。text-sm 等と同じ群に入れて、載せ替え途中でも後勝ちにする
      'font-size': [{ text: ['title', 'section', 'body', 'caption'] }],
      // 文字色
      'text-color': [
        {
          text: [
            'fg',
            'fg-muted',
            'fg-subtle',
            'accent',
            'accent-text',
            'accent-fg',
            'success',
            'warning',
            'danger',
          ],
        },
      ],
      rounded: [{ rounded: ['control', 'card'] }],
    },
  },
});

/** Tailwind クラスの結合。後勝ちの競合を tailwind-merge が解決する。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
