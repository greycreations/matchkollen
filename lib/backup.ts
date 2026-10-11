import { jpegSize } from "./jpeg";
import { z } from "zod";

export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const flag = z.union([z.literal(0), z.literal(1)]);
const number = z.number().int().min(0).max(999).nullable();
const name = z.string().min(1).max(BACKUP_MAX_BYTES);
const date = z.string().max(60).refine((value) => Number.isFinite(new Date(value).getTime()));
const photo = z.string().max(340000).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine((value) => { try { return jpegSize(Uint8Array.from(atob(value), (character) => character.charCodeAt(0))) !== null; } catch { return false; } }).nullable();
const settings = { yellow_enabled: flag, red_enabled: flag, green_enabled: flag };
const schemas = {
  sports: z.object({ id, name }).strict(),
  teams: z.object({ id, sport_id: id, name, group_name: z.string().max(BACKUP_MAX_BYTES), active: flag }).strict(),
  player_profiles: z.object({ id, name, active: flag, photo, photo_revision: z.number().int().nonnegative() }).strict(),
  users: z.object({ id, name, email: z.string().email().max(254), photo, photo_revision: z.number().int().nonnegative(), password_salt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/), password_hash: z.string().regex(/^[A-Za-z0-9+/]{43}=$/), role: z.enum(["admin", "coach", "parent"]), permissions: z.string().max(2000).refine((value) => { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed); } catch { return false; } }), active: flag, created_at: date }).strict(),
  players: z.object({ id, team_id: id, profile_id: id, name, number, active: flag }).strict(),
  competitions: z.object({ id, team_id: id, name, kind: z.enum(["cup", "sammandrag"]), ...settings, created_at: date }).strict(),
  matches: z.object({ id, team_id: id, competition_id: id.nullable(), home_name: name, opponent: name, scheduled_at: date, venue: z.string().max(BACKUP_MAX_BYTES), periods: z.union([z.literal(2), z.literal(3)]), status: z.enum(["scheduled", "live", "completed"]), ...settings }).strict(),
  participants: z.object({ id, match_id: id, player_id: id }).strict(),
  goals: z.object({ id, match_id: id, period: z.number().int().min(1).max(3), side: z.enum(["home", "away"]), player_id: id.nullable(), player_name: name.nullable(), number, created_at: date }).strict(),
  cards: z.object({ id, match_id: id, period: z.number().int().min(1).max(3), player_id: id, player_name: name.nullable(), number, card_type: z.enum(["red", "yellow", "green"]), created_at: date }).strict(),
  user_teams: z.object({ user_id: id, team_id: id }).strict(),
  parent_children: z.object({ user_id: id, profile_id: id }).strict(),
  activity_log: z.object({ id, user_id: id, user_name: name, action: z.string().min(1).max(100), category: z.enum(["auth", "accounts", "data", "profiles", "photos"]), description: z.string().max(BACKUP_MAX_BYTES), created_at: date }).strict(),
};
export const backupTables = Object.keys(schemas) as (keyof typeof schemas)[];
const tableSchema = z.object(Object.fromEntries(backupTables.map((table) => [table, z.array(schemas[table]).max(10000)]))).strict();
const envelope = z.object({ format: z.literal("matchkollen-backup"), version: z.literal(1), schemaVersion: z.literal(9), exportedAt: date, tables: tableSchema, sequences: z.array(z.object({ name: z.enum(backupTables as [string, ...string[]]), seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()).max(13) }).strict();
export type BackupRows = Record<string, Record<string, string | number | null>[]>;

export function validateBackup(value: unknown) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) throw new Error("Backupens format, version eller datainnehåll är ogiltigt. Använd en backup skapad med denna version av Matchkollen.");
  const backup = parsed.data;
  const tables = backup.tables as BackupRows;
  if (Object.values(tables).reduce((sum, rows) => sum + rows.length, 0) > 10000) throw new Error("Backupen får innehålla högst 10 000 poster.");
  const maps = Object.fromEntries(backupTables.map((table) => [table, new Map(tables[table].filter((row) => row.id !== undefined).map((row) => [row.id, row]))]));
  const requireLink = (table: string, key: string | number | null) => { if (key !== null && !maps[table].has(key)) throw new Error("Backupen innehåller en koppling till data som saknas."); };
  const unique = (rows: Record<string, string | number | null>[], keys: string[]) => { const values = rows.map((row) => JSON.stringify(keys.map((key) => row[key]))); if (new Set(values).size !== values.length) throw new Error("Backupen innehåller dubbla poster."); };
  for (const table of backupTables) if (tables[table][0]?.id !== undefined) unique(tables[table], ["id"]);
  unique(tables.sports, ["name"]); unique(tables.users.map((row) => ({ ...row, email: String(row.email).toLowerCase() })), ["email"]);
  unique(tables.players, ["profile_id", "team_id"]); unique(tables.user_teams, ["user_id", "team_id"]); unique(tables.parent_children, ["user_id", "profile_id"]); unique(tables.participants, ["match_id", "player_id"]);
  if (!tables.users.some((row) => row.role === "admin" && row.active === 1)) throw new Error("Backupen måste innehålla ett aktivt administratörskonto.");
  for (const row of tables.teams) requireLink("sports", row.sport_id);
  for (const row of tables.players) { requireLink("teams", row.team_id); requireLink("player_profiles", row.profile_id); }
  for (const row of tables.competitions) requireLink("teams", row.team_id);
  for (const row of tables.matches) { requireLink("teams", row.team_id); requireLink("competitions", row.competition_id); if (row.competition_id !== null && maps.competitions.get(row.competition_id)?.team_id !== row.team_id) throw new Error("Cup och match tillhör olika lag."); }
  for (const row of [...tables.goals, ...tables.cards, ...tables.participants]) {
    requireLink("matches", row.match_id);
    const match = maps.matches.get(row.match_id)!;
    if (row.period !== undefined && Number(row.period) > Number(match.periods)) throw new Error("En händelse har en ogiltig period.");
    const player = row.player_id === null ? undefined : maps.players.get(row.player_id);
    if (player && player.team_id !== match.team_id) throw new Error("Spelare och match tillhör olika lag.");
    if (!player && row.player_id !== null && !row.player_name) throw new Error("Spelaruppgifter saknas för en händelse.");
  }
  for (const row of tables.user_teams) { requireLink("users", row.user_id); requireLink("teams", row.team_id); }
  for (const row of tables.parent_children) { requireLink("users", row.user_id); requireLink("player_profiles", row.profile_id); }
  unique(backup.sequences, ["name"]);
  for (const sequence of backup.sequences) if (["user_teams", "parent_children"].includes(sequence.name) || sequence.seq < Math.max(0, ...tables[sequence.name].map((row) => Number(row.id ?? 0)))) throw new Error("Backupens ID-räknare är ogiltig.");
  // Preserve counters for deleted identities referenced by historical cards/logs.
  if (tables.cards.some((row) => !maps.players.has(row.player_id)) && !backup.sequences.some((row) => row.name === "players" && row.seq >= Math.max(...tables.cards.map((card) => Number(card.player_id))))) throw new Error("ID-räknaren för historiska spelare saknas.");
  return { ...backup, tables };
}

export function backupSummary(tables: BackupRows) {
  return { users: tables.users.length, teams: tables.teams.length, profiles: tables.player_profiles.length, matches: tables.matches.length, goals: tables.goals.length, cards: tables.cards.length, logs: tables.activity_log.length };
}
