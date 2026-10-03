import { env } from "cloudflare:workers";
import { createSession, digest, emptyPermissions, getAuthUser, isSameOrigin, normalizePermissions, passwordRecord, sessionCookie, validEmail, validPassword, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

function json(value: unknown, status = 200, headers?: HeadersInit) {
  const merged = new Headers(headers);
  merged.set("Cache-Control", "no-store");
  return Response.json(value, { status, headers: merged });
}

function database() {
  if (!env.DB) throw new Error("Databasen är inte tillgänglig just nu.");
  return env.DB;
}

function safePermissions(value: string) { try { return JSON.parse(value); } catch { return {}; } }

function bodyText(body: Record<string, unknown>, key: string) {
  return typeof body[key] === "string" ? String(body[key]).trim() : "";
}

export async function GET(request: Request) {
  try {
    const db = database();
    const count = await db.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
    const user = await getAuthUser(request);
    const usersResult = user?.role === "admin" ? await db.prepare("SELECT id, name, email, role, permissions, active, created_at AS createdAt FROM users ORDER BY role, name").all<{ id: number; name: string; email: string; role: "admin" | "user"; permissions: string; active: number; createdAt: string }>() : null;
    const users = usersResult?.results.map((row) => ({ ...row, permissions: normalizePermissions(safePermissions(row.permissions)) })) ?? undefined;
    return json({ setupRequired: (count?.total ?? 0) === 0, user, ...(users ? { users } : {}) });
  } catch (error) {
    console.error("Matchkollen auth status failed", error);
    return json({ error: "Kunde inte kontrollera inloggningen. Kontrollera att databasen har startat." }, 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ error: "Begäran avvisades." }, 403);
  try {
    const db = database();
    const body = await request.json() as Record<string, unknown>;
    const action = bodyText(body, "action");

    if (action === "logout") {
      const user = await getAuthUser(request);
      const cookie = request.headers.get("cookie") ?? "";
      const token = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("matchkollen_session="))?.slice("matchkollen_session=".length);
      if (user && token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digest(token)).run();
      return json({ success: true }, 200, { "Set-Cookie": sessionCookie("", request, 0) });
    }

    if (action === "createAdmin") {
      const name = bodyText(body, "name").slice(0, 100);
      const email = bodyText(body, "email").toLowerCase();
      const password = bodyText(body, "password");
      if (name.length < 2 || !validEmail(email) || !validPassword(password)) {
        return json({ error: "Ange namn, giltig e-post och ett lösenord med minst 12 tecken." }, 400);
      }
      const passwordData = await passwordRecord(password);
      const inserted = await db.prepare("INSERT INTO users (name, email, password_salt, password_hash, role, permissions, active) SELECT ?, ?, ?, ?, 'admin', ?, 1 WHERE NOT EXISTS (SELECT 1 FROM users)").bind(name, email, passwordData.salt, passwordData.hash, JSON.stringify(emptyPermissions)).run();
      if (inserted.meta.changes !== 1) return json({ error: "Installationen har redan konfigurerats. Ladda om sidan och logga in." }, 409);
      const userId = Number(inserted.meta.last_row_id);
      const session = await createSession(db, userId);
      return json({ success: true }, 201, { "Set-Cookie": sessionCookie(session.token, request) });
    }

    if (action === "login") {
      const email = bodyText(body, "email").toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      const row = await db.prepare("SELECT id, name, email, role, permissions, password_salt AS passwordSalt, password_hash AS passwordHash FROM users WHERE email = ? AND active = 1 LIMIT 1").bind(email).first<{ id: number; name: string; email: string; role: "admin" | "user"; permissions: string; passwordSalt: string; passwordHash: string }>();
      if (!row || !(await verifyPassword(password, row.passwordSalt, row.passwordHash))) {
        return json({ error: "E-post eller lösenord stämmer inte." }, 401);
      }
      await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()).run();
      const session = await createSession(db, row.id);
      return json({ success: true }, 200, { "Set-Cookie": sessionCookie(session.token, request) });
    }

    const actor = await getAuthUser(request);
    if (!actor) return json({ error: "Logga in för att fortsätta." }, 401);
    if (actor.role !== "admin") return json({ error: "Endast administratörer kan hantera användarkonton." }, 403);

    if (action === "createUser") {
      const name = bodyText(body, "name").slice(0, 100);
      const email = bodyText(body, "email").toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      if (name.length < 2 || !validEmail(email) || !validPassword(password)) {
        return json({ error: "Ange namn, giltig e-post och ett lösenord med minst 12 tecken." }, 400);
      }
      const passwordData = await passwordRecord(password);
      try {
        await db.prepare("INSERT INTO users (name, email, password_salt, password_hash, role, permissions, active) VALUES (?, ?, ?, ?, 'user', ?, 1)").bind(name, email, passwordData.salt, passwordData.hash, JSON.stringify(normalizePermissions(body.permissions))).run();
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes("unique")) return json({ error: "Det finns redan ett konto med den e-postadressen." }, 409);
        throw error;
      }
      return json({ success: true }, 201);
    }

    if (action === "updateUser") {
      const userId = Number(body.userId);
      const name = bodyText(body, "name").slice(0, 100);
      const email = bodyText(body, "email").toLowerCase();
      if (!Number.isInteger(userId) || userId < 1 || name.length < 2 || !validEmail(email)) return json({ error: "Kontrollera namn och e-postadress." }, 400);
      const target = await db.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first<{ role: string }>();
      if (!target) return json({ error: "Användaren hittades inte." }, 404);
      if (target.role === "admin") return json({ error: "Administratörskontot ändras i kontoinställningarna." }, 400);
      const password = typeof body.password === "string" ? body.password : "";
      const permissions = JSON.stringify(normalizePermissions(body.permissions));
      try {
        if (password) {
          if (!validPassword(password)) return json({ error: "Ett nytt lösenord måste innehålla minst 12 tecken." }, 400);
          const passwordData = await passwordRecord(password);
          await db.prepare("UPDATE users SET name = ?, email = ?, permissions = ?, password_salt = ?, password_hash = ? WHERE id = ? AND role = 'user'").bind(name, email, permissions, passwordData.salt, passwordData.hash, userId).run();
          await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
        } else {
          await db.prepare("UPDATE users SET name = ?, email = ?, permissions = ? WHERE id = ? AND role = 'user'").bind(name, email, permissions, userId).run();
        }
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes("unique")) return json({ error: "Det finns redan ett konto med den e-postadressen." }, 409);
        throw error;
      }
      return json({ success: true });
    }

    if (action === "setUserActive") {
      const userId = Number(body.userId), active = body.active === true ? 1 : 0;
      if (!Number.isInteger(userId) || userId < 1) return json({ error: "Ogiltigt användarkonto." }, 400);
      const target = await db.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first<{ role: string }>();
      if (!target || target.role === "admin") return json({ error: "Det här kontot kan inte avaktiveras." }, 400);
      await db.prepare("UPDATE users SET active = ? WHERE id = ?").bind(active, userId).run();
      if (!active) await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
      return json({ success: true });
    }

    return json({ error: "Okänd åtgärd." }, 400);
  } catch (error) {
    console.error("Matchkollen auth request failed", error);
    return json({ error: "Begäran kunde inte genomföras. Kontrollera uppgifterna och försök igen." }, 503);
  }
}
