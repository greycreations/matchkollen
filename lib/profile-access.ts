import { canAccessTeam, type AuthUser } from "./auth";

export async function profileAccess(db: D1Database, user: AuthUser, profileId: number) {
  if (user.role === "admin") return true;
  const rows = await db.prepare("SELECT team_id AS teamId FROM players WHERE profile_id = ?").bind(profileId).all<{ teamId: number }>();
  return rows.results.some((row) => canAccessTeam(user, row.teamId));
}
