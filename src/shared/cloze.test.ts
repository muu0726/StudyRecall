import { describe, expect, it } from 'vitest';
import { CLOZE_BLANK, speechTextOf, splitCloze } from './cloze';

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

  /* 選択肢を読まないと、耳だけでは何も選べない問題になる */
  it('4択は選択肢に番号を付けて読む', () => {
    expect(speechTextOf('適切なものはどれか。', 'quiz', ['TCP', 'UDP', 'DNS', 'ARP'])).toBe(
      '適切なものはどれか。1、TCP。2、UDP。3、DNS。4、ARP',
    );
  });

  /* 句点が無い問題文でも切れ目は入る */
  it('末尾の句点は重ねない', () => {
    expect(speechTextOf('適切なものはどれか', 'quiz', ['TCP', 'UDP'])).toBe(
      '適切なものはどれか。1、TCP。2、UDP',
    );
  });

  it('選択肢があっても4択でなければ読まない', () => {
    expect(speechTextOf('問題文', 'qa', ['TCP', 'UDP'])).toBe('問題文');
    expect(speechTextOf(`${CLOZE_BLANK}は？`, 'cloze', ['TCP', 'UDP'])).toBe('、何でしょう、は？');
  });

  it('空欄の無い穴埋めでも落ちない', () => {
    expect(speechTextOf('空欄がない文', 'cloze')).toBe('空欄がない文');
  });
});
