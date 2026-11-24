import type { DB } from "../db/index.js";
import type { Ctx } from "../context.js";
import { HttpError } from "./http.js";
import { tr } from "./i18n.js";

export const AVATAR_MAX_BYTES = 400 * 1024;

/** Detects the image format from the first bytes – the type reported by the browser does not count. */
export function sniffImage(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** Reads an uploaded profile photo (raw data in the body) and checks size and format. */
export async function readAvatarUpload(c: Ctx) {
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (!buf.length) throw new HttpError(400, tr("No image was uploaded.", "Es wurde kein Bild übertragen."), "empty");
  if (buf.length > AVATAR_MAX_BYTES) throw new HttpError(413, tr("The image is too large (max. 400 KB).", "Das Bild ist zu groß (max. 400 KB)."), "too_large");
  const mime = sniffImage(buf);
  if (!mime) throw new HttpError(422, tr("Please upload a JPG, PNG or WebP image.", "Bitte lade ein JPG-, PNG- oder WebP-Bild hoch."), "unsupported");
  return { buf, mime };
}

export function saveAvatar(db: DB, userId: string, img: { buf: Buffer; mime: string }) {
  const now = Date.now();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO user_avatars (user_id, mime, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at",
    ).run(userId, img.mime, img.buf, now);
    db.prepare("UPDATE users SET avatar_updated_at = ?, updated_at = ? WHERE id = ?").run(now, now, userId);
  })();
  return now;
}

export function deleteAvatar(db: DB, userId: string) {
  db.transaction(() => {
    db.prepare("DELETE FROM user_avatars WHERE user_id = ?").run(userId);
    db.prepare("UPDATE users SET avatar_updated_at = NULL, updated_at = ? WHERE id = ?").run(Date.now(), userId);
  })();
}
