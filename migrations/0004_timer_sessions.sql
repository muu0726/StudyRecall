CREATE TABLE `timer_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`accumulated_ms` integer DEFAULT 0 NOT NULL,
	`is_running` integer DEFAULT true NOT NULL,
	`completed_at` integer,
	`study_log_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`study_log_id`) REFERENCES `study_logs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `timer_sessions_user_completed_idx` ON `timer_sessions` (`user_id`,`completed_at`);