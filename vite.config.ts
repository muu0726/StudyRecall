import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
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
        // API を SW の SPA フォールバックに巻き込ませない。
        // 除外しないと /api/* が index.html を返してしまう。
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
    cloudflare(),
  ],
});
