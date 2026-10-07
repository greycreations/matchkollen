ALTER TABLE `cards` ADD `player_name` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `player_profiles` ADD `active` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE cards SET player_name = (SELECT name FROM players WHERE id = cards.player_id), number = (SELECT number FROM players WHERE id = cards.player_id);
