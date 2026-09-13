/**
 * 用語辞書の一覧をカテゴリごとにまとめる。
 *
 * 並べ方だけを決める。**何が見えるか（検索・タグ・習得ステータス）は変えない**ので、
 * 渡すのは絞り込み済みの用語。
 */

export interface GlossaryGroup<T> {
  categoryId: string;
  name: string;
  color: string;
  terms: T[];
}

/**
 * - 順番は `categories` の並び（カテゴリ管理の順 = サイドバーのノートツリーと同じ）
 * - カテゴリ内は渡された順を保つ（一覧は更新順で届く）
 * - 用語が 0 件のカテゴリは返さない（見出しだけ並ぶと結果を探す手間が増える）
 * - `categories` に無いカテゴリの用語（取得のすれ違いなど）は、用語側の名前と色で末尾にまとめる。
 *   **黙って落とさない。** 一覧から用語が消えるのがいちばん信用を失う
 */
export function groupTermsByCategory<
  T extends { categoryId: string; categoryName: string; categoryColor: string },
>(
  terms: readonly T[],
  categories: readonly { id: string; name: string; color: string }[],
): GlossaryGroup<T>[] {
  const byCategory = new Map<string, T[]>();
  for (const term of terms) {
    const list = byCategory.get(term.categoryId);
    if (list) list.push(term);
    else byCategory.set(term.categoryId, [term]);
  }

  const groups: GlossaryGroup<T>[] = [];
  for (const category of categories) {
    const list = byCategory.get(category.id);
    if (!list) continue;
    groups.push({
      categoryId: category.id,
      name: category.name,
      color: category.color,
      terms: list,
    });
    byCategory.delete(category.id);
  }

  // 残りは最初に現れた順（Map は挿入順を保つ）
  for (const [categoryId, list] of byCategory) {
    const first = list[0];
    if (!first) continue;
    groups.push({
      categoryId,
      name: first.categoryName,
      color: first.categoryColor,
      terms: list,
    });
  }

  return groups;
}
