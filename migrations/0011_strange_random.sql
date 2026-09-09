ALTER TABLE `user_settings` ADD `drive_backup_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `drive_folder_id` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `drive_backup_at` integer;