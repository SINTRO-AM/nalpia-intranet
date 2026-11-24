import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, elevatedAdmin, enable2fa, freshCode, setup } from "./helpers.js";
import { loadConfig } from "../server/config.js";
import { audit, verifyAuditChain } from "../server/lib/audit.js";
import { resolveEndpoints } from "../server/mail/zoho.js";

const PW = "korrekt-pferd-batterie";

function connectMailbox(deps: ReturnType<typeof setup>["deps"], userId: string, email: string) {
  const now = Date.now();
  deps.db
    .prepare(
      `INSERT INTO mail_accounts (user_id, provider, account_id, email, addresses, accounts_server, mail_api, refresh_token_enc, connected_at, updated_at)
       VALUES (?, 'demo', '1', ?, ?, 'demo', 'demo', ?, ?, ?)`,
    )
    .run(userId, email, JSON.stringify([email]), deps.vault.encrypt("demo"), now, now);
}

const hasMailbox = (deps: ReturnType<typeof setup>["deps"], userId: string) =>
  !!deps.db.prepare("SELECT 1 FROM mail_accounts WHERE user_id = ?").get(userId);

test("Heikle Admin-Aktionen verlangen eigene 2FA und frische Bestätigung", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "admin@nalpia.com", password: PW, role: "admin" });
  const uid = await addUser(deps, { email: "m@nalpia.com", password: PW });

  const admin = new Client(app);
  await admin.login("admin@nalpia.com", PW);
  const no2fa = await admin.post(`/api/admin/users/${uid}/link`, {});
  assert.equal(no2fa.status, 403);
  assert.equal(no2fa.json.code, "admin_2fa_required");

  const { secret } = await enable2fa(admin, PW);
  const notConfirmed = await admin.post(`/api/admin/users/${uid}/link`, {});
  assert.equal(notConfirmed.status, 403);
  assert.equal(notConfirmed.json.code, "reauth_required");
  assert.equal((await admin.post(`/api/admin/users/${uid}/reset-2fa`, {})).json.code, "reauth_required");
  assert.equal((await admin.patch(`/api/admin/users/${uid}`, { role: "admin" })).json.code, "reauth_required");
  assert.equal((await admin.patch("/api/admin/settings", { require2fa: true })).json.code, "reauth_required");
  // Harmlose Änderungen (Titel) gehen ohne Bestätigung
  assert.equal((await admin.patch(`/api/admin/users/${uid}`, { title: "Analyst" })).status, 200);

  const wrong = await admin.post("/api/auth/confirm", { password: "falsch-falsch-falsch", code: freshCode(deps, "admin@nalpia.com", secret) });
  assert.equal(wrong.status, 422);
  const noCode = await admin.post("/api/auth/confirm", { password: PW });
  assert.equal(noCode.json.code, "totp_required");
  assert.equal((await admin.post("/api/auth/confirm", { password: PW, code: freshCode(deps, "admin@nalpia.com", secret) })).status, 200);
  const ok = await admin.post(`/api/admin/users/${uid}/link`, {});
  assert.equal(ok.status, 200);
  assert.match(ok.json.url, /\/passwort-neu\//);

  // Bestätigung läuft ab
  deps.db.prepare("UPDATE sessions SET elevated_until = ?").run(Date.now() - 1);
  assert.equal((await admin.post(`/api/admin/users/${uid}/link`, {})).json.code, "reauth_required");
});

test("Kontoübernahme per Admin-Reset führt nicht zum fremden Postfach", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "admin@nalpia.com", password: PW, role: "admin" });
  const uid = await addUser(deps, { email: "m@nalpia.com", password: PW });
  connectMailbox(deps, uid, "m@nalpia.com");
  assert.ok(hasMailbox(deps, uid));

  const { client: admin } = await elevatedAdmin(app, deps, "admin@nalpia.com", PW);
  const link = await admin.post(`/api/admin/users/${uid}/link`, {});
  const token = String(link.json.url).split("/").pop();
  // Die betroffene Person wird informiert
  const n = deps.db.prepare("SELECT title FROM notifications WHERE user_id = ? AND kind = 'security'").get(uid) as { title: string } | undefined;
  assert.match(n?.title ?? "", /link to reset your password/);

  const attacker = new Client(app);
  const done = await attacker.post("/api/auth/token/complete", { kind: "reset", token, password: "uebernahme-versuch-123" });
  assert.equal(done.status, 200);
  assert.equal(hasMailbox(deps, uid), false, "Postfach-Verbindung wurde beim Reset getrennt");
  const st = await attacker.get("/api/mail/status");
  assert.equal(st.json.connected, false);
  // Der Link funktioniert genau einmal
  assert.equal((await new Client(app).post("/api/auth/token/complete", { kind: "reset", token, password: "noch-ein-versuch-456" })).status, 404);
  const audited = deps.db.prepare("SELECT meta FROM audit_log WHERE action = 'mail.disconnected' AND user_id = ?").get(uid) as { meta: string };
  assert.equal(JSON.parse(audited.meta).reason, "password_reset");
});

