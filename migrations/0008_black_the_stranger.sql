ALTER TABLE `quiz_questions` ADD `due_at` integer;--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `interval_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `ease_factor` integer DEFAULT 250 NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `repetitions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `quiz_questions_user_due_idx` ON `quiz_questions` (`user_id`,`due_at`);