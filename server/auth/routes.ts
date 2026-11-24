import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import QRCode from "qrcode";
import { z } from "zod";
import { toSelfUser, userPrefs, type AppEnv, type Ctx } from "../context.js";
import { getSetting } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { needsRehash, recoveryCodes, totpSecret, totpStep, verifyPassword } from "../lib/crypto.js";
import { body, HttpError, zEmail } from "../lib/http.js";
import { requireUser, setSessionCookie } from "./middleware.js";
import {
  assertNotLocked,
  checkPassword,
  consumeSecondFactor,
  cookieName,
  createSession,
  ELEVATION_MS,
  findAuthToken,
  getUserByEmail,
  hashRecoveryCodes,
  invalidateAuthTokens,
  issueAuthToken,
  LOCK_MS,
  LOCK_THRESHOLD,
  registerFailure,
  revokeSessions,
  setPassword,
} from "./service.js";
import { tr } from "../lib/i18n.js";

export const authRoutes = new Hono<AppEnv>();

const GENERIC_FAIL = () => tr("Email address or password is incorrect.", "E-Mail-Adresse oder Passwort ist falsch.");

function meta(c: { req: { header(n: string): string | undefined } }, ip: string) {
  return { ip, ua: c.req.header("user-agent") ?? "" };
}

authRoutes.post("/login", async (c) => {
  const deps = c.get("deps");
  const ip = c.get("ip");
  const input = await body(
    c,
    z.object({
      email: z.string().trim().toLowerCase().max(254),
      password: z.string().max(400),
      code: z.string().trim().max(20).optional(),
    }),
  );
  const ipKey = `login:ip:${ip}`;
  const emailKey = `login:email:${input.email}`;
  if (!deps.limiter.take(ipKey, 30, 15 * 60_000)) {
    throw new HttpError(429, tr("Too many sign-in attempts from this network. Please wait a few minutes.", "Zu viele Anmeldeversuche von diesem Netzwerk. Bitte warte einige Minuten."), "rate_limited");
  }
  // Same limit as the account lock: unknown and known addresses behave identically.
  if (!deps.limiter.take(emailKey, LOCK_THRESHOLD, LOCK_MS)) {
    const mins = Math.ceil(deps.limiter.retryAfter(emailKey, LOCK_THRESHOLD, LOCK_MS) / 60);
    throw new HttpError(429, tr(`Too many attempts. Please wait ${mins} minute${mins === 1 ? "" : "s"}.`, `Zu viele Versuche. Bitte warte ${mins} ${mins === 1 ? "Minute" : "Minuten"}.`), "rate_limited");
  }

  const user = getUserByEmail(deps, input.email);
  const now = Date.now();
  if (user && user.locked_until > now) {
    const mins = Math.ceil((user.locked_until - now) / 60_000);
    audit(deps.db, { userId: user.id, action: "login.locked", ip });
    throw new HttpError(429, tr(`Too many attempts. Please wait ${mins} minute${mins === 1 ? "" : "s"}.`, `Zu viele Versuche. Bitte warte ${mins} ${mins === 1 ? "Minute" : "Minuten"}.`), "rate_limited");
  }

  const ok = await verifyPassword(input.password, user?.password_hash);
  if (!user || !ok || user.status !== "active") {
    if (user && user.status === "active") registerFailure(deps, user);
    // Only log well-formed addresses (no passwords accidentally typed into the email field)
    const logged = z.email().safeParse(input.email).success ? input.email : "(invalid input)";
    audit(deps.db, { userId: user?.id ?? null, action: "login.failed", ip, meta: { email: logged } });
    throw new HttpError(401, GENERIC_FAIL(), "invalid_credentials");
  }

  if (user.totp_enabled) {
    if (!input.code) throw new HttpError(401, tr("Please enter the code from your authenticator app.", "Bitte gib den Code aus deiner Authenticator-App ein."), "totp_required");
    if (!consumeSecondFactor(deps, user, input.code)) {
      registerFailure(deps, user);
      audit(deps.db, { userId: user.id, action: "login.totp_failed", ip });
      throw new HttpError(401, tr("The code is invalid or has expired.", "Der Code ist ungültig oder abgelaufen."), "totp_invalid");
    }
  }

  deps.limiter.reset(emailKey);
  if (user.password_hash && needsRehash(user.password_hash)) await setPassword(deps, user.id, input.password);
  deps.db.prepare("UPDATE users SET failed_logins = 0, locked_until = 0, last_login_at = ? WHERE id = ?").run(now, user.id);
  const s = createSession(deps, user.id, meta(c, ip));
  setSessionCookie(c, s.token, s.expires, deps.config.secureCookies, cookieName(deps));
  audit(deps.db, { userId: user.id, action: "login.success", ip });
  return c.json({ ok: true });
});

