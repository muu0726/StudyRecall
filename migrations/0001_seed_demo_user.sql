-- MVP 開発フェーズ用のモックユーザーと初期カテゴリ。
-- 再適用しても壊れないよう INSERT OR IGNORE にしている。
INSERT OR IGNORE INTO `users` (`id`, `email`, `name`, `created_at`)
VALUES ('user_demo_1', 'demo@studyrecall.local', 'デモユーザー', unixepoch());
--> statement-breakpoint
INSERT OR IGNORE INTO `categories` (`id`, `user_id`, `name`, `color`, `created_at`) VALUES
  ('cat_demo_network', 'user_demo_1', 'ネットワーク', '#3b82f6', unixepoch()),
  ('cat_demo_fe', 'user_demo_1', '基本情報', '#8b5cf6', unixepoch()),
  ('cat_demo_english', 'user_demo_1', '英語', '#10b981', unixepoch());
