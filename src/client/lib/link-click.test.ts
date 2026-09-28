import { describe, expect, it } from 'vitest';
import { isPlainLeftClick, type ClickLike } from './link-click';

/**
 * ポータルのタイルは、押されたときに自分で新しいタブを開く
 * （インストールしたアプリでは `target="_blank"` が守られないことがあるため）。
 * そのとき**ブラウザ自身の操作まで横取りすると、いつもの使い方が壊れる**ので、
 * 「どのクリックに手を出してよいか」をここで固定する。
 */

const click = (overrides: Partial<ClickLike> = {}): ClickLike => ({
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe('isPlainLeftClick', () => {
  it('ただの左クリックだけ true', () => {
    expect(isPlainLeftClick(click())).toBe(true);
  });

  it('中クリック・右クリックには手を出さない', () => {
    expect(isPlainLeftClick(click({ button: 1 }))).toBe(false);
    expect(isPlainLeftClick(click({ button: 2 }))).toBe(false);
  });

  it('修飾キー付きは、ブラウザの「新しいタブ／窓で開く」なので任せる', () => {
    expect(isPlainLeftClick(click({ ctrlKey: true }))).toBe(false);
    expect(isPlainLeftClick(click({ metaKey: true }))).toBe(false);
    expect(isPlainLeftClick(click({ shiftKey: true }))).toBe(false);
    expect(isPlainLeftClick(click({ altKey: true }))).toBe(false);
  });
});