/**
 * Re-checks the signed-in person's password (for sensitive actions).
 * Same lock logic as sign-in: 5 failed attempts lock the account for 15 minutes.
 */
async function recheckPassword(c: Ctx, password: string, field = "password") {
  const deps = c.get("deps");
  const user = c.get("user");
  if (!deps.limiter.take(`pw:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, tr("Too many attempts. Please wait a few minutes.", "Zu viele Versuche. Bitte warte einige Minuten."), "rate_limited");
  assertNotLocked(deps, user.id);
  if (!(await verifyPassword(password, user.password_hash))) {
    registerFailure(deps, user);
    audit(deps.db, { userId: user.id, action: "reauth.failed", ip: c.get("ip") });
    throw new HttpError(422, tr("The password is incorrect.", "Das Passwort stimmt nicht."), "wrong_password", { fields: { [field]: tr("Incorrect", "Stimmt nicht") } });
  }
}

/** Re-confirmation (password + code if enabled) – unlocks sensitive actions for 10 minutes. */
authRoutes.post("/confirm", requireUser, async (c) => {
  const deps = c.get("deps");
  const user = c.get("user");
  const input = await body(c, z.object({ password: z.string().max(400), code: z.string().trim().max(20).optional() }));
  await recheckPassword(c, input.password);
  if (user.totp_enabled) {
    if (!input.code) throw new HttpError(422, tr("Please enter the code from your authenticator app.", "Bitte gib den Code aus deiner Authenticator-App ein."), "totp_required", { fields: { code: tr("Required", "Pflichtfeld") } });
    if (!consumeSecondFactor(deps, user, input.code)) {
      registerFailure(deps, user);
      audit(deps.db, { userId: user.id, action: "reauth.totp_failed", ip: c.get("ip") });
      throw new HttpError(422, tr("The code is invalid or has expired.", "Der Code ist ungültig oder abgelaufen."), "totp_invalid", { fields: { code: tr("Code does not match", "Code passt nicht") } });
    }
  }
  const until = Date.now() + ELEVATION_MS;
  deps.db.prepare("UPDATE sessions SET elevated_until = ? WHERE id_hash = ?").run(until, c.get("sessionHash"));
  deps.db.prepare("UPDATE users SET failed_logins = 0 WHERE id = ?").run(user.id);
  audit(deps.db, { userId: user.id, action: "reauth.success", ip: c.get("ip") });
  return c.json({ ok: true, until });
});

authRoutes.post("/logout", async (c) => {
  const deps = c.get("deps");
  const hash = c.get("sessionHash");
  if (hash) deps.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hash);
  deleteCookie(c, cookieName(deps), { path: "/", secure: deps.config.secureCookies });
  const user = c.get("user");
  if (user) audit(deps.db, { userId: user.id, action: "logout", ip: c.get("ip") });
  return c.json({ ok: true });
});

authRoutes.get("/me", (c) => {
  const deps = c.get("deps");
  const user = c.get("user");
  const require2fa = getSetting(deps.db, "require_2fa", false);
  const org = { name: deps.config.APP_NAME, require2fa };
  const features = {
    mail: deps.mail.available,
    ai: deps.ai.available,
    smtp: deps.mailer.enabled,
    demo: deps.config.DEMO_MODE,
  };
  if (!user) return c.json({ user: null, org, features });
  const prefs = userPrefs(user);
  return c.json({
    user: toSelfUser(user),
    prefs,
    org,
    features,
    mustSetup2fa: require2fa && !user.totp_enabled,
  });
});

/* ---------- Invitation & password reset ---------- */

authRoutes.get("/token/:kind/:token", (c) => {
  const kind = c.req.param("kind");
  if (kind !== "invite" && kind !== "reset") throw new HttpError(404, tr("Not found.", "Nicht gefunden."));
  const row = findAuthToken(c.get("deps"), c.req.param("token"), kind);
  if (!row) throw new HttpError(404, tr("This link is invalid or has expired. Please request a new one.", "Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an."), "token_invalid");
  return c.json({ email: row.email, name: row.name });
});

authRoutes.post("/token/complete", async (c) => {
  const deps = c.get("deps");
  const ip = c.get("ip");
  if (!deps.limiter.take(`token:ip:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, tr("Too many attempts.", "Zu viele Versuche."), "rate_limited");
  const input = await body(
    c,
    z.object({ kind: z.enum(["invite", "reset"]), token: z.string().max(100), password: z.string().max(400) }),
  );
  const row = findAuthToken(deps, input.token, input.kind);
  if (!row) throw new HttpError(404, tr("This link is invalid or has expired. Please request a new one.", "Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an."), "token_invalid");
  const problem = checkPassword(input.password, row.email);
  if (problem) throw new HttpError(422, problem, "weak_password", { fields: { password: problem } });

  // Consume the token atomically – a link works exactly once, even with parallel requests
  const used = deps.db.prepare("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(Date.now(), row.token_hash);
  if (used.changes !== 1) throw new HttpError(404, tr("This link is invalid or has expired. Please request a new one.", "Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an."), "token_invalid");
  await setPassword(deps, row.id, input.password);
  invalidateAuthTokens(deps, row.id);
  if (input.kind === "invite") {
    deps.db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'invited'").run(Date.now(), row.id);
  }
  revokeSessions(deps, row.id);
  if (input.kind === "reset") {
    // Whoever resets the password via a link does not "inherit" an already connected mailbox:
    // the Zoho connection is removed and must be re-established by the person (with their Zoho sign-in).
    await deps.mail.disconnect(row, ip, "password_reset");
  }
  // With 2FA enabled, do not sign in automatically – the second factor is checked at sign-in.
  if (!row.totp_enabled) {
    deps.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now(), row.id);
    const s = createSession(deps, row.id, meta(c, ip));
    setSessionCookie(c, s.token, s.expires, deps.config.secureCookies, cookieName(deps));
  }
  audit(deps.db, { userId: row.id, action: input.kind === "invite" ? "invite.accepted" : "password.reset", ip });
  return c.json({ ok: true, loggedIn: !row.totp_enabled });
});

