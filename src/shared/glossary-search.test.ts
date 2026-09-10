import { describe, expect, it } from 'vitest';
import {
  buildHaystack,
  collectTags,
  filterGlossaryTerms,
  matchesQuery,
  normalizeForSearch,
  type GlossaryFilter,
} from './glossary-search';
import type { MasteryStatus } from './glossary-mastery';

const term = (
  name: string,
  definition = '',
  tags: string[] = [],
  masteryStatus: MasteryStatus = 'unlearned',
) => ({ term: name, definition, tags, masteryStatus });

const filter = (overrides: Partial<GlossaryFilter> = {}): GlossaryFilter => ({
  query: '',
  tags: [],
  mastery: 'all',
  ...overrides,
});

describe('normalizeForSearch', () => {
  it('全角英数を半角の小文字に寄せる', () => {
    expect(normalizeForSearch('ＴＣＰ')).toBe('tcp');
    expect(normalizeForSearch('TCP')).toBe('tcp');
  });

  it('半角カナも全角カナもひらがなに寄せる', () => {
    expect(normalizeForSearch('ﾈｯﾄﾜｰｸ')).toBe('ねっとわーく');
    expect(normalizeForSearch('ネットワーク')).toBe('ねっとわーく');
    expect(normalizeForSearch('ねっとわーく')).toBe('ねっとわーく');
  });

  it('濁点付きの半角カナが崩れない', () => {
    expect(normalizeForSearch('ｸﾞﾛｰﾊﾞﾙ')).toBe('ぐろーばる');
  });

  /* 2 回かけても結果が動かないこと。保存する termKey がこれに依存している */
  it('冪等である', () => {
    const once = normalizeForSearch('ＤＮＳ ｻｰﾊﾞ');
    expect(normalizeForSearch(once)).toBe(once);
  });
});

describe('matchesQuery', () => {
  const haystack = buildHaystack({
    term: '3ウェイハンドシェイク',
    definition: 'TCPで接続を確立する手順。SYN → SYN-ACK → ACK の3段階。',
    tags: ['ネットワーク', 'TCP'],
  });

  it('空のクエリは全件通す', () => {
    expect(matchesQuery(haystack, '')).toBe(true);
    expect(matchesQuery(haystack, '   ')).toBe(true);
  });

  it('用語名・意味・タグのどれでも当たる', () => {
    expect(matchesQuery(haystack, 'ハンドシェイク')).toBe(true);
    expect(matchesQuery(haystack, '確立')).toBe(true);
    expect(matchesQuery(haystack, 'ネットワーク')).toBe(true);
  });

  it('表記が違っても当たる', () => {
    expect(matchesQuery(haystack, 'ｔｃｐ')).toBe(true);
    expect(matchesQuery(haystack, 'はんどしぇいく')).toBe(true);
  });

  it('空白区切りは AND', () => {
    expect(matchesQuery(haystack, 'ねっと 手順')).toBe(true);
    expect(matchesQuery(haystack, 'ねっと 存在しない語')).toBe(false);
  });

  it('全角スペースでも区切れる', () => {
    expect(matchesQuery(haystack, 'ねっと　手順')).toBe(true);
  });

  /**
   * ここを LIKE に戻した人への回帰ガード。
   * SQL に持っていくとこの 3 文字はワイルドカード／エスケープになり、
   * 「％で検索すると全部出る」類の静かな誤りが生まれる。
   */
  it('% _ \\ はただの文字として扱う', () => {
    const withSymbols = buildHaystack({ term: '100%', definition: 'a_b', tags: ['c\\d'] });
    expect(matchesQuery(withSymbols, '%')).toBe(true);
    expect(matchesQuery(withSymbols, 'a_b')).toBe(true);
    expect(matchesQuery(withSymbols, 'c\\d')).toBe(true);
    // ワイルドカードとして効いていたら、これが true になってしまう
    expect(matchesQuery(withSymbols, 'a%b')).toBe(false);
    expect(matchesQuery(withSymbols, 'zzz_')).toBe(false);
  });
});

describe('filterGlossaryTerms', () => {
  const terms = [
    term('TCP', '転送制御プロトコル', ['ネットワーク', 'プロトコル'], 'mastered'),
    term('DNS', '名前解決の仕組み', ['ネットワーク'], 'reviewing'),
    term('現在完了', '英文法の時制', ['英語'], 'unlearned'),
  ];

  it('絞り込みが無ければ全件', () => {
    expect(filterGlossaryTerms(terms, filter())).toHaveLength(3);
  });

  it('タグは AND（重ねるほど狭くなる）', () => {
    expect(filterGlossaryTerms(terms, filter({ tags: ['ネットワーク'] }))).toHaveLength(2);
    const both = filterGlossaryTerms(terms, filter({ tags: ['ネットワーク', 'プロトコル'] }));
    expect(both.map((t) => t.term)).toEqual(['TCP']);
  });

  it('タグの表記ゆれを吸収する', () => {
    expect(filterGlossaryTerms(terms, filter({ tags: ['ねっとわーく'] }))).toHaveLength(2);
  });

  /* 「苦手」は未習得と復習中をまとめて出す（覚えきっていないもの全部） */
  it('習得ステータスで絞れる', () => {
    expect(filterGlossaryTerms(terms, filter({ mastery: 'mastered' })).map((t) => t.term)).toEqual([
      'TCP',
    ]);
    expect(
      filterGlossaryTerms(terms, filter({ mastery: 'unmastered' })).map((t) => t.term),
    ).toEqual(['DNS', '現在完了']);
  });

  it('検索とタグとステータスを重ねられる', () => {
    const result = filterGlossaryTerms(
      terms,
      filter({ query: '解決', tags: ['ネットワーク'], mastery: 'unmastered' }),
    );
    expect(result.map((t) => t.term)).toEqual(['DNS']);
  });
});

describe('collectTags', () => {
  it('出現数の多い順、同数なら名前順', () => {
    expect(
      collectTags([
        term('a', '', ['ネットワーク', 'DNS']),
        term('b', '', ['ネットワーク']),
        term('c', '', ['英語']),
      ]),
    ).toEqual([
      { tag: 'ネットワーク', count: 2 },
      { tag: 'DNS', count: 1 },
      { tag: '英語', count: 1 },
    ]);
  });

  it('表記ゆれは 1 つに束ねる', () => {
    expect(collectTags([term('a', '', ['TCP']), term('b', '', ['ＴＣＰ'])])).toEqual([
      { tag: 'TCP', count: 2 },
    ]);
  });
});
