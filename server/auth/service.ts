import type { Deps, UserRow } from "../context.js";
import { parseJson } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { hashPassword, randomToken, sha256, totpStep } from "../lib/crypto.js";
import { HttpError } from "../lib/http.js";
import { tr } from "../lib/i18n.js";

export const SESSION_ABSOLUTE_MAX_MS = 90 * 24 * 3600 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
export const RESET_TTL_MS = 24 * 3600 * 1000;
export const LOCK_THRESHOLD = 5;
export const LOCK_MS = 15 * 60 * 1000;

export function cookieName(deps: Deps) {
  return deps.config.secureCookies ? "__Host-nalpia_sid" : "nalpia_sid";
}

const COMMON = new Set([
  "passwort123",
  "password123",
  "1234567890",
  "qwertzuiop",
  "qwertyuiop",
  "nalpia12345",
  "sintro12345",
  "sommer2026!",
  "winter2026!",
]);

/** Password rules: length matters more than special characters (NIST SP 800-63B). */
export function checkPassword(pw: string, email: string): string | null {
  if (pw.length < 10) return tr("The password needs at least 10 characters.", "Das Passwort braucht mindestens 10 Zeichen.");
  if (pw.length > 200) return tr("The password is too long (max. 200 characters).", "Das Passwort ist zu lang (max. 200 Zeichen).");
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return tr("This password is too common. Please choose another one.", "Dieses Passwort ist zu verbreitet. Wähle ein anderes.");
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 3 && lower.includes(local)) return tr("The password must not contain the part of your email address before the @.", "Das Passwort darf den Teil deiner E-Mail-Adresse vor dem @ nicht enthalten.");
  if (/^(.)\1+$/.test(pw)) return tr("The password must not consist of a single repeated character.", "Das Passwort darf nicht aus einem einzigen Zeichen bestehen.");
  return null;
}

