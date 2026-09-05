-- drizzle-kit の出力は `ADD \`issuer\` text NOT NULL;` だが、SQLite は DEFAULT なしの
-- NOT NULL 列を ADD COLUMN できないため、空文字を既定値にしてから規約どおりの値で埋める。
-- ローカル認証の issuer は `local:<providerId>`（Better Auth の createLocalAccountIssuer と同じ規約）。
ALTER TABLE `accounts` ADD `issuer` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `accounts` SET `issuer` = 'local:' || `provider_id` WHERE `issuer` = '';
