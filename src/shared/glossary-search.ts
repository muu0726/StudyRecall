import type { MasteryStatus } from './glossary-mastery';

/**
 * 用語辞書の検索と重複判定。**サーバーではなくここで畳む。**
 *
 * SQLite（D1）は ICU を持たないので、`LIKE` も `COLLATE NOCASE` も ASCII しか畳めない。
 * つまり D1 に任せると `ＴＣＰ` で `TCP` が引けず、`ﾈｯﾄﾜｰｸ` と `ネットワーク` と
 * `ねっとわーく` が別物になる。日本語の辞書としては使いものにならない。
 * FTS5 なら畳めるが、仮想テーブルは Drizzle のスキーマに書けず、
 * このリポジトリで禁じている手書きマイグレーションが要る。
 *
 * 代わりに JS で正規化する。数百件のクライアント側 `.filter()` は 1ms もかからないし、
 * **`LIKE` を使わないので `%` `_` `\` のエスケープ漏れという定番のバグが存在しない**
 * （そのことをテストで固定してある）。
 */

/** カタカナ→ひらがなのコードポイント差。'ァ'(0x30A1) - 'ぁ'(0x3041) */
const KATAKANA_OFFSET = 0x60;
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;

/**
 * 検索と重複判定の正規化。NFKC → 小文字化 → カタカナをひらがなへ寄せる。
 *
 * NFKC が全角英数と半角カナを畳むので、順番は **NFKC が先**。
 * 先にカタカナを寄せると `ﾈｯﾄﾜｰｸ` が半角のまま残って一致しない。
 */
export function normalizeForSearch(value: string): string {
  const folded = value.normalize('NFKC').toLowerCase();

  let result = '';
  for (const char of folded) {
    const code = char.codePointAt(0) ?? 0;
    result +=
      code >= KATAKANA_START && code <= KATAKANA_END
        ? String.fromCodePoint(code - KATAKANA_OFFSET)
        : char;
  }
  return result;
}

export interface SearchableTerm {
  term: string;
  definition: string;
  tags: readonly string[];
}

/** 用語名・意味・タグを 1 本の正規化済み文字列にする。検索はこれ 1 本を見る。 */
export function buildHaystack(source: SearchableTerm): string {
  return normalizeForSearch([source.term, source.definition, ...source.tags].join('\n'));
}

/**
 * 空白（半角・全角）で区切った語の **AND**。
 * 「ねっと 手順」で「3ウェイハンドシェイク」が引ける。
 *
 * 空のクエリは全件一致（絞り込みが始まっていないだけ、という意味）。
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const words = normalizeForSearch(query)
    .split(/[\s　]+/)
    .filter((word) => word.length > 0);

  return words.every((word) => haystack.includes(word));
}

export interface GlossaryFilter {
  query: string;
  /**
   * 選択中のタグ。**AND**（重ねるほど狭くなる）。
   * 隣に並ぶカテゴリ・習得ステータスの絞り込みがどちらも狭める向きなので、
   * ここだけ広がると操作の意味が読めなくなる。
   */
  tags: readonly string[];
  mastery: 'all' | 'unmastered' | 'mastered';
}

export const EMPTY_GLOSSARY_FILTER: GlossaryFilter = { query: '', tags: [], mastery: 'all' };

type FilterableTerm = SearchableTerm & { masteryStatus: MasteryStatus };

function matchesMastery(status: MasteryStatus, mastery: GlossaryFilter['mastery']): boolean {
  if (mastery === 'all') return true;
  // 「苦手」= まだ覚えきっていないもの全部。未習得と復習中をまとめて出す。
  return mastery === 'mastered' ? status === 'mastered' : status !== 'mastered';
}

export function filterGlossaryTerms<T extends FilterableTerm>(
  terms: readonly T[],
  filter: GlossaryFilter,
): T[] {
  const selected = filter.tags.map(normalizeForSearch);

  return terms.filter((term) => {
    if (!matchesMastery(term.masteryStatus, filter.mastery)) return false;

    if (selected.length > 0) {
      const tags = term.tags.map(normalizeForSearch);
      if (!selected.every((tag) => tags.includes(tag))) return false;
    }

    return matchesQuery(buildHaystack(term), filter.query);
  });
}

/** 一覧に出ているタグを出現数の多い順に集める。少ないほうは名前順で安定させる。 */
export function collectTags(terms: readonly SearchableTerm[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();

  for (const term of terms) {
    for (const raw of term.tags) {
      const key = normalizeForSearch(raw);
      const found = counts.get(key);
      if (found) found.count += 1;
      else counts.set(key, { tag: raw, count: 1 });
    }
  }

  return [...counts.values()].sort((a, b) =>
    b.count === a.count
      ? normalizeForSearch(a.tag) < normalizeForSearch(b.tag)
        ? -1
        : 1
      : b.count - a.count,
  );
}
