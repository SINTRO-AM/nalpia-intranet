import { Hono } from "hono";
import { z } from "zod";
import { toPublicUser, type AppEnv, type Ctx, type Deps, type UserRow } from "../context.js";
import { getSetting, setSetting } from "../db/index.js";
import { assertRecentAuth } from "../auth/middleware.js";
import { assertEmailAllowed, getUser, getUserByEmail, invalidateAuthTokens, isEmailAllowed, issueAuthToken, revokeSessions } from "../auth/service.js";
import { audit, notify } from "../lib/audit.js";
import { deleteAvatar, readAvatarUpload, saveAvatar } from "../lib/avatar.js";
import { importCrmBundle, parseCrmBundle, safeUrl } from "../lib/crm-import.js";
import { body, badRequest, HttpError, notFound, query, zEmail, zMsg, zText } from "../lib/http.js";
import { newId } from "../lib/util.js";
import { AVATAR_COLORS } from "./users.js";
import { tr } from "../lib/i18n.js";

export const adminRoutes = new Hono<AppEnv>();

function adminView(deps: Deps, u: UserRow) {
  const mail = deps.db.prepare("SELECT email, needs_reconnect FROM mail_accounts WHERE user_id = ?").get(u.id) as
    | { email: string; needs_reconnect: number }
    | undefined;
  return {
    ...toPublicUser(u),
    totpEnabled: !!u.totp_enabled,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
    locked: u.locked_until > Date.now(),
    mail: mail ? { email: mail.email, needsReconnect: !!mail.needs_reconnect } : null,
  };
}

adminRoutes.get("/users", (c) => {
  const deps = c.get("deps");
  const rows = deps.db
    .prepare("SELECT * FROM users ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END, name COLLATE NOCASE")
    .all() as UserRow[];
  return c.json({ users: rows.map((u) => adminView(deps, u)), smtp: deps.mailer.enabled, allowedDomains: deps.config.allowedDomains });
});

const newUser = z.object({
  email: zEmail,
  name: zText(80).min(2, zMsg("Please enter a name.", "Bitte gib einen Namen an.")),
  title: zText(80).optional(),
  role: z.enum(["admin", "member"]).default("member"),
  sendEmail: z.boolean().optional(),
  /** Admin override: invite an address outside ALLOWED_EMAIL_DOMAINS (needs a fresh password + code confirmation). */
  external: z.boolean().optional(),
});

async function createInvite(c: Ctx, p: z.infer<typeof newUser>) {
  const deps = c.get("deps");
  const me = c.get("user");
  if (p.role === "admin") assertRecentAuth(c);
  const external = !isEmailAllowed(deps, p.email);
  if (external) {
    if (!p.external) assertEmailAllowed(deps, p.email);
    assertRecentAuth(c);
  }
  if (getUserByEmail(deps, p.email)) throw new HttpError(409, tr(`An account for ${p.email} already exists.`, `Für ${p.email} gibt es bereits ein Konto.`), "exists");
  const id = newId();
  const now = Date.now();
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
  deps.db
    .prepare(
      "INSERT INTO users (id, email, name, title, role, status, avatar_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'invited', ?, ?, ?)",
    )
    .run(id, p.email, p.name, p.title ?? "", p.role, color, now, now);
  const { url } = issueAuthToken(deps, id, "invite", me.id);
  let emailed = false;
  if (p.sendEmail !== false && deps.mailer.enabled) {
    try {
      emailed = await deps.mailer.send(
        p.email,
        tr("Your invitation to the nalpia intranet", "Deine Einladung ins nalpia Intranet"),
        [
          tr(`Hi ${p.name.split(" ")[0]},`, `Hallo ${p.name.split(" ")[0]},`),
          tr(`${me.name} has invited you to the nalpia intranet. It brings news, tasks, milestones and your mailbox together in one place.`, `${me.name} hat dich ins nalpia Intranet eingeladen. Dort findest du Neuigkeiten, Aufgaben, Meilensteine und dein Postfach an einem Ort.`),
          tr("Use the link to set your password. The link is valid for 7 days.", "Lege über den Link dein Passwort fest. Der Link ist 7 Tage gültig."),
        ],
        { label: tr("Set password", "Passwort festlegen"), url },
      );
    } catch (e) {
      console.error("[mailer] Invitation not sent:", (e as Error).message);
    }
  }
  audit(deps.db, { userId: me.id, action: "user.invited", target: id, ip: c.get("ip"), meta: { email: p.email, role: p.role, ...(external ? { external: true } : {}) } });
  return { user: adminView(deps, getUser(deps, id)!), inviteUrl: url, emailed };
}

