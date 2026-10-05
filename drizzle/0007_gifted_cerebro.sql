CREATE TABLE `parent_children` (
	`user_id` integer NOT NULL,
	`profile_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `profile_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `player_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `parent_children_profile_idx` ON `parent_children` (`profile_id`);