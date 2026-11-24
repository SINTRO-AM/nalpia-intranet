import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, elevatedAdmin, ORIGIN, setup } from "./helpers.js";
import { totpCode } from "../server/lib/crypto.js";

const PW = "korrekt-pferd-batterie";

test("Login: Erfolg setzt HttpOnly-Session-Cookie, /me liefert Nutzer, Logout beendet Sitzung", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "anna@nalpia.com", name: "Anna Test", password: PW });
  const c = new Client(app);
  const r = await c.login("Anna@Nalpia.com", PW);
  assert.equal(r.status, 200);
  const sc = r.headers.get("set-cookie")!;
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Lax/i);
  const me = await c.get("/api/auth/me");
  assert.equal(me.json.user.email, "anna@nalpia.com");
  assert.equal(me.json.user.password_hash, undefined, "Passwort-Hash darf nie ausgeliefert werden");
  await c.post("/api/auth/logout");
  const me2 = await c.get("/api/auth/me");
  assert.equal(me2.json.user, null);
});

test("Login: gleiche Fehlermeldung für falsches Passwort und unbekannte Adresse", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "anna@nalpia.com", password: PW });
  const c = new Client(app);
  const a = await c.login("anna@nalpia.com", "falsch-falsch-falsch");
  const b = await c.login("niemand@nalpia.com", "falsch-falsch-falsch");
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.json.error, b.json.error);
  assert.equal(a.json.code, b.json.code);
});

test("Login: nach 5 Fehlversuchen gesperrt – auch das richtige Passwort hilft dann nicht", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "anna@nalpia.com", password: PW });
  const c = new Client(app);
  for (let i = 0; i < 5; i++) assert.equal((await c.login("anna@nalpia.com", "falsch" + i + "xxxxxx")).status, 401);
  const locked = await c.login("anna@nalpia.com", PW);
  assert.equal(locked.status, 429);
  // Unbekannte Adresse verhält sich identisch
  for (let i = 0; i < 5; i++) await c.login("ghost@nalpia.com", "falsch" + i + "xxxxxx");
  const ghost = await c.login("ghost@nalpia.com", PW);
  assert.equal(ghost.status, 429);
  assert.equal(ghost.json.code, locked.json.code);
});

test("Deaktivierte und eingeladene Konten können sich nicht anmelden", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "weg@nalpia.com", password: PW, status: "disabled" });
  await addUser(deps, { email: "neu@nalpia.com", status: "invited" });
  const c = new Client(app);
  assert.equal((await c.login("weg@nalpia.com", PW)).status, 401);
  assert.equal((await c.login("neu@nalpia.com", "")).status, 401);
});

test("CSRF: zustandsändernde Requests ohne eigenen Header oder von fremdem Origin werden abgelehnt", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "anna@nalpia.com", password: PW });
  const c = new Client(app);
  await c.login("anna@nalpia.com", PW);
  const noHeader = await c.req("POST", "/api/tasks", { title: "x" }, { "x-requested-with": "" });
  assert.equal(noHeader.status, 403);
  const foreign = await c.req("POST", "/api/tasks", { title: "x" }, { origin: "https://evil.example" });
  assert.equal(foreign.status, 403);
  const crossSite = await c.req("POST", "/api/tasks", { title: "x" }, { "sec-fetch-site": "cross-site" });
  assert.equal(crossSite.status, 403);
  const ok = await c.req("POST", "/api/tasks", { title: "x" }, { origin: ORIGIN });
  assert.equal(ok.status, 201);
});

test("Geschützte Endpunkte verlangen Anmeldung; Admin-Endpunkte verlangen Adminrolle", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "m@nalpia.com", password: PW });
  const anon = new Client(app);
  assert.equal((await anon.get("/api/tasks")).status, 401);
  assert.equal((await anon.get("/api/mail/status")).status, 401);
  const m = new Client(app);
  await m.login("m@nalpia.com", PW);
  assert.equal((await m.get("/api/tasks")).status, 200);
  assert.equal((await m.get("/api/admin/users")).status, 403);
  assert.equal((await m.get("/api/admin/audit")).status, 403);
});

