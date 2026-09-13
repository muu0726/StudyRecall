import { describe, expect, it } from 'vitest';
import { groupTermsByCategory } from './glossary-groups';

const categories = [
  { id: 'net', name: 'ネットワーク', color: '#3b82f6' },
  { id: 'fe', name: '基本情報', color: '#8b5cf6' },
  { id: 'en', name: '英語', color: '#10b981' },
];

const term = (
  id: string,
  categoryId: string,
  categoryName = categoryId,
  categoryColor = '#000',
) => ({
  id,
  categoryId,
  categoryName,
  categoryColor,
});

const shape = (groups: ReturnType<typeof groupTermsByCategory<ReturnType<typeof term>>>) =>
  groups.map((g) => [g.categoryId, g.terms.map((t) => t.id)]);

describe('groupTermsByCategory', () => {
  it('カテゴリ管理の並びでまとめる（用語の並びがバラバラでも）', () => {
    const terms = [term('a', 'fe'), term('b', 'net'), term('c', 'fe'), term('d', 'net')];
    expect(shape(groupTermsByCategory(terms, categories))).toEqual([
      ['net', ['b', 'd']],
      ['fe', ['a', 'c']],
    ]);
  });

  /* 一覧は更新順で届く。まとめても順番を崩さない */
  it('カテゴリ内は渡された順を保つ', () => {
    const terms = [term('z', 'net'), term('a', 'net'), term('m', 'net')];
    expect(groupTermsByCategory(terms, categories)[0]?.terms.map((t) => t.id)).toEqual([
      'z',
      'a',
      'm',
    ]);
  });

  it('用語が 0 件のカテゴリは出さない', () => {
    const groups = groupTermsByCategory([term('a', 'net')], categories);
    expect(groups.map((g) => g.categoryId)).toEqual(['net']);
  });

  it('見出しの名前と色はカテゴリ側から取る', () => {
    const [group] = groupTermsByCategory([term('a', 'net', '古い名前', '#fff')], categories);
    expect(group).toMatchObject({ name: 'ネットワーク', color: '#3b82f6' });
  });

  /* 取得がすれ違っても、一覧から用語が消えないこと */
  it('カテゴリ一覧に無いカテゴリの用語も落とさず末尾にまとめる', () => {
    const terms = [
      term('x', 'ghost', '消えたカテゴリ', '#123456'),
      term('a', 'net'),
      term('y', 'ghost', '消えたカテゴリ', '#123456'),
    ];
    const groups = groupTermsByCategory(terms, categories);
    expect(shape(groups)).toEqual([
      ['net', ['a']],
      ['ghost', ['x', 'y']],
    ]);
    expect(groups[1]).toMatchObject({ name: '消えたカテゴリ', color: '#123456' });
    expect(groups.reduce((sum, g) => sum + g.terms.length, 0)).toBe(terms.length);
  });

  it('空の入力は空', () => {
    expect(groupTermsByCategory([], categories)).toEqual([]);
    expect(groupTermsByCategory([term('a', 'net')], [])).toHaveLength(1);
  });
});
