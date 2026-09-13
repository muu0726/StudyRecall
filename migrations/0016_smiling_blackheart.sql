ALTER TABLE `timer_sessions` ADD `pomodoro_work_minutes` integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE `timer_sessions` ADD `pomodoro_break_minutes` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `timer_sessions` ADD `pomodoro_long_break_minutes` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `timer_sessions` ADD `pomodoro_long_break_every` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `pomodoro_work_minutes` integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `pomodoro_break_minutes` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `pomodoro_long_break_minutes` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `pomodoro_long_break_every` integer DEFAULT 0 NOT NULL;