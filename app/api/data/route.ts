import { auditedDatabase } from "@/lib/activity-log";
import { env } from "cloudflare:workers";
import { canAccessTeam, getAuthUser, hasPermission, isSameOrigin, type PermissionAction, type PermissionArea } from "@/lib/auth";

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
    const [sports, teams, players, competitions, matches, participants, goals, cards] = await Promise.all([
      db.prepare("SELECT id, name FROM sports ORDER BY name").all(),
      db.prepare("SELECT teams.id, teams.sport_id AS sportId, teams.name, teams.group_name AS groupName, teams.active, sports.name AS sportName FROM teams JOIN sports ON sports.id = teams.sport_id ORDER BY sports.name, teams.group_name, teams.name").all(),
      db.prepare("SELECT players.id, players.team_id AS teamId, players.profile_id AS profileId, CASE WHEN player_profiles.photo IS NULL THEN 0 ELSE player_profiles.photo_revision END AS photoRevision, players.name, players.number, CASE WHEN player_profiles.active = 1 THEN players.active ELSE 0 END AS active FROM players LEFT JOIN player_profiles ON player_profiles.id = players.profile_id ORDER BY players.name").all(),
      db.prepare("SELECT id, team_id AS teamId, name, kind, yellow_enabled AS yellowEnabled, red_enabled AS redEnabled, green_enabled AS greenEnabled, created_at AS createdAt FROM competitions ORDER BY created_at DESC, name").all(),
      db.prepare("SELECT matches.id, matches.team_id AS teamId, matches.competition_id AS competitionId, competitions.name AS competitionName, competitions.kind AS competitionKind, matches.home_name AS homeName, matches.opponent, matches.scheduled_at AS scheduledAt, matches.venue, matches.periods, matches.status, COALESCE(competitions.yellow_enabled, matches.yellow_enabled) AS yellowEnabled, COALESCE(competitions.red_enabled, matches.red_enabled) AS redEnabled, COALESCE(competitions.green_enabled, matches.green_enabled) AS greenEnabled FROM matches LEFT JOIN competitions ON competitions.id = matches.competition_id ORDER BY matches.scheduled_at DESC").all(),
      db.prepare("SELECT participants.id, participants.match_id AS matchId, participants.player_id AS playerId, players.name AS playerName, players.number, CASE WHEN player_profiles.active = 1 THEN players.active ELSE 0 END AS active FROM participants JOIN players ON players.id = participants.player_id JOIN player_profiles ON player_profiles.id = players.profile_id ORDER BY players.number, players.name").all(),
      db.prepare("SELECT goals.id, goals.match_id AS matchId, goals.period, goals.side, goals.player_id AS playerId, goals.player_name AS playerName, goals.number, goals.created_at AS createdAt FROM goals ORDER BY goals.id").all(),
      db.prepare("SELECT cards.id, cards.match_id AS matchId, cards.period, cards.player_id AS playerId, cards.card_type AS cardType, cards.created_at AS createdAt, COALESCE(cards.player_name, players.name) AS playerName, COALESCE(cards.number, players.number) AS number FROM cards LEFT JOIN players ON players.id = cards.player_id ORDER BY cards.id").all(),
    ]);
    const visibleTeams = teams.results.filter((team) => canAccessTeam(user, Number(team.id)));
    const teamIds = new Set(visibleTeams.map((team) => team.id));
    const sportIds = new Set(visibleTeams.map((team) => team.sportId));
    const visibleMatches = matches.results.filter((match) => teamIds.has(match.teamId));
    const matchIds = new Set(visibleMatches.map((match) => match.id));
    return Response.json({
      sports: sports.results.filter((sport) => user.role === "admin" || sportIds.has(sport.id)),
      teams: visibleTeams, players: players.results.filter((player) => teamIds.has(player.teamId)),
      competitions: competitions.results.filter((competition) => teamIds.has(competition.teamId)), matches: visibleMatches,
      participants: participants.results.filter((item) => matchIds.has(item.matchId)),
      goals: goals.results.filter((item) => matchIds.has(item.matchId)), cards: cards.results.filter((item) => matchIds.has(item.matchId)),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Matchkollen load failed", error);
    return Response.json({ error: message(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    let db = database();
    const actor = await getAuthUser(request);
    if (!actor) return Response.json({ error: "Logga in för att spara ändringar." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (!isSameOrigin(request)) return Response.json({ error: "Säkerhetskontrollen stoppade begäran eftersom webbadressen inte matchar appens adress. Kontrollera att din proxy skickar vidare Host, X-Forwarded-Host och X-Forwarded-Proto." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const id = (key: string) => Number(body[key]);
    const string = (key: string) => typeof body[key] === "string" ? String(body[key]).trim() : "";
    const permissionByAction: Record<string, [PermissionArea, PermissionAction]> = {
      addSport: ["teams", "create"], updateSport: ["teams", "edit"], deleteSport: ["teams", "delete"], addTeam: ["teams", "create"], updateTeam: ["teams", "edit"], deleteTeam: ["teams", "delete"],
      addPlayer: ["players", "create"], updatePlayer: ["players", "edit"], deletePlayer: ["players", "delete"],
      createMatch: ["matches", "create"], createCompetition: ["matches", "create"], updateCardSettings: ["matches", "edit"], updateMatch: ["matches", "edit"], startMatch: ["matches", "edit"], returnToScheduled: ["matches", "edit"], finishMatch: ["matches", "edit"],
      addParticipant: ["matches", "edit"], removeParticipant: ["matches", "edit"], deleteMatch: ["matches", "delete"],
      goal: ["scores", "create"], card: ["scores", "create"], updateGoal: ["scores", "edit"], deleteGoal: ["scores", "delete"], deleteCard: ["scores", "delete"], resetMatch: ["scores", "delete"],
    };
    const permission = permissionByAction[action];
    if (!permission) return Response.json({ error: "Okänd åtgärd." }, { status: 400 });
    if (!hasPermission(actor, permission[0], permission[1])) return Response.json({ error: "Ditt konto saknar behörighet för den här åtgärden." }, { status: 403 });

    // Resolve ownership from stored records, never from a supplied teamId for existing data.
    if (actor.role !== "admin") {
      let teamId: number | undefined;
      if (["addPlayer", "createMatch", "createCompetition"].includes(action)) teamId = id("teamId");
      else if (["updatePlayer", "deletePlayer"].includes(action)) {
        teamId = (await db.prepare("SELECT team_id AS teamId FROM players WHERE id = ?").bind(id("playerId")).first<{ teamId: number }>())?.teamId;
      } else if (["updateGoal", "deleteGoal"].includes(action)) {
        teamId = (await db.prepare("SELECT matches.team_id AS teamId FROM goals JOIN matches ON matches.id = goals.match_id WHERE goals.id = ?").bind(id("goalId")).first<{ teamId: number }>())?.teamId;
      } else if (action === "deleteCard") {
        teamId = (await db.prepare("SELECT matches.team_id AS teamId FROM cards JOIN matches ON matches.id = cards.match_id WHERE cards.id = ?").bind(id("cardId")).first<{ teamId: number }>())?.teamId;
      } else {
        const match = await db.prepare("SELECT team_id AS teamId, competition_id AS competitionId FROM matches WHERE id = ?").bind(id("matchId")).first<{ teamId: number; competitionId: number | null }>();
        if (action === "updateCardSettings" && match?.competitionId) return Response.json({ error: "Endast admin kan ändra cupens gemensamma kortval." }, { status: 403 });
        teamId = match?.teamId;
      }
      if (teamId === undefined || !canAccessTeam(actor, teamId)) return Response.json({ error: "Du har inte tillgång till det här laget." }, { status: 403 });
    }
    db = await auditedDatabase(db, actor, action, body, "data");
    const cardSettings = [body.yellowEnabled === false ? 0 : 1, body.redEnabled === false ? 0 : 1, body.greenEnabled === false ? 0 : 1];
    if (action === "updateCardSettings") {
      if (["yellowEnabled", "redEnabled", "greenEnabled"].some((key) => typeof body[key] !== "boolean")) return Response.json({ error: "Välj vilka kort som ska användas." }, { status: 400 });
      const match = await db.prepare("SELECT competition_id AS competitionId FROM matches WHERE id = ?").bind(id("matchId")).first<{ competitionId: number | null }>();
      if (!match) return Response.json({ error: "Matchen hittades inte." }, { status: 404 });
      if (match.competitionId) await db.prepare("UPDATE competitions SET yellow_enabled = ?, red_enabled = ?, green_enabled = ? WHERE id = ?").bind(...cardSettings, match.competitionId).run();
      else await db.prepare("UPDATE matches SET yellow_enabled = ?, red_enabled = ?, green_enabled = ? WHERE id = ?").bind(...cardSettings, id("matchId")).run();
      return Response.json({ success: true });
    }

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
      if (name.length > 100 || (number !== null && (!Number.isInteger(number) || number < 0 || number > 999))) return Response.json({ error: "Kontrollera namn och tröjnummer." }, { status: 400 });
      if (body.parentIds !== undefined && (!Array.isArray(body.parentIds) || body.parentIds.some((id) => !Number.isInteger(id) || Number(id) < 1))) return Response.json({ error: "Välj giltiga föräldrar." }, { status: 400 });
      const parentIds = [...new Set((body.parentIds ?? []) as number[])];
      if (parentIds.length && actor.role !== "admin") return Response.json({ error: "Endast admin kan koppla föräldrakonton." }, { status: 403 });
      const parents = await db.prepare("SELECT id FROM users WHERE role IN ('parent', 'coach')").all<{ id: number }>();
      if (parentIds.some((id) => !parents.results.some((parent) => parent.id === id))) return Response.json({ error: "Ett föräldrakonto saknas." }, { status: 400 });
      await db.batch([
        db.prepare("INSERT INTO player_profiles (name) VALUES (?)").bind(name),
        db.prepare("INSERT INTO players (team_id, profile_id, name, number, active) VALUES (?, last_insert_rowid(), ?, ?, 1)").bind(teamId, name, number),
        ...parentIds.map((userId) => db.prepare("INSERT INTO parent_children (user_id, profile_id) SELECT ?, MAX(id) FROM player_profiles").bind(userId)),
      ]);
      return Response.json({ success: true });
    }
    if (action === "updatePlayer") {
      const playerId = id("playerId"), name = string("name"), number = body.number === null || body.number === "" ? null : Number(body.number);
      if (!playerId || !name) return Response.json({ error: "Spelarens namn kan inte vara tomt." }, { status: 400 });
      if (name.length > 100 || (number !== null && (!Number.isInteger(number) || number < 0 || number > 999))) return Response.json({ error: "Kontrollera namn och tröjnummer." }, { status: 400 });
      await db.batch([
        db.prepare("UPDATE player_profiles SET name = ? WHERE id = (SELECT profile_id FROM players WHERE id = ?)").bind(name, playerId),
        db.prepare("UPDATE players SET name = ? WHERE profile_id = (SELECT profile_id FROM players WHERE id = ?)").bind(name, playerId),
        db.prepare("UPDATE players SET number = ?, active = 1 WHERE id = ?").bind(number, playerId),
      ]);
      return Response.json({ success: true });
    }
    if (action === "deletePlayer") {
      const playerId = id("playerId");
      await db.prepare("UPDATE players SET active = 0 WHERE id = ?").bind(playerId).run();
      return Response.json({ success: true });
    }
    if (action === "createMatch") {
      const teamId = id("teamId"), opponent = string("opponent"), homeName = string("homeName"), venue = string("venue"), competitionId = body.competitionId ? Number(body.competitionId) : null;
      const scheduledAt = string("scheduledAt"), periods = Math.min(3, Math.max(2, Number(body.periods)));
      if (!teamId || !opponent || !Number.isFinite(new Date(scheduledAt).getTime()) || ![2, 3].includes(periods)) return Response.json({ error: "Lag, motståndare samt datum och tid behövs." }, { status: 400 });
      const team = await db.prepare("SELECT name FROM teams WHERE id = ? AND active = 1").bind(teamId).first<{ name: string }>();
      if (!team) return Response.json({ error: "Det valda laget hittades inte." }, { status: 404 });
      if (competitionId) {
        const competition = await db.prepare("SELECT id FROM competitions WHERE id = ? AND team_id = ?").bind(competitionId, teamId).first<{ id: number }>();
        if (!competition) return Response.json({ error: "Cupen eller sammandraget tillhör inte det valda laget." }, { status: 400 });
      }
      const result = await db.prepare("INSERT INTO matches (team_id, competition_id, home_name, opponent, scheduled_at, venue, periods, yellow_enabled, red_enabled, green_enabled, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')").bind(teamId, competitionId, homeName || team.name, opponent, new Date(scheduledAt).toISOString(), venue, periods, ...cardSettings).run();
      return Response.json({ success: true, matchId: result.meta.last_row_id });
    }
    if (action === "createCompetition") {
      const teamId = id("teamId"), name = string("name"), kind = string("kind");
      const entries = Array.isArray(body.matches) ? body.matches as Record<string, unknown>[] : [];
      if (!teamId || !name || !["cup", "sammandrag"].includes(kind) || entries.length < 1) return Response.json({ error: "Välj lag, ange namn och lägg till minst en match." }, { status: 400 });
      const team = await db.prepare("SELECT name FROM teams WHERE id = ? AND active = 1").bind(teamId).first<{ name: string }>();
      if (!team) return Response.json({ error: "Det valda laget hittades inte." }, { status: 404 });
      const preparedMatches = entries.map((entry) => {
        const opponent = typeof entry.opponent === "string" ? entry.opponent.trim() : "";
        const scheduledAt = typeof entry.scheduledAt === "string" ? entry.scheduledAt : "";
        const venue = typeof entry.venue === "string" ? entry.venue.trim() : "";
        const periods = Math.min(3, Math.max(2, Number(entry.periods)));
        if (!opponent || !scheduledAt || !Number.isFinite(new Date(scheduledAt).getTime()) || ![2, 3].includes(periods)) return null;
        return { opponent, scheduledAt: new Date(scheduledAt).toISOString(), venue, periods };
      });
      if (preparedMatches.some((match) => match === null)) return Response.json({ error: "Varje match behöver motståndare, giltigt datum och tid samt två eller tre perioder." }, { status: 400 });
      const created = await db.prepare("INSERT INTO competitions (team_id, name, kind, yellow_enabled, red_enabled, green_enabled) VALUES (?, ?, ?, ?, ?, ?)").bind(teamId, name, kind, ...cardSettings).run();
      const competitionId = Number(created.meta.last_row_id);
      await db.batch(preparedMatches.map((match) => db.prepare("INSERT INTO matches (team_id, competition_id, home_name, opponent, scheduled_at, venue, periods, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')").bind(teamId, competitionId, team.name, match!.opponent, match!.scheduledAt, match!.venue, match!.periods)));
      return Response.json({ success: true, competitionId, matchCount: preparedMatches.length });
    }
    if (action === "updateMatch") {
      const matchId = id("matchId"), teamId = id("teamId"), homeName = string("homeName"), opponent = string("opponent"), venue = string("venue"), scheduledAt = string("scheduledAt"), periods = id("periods"), status = string("status");
      const competitionId = body.competitionId === null || body.competitionId === "" ? null : id("competitionId");
      if (!Number.isInteger(teamId) || teamId < 1 || !homeName || !opponent || !Number.isFinite(new Date(scheduledAt).getTime()) || ![2, 3].includes(periods) || !["scheduled", "live", "completed"].includes(status) || (competitionId !== null && (!Number.isInteger(competitionId) || competitionId < 1)) || ["yellowEnabled", "redEnabled", "greenEnabled"].some((key) => typeof body[key] !== "boolean")) return Response.json({ error: "Kontrollera lag, lagnamn, motståndare, datum, perioder, status och kortval." }, { status: 400 });
      const existing = await db.prepare("SELECT team_id AS teamId FROM matches WHERE id = ?").bind(matchId).first<{ teamId: number }>();
      if (!existing) return Response.json({ error: "Matchen hittades inte." }, { status: 404 });
      if (!canAccessTeam(actor, teamId)) return Response.json({ error: "Du har inte tillgång till det valda laget." }, { status: 403 });
      const targetTeam = await db.prepare("SELECT id, active FROM teams WHERE id = ?").bind(teamId).first<{ id: number; active: number }>();
      if (!targetTeam || (targetTeam.active !== 1 && teamId !== existing.teamId)) return Response.json({ error: "Det valda laget är inte aktivt." }, { status: 400 });
      if (teamId !== existing.teamId) {
        const related = await db.prepare("SELECT (SELECT COUNT(*) FROM participants WHERE match_id = ?) + (SELECT COUNT(*) FROM goals WHERE match_id = ?) + (SELECT COUNT(*) FROM cards WHERE match_id = ?) AS total").bind(matchId, matchId, matchId).first<{ total: number }>();
        if (related?.total) return Response.json({ error: "Laget kan inte bytas när matchen har matchtrupp, mål eller kort. Ta bort dessa uppgifter först om du vill byta lag." }, { status: 409 });
      }
      const lastPeriod = await db.prepare("SELECT MAX(period) AS period FROM (SELECT period FROM goals WHERE match_id = ? UNION ALL SELECT period FROM cards WHERE match_id = ?)").bind(matchId, matchId).first<{ period: number | null }>();
      if ((lastPeriod?.period ?? 0) > periods) return Response.json({ error: "Periodantalet kan inte minskas eftersom det finns mål eller kort i en senare period." }, { status: 409 });
      if (competitionId !== null) {
        const competition = await db.prepare("SELECT team_id AS teamId, yellow_enabled AS yellowEnabled, red_enabled AS redEnabled, green_enabled AS greenEnabled FROM competitions WHERE id = ?").bind(competitionId).first<{ teamId: number; yellowEnabled: number; redEnabled: number; greenEnabled: number }>();
        if (!competition || competition.teamId !== teamId) return Response.json({ error: "Cupen eller sammandraget tillhör inte det valda laget." }, { status: 400 });
        if (actor.role !== "admin" && cardSettings.some((value, index) => value !== [competition.yellowEnabled, competition.redEnabled, competition.greenEnabled][index])) return Response.json({ error: "Endast admin kan ändra cupens gemensamma kortval." }, { status: 403 });
      }
      let participantIds: number[] | undefined;
      if (body.participantIds !== undefined) {
        if (!Array.isArray(body.participantIds) || body.participantIds.some((value) => !Number.isInteger(value) || Number(value) < 1)) return Response.json({ error: "Välj giltiga spelare." }, { status: 400 });
        participantIds = [...new Set(body.participantIds as number[])];
        const eligible = await db.prepare("SELECT players.id FROM players JOIN player_profiles ON player_profiles.id = players.profile_id WHERE players.team_id = ? AND ((players.active = 1 AND player_profiles.active = 1) OR players.id IN (SELECT player_id FROM participants WHERE match_id = ?))").bind(teamId, matchId).all<{ id: number }>();
        if (participantIds.some((value) => !eligible.results.some((row) => row.id === value))) return Response.json({ error: "En vald spelare är inaktiv eller tillhör ett annat lag." }, { status: 400 });
      }
      const statements = [db.prepare("UPDATE matches SET team_id = ?, competition_id = ?, home_name = ?, opponent = ?, scheduled_at = ?, venue = ?, periods = ?, status = ?, yellow_enabled = ?, red_enabled = ?, green_enabled = ? WHERE id = ?").bind(teamId, competitionId, homeName, opponent, new Date(scheduledAt).toISOString(), venue, periods, status, ...cardSettings, matchId)];
      if (competitionId !== null && actor.role === "admin") statements.push(db.prepare("UPDATE competitions SET yellow_enabled = ?, red_enabled = ?, green_enabled = ? WHERE id = ?").bind(...cardSettings, competitionId));
      if (participantIds !== undefined) statements.push(db.prepare("DELETE FROM participants WHERE match_id = ?").bind(matchId), ...participantIds.map((playerId) => db.prepare("INSERT INTO participants (match_id, player_id) VALUES (?, ?)").bind(matchId, playerId)));
      await db.batch(statements);
      return Response.json({ success: true });
    }
    if (action === "startMatch") {
      await db.prepare("UPDATE matches SET status = 'live' WHERE id = ?").bind(id("matchId")).run();
      return Response.json({ success: true });
    }
    if (action === "returnToScheduled") {
      const result = await db.prepare("UPDATE matches SET status = 'scheduled' WHERE id = ? AND status = 'live'").bind(id("matchId")).run();
      if (result.meta.changes !== 1) return Response.json({ error: "Endast en pågående match kan återställas till planerad." }, { status: 409 });
      return Response.json({ success: true });
    }
    if (action === "finishMatch") {
      await db.prepare("UPDATE matches SET status = 'completed' WHERE id = ?").bind(id("matchId")).run();
      return Response.json({ success: true });
    }
    if (action === "addParticipant" || action === "removeParticipant") {
      const matchId = id("matchId"), playerId = id("playerId");
      if (action === "addParticipant") {
        const eligible = await db.prepare("SELECT players.id FROM players JOIN teams ON teams.id = players.team_id JOIN matches ON matches.team_id = teams.id WHERE players.id = ? AND matches.id = ? AND players.active = 1 AND players.profile_id IN (SELECT id FROM player_profiles WHERE active = 1) AND teams.active = 1").bind(playerId, matchId).first<{ id: number }>();
        if (!eligible) return Response.json({ error: "Spelaren tillhör inte matchens aktiva trupp." }, { status: 400 });
        await db.prepare("INSERT OR IGNORE INTO participants (match_id, player_id) VALUES (?, ?)").bind(matchId, playerId).run();
      }
      else await db.prepare("DELETE FROM participants WHERE match_id = ? AND player_id = ?").bind(matchId, playerId).run();
      return Response.json({ success: true });
    }
    if (action === "goal") {
      const matchId = id("matchId"), period = id("period"), side = string("side");
      if (!matchId || !Number.isInteger(period) || period < 1 || !["home", "away"].includes(side)) return Response.json({ error: "Ogiltig målregistrering." }, { status: 400 });
      const match = await db.prepare("SELECT periods FROM matches WHERE id = ?").bind(matchId).first<{ periods: number }>();
      if (!match) return Response.json({ error: "Matchen hittades inte." }, { status: 404 });
      if (period > match.periods) return Response.json({ error: `Matchen har bara ${match.periods} perioder.` }, { status: 400 });
      const playerId = body.playerId ? Number(body.playerId) : null;
      let playerName: string | null = null, number: number | null = null;
      if (playerId !== null) {
        const player = await db.prepare("SELECT players.name, players.number FROM players JOIN participants ON participants.player_id = players.id WHERE players.id = ? AND participants.match_id = ? AND players.active = 1 AND players.profile_id IN (SELECT id FROM player_profiles WHERE active = 1)").bind(playerId, matchId).first<{ name: string; number: number | null }>();
        if (!player) return Response.json({ error: "Spelaren måste vara aktiv och vald till matchtruppen." }, { status: 400 });
        playerName = player.name; number = player.number;
      }
      await db.prepare("INSERT INTO goals (match_id, period, side, player_id, player_name, number) VALUES (?, ?, ?, ?, ?, ?)").bind(matchId, period, side, playerId, playerName, number).run();
      await db.prepare("UPDATE matches SET status = 'live' WHERE id = ?").bind(matchId).run();
      return Response.json({ success: true });
    }
    if (action === "card") {
      const matchId = id("matchId"), period = id("period"), playerId = id("playerId"), cardType = string("cardType");
      if (!matchId || !Number.isInteger(period) || period < 1 || !playerId || !["red", "yellow", "green"].includes(cardType)) return Response.json({ error: "Kontrollera spelare, period och korttyp." }, { status: 400 });
      const match = await db.prepare("SELECT matches.periods, COALESCE(competitions.yellow_enabled, matches.yellow_enabled) AS yellowEnabled, COALESCE(competitions.red_enabled, matches.red_enabled) AS redEnabled, COALESCE(competitions.green_enabled, matches.green_enabled) AS greenEnabled FROM matches LEFT JOIN competitions ON competitions.id = matches.competition_id WHERE matches.id = ?").bind(matchId).first<{ periods: number; yellowEnabled: number; redEnabled: number; greenEnabled: number }>();
      if (!match) return Response.json({ error: "Matchen hittades inte." }, { status: 404 });
      const enabled = cardType === "yellow" ? match.yellowEnabled : cardType === "red" ? match.redEnabled : match.greenEnabled;
      if (!enabled) return Response.json({ error: "Den korttypen är avstängd för matchen." }, { status: 400 });
      if (period > match.periods) return Response.json({ error: `Matchen har bara ${match.periods} perioder.` }, { status: 400 });
      const eligible = await db.prepare("SELECT players.id FROM players JOIN participants ON participants.player_id = players.id WHERE players.id = ? AND participants.match_id = ? AND players.active = 1 AND players.profile_id IN (SELECT id FROM player_profiles WHERE active = 1)").bind(playerId, matchId).first<{ id: number }>();
      if (!eligible) return Response.json({ error: "Spelaren måste vara aktiv och vald till matchtruppen." }, { status: 400 });
      await db.prepare("INSERT INTO cards (match_id, period, player_id, card_type, player_name, number) SELECT ?, ?, ?, ?, name, number FROM players WHERE id = ?").bind(matchId, period, playerId, cardType, playerId).run();
      await db.prepare("UPDATE matches SET status = 'live' WHERE id = ?").bind(matchId).run();
      return Response.json({ success: true });
    }
    if (action === "deleteCard") {
      await db.prepare("DELETE FROM cards WHERE id = ?").bind(id("cardId")).run();
      return Response.json({ success: true });
    }
    if (action === "updateGoal") {
      const goalId = id("goalId"), period = id("period"), side = string("side");
      if (!goalId || !Number.isInteger(period) || period < 1 || !["home", "away"].includes(side)) return Response.json({ error: "Kontrollera period och lag." }, { status: 400 });
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
      const matchId = id("matchId");
      await db.batch([
        db.prepare("DELETE FROM goals WHERE match_id = ?").bind(matchId),
        db.prepare("DELETE FROM cards WHERE match_id = ?").bind(matchId),
      ]);
      return Response.json({ success: true });
    }
    if (action === "deleteMatch") {
      const matchId = id("matchId");
      await db.batch([
        db.prepare("DELETE FROM goals WHERE match_id = ?").bind(matchId),
        db.prepare("DELETE FROM cards WHERE match_id = ?").bind(matchId),
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
