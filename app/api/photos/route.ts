import { auditedDatabase } from "@/lib/activity-log";
import { env } from "cloudflare:workers";
import { getAuthUser, isSameOrigin } from "@/lib/auth";
import { profileAccess } from "@/lib/profile-access";

async function permitted(request: Request, kind: string, id: number, write: boolean) {
  const user = await getAuthUser(request);
  if (!user || !env.DB || !Number.isInteger(id) || id < 1) return false;
  if (kind === "player") return (!write || user.role !== "parent") && await profileAccess(env.DB, user, id);
  if (kind !== "user") return false;
  return user.role === "admin" || user.id === id;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  const id = Number(url.searchParams.get("id"));
  if (!(await permitted(request, kind, id, false))) return new Response(null, { status: 403 });
  const table = kind === "player" ? "player_profiles" : "users";
  const row = await env.DB!.prepare(`SELECT photo FROM ${table} WHERE id = ?`).bind(id).first<{ photo: string | null }>();
  if (!row?.photo) return new Response(null, { status: 404 });
  const bytes = Uint8Array.from(atob(row.photo), (char) => char.charCodeAt(0));
  return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

// Accept only small JPEGs with a valid square frame; SVG and original uploads are never stored.
export function jpegSize(bytes: Uint8Array): number | null {
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset++] !== 255) return null;
    const marker = bytes[offset++];
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ([192, 193, 194].includes(marker)) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      return width === height && width >= 32 && width <= 512 ? width : null;
    }
    offset += length;
  }
  return null;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Du saknar behörighet." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 350000) return Response.json({ error: "Bilden är för stor." }, { status: 413 });
  const raw = await request.text();
  if (raw.length > 350000) return Response.json({ error: "Bilden är för stor." }, { status: 413 });
  let body: { kind: string; id: number; photo: string | null };
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Ogiltig bild." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Ogiltig bild." }, { status: 400 });
  if (!(await permitted(request, body.kind, Number(body.id), true))) return Response.json({ error: "Du saknar behörighet att ändra bilden." }, { status: 403 });
  if (body.photo !== null) {
    if (typeof body.photo !== "string" || body.photo.length > 340000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.photo)) return Response.json({ error: "Ogiltig bild." }, { status: 400 });
    try { if (!jpegSize(Uint8Array.from(atob(body.photo), (c) => c.charCodeAt(0)))) throw new Error(); }
    catch { return Response.json({ error: "Bilden måste vara en beskuren JPEG-bild." }, { status: 400 }); }
  }
  const actor = await getAuthUser(request);
  const db = await auditedDatabase(env.DB!, actor!, "photo", { ...body, ...(body.kind === "player" ? { profileId: body.id } : { userId: body.id }) }, "photos");
  const table = body.kind === "player" ? "player_profiles" : "users";
  const result = await db.prepare(`UPDATE ${table} SET photo = ?, photo_revision = photo_revision + 1 WHERE id = ?`).bind(body.photo, Number(body.id)).run();
  return result.meta.changes ? Response.json({ success: true }) : Response.json({ error: "Profilen saknas." }, { status: 404 });
}
