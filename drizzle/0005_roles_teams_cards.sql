CREATE TABLE user_teams (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, team_id)
);
CREATE INDEX user_teams_team_idx ON user_teams(team_id);
ALTER TABLE matches ADD COLUMN yellow_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE matches ADD COLUMN red_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE matches ADD COLUMN green_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE competitions ADD COLUMN yellow_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE competitions ADD COLUMN red_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE competitions ADD COLUMN green_enabled INTEGER NOT NULL DEFAULT 1;
UPDATE users SET role = 'parent', permissions = '{}' WHERE role <> 'admin';
