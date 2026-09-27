CREATE TABLE `portal_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`icon_kind` text DEFAULT 'favicon' NOT NULL,
	`icon_value` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `portal_links_user_sort_idx` ON `portal_links` (`user_id`,`sort_order`);