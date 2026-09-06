import { describe, expect, it } from 'vitest';
import { shouldHandleShortcut, type ShortcutContext } from './keyboard';

/**
 * ショートカットが効かないのは不便なだけだが、
 * 効いてほしくない場面で効くと、意図しない判定や遷移が起きる。
 * 「無視する」側に倒せているかをここで固める。
 */

/** DOM 無しで判定を試すための最小の偽要素 */
const el = (tagName: string, contentEditable = false): Element =>
  ({
    tagName,
    isContentEditable: contentEditable,
    // isTypingIn の instanceof HTMLElement を通すための細工は不要
    // （tagName だけで判定できるケースを主に見る）
  }) as unknown as Element;

const context = (overrides: Partial<ShortcutContext> = {}): ShortcutContext => ({
  activeElement: null,
  hasOpenDialog: false,
  hasModifier: false,
  ...overrides,
});

describe('shouldHandleShortcut', () => {
  it('何もフォーカスしていなければ拾う', () => {
    expect(shouldHandleShortcut(context())).toBe(true);
  });

  it('ボタンにフォーカスがあっても拾う（Tab 移動の直後など）', () => {
    expect(shouldHandleShortcut(context({ activeElement: el('BUTTON') }))).toBe(true);
  });

  it('テキスト入力中は拾わない', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(shouldHandleShortcut(context({ activeElement: el(tag) }))).toBe(false);
    }
  });

  it('モーダルが開いているあいだは拾わない', () => {
    // ハンズフリー再生を開いたまま裏のカードが進むのを防ぐ
    expect(shouldHandleShortcut(context({ hasOpenDialog: true }))).toBe(false);
  });

  it('修飾キー付きは拾わない（ブラウザのショートカットを奪わない）', () => {
    expect(shouldHandleShortcut(context({ hasModifier: true }))).toBe(false);
  });

  it('条件が重なっても拾わない', () => {
    expect(
      shouldHandleShortcut(
        context({ activeElement: el('TEXTAREA'), hasOpenDialog: true, hasModifier: true }),
      ),
    ).toBe(false);
  });
});
