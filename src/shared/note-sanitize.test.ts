import { describe, expect, it } from 'vitest';
import {
  MAX_PROMPT_CHARS,
  TRUNCATION_SUFFIX,
  buildPromptSource,
  sanitizeForPrompt,
  truncateForPrompt,
  willTruncate,
} from './note-sanitize';

/**
 * ここが壊れると、送信内容が黙って変わる。
 * 画面上は何も起きず、Gemini の出力が劣化するだけなので気付きにくい。
 */

describe('sanitizeForPrompt', () => {
  it('コードブロックを丸ごと落とす', () => {
    const md = '説明の前\n\n```ts\nconst a = 1;\nconsole.log(a);\n```\n\n説明の後';
    const out = sanitizeForPrompt(md);
    expect(out).toContain('説明の前');
    expect(out).toContain('説明の後');
    expect(out).not.toContain('console.log');
  });

  it('言語指定の無いコードブロックも落とす', () => {
    expect(sanitizeForPrompt('前\n```\nplain\n```\n後')).not.toContain('plain');
  });

  it('コードブロックが複数あってもすべて落とす', () => {
    const md = '```\nA\n```\n本文\n```\nB\n```';
    const out = sanitizeForPrompt(md);
    expect(out).toBe('本文');
  });

  it('インラインコードは残す（用語そのものであることが多い）', () => {
    expect(sanitizeForPrompt('`TCP` は信頼性のある通信')).toContain('`TCP`');
  });

  it('画像リンクを落とす', () => {
    const out = sanitizeForPrompt(
      '図を参照\n![OSI参照モデルの図](https://example.com/a.png)\n以上',
    );
    expect(out).not.toContain('example.com');
    expect(out).toContain('図を参照');
    expect(out).toContain('以上');
  });

  it('通常のリンクは残す（本文の一部なので）', () => {
    expect(sanitizeForPrompt('[RFC 793](https://example.com/rfc)')).toContain('RFC 793');
  });

  it('Base64 の埋め込みを落とす', () => {
    const md = `前\n![](data:image/png;base64,${'A'.repeat(5000)})\n後`;
    const out = sanitizeForPrompt(md);
    expect(out).not.toContain('base64');
    expect(out.length).toBeLessThan(20);
  });

  it('HTML の img タグも落とす', () => {
    expect(sanitizeForPrompt('前<img src="a.png" alt="x">後')).toBe('前後');
  });

  it('除去でできた連続する空行を畳む', () => {
    const out = sanitizeForPrompt('A\n\n```\ncode\n```\n\n\n\nB');
    expect(out).not.toMatch(/\n{3,}/);
  });

  it('落とすものが無ければそのまま返す', () => {
    expect(sanitizeForPrompt('ただの本文')).toBe('ただの本文');
  });
});

describe('truncateForPrompt', () => {
  it('上限以下なら何もしない', () => {
    expect(truncateForPrompt('短い', 100)).toEqual({ text: '短い', truncated: false });
  });

  it('ちょうど上限なら切らない', () => {
    const text = 'あ'.repeat(100);
    expect(truncateForPrompt(text, 100).truncated).toBe(false);
  });

  it('超えたら先頭から切り、印を付ける', () => {
    const result = truncateForPrompt('あ'.repeat(120), 100);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('あ'.repeat(100) + TRUNCATION_SUFFIX);
  });

  it('既定の上限は 2500 文字', () => {
    expect(truncateForPrompt('あ'.repeat(2500)).truncated).toBe(false);
    expect(truncateForPrompt('あ'.repeat(2501)).truncated).toBe(true);
    expect(MAX_PROMPT_CHARS).toBe(2500);
  });
});

describe('buildPromptSource', () => {
  it('サニタイズしてから切り詰める', () => {
    // コードブロックを消せば上限に収まる
    const md = '要点\n```\n' + 'x'.repeat(200) + '\n```';
    expect(buildPromptSource(md, 100)).toEqual({ text: '要点', truncated: false });
  });

  it('サニタイズで空になったら元の本文を使う（生成できなくしない）', () => {
    // ノートが丸ごとコードブロックのケース
    const md = '```ts\nconst answer = 42;\n```';
    const result = buildPromptSource(md);
    expect(result.text).toContain('const answer = 42;');
  });

  it('サニタイズ後も長ければ切り詰める', () => {
    const result = buildPromptSource('あ'.repeat(3000));
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('あ'.repeat(2500))).toBe(true);
  });

  it('空文字を渡しても落ちない', () => {
    expect(buildPromptSource('')).toEqual({ text: '', truncated: false });
  });
});

describe('willTruncate', () => {
  it('UI の注記は送信時と同じ基準で判定する', () => {
    // 見た目は長いがコードブロックなので、除去すれば収まる → 注記を出さない
    const md = '要点\n```\n' + 'x'.repeat(4000) + '\n```';
    expect(willTruncate(md)).toBe(false);

    // 本文そのものが長い → 注記を出す
    expect(willTruncate('あ'.repeat(3000))).toBe(true);
  });
});
