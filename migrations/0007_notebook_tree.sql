ALTER TABLE `notebooks` ADD `parent_id` text REFERENCES notebooks(id);--> statement-breakpoint
ALTER TABLE `notebooks` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `notebooks_user_parent_order_idx` ON `notebooks` (`user_id`,`parent_id`,`sort_order`);