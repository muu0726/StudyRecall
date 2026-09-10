import { describe, expect, it } from 'vitest';
import { MAX_SELECTION_LENGTH, readSelection } from './note-selection';

/** 文字列全体を選んだことにする小道具 */
const all = (text: string) => readSelection(text, 0, text.length);

describe('readSelection', () => {
  it('選んだ語をそのまま返す', () => {
    expect(all('TCP')).toBe('TCP');
  });

  it('位置を指定して切り出す', () => {
    expect(readSelection('通信はTCPで行う', 3, 6)).toBe('TCP');
  });

  it('前後の空白を落とす', () => {
    expect(all('  3ウェイハンドシェイク  ')).toBe('3ウェイハンドシェイク');
  });

  it('start と end が逆でも読める', () => {
    expect(readSelection('通信はTCPで行う', 6, 3)).toBe('TCP');
  });

  it('選択が無ければ null', () => {
    expect(readSelection('本文', 2, 2)).toBeNull();
    expect(all('   ')).toBeNull();
  });

  /* 文や段落を丸ごと選んでいる。用語ではない */
  it('改行を含んでいたら null', () => {
    expect(all('TCP\nUDP')).toBeNull();
    expect(all('TCP\r\nUDP')).toBeNull();
  });

  /* 押す前に止める。通してもサーバーが 400 を返すだけ */
  it('長すぎたら null', () => {
    expect(all('あ'.repeat(MAX_SELECTION_LENGTH))).toHaveLength(MAX_SELECTION_LENGTH);
    expect(all('あ'.repeat(MAX_SELECTION_LENGTH + 1))).toBeNull();
  });

  describe('装飾記号を剥がす', () => {
    it('マーカー', () => {
      expect(all('==TCP==')).toBe('TCP');
    });

    it('太字と斜体とコード', () => {
      expect(all('**TCP**')).toBe('TCP');
      expect(all('__TCP__')).toBe('TCP');
      expect(all('*TCP*')).toBe('TCP');
      expect(all('`TCP`')).toBe('TCP');
    });

    /* マーカーを引いた語を太字にしていることがある */
    it('重なっていても剥がす', () => {
      expect(all('**==TCP==**')).toBe('TCP');
      expect(all('`**TCP**`')).toBe('TCP');
    });

    it('剥がしたあとの空白も落とす', () => {
      expect(all('** TCP **')).toBe('TCP');
    });

    /* 語そのものが記号を含む場合まで壊さない */
    it('片側だけの記号は剥がさない', () => {
      expect(all('**TCP')).toBe('**TCP');
      expect(all('C*')).toBe('C*');
    });

    it('記号だけなら剥がさずそのまま返す', () => {
      expect(all('**')).toBe('**');
      expect(all('====')).toBe('====');
    });
  });
});
