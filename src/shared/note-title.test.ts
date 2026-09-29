import { describe, expect, it } from 'vitest';
import { findDuplicateTitle, sameTitle, siblingsIn, titleKey } from './note-title';

/**
 * 題名の重複判定は、画面（作成ダイアログ・エディタ）とサーバー（POST / PUT）の
 * **両方が同じ関数を通る**。ここがずれると「入力できたのに保存できない」が起きる。
 * また、**用語辞書の検索と同じ正規化にしない**ことを固定する（あちらはカナを畳む）。
 */

describe('titleKey', () => {
  it('前後の空白と連続する空白を畳む', () => {
    expect(titleKey('  OSI 参照  モデル ')).toBe('osi 参照 モデル');
  });

  it('全角と半角、大文字と小文字は同じ扱い', () => {
    expect(sameTitle('ＴＣＰ', 'TCP')).toBe(true);
    expect(sameTitle('Note', 'note')).toBe(true);
    expect(sameTitle('ﾈｯﾄﾜｰｸ', 'ネットワーク')).toBe(true);
  });

  /* 用語辞書の検索（normalizeForSearch）はカナを畳むが、題名では畳まない */
  it('カタカナとひらがなは別の名前として扱う', () => {
    expect(sameTitle('テスト', 'てすと')).toBe(false);
  });

  it('空白だけの題名は空のキーになる', () => {
    expect(titleKey('   ')).toBe('');
  });
});

describe('findDuplicateTitle', () => {
  const siblings = [
    { id: 'a', title: 'ネットワーク' },
    { id: 'b', title: 'OSI 参照モデル' },
  ];

  it('同じ名前があれば、その 1 件を返す', () => {
    expect(findDuplicateTitle(siblings, 'ＯＳＩ　参照モデル')?.id).toBe('b');
  });

  it('無ければ null', () => {
    expect(findDuplicateTitle(siblings, 'TCP')).toBeNull();
  });

  it('自分自身は重複にしない（名前を変えるとき）', () => {
    expect(findDuplicateTitle(siblings, 'ネットワーク', 'a')).toBeNull();
    expect(findDuplicateTitle(siblings, 'ネットワーク', 'b')?.id).toBe('a');
  });

  it('空の題名は重複を探さない（空は別の理由で断る）', () => {
    expect(findDuplicateTitle([{ id: 'c', title: '  ' }], '   ')).toBeNull();
  });
});

describe('siblingsIn', () => {
  const notes = [
    { id: 'r1', parentId: null, categoryId: 'cat_a' },
    { id: 'r2', parentId: null, categoryId: 'cat_b' },
    { id: 'c1', parentId: 'r1', categoryId: 'cat_a' },
    { id: 'c2', parentId: 'r1', categoryId: 'cat_a' },
  ];

  it('親の下では、その親の子だけ', () => {
    expect(siblingsIn(notes, 'r1', 'cat_a').map((n) => n.id)).toEqual(['c1', 'c2']);
  });

  /* カテゴリを見ないと、別のフォルダのルート同士まで同名を禁じてしまう */
  it('ルートでは、同じカテゴリのルートだけ', () => {
    expect(siblingsIn(notes, null, 'cat_a').map((n) => n.id)).toEqual(['r1']);
    expect(siblingsIn(notes, null, 'cat_b').map((n) => n.id)).toEqual(['r2']);
  });
});
