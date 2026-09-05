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
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
