import { env } from "cloudflare:workers";

export const permissionAreas = ["teams", "players", "matches", "scores"] as const;
export const permissionActions = ["create", "edit", "delete"] as const;
export type PermissionArea = (typeof permissionAreas)[number];
export type PermissionAction = (typeof permissionActions)[number];
export type Permissions = Record<PermissionArea, Record<PermissionAction, boolean>>;

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  permissions: Permissions;
};

export const emptyPermissions: Permissions = {
  teams: { create: false, edit: false, delete: false },
  players: { create: false, edit: false, delete: false },
  matches: { create: false, edit: false, delete: false },
  scores: { create: false, edit: false, delete: false },
};

export function normalizePermissions(value: unknown): Permissions {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result = structuredClone(emptyPermissions);
  for (const area of permissionAreas) {
    const row = input[area] && typeof input[area] === "object" ? input[area] as Record<string, unknown> : {};
    for (const action of permissionActions) result[area][action] = row[action] === true;
  }
  return result;
}

export function hasPermission(user: AuthUser, area: PermissionArea, action: PermissionAction) {
  return user.role === "admin" || user.permissions[area]?.[action] === true;
}

export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const db = env.DB;
  if (!db) return null;
  const token = readCookie(request.headers.get("cookie") ?? "", "matchkollen_session");
  if (!token || token.length > 128) return null;
  const tokenHash = await digest(token);
  const now = new Date().toISOString();
  const row = await db.prepare(
    "SELECT users.id, users.name, users.email, users.role, users.permissions FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1 LIMIT 1",
  ).bind(tokenHash, now).first<{ id: number; name: string; email: string; role: "admin" | "user"; permissions: string }>();
  if (!row) return null;
  let permissions: unknown;
  try { permissions = JSON.parse(row.permissions); } catch { permissions = {}; }
  return { id: row.id, name: row.name, email: row.email, role: row.role, permissions: normalizePermissions(permissions) };
}

export async function passwordRecord(password: string) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toBase64(saltBytes);
  const hash = await derivePassword(password, saltBytes);
  return { salt, hash: toBase64(hash) };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string) {
  try {
    const actual = await derivePassword(password, fromBase64(salt));
    const expected = fromBase64(expectedHash);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
    return difference === 0;
  } catch {
    return false;
  }
}

export async function createSession(db: D1Database, userId: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(bytes);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").bind(userId, await digest(token), expiresAt).run();
  return { token, expiresAt };
}

export function sessionCookie(token: string, request: Request, maxAge = 7 * 24 * 60 * 60) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `matchkollen_session=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return (!origin || origin === new URL(request.url).origin) && request.headers.get("sec-fetch-site") !== "cross-site";
}

export function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validPassword(value: string) {
  return value.length >= 12 && value.length <= 256;
}

export async function digest(value: string) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function readCookie(header: string, name: string) {
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

async function derivePassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt).buffer, iterations: 310_000 }, key, 256);
  return new Uint8Array(bits);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
