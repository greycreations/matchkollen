CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`user_name` text NOT NULL,
	`action` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_log_time_idx` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_log_user_idx` ON `activity_log` (`user_id`);