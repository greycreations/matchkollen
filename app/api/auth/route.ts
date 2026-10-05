import { env } from "cloudflare:workers";
import { createSession, digest, emptyPermissions, getAuthUser, isSameOrigin, rolePermissions, passwordRecord, sessionCookie, validEmail, validPassword, verifyPassword } from "@/lib/auth";

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

function bodyText(body: Record<string, unknown>, key: string) {
  return typeof body[key] === "string" ? String(body[key]).trim() : "";
}

export async function GET(request: Request) {
  try {
    const db = database();
    const count = await db.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
    const user = await getAuthUser(request);
    const usersResult = user?.role === "admin" ? await db.prepare("SELECT id, name, email, role, permissions, active, CASE WHEN photo IS NULL THEN 0 ELSE photo_revision END AS photoRevision, created_at AS createdAt FROM users ORDER BY role, name").all<{ id: number; name: string; email: string; role: "admin" | "coach" | "parent"; permissions: string; active: number; photoRevision: number; createdAt: string }>() : null;
    const assignments = user?.role === "admin" ? await db.prepare("SELECT user_id AS userId, team_id AS teamId FROM user_teams").all<{ userId: number; teamId: number }>() : null;
    const family = user?.role === "admin" ? await db.prepare("SELECT user_id AS userId, profile_id AS profileId FROM parent_children").all<{ userId: number; profileId: number }>() : null;
    const users = usersResult?.results.map((row) => ({ ...row, childProfileIds: family?.results.filter((item) => item.userId === row.id).map((item) => item.profileId) ?? [], permissions: rolePermissions(row.role), teamIds: assignments?.results.filter((item) => item.userId === row.id).map((item) => item.teamId) ?? [] })) ?? undefined;
    return json({ setupRequired: (count?.total ?? 0) === 0, user, ...(users ? { users } : {}) });
  } catch (error) {
    console.error("Matchkollen auth status failed", error);
    return json({ error: "Kunde inte kontrollera inloggningen. Kontrollera att databasen har startat." }, 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ error: "Säkerhetskontrollen stoppade begäran eftersom webbadressen inte matchar appens adress. Kontrollera att din proxy skickar vidare Host, X-Forwarded-Host och X-Forwarded-Proto." }, 403);
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
      const row = await db.prepare("SELECT id, name, email, role, permissions, password_salt AS passwordSalt, password_hash AS passwordHash FROM users WHERE email = ? AND active = 1 LIMIT 1").bind(email).first<{ id: number; name: string; email: string; role: "admin" | "coach" | "parent"; permissions: string; passwordSalt: string; passwordHash: string }>();
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

    let assignedTeamIds: number[] = [];
    let childProfileIds: number[] = [];
    const role = body.role === "coach" ? "coach" : "parent";
    if (action === "createUser" || action === "updateUser") {
      if (!["coach", "parent"].includes(String(body.role)) || !Array.isArray(body.teamIds) || body.teamIds.some((value) => !Number.isInteger(value) || Number(value) < 1)) return json({ error: "Välj tränare eller förälder och giltiga lag." }, 400);
      assignedTeamIds = [...new Set(body.teamIds as number[])];
      if (body.childProfileIds !== undefined && (!Array.isArray(body.childProfileIds) || body.childProfileIds.some((id) => !Number.isInteger(id) || Number(id) < 1))) return json({ error: "Välj giltiga spelarprofiler." }, 400);
      if (role === "parent") {
        // Older clients may omit this field; editing unrelated fields must retain the links.
        if (body.childProfileIds === undefined && action === "updateUser") {
          const old = await db.prepare("SELECT profile_id AS id FROM parent_children WHERE user_id = ?").bind(Number(body.userId)).all<{ id: number }>();
          childProfileIds = old.results.map((row) => row.id);
        } else childProfileIds = [...new Set((body.childProfileIds ?? []) as number[])];
        const profiles = await db.prepare("SELECT id FROM player_profiles").all<{ id: number }>();
        if (childProfileIds.some((id) => !profiles.results.some((profile) => profile.id === id))) return json({ error: "En vald spelarprofil saknas." }, 400);
      } else if (Array.isArray(body.childProfileIds) && body.childProfileIds.length) return json({ error: "Barnkopplingar kräver rollen Förälder." }, 400);
      const available = await db.prepare("SELECT id FROM teams").all<{ id: number }>();
      if (assignedTeamIds.some((id) => !available.results.some((team) => team.id === id))) return json({ error: "Ett valt lag finns inte längre." }, 400);
    }
    const teamStatements = (userId: number) => [
      db.prepare("DELETE FROM user_teams WHERE user_id = ?").bind(userId),
      ...assignedTeamIds.map((teamId) => db.prepare("INSERT INTO user_teams (user_id, team_id) VALUES (?, ?)").bind(userId, teamId)),
      db.prepare("DELETE FROM parent_children WHERE user_id = ?").bind(userId),
      ...childProfileIds.map((profileId) => db.prepare("INSERT INTO parent_children (user_id, profile_id) VALUES (?, ?)").bind(userId, profileId)),
    ];

    if (action === "createUser") {
      const name = bodyText(body, "name").slice(0, 100);
      const email = bodyText(body, "email").toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      if (name.length < 2 || !validEmail(email) || !validPassword(password)) {
        return json({ error: "Ange namn, giltig e-post och ett lösenord med minst 12 tecken." }, 400);
      }
      const passwordData = await passwordRecord(password);
      try {
        await db.batch([
          db.prepare("INSERT INTO users (name, email, password_salt, password_hash, role, permissions, active) VALUES (?, ?, ?, ?, ?, '{}', 1)").bind(name, email, passwordData.salt, passwordData.hash, role),
          ...assignedTeamIds.map((teamId) => db.prepare("INSERT INTO user_teams (user_id, team_id) SELECT id, ? FROM users WHERE email = ?").bind(teamId, email)),
          ...childProfileIds.map((profileId) => db.prepare("INSERT INTO parent_children (user_id, profile_id) SELECT id, ? FROM users WHERE email = ?").bind(profileId, email)),
        ]);
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
      const permissions = JSON.stringify(rolePermissions(role));
      try {
        if (password) {
          if (!validPassword(password)) return json({ error: "Ett nytt lösenord måste innehålla minst 12 tecken." }, 400);
          const passwordData = await passwordRecord(password);
          await db.batch([
            db.prepare("UPDATE users SET name = ?, email = ?, role = ?, permissions = ?, password_salt = ?, password_hash = ? WHERE id = ? AND role <> 'admin'").bind(name, email, role, permissions, passwordData.salt, passwordData.hash, userId),
            ...teamStatements(userId),
            db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
          ]);
        } else {
          await db.batch([
            db.prepare("UPDATE users SET name = ?, email = ?, role = ?, permissions = ? WHERE id = ? AND role <> 'admin'").bind(name, email, role, permissions, userId),
            ...teamStatements(userId),
            db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
          ]);
        }
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes("unique")) return json({ error: "Det finns redan ett konto med den e-postadressen." }, 409);
        throw error;
      }
      return json({ success: true });
    }

    if (action === "deleteUser") {
      const userId = Number(body.userId);
      if (!Number.isInteger(userId) || userId < 1) return json({ error: "Ogiltigt användarkonto." }, 400);
      const target = await db.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first<{ role: string }>();
      if (!target) return json({ error: "Användaren hittades inte." }, 404);
      if (target.role === "admin") return json({ error: "Administratörskonton kan inte tas bort." }, 403);
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE id = ? AND role <> 'admin')").bind(userId),
        db.prepare("DELETE FROM user_teams WHERE user_id IN (SELECT id FROM users WHERE id = ? AND role <> 'admin')").bind(userId),
        db.prepare("DELETE FROM parent_children WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM users WHERE id = ? AND role <> 'admin'").bind(userId),
      ]);
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
