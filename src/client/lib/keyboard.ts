/**
 * 画面全体で拾うキー操作の共通判定。
 *
 * ショートカットは便利だが、**拾ってはいけない場面で拾うと壊れる**。
 * ノートを書いている最中に `1` でカードの判定が飛んだり、
 * モーダルを開いたまま裏の画面が進んだりする。その線引きをここに集約する。
 */

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** 文字入力中かどうか */
export function isTypingIn(element: Element | null): boolean {
  if (!element) return false;
  if (EDITABLE_TAGS.has(element.tagName)) return true;
  // instanceof HTMLElement は使わない。DOM の無い環境（テスト）で落ちるうえ、
  // iframe 越しの要素でも false になる。プロパティの有無だけを見れば足りる。
  return (element as Partial<HTMLElement>).isContentEditable === true;
}

export interface ShortcutContext {
  /** いまフォーカスされている要素（通常は document.activeElement） */
  activeElement: Element | null;
  /** モーダルが開いているか */
  hasOpenDialog: boolean;
  /** 修飾キーが押されているか（ブラウザのショートカットを奪わない） */
  hasModifier: boolean;
}

/**
 * このキー入力をアプリのショートカットとして扱ってよいか。
 *
 * 迷ったら「無視する」側に倒す。ショートカットが効かないのは不便なだけだが、
 * 効いてほしくない場面で効くと、意図しない判定や遷移が起きる。
 */
export function shouldHandleShortcut(context: ShortcutContext): boolean {
  if (context.hasModifier) return false;
  if (context.hasOpenDialog) return false;
  if (isTypingIn(context.activeElement)) return false;
  return true;
}

/** DOM から実際の状況を読み取る。テストしたいのは上の純粋関数のほう。 */
export function readShortcutContext(event: KeyboardEvent): ShortcutContext {
  return {
    activeElement: document.activeElement,
    // ハンズフリー再生・用語追加・確認ダイアログなどが開いているあいだは裏を触らせない
    hasOpenDialog: document.querySelector('[role="dialog"]') !== null,
    hasModifier: event.ctrlKey || event.metaKey || event.altKey,
  };
}
