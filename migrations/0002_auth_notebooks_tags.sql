-- drizzle-kit generate の出力を手で補正したもの。補正点は3つ:
--   1. PRAGMA foreign_keys=OFF/ON を削除。D1 が受け付けない上、quiz_questions は
--      他テーブルから参照されていないため再作成に FK 無効化は不要。
--   2. __new_quiz_questions への INSERT...SELECT が、旧テーブルに存在しない notebook_id / tags を
--      SELECT していたためリテラル(NULL / '[]')に置換。そのままでは "no such column" で落ちる。
--   3. SQLite は DEFAULT なしの NOT NULL 列を ADD COLUMN できないため、users.updated_at に
--      DEFAULT 0 を与えたうえで created_at の値で埋める。
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `notebooks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notebooks_user_updated_idx` ON `notebooks` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `__new_quiz_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`study_log_id` text,
	`notebook_id` text,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`explanation` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`is_mastered` integer DEFAULT false NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`incorrect_count` integer DEFAULT 0 NOT NULL,
	`last_answered_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`study_log_id`) REFERENCES `study_logs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_quiz_questions`("id", "user_id", "category_id", "study_log_id", "notebook_id", "question", "answer", "explanation", "tags", "is_mastered", "correct_count", "incorrect_count", "last_answered_at", "created_at") SELECT "id", "user_id", "category_id", "study_log_id", NULL, "question", "answer", "explanation", '[]', "is_mastered", "correct_count", "incorrect_count", "last_answered_at", "created_at" FROM `quiz_questions`;--> statement-breakpoint
DROP TABLE `quiz_questions`;--> statement-breakpoint
ALTER TABLE `__new_quiz_questions` RENAME TO `quiz_questions`;--> statement-breakpoint
CREATE INDEX `quiz_questions_user_category_idx` ON `quiz_questions` (`user_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `quiz_questions_user_mastered_idx` ON `quiz_questions` (`user_id`,`is_mastered`);--> statement-breakpoint
CREATE INDEX `quiz_questions_study_log_idx` ON `quiz_questions` (`study_log_id`);--> statement-breakpoint
CREATE INDEX `quiz_questions_notebook_idx` ON `quiz_questions` (`notebook_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `image` text;--> statement-breakpoint
ALTER TABLE `users` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `users` SET `updated_at` = `created_at`;