authRoutes.post("/forgot", async (c) => {
  const deps = c.get("deps");
  const ip = c.get("ip");
  const input = await body(c, z.object({ email: zEmail }));
  if (!deps.limiter.take(`forgot:ip:${ip}`, 5, 15 * 60_000) || !deps.limiter.take(`forgot:${input.email}`, 3, 60 * 60_000)) {
    throw new HttpError(429, tr("Too many requests. Please try again later.", "Zu viele Anfragen. Bitte versuche es später erneut."), "rate_limited");
  }
  if (!deps.mailer.enabled) return c.json({ ok: true, mode: "admin" });
  const user = getUserByEmail(deps, input.email);
  if (user && user.status === "active") {
    const { url } = issueAuthToken(deps, user.id, "reset", null);
    try {
      await deps.mailer.send(
        user.email,
        tr("Reset your password – nalpia intranet", "Passwort zurücksetzen – nalpia Intranet"),
        [tr(`Hi ${user.name.split(" ")[0]},`, `Hallo ${user.name.split(" ")[0]},`), tr("you can set a new password using the link below. The link is valid for 24 hours.", "du kannst dein Passwort über den folgenden Link neu setzen. Der Link ist 24 Stunden gültig."), tr("If you did not request this, please ignore this email.", "Falls du das nicht angefordert hast, ignoriere diese E-Mail.")],
        { label: tr("Set new password", "Neues Passwort festlegen"), url },
      );
      audit(deps.db, { userId: user.id, action: "password.reset_requested", ip });
    } catch (e) {
      console.error("[mailer] Sending failed:", (e as Error).message);
    }
  }
  return c.json({ ok: true, mode: "email" });
});

/* ---------- Own security settings ---------- */

authRoutes.post("/password", requireUser, async (c) => {
  const deps = c.get("deps");
  const user = c.get("user");
  const input = await body(c, z.object({ current: z.string().max(400), next: z.string().max(400) }));
  await recheckPassword(c, input.current, "current");
  const problem = checkPassword(input.next, user.email);
  if (problem) throw new HttpError(422, problem, "weak_password", { fields: { next: problem } });
  await setPassword(deps, user.id, input.next);
  revokeSessions(deps, user.id, c.get("sessionHash"));
  invalidateAuthTokens(deps, user.id);
  audit(deps.db, { userId: user.id, action: "password.changed", ip: c.get("ip") });
  return c.json({ ok: true });
});

authRoutes.get("/sessions", requireUser, (c) => {
  const deps = c.get("deps");
  const user = c.get("user");
  const current = c.get("sessionHash");
  const rows = deps.db
    .prepare("SELECT id_hash, created_at, last_seen_at, user_agent, ip FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC")
    .all(user.id, Date.now()) as { id_hash: string; created_at: number; last_seen_at: number; user_agent: string; ip: string }[];
  return c.json(
    rows.map((r) => ({
      id: r.id_hash.slice(0, 16),
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      userAgent: r.user_agent,
      ip: r.ip,
      current: r.id_hash === current,
    })),
  );
});