adminRoutes.post("/users", async (c) => {
  const p = await body(c, newUser);
  return c.json(await createInvite(c, p), 201);
});

/** Invite several people at once. One line per person: “Name; Email; Role/title” (separator ; , or tab). */
adminRoutes.post("/users/bulk", async (c) => {
  const p = await body(c, z.object({ text: z.string().max(20000), sendEmail: z.boolean().optional() }));
  const results: { line: string; ok: boolean; message: string; inviteUrl?: string; email?: string }[] = [];
  const lines = p.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 100);
  for (const line of lines) {
    const angle = line.match(/^(.*?)<([^>]+)>\s*[,;\t]?\s*(.*)$/);
    let name = "";
    let email = "";
    let title = "";
    if (angle) {
      name = angle[1]!.replace(/[,;"]/g, "").trim();
      email = angle[2]!.trim();
      title = angle[3]!.trim();
    } else {
      const parts = line.split(/\s*[;\t,]\s*/);
      const ei = parts.findIndex((x) => x.includes("@"));
      if (ei >= 0) {
        email = parts[ei]!;
        const rest = parts.filter((_, i) => i !== ei);
        name = rest[0] ?? "";
        title = rest.slice(1).join(", ");
      }
    }
    const parsed = newUser.safeParse({ email, name: name || email.split("@")[0], title, role: "member", sendEmail: p.sendEmail });
    if (!parsed.success) {
      results.push({ line, ok: false, message: tr("Line not recognized – expected: Name; Email; Title", "Zeile nicht erkannt – erwartet: Name; E-Mail; Titel") });
      continue;
    }
    try {
      const r = await createInvite(c, parsed.data);
      results.push({ line, ok: true, message: r.emailed ? tr("Invited (email sent)", "Eingeladen (E-Mail versendet)") : tr("Invited", "Eingeladen"), inviteUrl: r.inviteUrl, email: parsed.data.email });
    } catch (e) {
      results.push({ line, ok: false, message: (e as Error).message });
    }
  }
  return c.json({ results });
});

function lastActiveAdmin(deps: Deps, userId: string) {
  const n = (deps.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id != ?").get(userId) as { n: number }).n;
  return n === 0;
}

adminRoutes.patch("/users/:id", async (c) => {
  const deps = c.get("deps");
  const me = c.get("user");
  const u = getUser(deps, c.req.param("id"));
  if (!u) throw notFound();
  const p = await body(
    c,
    z.object({
      name: zText(80).min(2).optional(),
      title: zText(80).optional(),
      role: z.enum(["admin", "member"]).optional(),
      status: z.enum(["active", "disabled"]).optional(),
      // Org chart and profile (admins maintain these for everyone)
      department: zText(60).optional(),
      managerId: z.string().max(64).nullable().optional(),
      bio: zText(1500).optional(),
      location: zText(60).optional(),
      phone: zText(40).optional(),
      linkedin: z.string().max(300).optional(),
      responsibilities: z.array(zText(60).min(1)).max(12).optional(),
      sortOrder: z.number().int().min(0).max(10000).optional(),
      email: zEmail.optional(),
    }),
  );
  if (p.managerId !== undefined && p.managerId !== null) {
    if (p.managerId === u.id) throw badRequest(tr("A person cannot report to themselves.", "Eine Person kann nicht an sich selbst berichten."));
    if (!getUser(deps, p.managerId)) throw notFound(tr("The manager does not exist.", "Die vorgesetzte Person gibt es nicht."));
    // No cycles in the org chart
    let cur: string | null = p.managerId;
    for (let i = 0; cur && i < 50; i++) {
      if (cur === u.id) throw badRequest(tr("That would create a cycle in the org chart.", "Das würde einen Kreis im Organigramm ergeben."));
      cur = (deps.db.prepare("SELECT manager_id FROM users WHERE id = ?").get(cur) as { manager_id: string | null } | undefined)?.manager_id ?? null;
    }
  }
  if (p.email && p.email !== u.email) {
    // The sign-in address can only be changed while the person has not signed in yet
    if (u.status !== "invited") throw badRequest(tr("The email address can only be changed for invited people.", "Die E-Mail-Adresse lässt sich nur bei eingeladenen Personen ändern."));
    assertEmailAllowed(deps, p.email);
    if (getUserByEmail(deps, p.email)) throw new HttpError(409, tr("This email address is already taken.", "Diese E-Mail-Adresse ist schon vergeben."), "email_taken");
    assertRecentAuth(c);
    invalidateAuthTokens(deps, u.id);
  }
  if (u.id === me.id && (p.status === "disabled" || p.role === "member")) {
    throw badRequest(tr("You cannot remove your own admin rights or disable yourself.", "Du kannst dir selbst keine Adminrechte entziehen oder dich deaktivieren."));
  }
  if (u.role === "admin" && (p.role === "member" || p.status === "disabled") && lastActiveAdmin(deps, u.id)) {
    throw badRequest(tr("There must be at least one active admin.", "Es muss mindestens eine aktive Admin-Person geben."));
  }
  if (p.status === "active" && u.status === "invited") throw badRequest(tr("Invited people become active as soon as they set their password.", "Eingeladene Personen werden aktiv, sobald sie ihr Passwort festlegen."));
  if ((p.role && p.role !== u.role) || (p.status && p.status !== u.status)) assertRecentAuth(c);
  const status = p.status ? (p.status === "active" && u.status === "disabled" && !u.password_hash ? "invited" : p.status) : u.status;
  deps.db
    .prepare(
      `UPDATE users SET name = ?, title = ?, role = ?, status = ?, department = ?, manager_id = ?, bio = ?, location = ?, phone = ?, linkedin = ?,
         responsibilities = ?, sort_order = ?, email = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      p.name ?? u.name,
      p.title ?? u.title,
      p.role ?? u.role,
      status,
      p.department ?? u.department,
      p.managerId === undefined ? u.manager_id : p.managerId,
      p.bio ?? u.bio,
      p.location ?? u.location,
      p.phone ?? u.phone,
      p.linkedin === undefined ? u.linkedin : safeUrl(p.linkedin),
      p.responsibilities ? JSON.stringify(p.responsibilities) : u.responsibilities,
      p.sortOrder ?? u.sort_order,
      p.email ?? u.email,
      Date.now(),
      u.id,
    );
  if (status === "disabled" && u.status !== "disabled") {
    revokeSessions(deps, u.id);
    invalidateAuthTokens(deps, u.id);
    await deps.mail.disconnect(u, c.get("ip"), "disabled");
  }
  if (p.role && p.role !== u.role) {
    notify(deps.db, { userId: u.id, actorId: me.id, kind: "security", title: () => (p.role === "admin" ? tr(`${me.name} gave you admin rights`, `${me.name} hat dir Adminrechte gegeben`) : tr(`${me.name} removed your admin rights`, `${me.name} hat deine Adminrechte entfernt`)), link: "/einstellungen?tab=sicherheit" });
  }
  audit(deps.db, { userId: me.id, action: "user.updated", target: u.id, ip: c.get("ip"), meta: p });
  return c.json(adminView(deps, getUser(deps, u.id)!));
});

adminRoutes.post("/users/:id/link", async (c) => {
  const deps = c.get("deps");
  const me = c.get("user");
  const u = getUser(deps, c.req.param("id"));
  if (!u) throw notFound();
  const p = await body(c, z.object({ sendEmail: z.boolean().optional() }));
  if (u.status === "disabled") throw badRequest(tr("The account is disabled.", "Das Konto ist deaktiviert."));
  const kind = u.status === "invited" ? "invite" : "reset";
  if (kind === "reset") {
    if (u.id === me.id) throw badRequest(tr("Change your own password under Settings → Security.", "Dein eigenes Passwort änderst du unter Einstellungen → Sicherheit."));
    assertRecentAuth(c);
  }
  // With email delivery set up, reset links for active accounts only go to the person themselves –
  // so nobody in the admin area can secretly take over a colleague's password.
  const mustEmail = kind === "reset" && deps.mailer.enabled;
  const { url } = issueAuthToken(deps, u.id, kind, me.id);
  let emailed = false;
  if ((p.sendEmail || mustEmail) && deps.mailer.enabled) {
    try {
      emailed = await deps.mailer.send(
        u.email,
        kind === "invite" ? tr("Your invitation to the nalpia intranet", "Deine Einladung ins nalpia Intranet") : tr("New password for the nalpia intranet", "Neues Passwort für das nalpia Intranet"),
        [
          tr(`Hi ${u.name.split(" ")[0]},`, `Hallo ${u.name.split(" ")[0]},`),
          kind === "invite" ? tr("here is your new invite link.", "hier ist dein neuer Einladungslink.") : tr(`${me.name} has sent you a link to reset your password.`, `${me.name} hat dir einen Link zum Zurücksetzen deines Passworts geschickt.`),
          kind === "invite" ? tr("The link is valid for 7 days.", "Der Link ist 7 Tage gültig.") : tr("The link is valid for 24 hours.", "Der Link ist 24 Stunden gültig."),
        ],
        { label: tr("Set password", "Passwort festlegen"), url },
      );
    } catch (e) {
      console.error("[mailer]", (e as Error).message);
    }
  }
  if (mustEmail && !emailed) {
    invalidateAuthTokens(deps, u.id);
    throw new HttpError(502, tr("The email with the reset link could not be sent. Please check the SMTP settings.", "Die E-Mail mit dem Reset-Link konnte nicht versendet werden. Bitte prüfe die SMTP-Einstellungen."), "mail_failed");
  }
  if (kind === "reset") {
    notify(deps.db, { userId: u.id, actorId: me.id, kind: "security", title: () => tr(`${me.name} created a link to reset your password`, `${me.name} hat einen Link zum Zurücksetzen deines Passworts erstellt`), link: "/einstellungen?tab=sicherheit" });
  }
  audit(deps.db, { userId: me.id, action: kind === "invite" ? "user.invite_renewed" : "user.reset_link", target: u.id, ip: c.get("ip"), meta: { emailed } });
  return c.json({ url: mustEmail ? null : url, kind, emailed });
});

adminRoutes.post("/users/:id/reset-2fa", async (c) => {
  const deps = c.get("deps");
  const me = c.get("user");
  const u = getUser(deps, c.req.param("id"));
  if (!u) throw notFound();
  if (u.id === me.id) throw badRequest(tr("Manage your own two-factor authentication under Settings → Security.", "Deine eigene Zwei-Faktor-Anmeldung verwaltest du unter Einstellungen → Sicherheit."));
  assertRecentAuth(c);
  deps.db
    .prepare("UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = 0, recovery_codes = '[]', updated_at = ? WHERE id = ?")
    .run(Date.now(), u.id);
  revokeSessions(deps, u.id);
  // The mailbox connection is removed: a 2FA reset must never lead to someone else accessing the mail.
  await deps.mail.disconnect(u, c.get("ip"), "2fa_reset");
  notify(deps.db, { userId: u.id, actorId: me.id, kind: "security", title: () => tr(`${me.name} reset your two-factor authentication`, `${me.name} hat deine Zwei-Faktor-Anmeldung zurückgesetzt`), link: "/einstellungen?tab=sicherheit" });
  if (deps.mailer.enabled) {
    deps.mailer
      .send(u.email, tr("Your two-factor authentication was reset", "Deine Zwei-Faktor-Anmeldung wurde zurückgesetzt"), [
        tr(`Hi ${u.name.split(" ")[0]},`, `Hallo ${u.name.split(" ")[0]},`),
        tr(`${me.name} has reset your two-factor authentication in the nalpia intranet. You have been signed out everywhere; please reconnect your mailbox after your next sign-in.`, `${me.name} hat deine Zwei-Faktor-Anmeldung im nalpia Intranet zurückgesetzt. Du wurdest überall abgemeldet; dein Postfach musst du nach der nächsten Anmeldung neu verbinden.`),
        tr("If you did not request this, please contact management immediately.", "Falls du das nicht veranlasst hast, melde dich bitte sofort bei der Geschäftsleitung."),
      ])
      .catch((e: Error) => console.error("[mailer]", e.message));
  }
  audit(deps.db, { userId: me.id, action: "user.2fa_reset", target: u.id, ip: c.get("ip") });
  return c.json(adminView(deps, getUser(deps, u.id)!));
});

/** Set the profile photo for another person (e.g. consistent team photos). */
adminRoutes.put("/users/:id/avatar", async (c) => {
  const deps = c.get("deps");
  const me = c.get("user");
  const u = getUser(deps, c.req.param("id"));
  if (!u) throw notFound();
  saveAvatar(deps.db, u.id, await readAvatarUpload(c));
  audit(deps.db, { userId: me.id, action: "user.avatar_set", target: u.id, ip: c.get("ip") });
  return c.json(adminView(deps, getUser(deps, u.id)!));
});

adminRoutes.delete("/users/:id/avatar", (c) => {
  const deps = c.get("deps");
  const me = c.get("user");
  const u = getUser(deps, c.req.param("id"));
  if (!u) throw notFound();
  deleteAvatar(deps.db, u.id);
  audit(deps.db, { userId: me.id, action: "user.avatar_removed", target: u.id, ip: c.get("ip") });
  return c.json(adminView(deps, getUser(deps, u.id)!));
});

adminRoutes.post("/users/:id/unlock", (c) => {
  const deps = c.get("deps");
  const me = c.get("user");
  const u = getUser(deps, c.req.param("id"));
  if (!u) throw notFound();
  deps.db.prepare("UPDATE users SET locked_until = 0, failed_logins = 0 WHERE id = ?").run(u.id);
  deps.limiter.reset(`login:email:${u.email.toLowerCase()}`);
  audit(deps.db, { userId: me.id, action: "user.unlocked", target: u.id, ip: c.get("ip") });
  return c.json(adminView(deps, getUser(deps, u.id)!));
});

adminRoutes.delete("/users/:id", (c) => {
  const deps = c.get("deps");
  const me = c.get("user");
  const u = getUser(deps, c.req.param("id"));
  if (!u) throw notFound();
  if (u.status !== "invited" || u.last_login_at) throw badRequest(tr("Only pending invitations can be deleted. Please disable active accounts instead.", "Nur offene Einladungen können gelöscht werden. Aktive Konten bitte deaktivieren."));
  deps.db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
  audit(deps.db, { userId: me.id, action: "user.invite_deleted", target: u.id, ip: c.get("ip"), meta: { email: u.email } });
  return c.json({ ok: true });
});

adminRoutes.get("/audit", (c) => {
  const { db } = c.get("deps");
  const q = query(
    c,
    z.object({
      before: z.coerce.number().int().optional(),
      action: z.string().max(60).optional(),
      user: z.string().max(64).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
  );
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.before) {
    where.push("id < ?");
    args.push(q.before);
  }
  if (q.action) {
    where.push("action LIKE ?");
    args.push(q.action.replace(/[%_]/g, "") + "%");
  }
  if (q.user) {
    where.push("(user_id = ? OR target = ?)");
    args.push(q.user, q.user);
  }
  const rows = db
    .prepare(`SELECT id, ts, user_id AS userId, action, target, ip, meta FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`)
    .all(...args, q.limit ?? 100) as { meta: string }[];
  return c.json(rows.map((r) => ({ ...r, meta: JSON.parse(r.meta || "{}") })));
});

/**
 * Import a CRM bundle (organizations, contacts, activity). Check with ?probe=1 first, then without.
 * ?aktualisieren=1 overwrites already imported records with the values from the bundle.
 */
/** Check up front whether the real import is allowed – before the UI uploads the large bundle. */
adminRoutes.post("/import-crm/bereit", (c) => {
  assertRecentAuth(c);
  return c.json({ ok: true });
});

adminRoutes.post("/import-crm", async (c) => {
  const deps = c.get("deps");
  const me = c.get("user");
  const dryRun = c.req.query("probe") === "1";
  const update = c.req.query("aktualisieren") === "1";
  const tasks = c.req.query("aufgaben") === "1";
  // Read the whole upload first, then reject if needed: if the server answers while the browser is still
  // sending, the connection often breaks on Windows and the UI only sees "No connection".
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(422, tr("The file is not valid JSON.", "Die Datei ist kein gültiges JSON."), "invalid_bundle");
  }
  if (!dryRun) assertRecentAuth(c);
  const bundle = parseCrmBundle(raw);
  const result = importCrmBundle(deps.db, bundle, { actorId: me.id, fallbackOwnerId: me.id, update, tasks, dryRun, ip: c.get("ip") });
  return c.json(result);
});

adminRoutes.get("/settings", (c) => {
  const { db } = c.get("deps");
  return c.json({ require2fa: getSetting(db, "require_2fa", false) });
});

adminRoutes.patch("/settings", async (c) => {
  const deps = c.get("deps");
  const me = c.get("user");
  const p = await body(c, z.object({ require2fa: z.boolean().optional() }));
  if (p.require2fa !== undefined) {
    assertRecentAuth(c);
    if (p.require2fa && !me.totp_enabled) throw badRequest(tr("Set up two-factor authentication for yourself first.", "Richte zuerst selbst die Zwei-Faktor-Anmeldung ein."));
    setSetting(deps.db, "require_2fa", p.require2fa);
    audit(deps.db, { userId: me.id, action: "settings.require_2fa", ip: c.get("ip"), meta: { value: p.require2fa } });
  }
  return c.json({ require2fa: getSetting(deps.db, "require_2fa", false) });
});
