import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Run the actual route handlers and migrations against an isolated SQLite database.
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys = ON");
const migrations = (await readdir("drizzle")).filter((file) => file.endsWith(".sql")).sort();
for (const file of migrations) {
  if (file.startsWith("0005")) {
    sqlite.exec("INSERT INTO users (name,email,password_salt,password_hash,role) VALUES ('Legacy','legacy@example.com','','','user')");
    sqlite.exec("INSERT INTO matches (team_id,home_name,opponent,scheduled_at) VALUES (1,'Legacy','Opponent','2026-10-01T12:00:00Z')");
  }
  sqlite.exec(await readFile(`drizzle/${file}`, "utf8"));
}
assert.equal(sqlite.prepare("SELECT role FROM users WHERE email = 'legacy@example.com'").get().role, "parent");
assert.equal(sqlite.prepare("SELECT yellow_enabled + red_enabled + green_enabled AS total FROM matches").get().total, 3);
sqlite.exec("DELETE FROM matches; DELETE FROM users;");

function statement(sql, values = []) {
  return {
    bind(...next) { return statement(sql, next); },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() {
      const result = sqlite.prepare(sql).run(...values);
      return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
  };
}
globalThis.__testEnv = { DB: {
  prepare: statement,
  async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const item of statements) results.push(await item.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
} };
await mkdir("work/tests", { recursive: true });
const routes = {};
for (const name of ["auth", "data"]) {
  const outfile = resolve(`work/tests/${name}.mjs`);
  await build({ entryPoints: [`app/api/${name}/route.ts`], outfile, bundle: true, platform: "node", format: "esm", plugins: [{ name: "test-database", setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "environment", namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const env = globalThis.__testEnv;" }));
  } }] });
  routes[name] = await import(pathToFileURL(outfile).href);
}
const password = "Test-password-12345";
async function call(route, cookie = "", body) {
  const request = new Request(`http://localhost/api/${route}`, { method: body ? "POST" : "GET", headers: { cookie, "Content-Type": "application/json", origin: "http://localhost" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const response = await routes[route][body ? "POST" : "GET"](request);
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const setup = await call("auth", "", { action: "createAdmin", name: "Admin", email: "admin@example.com", password });
assert.equal(setup.status, 201);
const admin = setup.cookie;
async function mutate(cookie, values, status = 200) {
  const result = await call("data", cookie, values);
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body;
}
await mutate(admin, { action: "addSport", name: "Fotboll" });
await mutate(admin, { action: "addSport", name: "Innebandy" });
const sports = sqlite.prepare("SELECT id FROM sports ORDER BY id").all();
assert.ok(sports.length >= 2);
await mutate(admin, { action: "addTeam", sportId: sports[0].id, name: "Fotbollslag", groupName: "P10" });
await mutate(admin, { action: "addTeam", sportId: sports[1].id, name: "Innebandylag", groupName: "P10" });
const [teamA, teamB] = sqlite.prepare("SELECT id FROM teams ORDER BY id").all().map((row) => row.id);
for (const [role, teamIds] of [["coach", [teamA]], ["parent", [teamA]], ["parent", []], ["coach", [teamA, teamB]]]) {
  const email = `${role}-${teamIds.length}@example.com`;
  assert.equal((await call("auth", admin, { action: "createUser", name: role, email, password, role, teamIds })).status, 201);
}
async function login(email) { const result = await call("auth", "", { action: "login", email, password }); assert.equal(result.status, 200); return result.cookie; }
const coach = await login("coach-1@example.com");
const parent = await login("parent-1@example.com");
const noTeams = await login("parent-0@example.com");
const multi = await login("coach-2@example.com");
const authState = await call("auth", coach);
assert.deepEqual(authState.body.user.teamIds, [teamA]);
assert.equal(authState.body.user.permissions.scores.create, true);
assert.equal(authState.body.user.permissions.teams.create, false);
assert.equal(authState.body.users, undefined);
await mutate(coach, { action: "addPlayer", teamId: teamA, name: "Player A", number: 7 });
await mutate(admin, { action: "addPlayer", teamId: teamB, name: "Player B", number: 8 });
const [playerA, playerB] = sqlite.prepare("SELECT id FROM players ORDER BY id").all().map((row) => row.id);
const matchA = (await mutate(coach, { action: "createMatch", teamId: teamA, opponent: "A", scheduledAt: "2026-10-05T12:00:00Z", periods: 3, yellowEnabled: true, redEnabled: false, greenEnabled: false })).matchId;
const matchB = (await mutate(admin, { action: "createMatch", teamId: teamB, opponent: "B", scheduledAt: "2026-10-06T12:00:00Z", periods: 2 })).matchId;
for (const [cookie, matchId, playerId] of [[coach, matchA, playerA], [admin, matchB, playerB]]) {
  await mutate(cookie, { action: "addParticipant", matchId, playerId });
  await mutate(cookie, { action: "goal", matchId, period: 1, side: "home", playerId });
  await mutate(cookie, { action: "card", matchId, period: 1, playerId, cardType: "yellow" });
}
await mutate(coach, { action: "card", matchId: matchA, period: 1, playerId: playerA, cardType: "red" }, 400);
await mutate(parent, { action: "returnToScheduled", matchId: matchA }, 403);
await mutate(coach, { action: "returnToScheduled", matchId: matchB }, 403);
await mutate(coach, { action: "returnToScheduled", matchId: matchA });
assert.equal(sqlite.prepare("SELECT status FROM matches WHERE id = ?").get(matchA).status, "scheduled");
for (const table of ["goals", "cards", "participants"]) assert.equal(sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE match_id = ?`).get(matchA).total, 1);
await mutate(coach, { action: "returnToScheduled", matchId: matchA }, 409);
await mutate(coach, { action: "startMatch", matchId: matchA });
assert.equal(sqlite.prepare("SELECT status FROM matches WHERE id = ?").get(matchA).status, "live");
await mutate(admin, { action: "finishMatch", matchId: matchB });
await mutate(admin, { action: "returnToScheduled", matchId: matchB }, 409);
await mutate(coach, { action: "card", matchId: matchA, period: -1, playerId: playerA, cardType: "yellow" }, 400);
await mutate(coach, { action: "goal", matchId: matchA, period: 1.5, side: "home" }, 400);
await mutate(coach, { action: "addParticipant", matchId: matchA, playerId: playerB }, 400);
for (const cookie of [coach, parent]) {
  const result = await call("data", cookie);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.teams.map((team) => team.id), [teamA]);
  assert.equal(result.body.sports.length, 1);
  for (const key of ["matches", "players", "participants", "goals", "cards"]) assert.equal(result.body[key].length, 1, key);
}
const empty = (await call("data", noTeams)).body;
for (const items of Object.values(empty)) assert.deepEqual(items, []);
assert.equal((await call("data", multi)).body.teams.length, 2);
assert.equal((await call("data")).status, 401);
const goalB = sqlite.prepare("SELECT id FROM goals WHERE match_id = ?").get(matchB).id;
const cardB = sqlite.prepare("SELECT id FROM cards WHERE match_id = ?").get(matchB).id;
for (const payload of [
  { action: "addPlayer", teamId: teamB, name: "Forbidden" },
  { action: "updatePlayer", playerId: playerB, name: "Forbidden" },
  { action: "deletePlayer", playerId: playerB },
  { action: "createMatch", teamId: teamB },
  { action: "createCompetition", teamId: teamB },
  { action: "updateGoal", goalId: goalB, period: 1, side: "away" },
  { action: "deleteGoal", goalId: goalB },
  { action: "deleteCard", cardId: cardB },
  ...["updateMatch", "startMatch", "finishMatch", "addParticipant", "removeParticipant", "goal", "card", "resetMatch", "deleteMatch", "updateCardSettings"].map((action) => ({ action, matchId: matchB, playerId: playerB })),
  { action: "addSport", name: "Forbidden" }, { action: "addTeam", sportId: sports[0].id, name: "Forbidden" },
  { action: "updateTeam", teamId: teamA, name: "Forbidden" }, { action: "deleteTeam", teamId: teamA },
]) await mutate(coach, { ...payload, teamId: payload.teamId ?? teamA }, 403);
for (const action of ["addPlayer", "createMatch", "createCompetition", "goal", "card", "deleteCard", "updateCardSettings"]) await mutate(parent, { action, teamId: teamA, matchId: matchA }, 403);
assert.equal((await call("auth", coach, { action: "createUser", role: "coach", teamIds: [teamA] })).status, 403);
assert.equal((await call("auth", admin, { action: "createUser", name: "Bad", email: "bad@example.com", password, role: "admin", teamIds: [teamA] })).status, 400);
assert.equal((await call("auth", admin, { action: "createUser", name: "Bad", email: "bad@example.com", password, role: "parent", teamIds: [99999] })).status, 400);

const cup = await mutate(coach, { action: "createCompetition", teamId: teamA, name: "Testcup", kind: "cup", yellowEnabled: false, redEnabled: true, greenEnabled: false, matches: [1, 2].map((day) => ({ opponent: `Cup ${day}`, scheduledAt: `2026-10-0${day}T12:00:00Z`, periods: 3 })) });
const extra = (await mutate(coach, { action: "createMatch", teamId: teamA, competitionId: cup.competitionId, opponent: "Extra", scheduledAt: "2026-10-07T12:00:00Z", periods: 3, yellowEnabled: true, redEnabled: false })).matchId;
let cupMatches = (await call("data", coach)).body.matches.filter((match) => match.competitionId === cup.competitionId);
assert.equal(cupMatches.length, 3);
assert.ok(cupMatches.every((match) => match.yellowEnabled === 0 && match.redEnabled === 1 && match.greenEnabled === 0));
await mutate(coach, { action: "addParticipant", matchId: extra, playerId: playerA });
await mutate(coach, { action: "card", matchId: extra, period: 1, playerId: playerA, cardType: "yellow" }, 400);
await mutate(coach, { action: "card", matchId: extra, period: 1, playerId: playerA, cardType: "red" });
await mutate(coach, { action: "updateCardSettings", matchId: extra, yellowEnabled: true, redEnabled: false, greenEnabled: false }, 403);
await mutate(admin, { action: "updateCardSettings", matchId: extra, yellowEnabled: true, redEnabled: false, greenEnabled: false });
cupMatches = (await call("data", coach)).body.matches.filter((match) => match.competitionId === cup.competitionId);
assert.ok(cupMatches.every((match) => match.yellowEnabled === 1 && match.redEnabled === 0 && match.greenEnabled === 0));
await mutate(coach, { action: "card", matchId: extra, period: 1, playerId: playerA, cardType: "red" }, 400);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM cards WHERE match_id = ? AND card_type = 'red'").get(extra).total, 1);
await mutate(coach, { action: "updateCardSettings", matchId: matchA, yellowEnabled: false, redEnabled: false, greenEnabled: false });
assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM cards WHERE match_id = ?").get(matchA).total, 1);
async function editValues(matchId, overrides = {}) {
  const match = (await call("data", admin)).body.matches.find((match) => match.id === matchId);
  return { action: "updateMatch", matchId, teamId: match.teamId, competitionId: match.competitionId, homeName: match.homeName, opponent: match.opponent, scheduledAt: match.scheduledAt, venue: match.venue, periods: match.periods, status: match.status, yellowEnabled: match.yellowEnabled === 1, redEnabled: match.redEnabled === 1, greenEnabled: match.greenEnabled === 1, ...overrides };
}
await mutate(parent, await editValues(matchA), 403);
await mutate(coach, await editValues(matchA, { teamId: teamB }), 403);
await mutate(multi, await editValues(matchA, { teamId: teamB }), 409);
await mutate(coach, await editValues(matchA, { homeName: "Nytt lagnamn", opponent: "Ny motståndare", scheduledAt: "2026-11-12T17:30:00Z", venue: "Ny hall", periods: 2, status: "scheduled", yellowEnabled: true, redEnabled: true, greenEnabled: true }));
let edited = (await call("data", coach)).body.matches.find((match) => match.id === matchA);
assert.equal(edited.homeName, "Nytt lagnamn");
assert.equal(edited.opponent, "Ny motståndare");
assert.equal(edited.venue, "Ny hall");
assert.equal(edited.scheduledAt, "2026-11-12T17:30:00.000Z");
assert.equal(edited.periods, 2);
assert.equal(edited.status, "scheduled");
assert.equal(edited.greenEnabled, 1);
for (const table of ["goals", "cards", "participants"]) assert.equal(sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE match_id = ?`).get(matchA).total, 1);
await mutate(coach, { action: "card", matchId: matchA, period: 2, playerId: playerA, cardType: "green" });
await mutate(coach, await editValues(matchA, { periods: 3 }));
await mutate(coach, { action: "goal", matchId: matchA, period: 3, side: "home", playerId: playerA });
await mutate(coach, await editValues(matchA, { periods: 2, venue: "Must not save" }), 409);
assert.equal(sqlite.prepare("SELECT venue FROM matches WHERE id = ?").get(matchA).venue, "Ny hall");
for (const invalid of [{ scheduledAt: "invalid" }, { periods: 1 }, { opponent: "" }, { status: "invalid" }, { greenEnabled: "true" }, { competitionId: 99999 }]) await mutate(coach, await editValues(matchA, invalid), 400);
await mutate(coach, await editValues(extra, { greenEnabled: true }), 403);
await mutate(coach, await editValues(extra, { venue: "Cup hall" }));
await mutate(admin, await editValues(extra, { greenEnabled: true, yellowEnabled: false }));
assert.ok((await call("data", coach)).body.matches.filter((match) => match.competitionId === cup.competitionId).every((match) => match.greenEnabled === 1 && match.yellowEnabled === 0));
await mutate(coach, await editValues(extra, { competitionId: null, greenEnabled: false, redEnabled: true }));
assert.equal((await call("data", coach)).body.matches.find((match) => match.id === extra).competitionId, null);
await mutate(coach, await editValues(extra, { competitionId: cup.competitionId, greenEnabled: true, redEnabled: false, yellowEnabled: false }));
const movable = (await mutate(coach, { action: "createMatch", teamId: teamA, opponent: "Movable", scheduledAt: "2026-12-01T10:00:00Z", periods: 3 })).matchId;
await mutate(multi, await editValues(movable, { teamId: teamB, competitionId: cup.competitionId }), 400);
await mutate(multi, await editValues(movable, { teamId: teamB, homeName: "Innebandylag" }));
assert.equal((await call("data", admin)).body.matches.find((match) => match.id === movable).teamId, teamB);
await mutate(admin, await editValues(matchB, { venue: "Historik korrigerad" }));
assert.equal((await call("data", admin)).body.matches.find((match) => match.id === matchB).status, "completed");
await mutate(admin, await editValues(matchA, { matchId: 99999 }), 404);
const coachId = authState.body.user.id;
assert.equal((await call("auth", admin, { action: "updateUser", userId: coachId, name: "Former coach", email: "coach-1@example.com", role: "parent", teamIds: [teamB] })).status, 200);
assert.equal((await call("data", coach)).status, 401);
const changed = await login("coach-1@example.com");
assert.deepEqual((await call("data", changed)).body.teams.map((team) => team.id), [teamB]);
await mutate(changed, { action: "goal", matchId: matchB, side: "home", period: 1 }, 403);
assert.equal((await call("auth", admin, { action: "setUserActive", userId: coachId, active: false })).status, 200);
assert.equal((await call("data", changed)).status, 401);
const adminId = (await call("auth", admin)).body.user.id;
assert.equal((await call("auth", parent, { action: "deleteUser", userId: coachId })).status, 403);
assert.equal((await call("auth", multi, { action: "deleteUser", userId: coachId })).status, 403);
assert.equal((await call("auth", admin, { action: "deleteUser", userId: adminId })).status, 403);
assert.equal((await call("auth", admin, { action: "deleteUser", userId: -1 })).status, 400);
assert.equal((await call("auth", admin, { action: "deleteUser", userId: 99999 })).status, 404);
const beforeData = (await call("data", admin)).body;
assert.equal((await call("auth", admin, { action: "deleteUser", userId: coachId })).status, 200);
assert.equal(sqlite.prepare("SELECT id FROM users WHERE id = ?").get(coachId), undefined);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM user_teams WHERE user_id = ?").get(coachId).total, 0);
const parentId = (await call("auth", parent)).body.user.id;
assert.equal((await call("auth", admin, { action: "deleteUser", userId: parentId })).status, 200);
assert.equal((await call("data", parent)).status, 401);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?").get(parentId).total, 0);
assert.equal((await call("auth", "", { action: "login", email: "parent-1@example.com", password })).status, 401);
assert.deepEqual((await call("data", admin)).body, beforeData);
assert.equal((await call("auth", admin, { action: "createUser", name: "Replacement", email: "parent-1@example.com", password, role: "parent", teamIds: [] })).status, 201);
const activeCoachId = (await call("auth", multi)).body.user.id;
assert.equal((await call("auth", admin, { action: "setUserActive", userId: activeCoachId, active: false })).status, 200);
assert.equal((await call("auth", admin, { action: "setUserActive", userId: activeCoachId, active: true })).status, 200);
const activeCoach = await login("coach-2@example.com");
assert.equal((await call("auth", admin, { action: "deleteUser", userId: activeCoachId })).status, 200);
assert.equal((await call("data", activeCoach)).status, 401);
console.log("Passed: SQL migrations, account roles, team isolation, all mutation ownership checks, read-only parents, card choices, cup inheritance, retained history, session revocation.");
sqlite.close();
