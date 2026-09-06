import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * vite.config.ts とは分けている。
 * あちらは cloudflare() と VitePWA を積んでおり、テストを回すのに Worker 環境の
 * ビルドや SW の生成まで走らせる必要はない（遅いうえ壊れやすい）。
 *
 * 対象は「壊れると被害が大きい純粋関数」に絞る。
 * とくに shared/note-tree はサーバーとクライアントが同じ実装を使っているので、
 * ここが壊れると両方が同時に壊れる。
 */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // vite.config.ts と同じ値を入れておく。無いと version.ts の import で落ちる。
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
