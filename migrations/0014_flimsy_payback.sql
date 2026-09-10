ALTER TABLE `user_settings` ADD `drive_glossary_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `glossary_json_file_id` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `glossary_md_file_id` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `glossary_synced_at` integer;