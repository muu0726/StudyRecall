CREATE TABLE `glossary_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`notebook_id` text,
	`term` text NOT NULL,
	`term_key` text NOT NULL,
	`definition` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `glossary_terms_user_updated_idx` ON `glossary_terms` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `glossary_terms_user_category_idx` ON `glossary_terms` (`user_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `glossary_terms_notebook_idx` ON `glossary_terms` (`notebook_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `glossary_terms_user_category_key_unq` ON `glossary_terms` (`user_id`,`category_id`,`term_key`);--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `glossary_term_id` text REFERENCES glossary_terms(id);--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `question_type` text DEFAULT 'qa' NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `choices` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `quiz_questions_glossary_idx` ON `quiz_questions` (`glossary_term_id`);