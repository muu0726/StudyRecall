import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { cloudflare } from '@cloudflare/vite-plugin';

// バージョンの正は package.json だけ。2 か所に持つと必ずズレる。
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    react(),
    tailwindcss(),
    // cloudflare() より前に置く。後ろだと Worker 環境のビルドに巻き込まれる。
    VitePWA({
      // 'autoUpdate' だと更新が当たるのは次の読み込みからで、
      // デプロイ直後の 1 回目は古い画面が出る（実際に本番で踏んだ）。
      // 'prompt' にして、更新があることをトーストで知らせる。
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'StudyRecall',
        short_name: 'StudyRecall',
        description: '学習を記録して、そのまま一問一答に',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#2563eb',
        background_color: '#f8fafc',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Inter は unicode-range で分割されており、この画面で実際に要るのは latin だけ。
        // 残り 6 サブセット（170KB）は日本語＋英数字では一度も読まれないのに、
        // プリキャッシュに入れると初回インストールでまとめて落としてしまう。
        // 除外しても通常配信はされるので、必要になればその場で取りに行く。
        globIgnores: [
          '**/inter-{latin-ext,cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2',
        ],
        // API を SW の SPA フォールバックに巻き込ませない。
        // 除外しないと /api/* が index.html を返してしまう。
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
    cloudflare(),
  ],
});
