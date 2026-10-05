import type { AuthUser } from "./auth";

const labels: Record<string, string> = {
  login: "Loggade in", logout: "Loggade ut", createAdmin: "Skapade administratörskonto",
  createUser: "Skapade användarkonto", updateUser: "Ändrade konto, roll eller lagtillgång", deleteUser: "Tog bort användarkonto", setUserActive: "Ändrade kontots aktiva status",
  addSport: "Lade till sport", updateSport: "Ändrade sport", deleteSport: "Tog bort sport", addTeam: "Lade till lag", updateTeam: "Ändrade lag", deleteTeam: "Arkiverade lag",
  addPlayer: "Skapade spelarprofil", updatePlayer: "Ändrade spelare", deletePlayer: "Inaktiverade spelare i lag",
  createMatch: "Planerade match", createCompetition: "Skapade cup eller sammandrag", updateMatch: "Ändrade matchinställningar", updateCardSettings: "Ändrade kortval",
  startMatch: "Startade match", returnToScheduled: "Återställde match till planerad", finishMatch: "Avslutade match", deleteMatch: "Tog bort match",
  addParticipant: "Lade till spelare i matchtrupp", removeParticipant: "Tog bort spelare ur matchtrupp", goal: "Registrerade mål", card: "Registrerade kort", updateGoal: "Ändrade mål", deleteGoal: "Tog bort mål", deleteCard: "Tog bort kort", resetMatch: "Nollställde matchhändelser",
  rename: "Ändrade spelarprofilens namn", membership: "Ändrade lagkoppling", family: "Ändrade föräldrakopplingar", photo: "Ändrade profilbild",
};
const fields: Record<string, string> = { name: "Namn", opponent: "Motståndare", homeName: "Vårt lag", number: "Tröjnummer", venue: "Plats", scheduledAt: "Tid", periods: "Perioder", status: "Status", role: "Roll", active: "Aktiv", period: "Period", side: "Lag", cardType: "Kort", yellowEnabled: "Gula kort", redEnabled: "Röda kort", greenEnabled: "Gröna kort", teamIds: "Lagkopplingar", childProfileIds: "Barnkopplingar", parentIds: "Föräldrakopplingar" };

// Audit and mutation commit together. Record one event per request, never raw bodies,
// credentials, session tokens or image payloads. User identity is a durable snapshot.
export async function auditedDatabase(db: D1Database, user: Pick<AuthUser, "id" | "name">, action: string, body: Record<string, unknown>, category: string): Promise<D1Database> {
  const entities: [string, string, string][] = [["userId", "users", "Konto"], ["profileId", "player_profiles", "Spelarprofil"], ["playerId", "players", "Spelare"], ["matchId", "matches", "Match"], ["competitionId", "competitions", "Cup"], ["teamId", "teams", "Lag"], ["sportId", "sports", "Sport"], ["goalId", "goals", "Mål"], ["cardId", "cards", "Kort"]];
  let description = labels[action] ?? "Ändrade data";
  let previous: Record<string, unknown> = {};
  if (category === "profiles" && action === "membership") {
    previous = await db.prepare("SELECT name, number, active FROM players WHERE profile_id = ? AND team_id = ?").bind(Number(body.profileId), Number(body.teamId)).first<Record<string, unknown>>() ?? {};
  }
  for (const [key, table, label] of entities) {
    const id = Number(body[key]);
    if (!Number.isInteger(id) || id < 1) continue;
    const columns = table === "matches" ? "home_name AS homeName, home_name AS name, opponent, scheduled_at AS scheduledAt, venue, periods, status, yellow_enabled AS yellowEnabled, red_enabled AS redEnabled, green_enabled AS greenEnabled" : ["goals", "cards"].includes(table) ? "match_id AS matchId, period" : table === "players" ? "name, number, active" : table === "users" ? "name, role, active" : "name";
    const row = await db.prepare(`SELECT ${columns} FROM ${table} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    description += ` · ${label}: ${row?.name ?? `#${id}`}${row?.opponent ? ` – ${row.opponent}` : ""}`;
    if (!Object.keys(previous).length && row) previous = row;
  }
  for (const [key, label] of Object.entries(fields)) {
    const value = body[key];
    if (value === undefined) continue;
    const safe = Array.isArray(value) ? value.filter((id) => Number.isInteger(id)).join(", ") || "inga" : typeof value === "boolean" ? value ? "ja" : "nej" : value === null ? "saknas" : String(value).slice(0, 150);
    const old = previous[key];
    description += ` · ${label}: ${old !== undefined && String(old) !== String(value) ? `${old === null ? "saknas" : String(old).slice(0,150)} → ` : ""}${safe}`;
  }
  if (action === "photo") description += body.photo === null ? " · Bild borttagen" : " · Bild sparad";
  let recorded = false;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  async function commit(statements: D1PreparedStatement[]) {
    statements = statements.map((statement) => originals.get(statement) ?? statement);
    if (!recorded) {
      const log = db.prepare("INSERT INTO activity_log (user_id, user_name, action, category, description, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(user.id, user.name, action, category, description, new Date().toISOString());
      const results = await db.batch([...statements, log]);
      recorded = true;
      return results.slice(0, -1);
    }
    return db.batch(statements);
  }
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    const wrapped = new Proxy(statement, { get(target, property) {
      if (property === "bind") return (...args: unknown[]) => wrap(target.bind(...args));
      if (property === "run") return async () => (await commit([target]))[0];
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    originals.set(wrapped, statement);
    return wrapped;
  }
  return new Proxy(db, { get(target, property) {
    if (property === "prepare") return (sql: string) => wrap(target.prepare(sql));
    if (property === "batch") return (statements: D1PreparedStatement[]) => commit(statements.map((statement) => statement));
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
