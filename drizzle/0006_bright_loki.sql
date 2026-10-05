CREATE TABLE `player_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`photo` text,
	`photo_revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `players` ADD `profile_id` integer REFERENCES player_profiles(id);--> statement-breakpoint
ALTER TABLE `users` ADD `photo` text;--> statement-breakpoint
ALTER TABLE `users` ADD `photo_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO player_profiles (id, name) SELECT id, name FROM players;
--> statement-breakpoint
UPDATE players SET profile_id = id;
--> statement-breakpoint
CREATE UNIQUE INDEX players_profile_team_idx ON players(profile_id, team_id);