test("2FA-Reset durch Admin trennt das Postfach und benachrichtigt die Person", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "admin@nalpia.com", password: PW, role: "admin" });
  const uid = await addUser(deps, { email: "m@nalpia.com", password: PW });
  const m = new Client(app);
  await m.login("m@nalpia.com", PW);
  await enable2fa(m, PW);
  connectMailbox(deps, uid, "m@nalpia.com");
  const { client: admin } = await elevatedAdmin(app, deps, "admin@nalpia.com", PW);
  assert.equal((await admin.post(`/api/admin/users/${uid}/reset-2fa`, {})).status, 200);
  assert.equal(hasMailbox(deps, uid), false);
  assert.equal((await m.get("/api/tasks")).status, 401, "alle Sitzungen beendet");
  const n = deps.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'security'").get(uid) as { n: number };
  assert.equal(n.n, 1);
});

test("Deaktivieren trennt das Postfach", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "admin@nalpia.com", password: PW, role: "admin" });
  const uid = await addUser(deps, { email: "m@nalpia.com", password: PW });
  connectMailbox(deps, uid, "m@nalpia.com");
  const { client: admin } = await elevatedAdmin(app, deps, "admin@nalpia.com", PW);
  assert.equal((await admin.patch(`/api/admin/users/${uid}`, { status: "disabled" })).status, 200);
  assert.equal(hasMailbox(deps, uid), false);
});

test("Passwort-Abfragen in den Einstellungen zählen als Fehlversuche (Kontosperre)", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "a@nalpia.com", password: PW });
  const c = new Client(app);
  await c.login("a@nalpia.com", PW);
  for (let i = 0; i < 5; i++) {
    assert.equal((await c.post("/api/auth/2fa/setup", { password: "rate-mal-" + i })).status, 422);
  }
  // Konto ist jetzt gesperrt – auch das richtige Passwort hilft vorerst nicht
  assert.equal((await c.post("/api/auth/2fa/setup", { password: PW })).status, 429);
  assert.equal((await new Client(app).login("a@nalpia.com", PW)).status, 429);
});

test("Fehlgeschlagener Login protokolliert keine Passwörter aus dem E-Mail-Feld", async () => {
  const { app, deps } = setup();
  await new Client(app).login("mein-geheimes-passwort", "x");
  await new Client(app).login("jemand@nalpia.com", "x");
  const metas = (deps.db.prepare("SELECT meta FROM audit_log WHERE action = 'login.failed' ORDER BY id").all() as { meta: string }[]).map((r) => JSON.parse(r.meta).email);
  assert.deepEqual(metas, ["(invalid input)", "jemand@nalpia.com"]);
});

test("Zoho-Rechenzentrum: nur bekannte Hosts, keine Prototyp-Schlüssel", () => {
  const def = "https://accounts.zoho.eu";
  assert.deepEqual(resolveEndpoints("https://accounts.zoho.com", def), { accountsServer: "https://accounts.zoho.com", mailApi: "https://mail.zoho.com" });
  for (const bad of [
    "https://constructor",
    "https://__proto__",
    "https://toString",
    "http://accounts.zoho.com",
    "https://accounts.zoho.com.evil.example",
    "https://user:pw@accounts.zoho.com",
    "https://accounts.zoho.com:8443",
    "https://accounts.zoho.com/pfad",
    "javascript:alert(1)",
  ]) {
    assert.equal(resolveEndpoints(bad, def), null, bad);
  }
});

test("Demo-Modus wird in Produktion verweigert", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "production", DEMO_MODE: "1", APP_URL: "https://intranet.nalpia.com", APP_SECRET: "x".repeat(48) }),
    /DEMO_MODE/,
  );
  assert.throws(() => loadConfig({ NODE_ENV: "production", APP_URL: "http://intranet.nalpia.com", APP_SECRET: "x".repeat(48) }));
});

test("Audit-Protokoll ist per Hash-Kette manipulationserkennbar", () => {
  const { deps } = setup();
  for (let i = 0; i < 5; i++) audit(deps.db, { action: "test.entry", meta: { i } });
  assert.deepEqual(verifyAuditChain(deps.db), { ok: true, entries: 5 });
  const third = deps.db.prepare("SELECT id FROM audit_log ORDER BY id LIMIT 1 OFFSET 2").get() as { id: number };
  deps.db.prepare("UPDATE audit_log SET meta = '{\"i\":99}' WHERE id = ?").run(third.id);
  assert.equal(verifyAuditChain(deps.db).ok, false);
  assert.equal(verifyAuditChain(deps.db).brokenAtId, third.id);
  deps.db.prepare("UPDATE audit_log SET meta = '{\"i\":2}' WHERE id = ?").run(third.id);
  assert.equal(verifyAuditChain(deps.db).ok, true);
  deps.db.prepare("DELETE FROM audit_log WHERE id = ?").run(third.id);
  assert.equal(verifyAuditChain(deps.db).ok, false, "Löschung fällt auf");
});

test("OAuth-Rückruf respektiert die 2FA-Pflicht", async () => {
  const { app, deps } = setup({ DEMO_MODE: "1" });
  await addUser(deps, { email: "a@nalpia.com", password: PW });
  deps.db.prepare("INSERT INTO settings (key, value) VALUES ('require_2fa', 'true')").run();
  const c = new Client(app);
  await c.login("a@nalpia.com", PW);
  const r = await c.get("/api/mail/oauth/callback?state=x&code=y");
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/einstellungen?tab=sicherheit");
});
