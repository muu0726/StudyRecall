ALTER TABLE `notebooks` ADD `drive_file_id` text;--> statement-breakpoint
ALTER TABLE `notebooks` ADD `drive_path` text;--> statement-breakpoint
ALTER TABLE `notebooks` ADD `drive_synced_at` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `drive_notes_enabled` integer DEFAULT false NOT NULL;