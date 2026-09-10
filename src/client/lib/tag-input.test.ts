import { describe, expect, it } from 'vitest';
import { MAX_TAGS_PER_TERM } from '../../shared/types';
import { commitTag, commitTags, removeTag, splitTagInput } from './tag-input';

describe('commitTag', () => {
  it('前後の空白を落として足す', () => {
    expect(commitTag([], '  ネットワーク  ')).toEqual({ tags: ['ネットワーク'], added: true });
  });

  it('空文字は足さない（理由も出さない）', () => {
    expect(commitTag(['a'], '   ')).toEqual({ tags: ['a'], added: false });
  });

  /* 画面では別に見えるのに保存で 1 つに畳まれる、というずれを防ぐ */
  it('表記が違うだけの重複は足さない', () => {
    const result = commitTag(['TCP'], 'ｔｃｐ');
    expect(result.added).toBe(false);
    expect(result.tags).toEqual(['TCP']);
    expect(result.reason).toBeTruthy();
  });

  it('上限を超えない', () => {
    const full = Array.from({ length: MAX_TAGS_PER_TERM }, (_, i) => `tag${i}`);
    const result = commitTag(full, 'あふれる');
    expect(result.added).toBe(false);
    expect(result.tags).toEqual(full);
    expect(result.reason).toContain(String(MAX_TAGS_PER_TERM));
  });

  it('入力の順番を保つ', () => {
    expect(commitTag(['a', 'b'], 'c').tags).toEqual(['a', 'b', 'c']);
  });

  it('もとの配列を書き換えない', () => {
    const original = ['a'];
    commitTag(original, 'b');
    expect(original).toEqual(['a']);
  });
});

describe('splitTagInput', () => {
  it('読点でもカンマでも割る', () => {
    expect(splitTagInput('a, b、c，d')).toEqual(['a', 'b', 'c', 'd']);
  });

  /* 「基本情報 技術者」のような 1 語のタグを壊さない */
  it('空白では割らない', () => {
    expect(splitTagInput('基本情報 技術者')).toEqual(['基本情報 技術者']);
  });

  it('空の区間は落とす', () => {
    expect(splitTagInput(',,a,,')).toEqual(['a']);
  });
});

describe('commitTags', () => {
  it('まとめて足せる', () => {
    expect(commitTags([], 'ネットワーク, DNS')).toEqual(['ネットワーク', 'DNS']);
  });

  it('上限で静かに止まる', () => {
    expect(commitTags([], 'a,b,c,d,e')).toHaveLength(MAX_TAGS_PER_TERM);
  });

  it('重複は飛ばして続ける', () => {
    expect(commitTags(['a'], 'a,b')).toEqual(['a', 'b']);
  });
});

describe('removeTag', () => {
  it('位置を指定して外す', () => {
    expect(removeTag(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('範囲外なら何も変わらない', () => {
    expect(removeTag(['a'], 5)).toEqual(['a']);
  });
});
