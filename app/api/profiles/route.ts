import { auditedDatabase } from "@/lib/activity-log";
import { env } from "cloudflare:workers";
import { canAccessTeam, getAuthUser, isSameOrigin } from "@/lib/auth";
import { profileAccess } from "@/lib/profile-access";

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "Logga in först." }, { status: 401 });
  const db = env.DB;
  if (!db) return Response.json({ error: "Databasen är inte tillgänglig." }, { status: 503 });
  const profiles = await db.prepare("SELECT id, name, CASE WHEN photo IS NULL THEN 0 ELSE photo_revision END AS photoRevision FROM player_profiles ORDER BY name").all();
  const memberships = await db.prepare("SELECT id, profile_id AS profileId, team_id AS teamId, number, active FROM players ORDER BY id").all();
  const visible = memberships.results.filter((row) => canAccessTeam(user, Number(row.teamId)));
  const ids = new Set(visible.map((row) => row.profileId));
  const family = await db.prepare("SELECT parent_children.user_id AS userId, parent_children.profile_id AS profileId, users.name AS parentName FROM parent_children JOIN users ON users.id = parent_children.user_id").all();
  const parents = user.role === "admin" ? await db.prepare("SELECT id, name FROM users WHERE role = 'parent' ORDER BY name").all() : null;
  return Response.json({ parents: parents?.results ?? [], family: family.results.filter((row) => (user.role === "admin" || ids.has(row.profileId)) && (user.role !== "parent" || row.userId === user.id)), profiles: profiles.results.filter((row) => user.role === "admin" || ids.has(row.id)), memberships: visible }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "Logga in först." }, { status: 401 });
  if (!isSameOrigin(request) || user.role === "parent") return Response.json({ error: "Du saknar behörighet." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 10000) return Response.json({ error: "För stor begäran." }, { status: 413 });
  const raw = await request.text();
  if (raw.length > 10000) return Response.json({ error: "För stor begäran." }, { status: 413 });
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return Response.json({ error: "Ogiltig begäran." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "Ogiltig begäran." }, { status: 400 });
  const body = parsed as { action?: string; profileId?: number; name?: string; teamId?: number; number?: number | null; active?: boolean; parentIds?: number[] };
  let db = env.DB;
  if (!db) return Response.json({ error: "Databasen är inte tillgänglig." }, { status: 503 });
  const profileId = Number(body.profileId);
  if (!Number.isInteger(profileId) || profileId < 1) return Response.json({ error: "Ogiltig profil." }, { status: 400 });
  const exists = await db.prepare("SELECT id FROM player_profiles WHERE id = ?").bind(profileId).first();
  if (!exists) return Response.json({ error: "Spelarprofilen saknas." }, { status: 404 });
  if (!(await profileAccess(db, user, profileId))) return Response.json({ error: "Du har inte tillgång till spelarprofilen." }, { status: 403 });
  db = await auditedDatabase(db, user, body.action ?? "", body, "profiles");
  if (body.action === "family") {
    if (user.role !== "admin") return Response.json({ error: "Endast admin kan ändra familjekopplingar." }, { status: 403 });
    if (!Array.isArray(body.parentIds) || body.parentIds.some((id) => !Number.isInteger(id) || id < 1)) return Response.json({ error: "Välj giltiga föräldrar." }, { status: 400 });
    const parentIds = [...new Set(body.parentIds)];
    const parents = await db.prepare("SELECT id FROM users WHERE role = 'parent'").all<{ id: number }>();
    if (parentIds.some((id) => !parents.results.some((row) => row.id === id))) return Response.json({ error: "Ett valt föräldrakonto saknas." }, { status: 400 });
    await db.batch([db.prepare("DELETE FROM parent_children WHERE profile_id = ?").bind(profileId), ...parentIds.map((id) => db.prepare("INSERT INTO parent_children (user_id, profile_id) VALUES (?, ?)").bind(id, profileId))]);
  } else if (body.action === "rename") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) return Response.json({ error: "Ange ett namn med högst 100 tecken." }, { status: 400 });
    // Shared identity changes affect every membership, but goal snapshots remain untouched.
    await db.batch([db.prepare("UPDATE player_profiles SET name = ? WHERE id = ?").bind(name, profileId), db.prepare("UPDATE players SET name = ? WHERE profile_id = ?").bind(name, profileId)]);
  } else if (body.action === "membership") {
    const teamId = Number(body.teamId);
    if (!canAccessTeam(user, teamId)) return Response.json({ error: "Du har inte tillgång till laget." }, { status: 403 });
    const team = await db.prepare("SELECT id FROM teams WHERE id = ? AND active = 1").bind(teamId).first();
    if (!team || typeof body.active !== "boolean" || (body.number !== null && (!Number.isInteger(body.number) || Number(body.number) < 0 || Number(body.number) > 999))) return Response.json({ error: "Kontrollera lag, tröjnummer och status." }, { status: 400 });
    const old = await db.prepare("SELECT id FROM players WHERE profile_id = ? AND team_id = ?").bind(profileId, teamId).first<{ id: number }>();
    if (old || body.active) await db.prepare("INSERT INTO players (profile_id, team_id, name, number, active) SELECT id, ?, name, ?, ? FROM player_profiles WHERE id = ? ON CONFLICT(profile_id, team_id) DO UPDATE SET number = excluded.number, active = excluded.active").bind(teamId, body.number ?? null, body.active ? 1 : 0, profileId).run();
  } else return Response.json({ error: "Okänd åtgärd." }, { status: 400 });
  return Response.json({ success: true });
}
