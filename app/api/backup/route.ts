import { env } from "cloudflare:workers";
import { digest, getAuthUser, isSameOrigin, sessionCookie, verifyPassword } from "@/lib/auth";
import { BACKUP_MAX_BYTES, backupSummary, backupTables, validateBackup } from "@/lib/backup";

function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
export async function GET(request: Request) {
  const actor = await getAuthUser(request);
  if (!actor) return json({ error: "Logga in först." }, 401);
  if (actor.role !== "admin") return json({ error: "Endast admin kan exportera backup." }, 403);
  try {
    const db = env.DB!;
    const result = await db.batch([...backupTables.map((table) => db.prepare(`SELECT * FROM ${table}`)), db.prepare("SELECT name, seq FROM sqlite_sequence")]);
    const exportedAt = new Date().toISOString();
    const backup = { format: "matchkollen-backup", version: 1, schemaVersion: 9, exportedAt, tables: Object.fromEntries(backupTables.map((table, index) => [table, result[index].results])), sequences: result.at(-1)!.results.filter((row) => backupTables.includes((row as { name: string }).name as typeof backupTables[number])) };
    const body = JSON.stringify(backup);
    if (new TextEncoder().encode(body).length > BACKUP_MAX_BYTES) return json({ error: "Backupen överskrider gränsen på 20 MB. Använd en kopia av Docker-datavolymen." }, 413);
    validateBackup(backup);
    await db.prepare("INSERT INTO activity_log(user_id,user_name,action,category,description,created_at) VALUES (?,?,'exportBackup','accounts','Exporterade fullständig backup',?)").bind(actor.id, actor.name, exportedAt).run();
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="matchkollen-backup-${exportedAt.slice(0, 10)}.json"` } });
  } catch { return json({ error: "Backupen kunde inte skapas. Kontrollera datan och försök igen." }, 503); }
}

export async function POST(request: Request) {
  const actor = await getAuthUser(request);
  if (!actor) return json({ error: "Logga in först." }, 401);
  if (actor.role !== "admin" || !isSameOrigin(request)) return json({ error: "Du saknar behörighet." }, 403);
  if (Number(request.headers.get("content-length")) > BACKUP_MAX_BYTES + 10000) return json({ error: "Filen är för stor (max 20 MB)." }, 413);
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > BACKUP_MAX_BYTES + 10000) return json({ error: "Filen är för stor (max 20 MB)." }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Ogiltig JSON-fil." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Ogiltig begäran." }, 400);
    let backup;
    try { backup = validateBackup(body.backup); } catch (error) { return json({ error: error instanceof Error ? error.message : "Ogiltig backup." }, 400); }
    const fingerprint = await digest(JSON.stringify(body.backup));
    if (body.action === "validate") return json({ summary: backupSummary(backup.tables), exportedAt: backup.exportedAt, fingerprint, admins: backup.tables.users.filter((user) => user.role === "admin" && user.active === 1).map((user) => ({ name: user.name, email: user.email })) });
    if (body.action !== "restore" || body.confirm !== "ERSÄTT ALL DATA" || body.fingerprint !== fingerprint) return json({ error: "Granska backupen och bekräfta att all data ska ersättas." }, 400);
    const db = env.DB!;
    const current = await db.prepare("SELECT password_salt AS salt, password_hash AS hash FROM users WHERE id = ?").bind(actor.id).first<{ salt: string; hash: string }>();
    if (!current || typeof body.currentPassword !== "string" || !(await verifyPassword(body.currentPassword, current.salt, current.hash))) return json({ error: "Nuvarande administratörslösenord stämmer inte." }, 403);
    const statements = [db.prepare("DELETE FROM sessions"), ...[...backupTables].reverse().map((table) => db.prepare(`DELETE FROM ${table}`))];
    for (const table of backupTables) for (const row of backup.tables[table]) {
      const columns = Object.keys(row);
      statements.push(db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(...Object.values(row)));
    }
    statements.push(db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${backupTables.map(() => "?").join(",")})`).bind(...backupTables));
    for (const table of backupTables) if (backup.tables[table][0]?.id !== undefined || backup.sequences.some((sequence) => sequence.name === table)) {
      const seq = Math.max(0, ...backup.tables[table].map((row) => Number(row.id ?? 0)), backup.sequences.find((sequence) => sequence.name === table)?.seq ?? 0);
      statements.push(db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)").bind(table, seq));
    }
    statements.push(db.prepare("INSERT INTO activity_log(user_id,user_name,action,category,description,created_at) VALUES (?,?,'restoreBackup','accounts','Återställde fullständig backup; alla sessioner avslutades',?)").bind(actor.id, actor.name, new Date().toISOString()));
    await db.batch(statements);
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie("", request, 0) } });
  } catch { return json({ error: "Återställningen misslyckades. Befintlig data har behållits." }, 503); }
}
