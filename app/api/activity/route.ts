import { env } from "cloudflare:workers";
import { getAuthUser } from "@/lib/auth";

function stockholmMidnight(date: string) {
  const utc = new Date(`${date}T00:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(utc));
  return new Date(utc.getTime() - hour * 3600000).toISOString();
}
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "Logga in först." }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Endast admin kan läsa aktivitetsloggen." }, { status: 403 });
  const db = env.DB!;
  const params = new URL(request.url).searchParams;
  const clauses: string[] = [], values: (string | number)[] = [];
  for (const key of ["userId", "before"]) {
    const raw = params.get(key);
    if (!raw) continue;
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Ogiltigt filter." }, { status: 400 });
    clauses.push(key === "userId" ? "user_id = ?" : "id < ?"); values.push(id);
  }
  const category = params.get("category");
  if (category) {
    if (!["auth", "accounts", "data", "profiles", "photos"].includes(category)) return Response.json({ error: "Ogiltig loggtyp." }, { status: 400 });
    clauses.push("category = ?"); values.push(category);
  }
  for (const key of ["from", "to"]) {
    const raw = params.get(key);
    if (!raw) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(new Date(`${raw}T00:00:00Z`).getTime()) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0,10) !== raw) return Response.json({ error: "Ogiltigt datum." }, { status: 400 });
    const date = key === "to" ? new Date(new Date(`${raw}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0,10) : raw;
    clauses.push(key === "from" ? "created_at >= ?" : "created_at < ?"); values.push(stockholmMidnight(date));
  }
  const rows = await db.prepare(`SELECT id, user_id AS userId, user_name AS userName, action, category, description, created_at AS createdAt FROM activity_log ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id DESC LIMIT 51`).bind(...values).all();
  const users = await db.prepare("SELECT log.user_id AS id, log.user_name AS name FROM activity_log log JOIN (SELECT user_id, MAX(id) AS latest FROM activity_log GROUP BY user_id) last ON log.id = last.latest ORDER BY log.user_name").all();
  return Response.json({ entries: rows.results.slice(0,50), next: rows.results.length > 50 ? rows.results[49].id : null, users: users.results }, { headers: { "Cache-Control": "no-store" } });
}
