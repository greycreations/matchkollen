import { env } from "cloudflare:workers";
import { getAuthUser, hasPermission, isSameOrigin, type PermissionAction, type PermissionArea } from "@/lib/auth";

export const dynamic = "force-dynamic";

function database() {
  if (!env.DB) throw new Error("Databasen är inte tillgänglig just nu. Försök igen om en liten stund.");
  return env.DB;
}

function message(error: unknown) {
  const value = error instanceof Error ? error.message : "Okänt fel";
  if (value.includes("no such table")) return "Matchdatabasen är inte färdig än. Ladda om sidan om en liten stund.";
  return value;
}

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return Response.json({ error: "Logga in för att visa matchdata." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const db = database();
    const [sports, teams, players, matches, participants, goals] = await Promise.all([
      db.prepare("SELECT id, name FROM sports ORDER BY name").all(),
      db.prepare("SELECT teams.id, teams.sport_id AS sportId, teams.name, teams.group_name AS groupName, teams.active, sports.name AS sportName FROM teams JOIN sports ON sports.id = teams.sport_id ORDER BY sports.name, teams.group_name, teams.name").all(),
      db.prepare("SELECT id, team_id AS teamId, name, number, active FROM players ORDER BY name").all(),
      db.prepare("SELECT id, team_id AS teamId, home_name AS homeName, opponent, scheduled_at AS scheduledAt, venue, periods, status FROM matches ORDER BY scheduled_at DESC").all(),
      db.prepare("SELECT participants.id, participants.match_id AS matchId, participants.player_id AS playerId, players.name AS playerName, players.number, players.active FROM participants JOIN players ON players.id = participants.player_id ORDER BY players.number, players.name").all(),
      db.prepare("SELECT goals.id, goals.match_id AS matchId, goals.period, goals.side, goals.player_id AS playerId, goals.player_name AS playerName, goals.number, goals.created_at AS createdAt FROM goals ORDER BY goals.id").all(),
    ]);
    return Response.json({ sports: sports.results, teams: teams.results, players: players.results, matches: matches.results, participants: participants.results, goals: goals.results });
  } catch (error) {
    console.error("Matchkollen load failed", error);
    return Response.json({ error: message(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const db = database();
    const actor = await getAuthUser(request);
    if (!actor) return Response.json({ error: "Logga in för att spara ändringar." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (!isSameOrigin(request)) return Response.json({ error: "Begäran avvisades." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const id = (key: string) => Number(body[key]);
    const string = (key: string) => typeof body[key] === "string" ? String(body[key]).trim() : "";
    const permissionByAction: Record<string, [PermissionArea, PermissionAction]> = {
      addSport: ["teams", "create"], updateSport: ["teams", "edit"], deleteSport: ["teams", "delete"], addTeam: ["teams", "create"], updateTeam: ["teams", "edit"], deleteTeam: ["teams", "delete"],
      addPlayer: ["players", "create"], updatePlayer: ["players", "edit"], deletePlayer: ["players", "delete"],
      createMatch: ["matches", "create"], updateMatch: ["matches", "edit"], startMatch: ["matches", "edit"], finishMatch: ["matches", "edit"],
      addParticipant: ["matches", "edit"], removeParticipant: ["matches", "edit"], deleteMatch: ["matches", "delete"],
      goal: ["scores", "create"], updateGoal: ["scores", "edit"], deleteGoal: ["scores", "delete"], resetMatch: ["scores", "delete"],
    };
    const permission = permissionByAction[action];
    if (!permission) return Response.json({ error: "Okänd åtgärd." }, { status: 400 });
    if (!hasPermission(actor, permission[0], permission[1])) return Response.json({ error: "Ditt konto saknar behörighet för den här åtgärden." }, { status: 403 });

    if (action === "addSport") {
      const name = string("name");
      if (!name) return Response.json({ error: "Skriv ett namn på sporten." }, { status: 400 });
      const result = await db.prepare("INSERT OR IGNORE INTO sports (name) VALUES (?)").bind(name).run();
      return Response.json({ success: true, changed: result.meta.changes > 0 });
    }
    if (action === "updateSport") {
      const sportId = id("sportId"), name = string("name");
      if (!sportId || !name) return Response.json({ error: "Sportens namn kan inte vara tomt." }, { status: 400 });
      await db.prepare("UPDATE sports SET name = ? WHERE id = ?").bind(name, sportId).run();
      return Response.json({ success: true });
    }
    if (action === "deleteSport") {
      const sportId = id("sportId");
      const teamsExist = await db.prepare("SELECT id FROM teams WHERE sport_id = ? LIMIT 1").bind(sportId).first<{ id: number }>();
      if (teamsExist) return Response.json({ error: "Sporten används av ett eller flera lag. Ta bort lagen först." }, { status: 409 });
      await db.prepare("DELETE FROM sports WHERE id = ?").bind(sportId).run();
      return Response.json({ success: true });
    }
    if (action === "addTeam") {
      const sportId = id("sportId"), name = string("name"), groupName = string("groupName");
      if (!sportId || !name) return Response.json({ error: "Välj sport och ange lagnamn." }, { status: 400 });
      await db.prepare("INSERT INTO teams (sport_id, name, group_name, active) VALUES (?, ?, ?, 1)").bind(sportId, name, groupName).run();
      return Response.json({ success: true });
    }
    if (action === "updateTeam") {
      const teamId = id("teamId"), name = string("name"), groupName = string("groupName");
      if (!teamId || !name) return Response.json({ error: "Lagnamnet kan inte vara tomt." }, { status: 400 });
      await db.prepare("UPDATE teams SET name = ?, group_name = ?, active = 1 WHERE id = ?").bind(name, groupName, teamId).run();
      return Response.json({ success: true });
    }
    if (action === "deleteTeam") {
      const teamId = id("teamId");
      await db.batch([
        db.prepare("UPDATE teams SET active = 0 WHERE id = ?").bind(teamId),
        db.prepare("UPDATE players SET active = 0 WHERE team_id = ?").bind(teamId),
      ]);
      return Response.json({ success: true });
    }
    if (action === "addPlayer") {
      const teamId = id("teamId"), name = string("name"), number = body.number === null || body.number === "" ? null : Number(body.number);
      if (!teamId || !name) return Response.json({ error: "Välj lag och ange spelarens namn." }, { status: 400 });
      const team = await db.prepare("SELECT id FROM teams WHERE id = ? AND active = 1").bind(teamId).first<{ id: number }>();
      if (!team) return Response.json({ error: "Det valda laget hittades inte." }, { status: 404 });
      await db.prepare("INSERT INTO players (team_id, name, number, active) VALUES (?, ?, ?, 1)").bind(teamId, name, number).run();
      return Response.json({ success: true });
    }
    if (action === "updatePlayer") {
      const playerId = id("playerId"), name = string("name"), number = body.number === null || body.number === "" ? null : Number(body.number);
      if (!playerId || !name) return Response.json({ error: "Spelarens namn kan inte vara tomt." }, { status: 400 });
      await db.prepare("UPDATE players SET name = ?, number = ?, active = 1 WHERE id = ?").bind(name, number, playerId).run();
      return Response.json({ success: true });
    }
    if (action === "deletePlayer") {
      const playerId = id("playerId");
      await db.prepare("UPDATE players SET active = 0 WHERE id = ?").bind(playerId).run();
      return Response.json({ success: true });
    }
    if (action === "createMatch") {
      const teamId = id("teamId"), opponent = string("opponent"), homeName = string("homeName"), venue = string("venue");
      const scheduledAt = string("scheduledAt"), periods = Math.min(3, Math.max(2, Number(body.periods)));
      if (!teamId || !opponent || !scheduledAt) return Response.json({ error: "Lag, motståndare samt datum och tid behövs." }, { status: 400 });
      const team = await db.prepare("SELECT name FROM teams WHERE id = ? AND active = 1").bind(teamId).first<{ name: string }>();
      if (!team) return Response.json({ error: "Det valda laget hittades inte." }, { status: 404 });
      const result = await db.prepare("INSERT INTO matches (team_id, home_name, opponent, scheduled_at, venue, periods, status) VALUES (?, ?, ?, ?, ?, ?, 'scheduled')").bind(teamId, homeName || team.name, opponent, new Date(scheduledAt).toISOString(), venue, periods).run();
      return Response.json({ success: true, matchId: result.meta.last_row_id });
    }
    if (action === "updateMatch") {
      const matchId = id("matchId"), homeName = string("homeName"), opponent = string("opponent");
      await db.prepare("UPDATE matches SET home_name = ?, opponent = ? WHERE id = ?").bind(homeName, opponent, matchId).run();
      return Response.json({ success: true });
    }
    if (action === "startMatch") {
      await db.prepare("UPDATE matches SET status = 'live' WHERE id = ?").bind(id("matchId")).run();
      return Response.json({ success: true });
    }
    if (action === "finishMatch") {
      await db.prepare("UPDATE matches SET status = 'completed' WHERE id = ?").bind(id("matchId")).run();
      return Response.json({ success: true });
    }
    if (action === "addParticipant" || action === "removeParticipant") {
      const matchId = id("matchId"), playerId = id("playerId");
      if (action === "addParticipant") {
        const eligible = await db.prepare("SELECT players.id FROM players JOIN teams ON teams.id = players.team_id JOIN matches ON matches.team_id = teams.id WHERE players.id = ? AND matches.id = ? AND players.active = 1 AND teams.active = 1").bind(playerId, matchId).first<{ id: number }>();
        if (!eligible) return Response.json({ error: "Spelaren tillhör inte matchens aktiva trupp." }, { status: 400 });
        await db.prepare("INSERT OR IGNORE INTO participants (match_id, player_id) VALUES (?, ?)").bind(matchId, playerId).run();
      }
      else await db.prepare("DELETE FROM participants WHERE match_id = ? AND player_id = ?").bind(matchId, playerId).run();
      return Response.json({ success: true });
    }
    if (action === "goal") {
      const matchId = id("matchId"), period = id("period"), side = string("side");
      if (!matchId || !period || !["home", "away"].includes(side)) return Response.json({ error: "Ogiltig målregistrering." }, { status: 400 });
      const match = await db.prepare("SELECT periods FROM matches WHERE id = ?").bind(matchId).first<{ periods: number }>();
      if (!match) return Response.json({ error: "Matchen hittades inte." }, { status: 404 });
      if (period > match.periods) return Response.json({ error: `Matchen har bara ${match.periods} perioder.` }, { status: 400 });
      const playerId = body.playerId ? Number(body.playerId) : null;
      let playerName: string | null = null, number: number | null = null;
      if (playerId !== null) {
        const player = await db.prepare("SELECT players.name, players.number FROM players JOIN participants ON participants.player_id = players.id WHERE players.id = ? AND participants.match_id = ? AND players.active = 1").bind(playerId, matchId).first<{ name: string; number: number | null }>();
        if (!player) return Response.json({ error: "Spelaren måste vara aktiv och vald till matchtruppen." }, { status: 400 });
        playerName = player.name; number = player.number;
      }
      await db.prepare("INSERT INTO goals (match_id, period, side, player_id, player_name, number) VALUES (?, ?, ?, ?, ?, ?)").bind(matchId, period, side, playerId, playerName, number).run();
      await db.prepare("UPDATE matches SET status = 'live' WHERE id = ?").bind(matchId).run();
      return Response.json({ success: true });
    }
    if (action === "updateGoal") {
      const goalId = id("goalId"), period = id("period"), side = string("side");
      if (!goalId || !period || !["home", "away"].includes(side)) return Response.json({ error: "Kontrollera period och lag." }, { status: 400 });
      const goal = await db.prepare("SELECT goals.match_id AS matchId, matches.periods FROM goals JOIN matches ON matches.id = goals.match_id WHERE goals.id = ?").bind(goalId).first<{ matchId: number; periods: number }>();
      if (!goal) return Response.json({ error: "Matchhändelsen hittades inte." }, { status: 404 });
      if (period > goal.periods) return Response.json({ error: `Matchen har bara ${goal.periods} perioder.` }, { status: 400 });
      await db.prepare("UPDATE goals SET period = ?, side = ? WHERE id = ?").bind(period, side, goalId).run();
      return Response.json({ success: true });
    }
    if (action === "deleteGoal") {
      await db.prepare("DELETE FROM goals WHERE id = ?").bind(id("goalId")).run();
      return Response.json({ success: true });
    }
    if (action === "resetMatch") {
      await db.prepare("DELETE FROM goals WHERE match_id = ?").bind(id("matchId")).run();
      return Response.json({ success: true });
    }
    if (action === "deleteMatch") {
      const matchId = id("matchId");
      await db.batch([
        db.prepare("DELETE FROM goals WHERE match_id = ?").bind(matchId),
        db.prepare("DELETE FROM participants WHERE match_id = ?").bind(matchId),
        db.prepare("DELETE FROM matches WHERE id = ?").bind(matchId),
      ]);
      return Response.json({ success: true });
    }
    return Response.json({ error: "Okänd åtgärd." }, { status: 400 });
  } catch (error) {
    console.error("Matchkollen save failed", error);
    return Response.json({ error: message(error) }, { status: 503 });
  }
}
