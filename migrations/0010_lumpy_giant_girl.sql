CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`google_task_id` text,
	`category_id` text,
	`notebook_id` text,
	`title` text NOT NULL,
	`memo` text,
	`due_date` text,
	`is_completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	`google_updated_at` integer,
	`sync_state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_user_deleted_idx` ON `tasks` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `tasks_user_due_idx` ON `tasks` (`user_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_user_google_idx` ON `tasks` (`user_id`,`google_task_id`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`calendar_sync_enabled` integer DEFAULT false NOT NULL,
	`calendar_id` text DEFAULT 'primary' NOT NULL,
	`tasks_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
