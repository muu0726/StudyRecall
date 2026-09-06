import { describe, expect, it } from 'vitest';
import { isThemeSetting, nextThemeSetting, resolveTheme, type ThemeSetting } from './theme';

/**
 * 間違えると「OS はダークなのに白いまま」「切り替えても戻らない」といった、
 * 見れば分かるが原因は追いにくい壊れ方をする。
 */

describe('resolveTheme', () => {
  it('明示的な指定は OS の設定より優先する', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('system は OS の設定に従う', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('isThemeSetting', () => {
  it('想定内の値だけを通す', () => {
    expect(isThemeSetting('light')).toBe(true);
    expect(isThemeSetting('dark')).toBe(true);
    expect(isThemeSetting('system')).toBe(true);
  });

  it('壊れた保存値は弾く（読み込んで画面を壊さない）', () => {
    expect(isThemeSetting('DARK')).toBe(false);
    expect(isThemeSetting('')).toBe(false);
    expect(isThemeSetting(null)).toBe(false);
    expect(isThemeSetting(1)).toBe(false);
  });
});

describe('nextThemeSetting', () => {
  it('light → dark → system → light と一巡する', () => {
    expect(nextThemeSetting('light')).toBe('dark');
    expect(nextThemeSetting('dark')).toBe('system');
    expect(nextThemeSetting('system')).toBe('light');
  });

  it('3 回回すと元に戻る', () => {
    let current: ThemeSetting = 'light';
    for (let i = 0; i < 3; i += 1) current = nextThemeSetting(current);
    expect(current).toBe('light');
  });
});