export function createSession(deps: Deps, userId: string, meta: { ip: string; ua: string }) {
  const token = randomToken(32);
  const now = Date.now();
  const expires = now + deps.config.SESSION_DAYS * 24 * 3600 * 1000;
  deps.db
    .prepare(
      "INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(sha256(token), userId, now, now, expires, meta.ua.slice(0, 300), meta.ip.slice(0, 64));
  // Clean up this user's expired sessions
  deps.db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at < ?").run(userId, now);
  return { token, expires };
}

export function revokeSessions(deps: Deps, userId: string, exceptHash?: string) {
  if (exceptHash) deps.db.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?").run(userId, exceptHash);
  else deps.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function issueAuthToken(deps: Deps, userId: string, kind: "invite" | "reset", createdBy: string | null) {
  const token = randomToken(32);
  const now = Date.now();
  // Invalidate older, unused tokens of the same kind
  deps.db.prepare("DELETE FROM auth_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL").run(userId, kind);
  deps.db
    .prepare(
      "INSERT INTO auth_tokens (token_hash, user_id, kind, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(sha256(token), userId, kind, createdBy, now, now + (kind === "invite" ? INVITE_TTL_MS : RESET_TTL_MS));
  const path = kind === "invite" ? "/einladung/" : "/passwort-neu/";
  return { token, url: deps.config.appOrigin + path + token };
}

export function findAuthToken(deps: Deps, token: string, kind: "invite" | "reset") {
  if (!token || token.length > 100) return null;
  const row = deps.db
    .prepare(
      `SELECT t.token_hash, t.expires_at, t.used_at, u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.kind = ?`,
    )
    .get(sha256(token), kind) as (UserRow & { token_hash: string; expires_at: number; used_at: number | null }) | undefined;
  if (!row || row.used_at || row.expires_at < Date.now() || row.status === "disabled") return null;
  return row;
}

export async function setPassword(deps: Deps, userId: string, password: string) {
  const hash = await hashPassword(password);
  const now = Date.now();
  deps.db
    .prepare(
      "UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = 0, updated_at = ? WHERE id = ?",
    )
    .run(hash, now, now, userId);
}

export function getUser(deps: Deps, id: string): UserRow | undefined {
  return deps.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function getUserByEmail(deps: Deps, email: string): UserRow | undefined {
  return deps.db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email.trim()) as UserRow | undefined;
}

/** True when ALLOWED_EMAIL_DOMAINS is empty or contains the address's domain. */
export function isEmailAllowed(deps: Deps, email: string): boolean {
  const domains = deps.config.allowedDomains;
  if (!domains.length) return true;
  return domains.includes(email.split("@")[1]?.toLowerCase() ?? "");
}

export function assertEmailAllowed(deps: Deps, email: string) {
  const domains = deps.config.allowedDomains;
  if (!isEmailAllowed(deps, email)) {
    throw new HttpError(422, tr(`Only addresses from these domains are allowed: ${domains.join(", ")}`, `Nur Adressen dieser Domains sind erlaubt: ${domains.join(", ")}`), "domain_not_allowed");
  }
}

/** Count a failed attempt; from LOCK_THRESHOLD on, the account is locked temporarily. */
export function registerFailure(deps: Deps, user: Pick<UserRow, "id">) {
  const cur = deps.db.prepare("SELECT failed_logins FROM users WHERE id = ?").get(user.id) as { failed_logins: number } | undefined;
  const fails = (cur?.failed_logins ?? 0) + 1;
  if (fails >= LOCK_THRESHOLD) {
    deps.db.prepare("UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?").run(Date.now() + LOCK_MS, user.id);
  } else {
    deps.db.prepare("UPDATE users SET failed_logins = ? WHERE id = ?").run(fails, user.id);
  }
}

/** Is the account currently locked? (throws 429) */
export function assertNotLocked(deps: Deps, userId: string) {
  const r = deps.db.prepare("SELECT locked_until FROM users WHERE id = ?").get(userId) as { locked_until: number } | undefined;
  if (r && r.locked_until > Date.now()) {
    const mins = Math.ceil((r.locked_until - Date.now()) / 60_000);
    throw new HttpError(429, tr(`Too many attempts. Please wait ${mins} minute${mins === 1 ? "" : "s"}.`, `Zu viele Versuche. Bitte warte ${mins} ${mins === 1 ? "Minute" : "Minuten"}.`), "rate_limited");
  }
}

/**
 * Checks the second factor: TOTP code (each time window usable only once) or
 * recovery code (consumed atomically).
 */
export function consumeSecondFactor(deps: Deps, user: UserRow, code: string): boolean {
  if (!user.totp_secret_enc) return false;
  const secret = deps.vault.decrypt(user.totp_secret_enc);
  const step = totpStep(secret, code);
  if (step !== null) {
    const r = deps.db.prepare("UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?").run(step, user.id, step);
    return r.changes === 1;
  }
  const normalized = code.toUpperCase().replace(/[^A-F0-9]/g, "");
  if (normalized.length !== 12) return false;
  const formatted = `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`;
  const raw = (deps.db.prepare("SELECT recovery_codes FROM users WHERE id = ?").get(user.id) as { recovery_codes: string } | undefined)?.recovery_codes ?? "[]";
  const hashes = parseJson<string[]>(raw, []);
  const h = deps.vault.mac("recovery:" + formatted);
  if (!hashes.includes(h)) return false;
  // Compare-and-swap: only consume if the list has not changed since reading it
  const r = deps.db
    .prepare("UPDATE users SET recovery_codes = ? WHERE id = ? AND recovery_codes = ?")
    .run(JSON.stringify(hashes.filter((x) => x !== h)), user.id, raw);
  if (r.changes !== 1) return false;
  audit(deps.db, { userId: user.id, action: "login.recovery_code_used", meta: { remaining: hashes.length - 1 } });
  return true;
}

export function hashRecoveryCodes(deps: Deps, codes: string[]) {
  return JSON.stringify(codes.map((c) => deps.vault.mac("recovery:" + c)));
}

/** Invalidates all open invite and reset links of a person. */
export function invalidateAuthTokens(deps: Deps, userId: string) {
  deps.db.prepare("DELETE FROM auth_tokens WHERE user_id = ? AND used_at IS NULL").run(userId);
}

export const ELEVATION_MS = 10 * 60_000;
