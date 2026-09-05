ALTER TABLE `timer_sessions` ADD `mode` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
CREATE INDEX `quiz_questions_user_answered_idx` ON `quiz_questions` (`user_id`,`last_answered_at`);