import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { userPrefs, type AppEnv, type UserRow } from "../context.js";
import { preferLang, tr } from "../lib/i18n.js";
import { getSetting } from "../db/index.js";
import { sha256 } from "../lib/crypto.js";
import { HttpError } from "../lib/http.js";
import { cookieName, SESSION_ABSOLUTE_MAX_MS } from "./service.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection: state-changing requests must carry a custom header (forces a CORS preflight,
 * which we never allow) and – if present – come from our own origin. Plus SameSite=Lax.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!SAFE.has(c.req.method)) {
    const deps = c.get("deps");
    const xrw = c.req.header("x-requested-with");
    if (xrw !== "nalpia-intranet") throw new HttpError(403, tr("Invalid request.", "Ungültige Anfrage."), "csrf");
    const origin = c.req.header("origin");
    if (origin && origin !== deps.config.appOrigin) throw new HttpError(403, tr("Invalid origin.", "Ungültiger Ursprung."), "csrf");
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, tr("Invalid origin.", "Ungültiger Ursprung."), "csrf");
  }
  await next();
};

/** Loads the session (if any) and extends it on a sliding basis. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const deps = c.get("deps");
  const token = getCookie(c, cookieName(deps));
  if (token && token.length < 100) {
    const hash = sha256(token);
    const now = Date.now();
    const row = deps.db
      .prepare(
        `SELECT s.created_at AS s_created, s.last_seen_at AS s_seen, s.expires_at AS s_expires, s.elevated_until AS s_elevated, u.*
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
      )
      .get(hash) as (UserRow & { s_created: number; s_seen: number; s_expires: number; s_elevated: number }) | undefined;
    if (row && row.s_expires > now && row.s_created + SESSION_ABSOLUTE_MAX_MS > now && row.status === "active") {
      const { s_created: _c, s_seen, s_expires: _e, s_elevated, ...user } = row;
      c.set("user", user as UserRow);
      preferLang(userPrefs(user as UserRow).lang);
      c.set("sessionHash", hash);
      c.set("elevatedUntil", s_elevated);
      if (now - s_seen > 5 * 60 * 1000) {
        const expires = Math.min(now + deps.config.SESSION_DAYS * 86400_000, row.s_created + SESSION_ABSOLUTE_MAX_MS);
        deps.db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?").run(now, expires, hash);
        setSessionCookie(c, token, expires, deps.config.secureCookies, cookieName(deps));
      }
    } else if (row) {
      deps.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hash);
    }
  }
  await next();
};

export function setSessionCookie(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  token: string,
  expires: number,
  secure: boolean,
  name: string,
) {
  setCookie(c, name, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.max(0, Math.floor((expires - Date.now()) / 1000)),
  });
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) throw new HttpError(401, tr("Please sign in.", "Bitte melde dich an."), "unauthenticated");
  // Enforce the organization-wide 2FA requirement on the server
  const require2fa = getSetting(c.get("deps").db, "require_2fa", false);
  if (require2fa && !user.totp_enabled) {
    const p = c.req.path;
    const allowed = p.startsWith("/api/auth/") || p === "/api/me";
    if (!allowed) throw new HttpError(403, tr("Please set up two-factor authentication first.", "Bitte richte zuerst die Zwei-Faktor-Anmeldung ein."), "totp_setup_required");
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) throw new HttpError(401, tr("Please sign in.", "Bitte melde dich an."), "unauthenticated");
  if (user.role !== "admin") throw new HttpError(403, tr("Admins only.", "Nur für Admins."), "forbidden");
  await next();
};

/**
 * For particularly sensitive admin actions (reset links, 2FA reset, roles, security settings):
 * the admin needs 2FA themselves and must have re-confirmed within the last 10 minutes.
 */
export function assertRecentAuth(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  const user = c.get("user");
  // In demo mode (never in production) password confirmation is enough, so everything can be tried out.
  if (!user.totp_enabled && !c.get("deps").config.DEMO_MODE) {
    throw new HttpError(403, tr("This action requires two-factor authentication on your own account (Settings → Security).", "Für diese Aktion brauchst du selbst eine aktive Zwei-Faktor-Anmeldung (Einstellungen → Sicherheit)."), "admin_2fa_required");
  }
  if ((c.get("elevatedUntil") ?? 0) < Date.now()) {
    throw new HttpError(403, tr("Please confirm this action with your password and code.", "Bitte bestätige diese Aktion mit Passwort und Code."), "reauth_required");
  }
}
