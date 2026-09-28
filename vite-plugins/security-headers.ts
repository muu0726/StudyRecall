import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * 配信時の安全ヘッダー（CSP ほか）を `_headers` として出す vite プラグイン。
 *
 * **なぜビルド時に作るのか。**
 * `index.html` にはテーマを先当てするインライン script がある（これが無いと、ダーク設定でも
 * 一瞬白い画面が出る）。CSP でインライン script を許すには**そのハッシュ**が要るが、
 * 手で `_headers` に書くと script を直したときに必ずズレて、**画面が真っ白になる**。
 * 出力された HTML から毎回計算して埋める。
 *
 * `_headers` は Cloudflare の静的配信の設定で、wrangler が deploy 時に読む
 * （配信物そのものには含まれない）。**Worker が返す `/api/*` には効かない**ので、
 * そちらは worker 側の middleware で付ける。
 */

/** インライン script の sha256（CSP の 'sha256-…' 形式） */
export function sha256Source(source: string): string {
  return `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`;
}

/** 出力 HTML から、src の無い `<script>` の中身を取り出す */
export function inlineScripts(html: string): string[] {
  const found: string[] = [];
  const pattern = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const body = match[1];
    if (body !== undefined && body.trim() !== '') found.push(body);
  }
  return found;
}

/**
 * `_headers` の中身を組み立てる。
 *
 * ゆるめているところと、その理由:
 * - `style-src 'unsafe-inline'`: React の `style={{...}}`（ツリーのインデントなど）が属性で出る
 * - `img-src https:`: **利用者が貼る画像 URL**・ノートの Markdown 画像・Google のアカウント画像。
 *   ここを絞ると機能が壊れる（ファビコンは `/api/icon` 経由なので 'self' で足りる）
 * - `form-action` と navigate 系は**入れない**。Google ログインは Worker からの 302 で、
 *   締めると認証が壊れうるのに、こちらの環境では本番のログインを試せない
 */
export function buildHeadersFile(scriptHashes: readonly string[]): string {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
    '',
  ].join('\n');
}

export function securityHeaders(): Plugin {
  const hashes = new Set<string>();

  return {
    name: 'studyrecall:security-headers',
    apply: 'build',

    // 変換後（＝実際に配られる形）の HTML を見る
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        for (const source of inlineScripts(html)) hashes.add(sha256Source(source));
        return html;
      },
    },

    /*
     * **書き出しは writeBundle で行う。**
     * HTML の変換はバンドルの生成と同じ段で走るため、generateBundle で emitFile すると
     * ハッシュがまだ揃っていないことがある（実際に `_headers` が出ないビルドになった）。
     * 出力先は options.dir。ハッシュが空＝HTML を通っていないビルド（Worker 側）なので何もしない。
     */
    writeBundle(options) {
      if (hashes.size === 0 || !options.dir) return;
      writeFileSync(join(options.dir, '_headers'), buildHeadersFile([...hashes]), 'utf8');
    },
  };
}