authRoutes.delete("/sessions/:id", requireUser, (c) => {
  const deps = c.get("deps");
  const user = c.get("user");
  const id = c.req.param("id");
  if (!/^[0-9a-f]{16}$/.test(id)) throw new HttpError(400, tr("Invalid session.", "Ungültige Sitzung."));
  deps.db.prepare("DELETE FROM sessions WHERE user_id = ? AND substr(id_hash, 1, 16) = ?").run(user.id, id);
  audit(deps.db, { userId: user.id, action: "session.revoked", ip: c.get("ip") });
  return c.json({ ok: true });
});

authRoutes.post("/sessions/revoke-others", requireUser, (c) => {
  const deps = c.get("deps");
  const user = c.get("user");
  revokeSessions(deps, user.id, c.get("sessionHash"));
  audit(deps.db, { userId: user.id, action: "session.revoked_others", ip: c.get("ip") });
  return c.json({ ok: true });
});

/* ---------- Two-factor authentication (TOTP) ---------- */

authRoutes.post("/2fa/setup", requireUser, async (c) => {
  const deps = c.get("deps");
  const user = c.get("user");
  const input = await body(c, z.object({ password: z.string().max(400) }));
  if (user.totp_enabled) throw new HttpError(409, tr("Two-factor authentication is already enabled.", "Die Zwei-Faktor-Anmeldung ist bereits aktiv."), "already_enabled");
  await recheckPassword(c, input.password);
  const secret = totpSecret();
  deps.db.prepare("UPDATE users SET totp_secret_enc = ?, updated_at = ? WHERE id = ?").run(deps.vault.encrypt(secret), Date.now(), user.id);
  const label = encodeURIComponent(`nalpia Intranet:${user.email}`);
  const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("nalpia Intranet")}&algorithm=SHA1&digits=6&period=30`;
  const qrSvg = await QRCode.toString(otpauth, { type: "svg", margin: 1, color: { dark: "#0C2A57", light: "#FFFFFF" } });
  return c.json({ secret, otpauth, qrSvg });
});

authRoutes.post("/2fa/enable", requireUser, async (c) => {
  const deps = c.get("deps");
  const user = c.get("user");
  const input = await body(c, z.object({ code: z.string().trim().max(10) }));
  if (user.totp_enabled) throw new HttpError(409, tr("Two-factor authentication is already enabled.", "Die Zwei-Faktor-Anmeldung ist bereits aktiv."), "already_enabled");
  if (!user.totp_secret_enc) throw new HttpError(409, tr("Please restart the setup.", "Bitte starte die Einrichtung neu."), "no_secret");
  const step = totpStep(deps.vault.decrypt(user.totp_secret_enc), input.code);
  if (step === null) {
    throw new HttpError(422, tr("The code does not match. Check the time on your phone and try again.", "Der Code passt nicht. Prüfe die Uhrzeit deines Handys und versuche es erneut."), "totp_invalid", {
      fields: { code: tr("Code does not match", "Code passt nicht") },
    });
  }
  const codes = recoveryCodes();
  deps.db
    .prepare("UPDATE users SET totp_enabled = 1, totp_last_step = ?, recovery_codes = ?, updated_at = ? WHERE id = ?")
    .run(step, hashRecoveryCodes(deps, codes), Date.now(), user.id);
  revokeSessions(deps, user.id, c.get("sessionHash"));
  audit(deps.db, { userId: user.id, action: "2fa.enabled", ip: c.get("ip") });
  return c.json({ recoveryCodes: codes });
});

authRoutes.post("/2fa/disable", requireUser, async (c) => {
  const deps = c.get("deps");
  const user = c.get("user");
  const input = await body(c, z.object({ password: z.string().max(400), code: z.string().trim().max(20) }));
  if (getSetting(deps.db, "require_2fa", false)) {
    throw new HttpError(409, tr("Two-factor authentication is required for everyone and cannot be turned off.", "Die Zwei-Faktor-Anmeldung ist für alle Pflicht und kann nicht abgeschaltet werden."), "required");
  }
  await recheckPassword(c, input.password);
  if (!consumeSecondFactor(deps, user, input.code)) {
    registerFailure(deps, user);
    throw new HttpError(422, tr("The code is incorrect.", "Der Code stimmt nicht."), "totp_invalid", { fields: { code: tr("Code does not match", "Code passt nicht") } });
  }
  deps.db
    .prepare("UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = 0, recovery_codes = '[]', updated_at = ? WHERE id = ?")
    .run(Date.now(), user.id);
  revokeSessions(deps, user.id, c.get("sessionHash"));
  audit(deps.db, { userId: user.id, action: "2fa.disabled", ip: c.get("ip") });
  return c.json({ ok: true });
});
