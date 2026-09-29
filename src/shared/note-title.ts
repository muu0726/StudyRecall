/**
 * ノートの題名の比較。**純粋関数だけ。**
 *
 * 同じフォルダに同じ名前のノートを作らせないための判定を、画面とサーバーで共有する。
 * 名前を付けずに閉じた `無題のノート` が積み上がるのをやめるために入れた。
 *
 * **`normalizeForSearch`（用語辞書）は使わない。**
 * あれは検索のためにカタカナをひらがなへ寄せるので、`テスト` と `てすと` が同じ名前になる。
 * 題名は人が見分けて付けるものなので、**カタカナとひらがなは別物**として扱う。
 * ここで畳むのは「見た目が同じなのに別物になってしまう」もの（全角半角・大文字小文字・空白）だけ。
 */

/** 比較用のキー。NFKC → 前後の空白を落とす → 連続する空白を 1 つに → 小文字化 */
export function titleKey(title: string): string {
  return title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 同じ名前とみなせるか */
export function sameTitle(a: string, b: string): boolean {
  return titleKey(a) === titleKey(b);
}

/**
 * 同じ名前の兄弟を探す。無ければ null。
 * `exceptId` は「自分自身とは重複しない」ための除外（名前を変えるときに使う）。
 */
export function findDuplicateTitle<T extends { id: string; title: string }>(
  siblings: readonly T[],
  title: string,
  exceptId?: string,
): T | null {
  const key = titleKey(title);
  if (!key) return null;
  return siblings.find((item) => item.id !== exceptId && titleKey(item.title) === key) ?? null;
}

/**
 * 同じ場所に並ぶノート（兄弟）を選ぶ。
 *
 * **ルート（`parentId` が null）の兄弟は「同じカテゴリのルート」。**
 * カテゴリを見ないと、別のフォルダのルート同士まで同名を禁じてしまう。
 * 作成ダイアログ・エディタ・サーバーが同じ規則で選ぶ。
 */
export function siblingsIn<T extends { parentId: string | null; categoryId: string }>(
  all: readonly T[],
  parentId: string | null,
  categoryId: string,
): T[] {
  return all.filter((item) =>
    parentId === null
      ? item.parentId === null && item.categoryId === categoryId
      : item.parentId === parentId,
  );
}