test("Einladung: Admin lädt ein, Link setzt Passwort genau einmal, danach Login möglich", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "admin@nalpia.com", password: PW, role: "admin" });
  const admin = new Client(app);
  await admin.login("admin@nalpia.com", PW);
  const inv = await admin.post("/api/admin/users", { email: "neu@nalpia.com", name: "Neue Person", title: "Analyst" });
  assert.equal(inv.status, 201);
  const token = inv.json.inviteUrl.split("/einladung/")[1];
  const user = new Client(app);
  assert.equal((await user.get(`/api/auth/token/invite/${token}`)).json.email, "neu@nalpia.com");
  const weak = await user.post("/api/auth/token/complete", { kind: "invite", token, password: "kurz" });
  assert.equal(weak.status, 422);
  const done = await user.post("/api/auth/token/complete", { kind: "invite", token, password: "ein-langes-gutes-passwort" });
  assert.equal(done.status, 200);
  assert.equal((await user.get("/api/auth/me")).json.user.status, "active");
  const again = await new Client(app).post("/api/auth/token/complete", { kind: "invite", token, password: "noch-ein-passwort-123" });
  assert.equal(again.status, 404, "Token darf nur einmal funktionieren");
  const fresh = new Client(app);
  assert.equal((await fresh.login("neu@nalpia.com", "ein-langes-gutes-passwort")).status, 200);
});

test("Deaktivieren beendet alle Sitzungen der Person sofort", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "admin@nalpia.com", password: PW, role: "admin" });
  const uid = await addUser(deps, { email: "m@nalpia.com", password: PW });
  const { client: admin } = await elevatedAdmin(app, deps, "admin@nalpia.com", PW);
  const m = new Client(app);
  await m.login("m@nalpia.com", PW);
  assert.equal((await m.get("/api/tasks")).status, 200);
  assert.equal((await admin.patch(`/api/admin/users/${uid}`, { status: "disabled" })).status, 200);
  assert.equal((await m.get("/api/tasks")).status, 401);
});

test("Letzte Admin-Person kann nicht entfernt werden", async () => {
  const { app, deps } = setup();
  const aid = await addUser(deps, { email: "admin@nalpia.com", password: PW, role: "admin" });
  const { client: admin } = await elevatedAdmin(app, deps, "admin@nalpia.com", PW);
  assert.equal((await admin.patch(`/api/admin/users/${aid}`, { role: "member" })).status, 400);
});

test("Passwortänderung meldet andere Geräte ab", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "a@nalpia.com", password: PW });
  const one = new Client(app);
  const two = new Client(app);
  await one.login("a@nalpia.com", PW);
  await two.login("a@nalpia.com", PW);
  const r = await one.post("/api/auth/password", { current: PW, next: "ein-ganz-neues-passwort" });
  assert.equal(r.status, 200);
  assert.equal((await one.get("/api/tasks")).status, 200);
  assert.equal((await two.get("/api/tasks")).status, 401);
});

test("2FA: Einrichtung, Login verlangt Code, Wiederherstellungscode nur einmal gültig", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "a@nalpia.com", password: PW });
  const c = new Client(app);
  await c.login("a@nalpia.com", PW);
  const s = await c.post("/api/auth/2fa/setup", { password: PW });
  assert.equal(s.status, 200);
  assert.match(s.json.qrSvg, /<svg/);
  const en = await c.post("/api/auth/2fa/enable", { code: totpCode(s.json.secret) });
  assert.equal(en.status, 200);
  const codes: string[] = en.json.recoveryCodes;
  assert.equal(codes.length, 8);
  const row = deps.db.prepare("SELECT totp_secret_enc, recovery_codes FROM users WHERE email = 'a@nalpia.com'").get() as { totp_secret_enc: string; recovery_codes: string };
  assert.ok(!row.totp_secret_enc.includes(s.json.secret), "TOTP-Secret liegt verschlüsselt in der DB");
  assert.ok(!row.recovery_codes.includes(codes[0]!), "Wiederherstellungscodes liegen nur gehasht in der DB");

  const d = new Client(app);
  const need = await d.login("a@nalpia.com", PW);
  assert.equal(need.json.code, "totp_required");
  assert.equal((await d.login("a@nalpia.com", PW, "000000")).status, 401);
  // Derselbe Code wie bei der Einrichtung gilt nicht noch einmal (Replay-Schutz) …
  const replay = await d.login("a@nalpia.com", PW, totpCode(s.json.secret));
  assert.equal(replay.status, 401);
  assert.equal(replay.json.code, "totp_invalid");
  // … der Code des nächsten Zeitfensters schon
  assert.equal((await d.login("a@nalpia.com", PW, totpCode(s.json.secret, Date.now() + 30_000))).status, 200);
  const e = new Client(app);
  assert.equal((await e.login("a@nalpia.com", PW, codes[0]!.toLowerCase())).status, 200);
  const f = new Client(app);
  assert.equal((await f.login("a@nalpia.com", PW, codes[0]!)).status, 401, "Wiederherstellungscode ist verbraucht");
});

