ALTER TABLE `notebooks` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `notebooks_user_deleted_idx` ON `notebooks` (`user_id`,`deleted_at`);