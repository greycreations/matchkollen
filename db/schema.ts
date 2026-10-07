import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sports = sqliteTable("sports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sportId: integer("sport_id").notNull(),
  name: text("name").notNull(),
  groupName: text("group_name").notNull().default(""),
  active: integer("active").notNull().default(1),
});

export const playerProfiles = sqliteTable("player_profiles", {
  active: integer("active").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  photo: text("photo"),
  photoRevision: integer("photo_revision").notNull().default(0),
});

export const players = sqliteTable("players", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id").notNull(),
  profileId: integer("profile_id").references(() => playerProfiles.id),
  name: text("name").notNull(),
  number: integer("number"),
  active: integer("active").notNull().default(1),
}, (table) => [uniqueIndex("players_profile_team_idx").on(table.profileId, table.teamId)]);

export const competitions = sqliteTable("competitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("cup"),
  yellowEnabled: integer("yellow_enabled").notNull().default(1),
  redEnabled: integer("red_enabled").notNull().default(1),
  greenEnabled: integer("green_enabled").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const matches = sqliteTable("matches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id").notNull(),
  competitionId: integer("competition_id").references(() => competitions.id),
  homeName: text("home_name").notNull(),
  opponent: text("opponent").notNull(),
  scheduledAt: text("scheduled_at").notNull(),
  venue: text("venue").notNull().default(""),
  periods: integer("periods").notNull().default(3),
  status: text("status").notNull().default("scheduled"),
  yellowEnabled: integer("yellow_enabled").notNull().default(1),
  redEnabled: integer("red_enabled").notNull().default(1),
  greenEnabled: integer("green_enabled").notNull().default(1),
});

export const participants = sqliteTable("participants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: integer("match_id").notNull(),
  playerId: integer("player_id").notNull(),
});

export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: integer("match_id").notNull(),
  period: integer("period").notNull(),
  side: text("side").notNull(),
  playerId: integer("player_id"),
  playerName: text("player_name"),
  number: integer("number"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const cards = sqliteTable("cards", {
  playerName: text("player_name"),
  number: integer("number"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: integer("match_id").notNull(),
  period: integer("period").notNull(),
  playerId: integer("player_id").notNull(),
  cardType: text("card_type").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  photo: text("photo"),
  photoRevision: integer("photo_revision").notNull().default(0),
  email: text("email").notNull().unique(),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  permissions: text("permissions").notNull().default("{}"),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userTeams = sqliteTable("user_teams", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.userId, table.teamId] }), index("user_teams_team_idx").on(table.teamId)]);

export const parentChildren = sqliteTable("parent_children", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  profileId: integer("profile_id").notNull().references(() => playerProfiles.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.userId, table.profileId] }), index("parent_children_profile_idx").on(table.profileId)]);

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  userName: text("user_name").notNull(),
  action: text("action").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("activity_log_time_idx").on(table.createdAt), index("activity_log_user_idx").on(table.userId)]);
