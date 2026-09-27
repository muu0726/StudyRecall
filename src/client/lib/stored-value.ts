/**
 * localStorage に覚えておく短い文字列（最後に選んだタブなど）。
 *
 * **判断はここに置かない。** 読めない・書けない（プライベートウィンドウ、容量超過、
 * 壊れた値）は起こる前提で、そのときは既定値で動き続ける。
 * `App.tsx` の `readStored` は「決まった選択肢のどれか」を読むための別物で、
 * こちらは自由入力（カテゴリ名など）を扱う。
 */

export function readStoredText(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredText(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // 覚えられないだけ。画面の動きは変えない
  }
}
