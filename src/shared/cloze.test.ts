import { describe, expect, it } from 'vitest';
import { CLOZE_BLANK, ensureCloze, speechTextOf, splitCloze } from './cloze';

describe('splitCloze', () => {
  it('空欄の前後で割る', () => {
    expect(splitCloze(`TCPは${CLOZE_BLANK}で接続を確立する。`)).toEqual({
      before: 'TCPは',
      after: 'で接続を確立する。',
    });
  });

  it('空欄が無ければ null', () => {
    expect(splitCloze('TCPで接続を確立する手順。')).toBeNull();
  });

  it('先頭や末尾の空欄でも片側が空文字になるだけ', () => {
    expect(splitCloze(`${CLOZE_BLANK}は3段階の手順。`)).toEqual({
      before: '',
      after: 'は3段階の手順。',
    });
  });

  /* 答えは 1 つしか無いので、2 か所目は文の一部として出す */
  it('空欄が2か所あっても最初の1か所だけを空欄にする', () => {
    const result = splitCloze(`${CLOZE_BLANK}と${CLOZE_BLANK}`);
    expect(result).toEqual({ before: '', after: `と${CLOZE_BLANK}` });
  });

  it('アンダースコア3個は空欄ではない', () => {
    expect(splitCloze('a___b')).toBeNull();
  });
});

describe('ensureCloze', () => {
  it('既に空欄があればそのまま通す', () => {
    const question = `TCPは${CLOZE_BLANK}で接続する。`;
    expect(ensureCloze(question, '3ウェイハンドシェイク')).toBe(question);
  });

  /* 「____ を置く」という指示は構造化出力でも破られる。直せるなら直す */
  it('答えが問題文に出ていれば空欄に置き換える', () => {
    expect(ensureCloze('TCPは3ウェイハンドシェイクで接続する。', '3ウェイハンドシェイク')).toBe(
      `TCPは${CLOZE_BLANK}で接続する。`,
    );
  });

  it('置き換えるのは最初の1回だけ', () => {
    expect(ensureCloze('DNSとDNS', 'DNS')).toBe(`${CLOZE_BLANK}とDNS`);
  });

  /* 直せないものを出すと「答えが問題文に書いてある問題」になる。捨てる */
  it('答えが問題文に無ければ null', () => {
    expect(ensureCloze('通信の手順を説明した文。', 'DNS')).toBeNull();
  });

  it('空の入力は null', () => {
    expect(ensureCloze('   ', 'DNS')).toBeNull();
    expect(ensureCloze('DNSの説明', '  ')).toBeNull();
  });

  it('前後の空白は落とす', () => {
    expect(ensureCloze(`  TCPは${CLOZE_BLANK}。  `, 'x')).toBe(`TCPは${CLOZE_BLANK}。`);
  });
});

describe('speechTextOf', () => {
  /* これが無いと読み上げが「アンダーバー」を4回読む */
  it('穴埋めの空欄を読める言葉に替える', () => {
    expect(speechTextOf(`TCPは${CLOZE_BLANK}で接続する。`, 'cloze')).toBe(
      'TCPは、何でしょう、で接続する。',
    );
  });

  it('穴埋め以外は何も変えない', () => {
    const text = `記号 ${CLOZE_BLANK} を含む問題文`;
    expect(speechTextOf(text, 'qa')).toBe(text);
    expect(speechTextOf(text, 'quiz')).toBe(text);
  });

  it('空欄の無い穴埋めでも落ちない', () => {
    expect(speechTextOf('空欄がない文', 'cloze')).toBe('空欄がない文');
  });
});