test("2FA-Pflicht sperrt die Fach-APIs, bis die Person 2FA eingerichtet hat", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "a@nalpia.com", password: PW });
  deps.db.prepare("INSERT INTO settings (key, value) VALUES ('require_2fa', 'true')").run();
  const c = new Client(app);
  await c.login("a@nalpia.com", PW);
  assert.equal((await c.get("/api/auth/me")).json.mustSetup2fa, true);
  const blocked = await c.get("/api/tasks");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, "totp_setup_required");
  const s = await c.post("/api/auth/2fa/setup", { password: PW });
  await c.post("/api/auth/2fa/enable", { code: totpCode(s.json.secret) });
  assert.equal((await c.get("/api/tasks")).status, 200);
});

test("Sicherheits-Header sind gesetzt", async () => {
  const { app } = setup();
  const r = await app.request("/api/auth/me");
  assert.match(r.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("Audit-Log erfasst fehlgeschlagene und erfolgreiche Anmeldungen", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "a@nalpia.com", password: PW });
  const c = new Client(app);
  await c.login("a@nalpia.com", "falsch-falsch-falsch");
  await c.login("a@nalpia.com", PW);
  const actions = (deps.db.prepare("SELECT action FROM audit_log ORDER BY id").all() as { action: string }[]).map((r) => r.action);
  assert.deepEqual(actions, ["login.failed", "login.success"]);
});

test("Language: x-lang header switches error messages (English default, German with x-lang: de, saved preference otherwise)", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "anna@nalpia.com", password: PW });
  const c = new Client(app);
  const en = await c.login("anna@nalpia.com", "falsch-falsch-falsch");
  assert.equal(en.status, 401);
  assert.equal(en.json.error, "Email address or password is incorrect.");
  const de = await c.req("POST", "/api/auth/login", { email: "anna@nalpia.com", password: "falsch-falsch-falsch" }, { "x-lang": "de" });
  assert.equal(de.status, 401);
  assert.equal(de.json.error, "E-Mail-Adresse oder Passwort ist falsch.");
  assert.equal(de.json.code, en.json.code);

  // Unknown endpoint (app-level handler) and validation messages (zod, incl. lazily translated field hints)
  assert.equal((await c.req("GET", "/api/gibts-nicht", undefined, { "x-lang": "de" })).json.error, "Bitte melde dich an.");
  assert.equal((await c.login("anna@nalpia.com", PW)).status, 200);
  assert.equal((await c.req("GET", "/api/gibts-nicht", undefined, { "x-lang": "de" })).json.error, "Unbekannter Endpunkt.");
  const v = await c.req("POST", "/api/tasks", { title: "" }, { "x-lang": "de" });
  assert.equal(v.status, 422);
  assert.equal(v.json.error, "Bitte prüfe die Eingaben.");
  assert.equal(v.json.fields.title, "Bitte gib einen Titel ein.");
  const vEn = await c.post("/api/tasks", { title: "" });
  assert.equal(vEn.json.fields.title, "Please enter a title.");

  // Saved preference applies when the request names no language; the header wins over it
  assert.equal((await c.patch("/api/me/prefs", { lang: "de" })).status, 200);
  assert.equal((await c.post("/api/tasks", { title: "" })).json.fields.title, "Bitte gib einen Titel ein.");
  assert.equal((await c.req("POST", "/api/tasks", { title: "" }, { "x-lang": "en" })).json.fields.title, "Please enter a title.");
});
