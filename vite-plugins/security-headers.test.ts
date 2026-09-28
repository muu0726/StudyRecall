import { describe, expect, it } from 'vitest';
import { buildHeadersFile, inlineScripts, sha256Source } from './security-headers';

/**
 * CSP は**間違えると画面が真っ白になる**種類の設定で、しかも本番でしか効かない
 * （`_headers` は静的配信の設定なので dev では既定で読まれない）。
 * せめて「ハッシュの取り方」と「緩めたつもりのないところが緩んでいないか」をここで固定する。
 */

describe('inlineScripts', () => {
  it('src の無い script の中身だけを拾う', () => {
    const html = `
      <script>var a = 1;</script>
      <script type="module" src="/assets/index.js"></script>
      <script type="application/json">{"a":1}</script>
    `;
    expect(inlineScripts(html)).toEqual(['var a = 1;', '{"a":1}']);
  });

  it('空の script は数えない（ハッシュが増えるだけで意味が無い）', () => {
    expect(inlineScripts('<script></script><script>  </script>')).toEqual([]);
  });

  it('属性の中に src という文字があっても、外部 script と間違えない', () => {
    expect(inlineScripts('<script data-srcset="x">var a = 1;</script>')).toEqual(['var a = 1;']);
  });
});

describe('sha256Source', () => {
  it('CSP の書式で返す', () => {
    // 既知の値（空文字の sha256）で、符号化の取り違えに気付けるようにする
    expect(sha256Source('')).toBe("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
  });
});

describe('buildHeadersFile', () => {
  const headers = buildHeadersFile(["'sha256-abc='"]);

  it('すべてのパスに当てる', () => {
    expect(headers.startsWith('/*\n')).toBe(true);
  });

  it('script は self とハッシュだけ。unsafe-inline を混ぜない', () => {
    expect(headers).toContain("script-src 'self' 'sha256-abc='");
    expect(headers).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(headers).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  it('壊さないために開けてあるところは開いたまま（意図しない締めすぎを防ぐ）', () => {
    expect(headers).toContain("img-src 'self' data: blob: https:");
    expect(headers).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('Google ログイン（302 での遷移）を止めうる指定は入れない', () => {
    expect(headers).not.toContain('form-action');
    expect(headers).not.toContain('navigate-to');
  });

  it('付随する安全ヘッダーも出す', () => {
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin');
  });
});
