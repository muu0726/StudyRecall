import { defineConfig } from 'drizzle-kit';

// マイグレーション SQL の「生成」専用の設定。
// 適用は wrangler d1 migrations apply が行うため、認証情報は不要。
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
});
