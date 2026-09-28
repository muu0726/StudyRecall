/**
 * 外部リンクのクリックの扱い。**判断だけを置く**（`window.open` は呼ばない）。
 *
 * インストールしたアプリ（`display: standalone` の PWA）では、
 * `<a target="_blank">` が守られずに**アプリの窓そのものが外のサイトへ移る**ことがある。
 * スタンドアロンにはアドレスバーも戻るボタンも無いので、そうなると戻る手段がほぼ無い。
 * そこで押されたときに自分で新しいタブを開くのだが、**何でも横取りしてはいけない。**
 */

export interface ClickLike {
  /** 0 = 左ボタン */
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * 「ただの左クリック」か。
 *
 * false のときは**ブラウザに任せる**。修飾キー付き（Ctrl / ⌘ / Shift / Alt）と中クリックは
 * ブラウザ自身の「新しいタブ・新しい窓・ダウンロード」の操作で、横取りすると逆に壊れる。
 */
export function isPlainLeftClick(event: ClickLike): boolean {
  if (event.button !== 0) return false;
  return !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}
