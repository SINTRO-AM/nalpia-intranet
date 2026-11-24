import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";
import { parseCsv, parseMio, toCsv } from "../server/lib/csv.js";

const PW = "korrekt-pferd-batterie";

async function loggedIn(role: "admin" | "member" = "member", email = role === "admin" ? "admin@nalpia.com" : "m@nalpia.com") {
  const ctx = setup();
  await addUser(ctx.deps, { email, password: PW, role });
  const c = new Client(ctx.app);
  await c.login(email, PW);
  return { ...ctx, c };
}

/* ---------- Profilfotos ---------- */

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);

test("Profilfoto: Upload, Auslieferung mit Cache, Löschen", async () => {
  const { app, c } = await loggedIn();
  const put = await c.req("PUT", "/api/me/avatar", undefined, { "content-type": "image/jpeg" });
  assert.equal(put.status, 400, "leerer Body wird abgelehnt");

  const res = await app.request("/api/me/avatar", { method: "PUT", headers: { cookie: c.cookie, "x-requested-with": "nalpia-intranet", "content-type": "image/jpeg" }, body: JPEG });
  assert.equal(res.status, 200);
  const me = (await res.json()) as { id: string; avatarUrl: string };
  assert.match(me.avatarUrl, new RegExp(`^/api/users/${me.id}/avatar\\?v=\\d+$`));

  const img = await app.request(me.avatarUrl, { headers: { cookie: c.cookie } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.match(img.headers.get("cache-control") ?? "", /max-age=31536000/);
  assert.equal(Buffer.from(await img.arrayBuffer()).length, JPEG.length);

  // Andere Teammitglieder sehen das Foto in der Personenliste
  const users = (await c.get("/api/users")).json as { avatarUrl: string | null }[];
  assert.ok(users.some((u) => u.avatarUrl === me.avatarUrl));

  assert.equal((await c.del("/api/me/avatar")).json.avatarUrl, null);
  assert.equal((await app.request(me.avatarUrl, { headers: { cookie: c.cookie } })).status, 404);
});

test("Profilfoto: nur echte Bilder, maximal 400 KB, nicht ohne Anmeldung", async () => {
  const { app, c } = await loggedIn();
  const send = (body: Buffer, type = "image/png") =>
    app.request("/api/me/avatar", { method: "PUT", headers: { cookie: c.cookie, "x-requested-with": "nalpia-intranet", "content-type": type }, body });
  // HTML als „Bild“ getarnt
  assert.equal((await send(Buffer.from("<svg onload=alert(1)></svg>"), "image/svg+xml")).status, 422);
  assert.equal((await send(Buffer.from("<html><script>x</script></html>"))).status, 422);
  assert.equal((await send(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(401 * 1024)]))).status, 413);
  // ohne CSRF-Header
  const noCsrf = await app.request("/api/me/avatar", { method: "PUT", headers: { cookie: c.cookie, "content-type": "image/jpeg" }, body: JPEG });
  assert.equal(noCsrf.status, 403);
  const me = (await c.get("/api/auth/me")).json.user;
  assert.equal((await app.request(`/api/users/${me.id}/avatar`)).status, 401);
});

test("Profilfoto: Admins können Fotos für andere setzen, Mitglieder nicht", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "admin@nalpia.com", password: PW, role: "admin" });
  const mid = await addUser(deps, { email: "m@nalpia.com", password: PW });
  const admin = new Client(app);
  await admin.login("admin@nalpia.com", PW);
  const r = await app.request(`/api/admin/users/${mid}/avatar`, { method: "PUT", headers: { cookie: admin.cookie, "x-requested-with": "nalpia-intranet", "content-type": "image/jpeg" }, body: JPEG });
  assert.equal(r.status, 200);
  assert.ok(((await r.json()) as { avatarUrl: string }).avatarUrl);
  const m = new Client(app);
  await m.login("m@nalpia.com", PW);
  const aid = (await admin.get("/api/auth/me")).json.user.id;
  const denied = await app.request(`/api/admin/users/${aid}/avatar`, { method: "PUT", headers: { cookie: m.cookie, "x-requested-with": "nalpia-intranet", "content-type": "image/jpeg" }, body: JPEG });
  assert.equal(denied.status, 403);
});

/* ---------- Partner und Investoren ---------- */

test("Organisation anlegen, Status ändern (mit Verlaufseintrag), Ansprechpartner verknüpfen", async () => {
  const { c } = await loggedIn();
  const o = await c.post("/api/orgs", { kind: "partner", name: "BrokerHub Test", type: "broker", potentialMio: 0.2, probability: 30, website: "brokerhub-test.example" });
  assert.equal(o.status, 201);
  assert.equal(o.json.website, "https://brokerhub-test.example", "Schema wird ergänzt");
  assert.equal(o.json.stage, "identifiziert");
  // Unbekannte Art fällt auf „sonstige“ zurück, Duplikate werden erkannt
  assert.equal((await c.post("/api/orgs", { kind: "partner", name: "brokerhub test" })).status, 409);
  assert.equal((await c.post("/api/orgs", { kind: "investor", name: "BrokerHub Test", type: "quatsch" })).json.type, "sonstige");

  const p = await c.patch(`/api/orgs/${o.json.id}`, { stage: "pruefung", nextStep: "Sandbox-Test", nextDate: "2030-01-15" });
  assert.equal(p.json.stage, "pruefung");
  const wrong = await c.patch(`/api/orgs/${o.json.id}`, { stage: "termsheet" });
  assert.equal(wrong.status, 422, "Investoren-Status gilt nicht für Partner");
  assert.equal((await c.get(`/api/orgs/${o.json.id}`)).json.stage, "pruefung", "Status bleibt unverändert");

  const ct = await c.post("/api/contacts", { name: "Dr. Erika Muster", email: "e.muster@brokerhub-test.example", organizationId: o.json.id });
  assert.equal(ct.status, 201);
  assert.equal(ct.json.category, "partner", "Ansprechpartner übernimmt die Art der Organisation");
  assert.equal(ct.json.company, "BrokerHub Test");
  assert.equal(ct.json.organizationName, "BrokerHub Test");
  await c.post(`/api/contacts/${ct.json.id}/activities`, { kind: "anruf", body: "Kurz telefoniert" });
  await c.post(`/api/orgs/${o.json.id}/activities`, { kind: "dokument", body: "Track Record geschickt" });

  const d = await c.get(`/api/orgs/${o.json.id}`);
  assert.equal(d.json.contacts.length, 1);
  assert.equal(d.json.contactCount, 1);
  const kinds = d.json.activities.map((a: { kind: string; source: string }) => `${a.source}:${a.kind}`).sort();
  assert.deepEqual(kinds, ["contact:anruf", "org:dokument", "org:status"]);
  assert.ok(d.json.lastContactAt, "letzter Kontakt aus Ansprechpartnern übernommen");

  // Aufgabe an der Organisation
  const t = await c.post("/api/tasks", { title: "Integrationstest schicken", organizationId: o.json.id });
  assert.equal(t.json.organizationName, "BrokerHub Test");
  assert.equal((await c.get(`/api/orgs/${o.json.id}`)).json.tasks.length, 1);

  // Lösen und Löschen: Kontakt bleibt erhalten
  await c.del(`/api/orgs/${o.json.id}/contacts/${ct.json.id}`);
  assert.equal((await c.get(`/api/contacts/${ct.json.id}`)).json.organizationId, null);
  await c.post(`/api/orgs/${o.json.id}/contacts`, { contactId: ct.json.id });
  assert.equal((await c.del(`/api/orgs/${o.json.id}`)).status, 200);
  assert.equal((await c.get(`/api/contacts/${ct.json.id}`)).status, 200);
  assert.equal((await c.get(`/api/contacts/${ct.json.id}`)).json.organizationId, null);
});

test("Organisationen: Filter, Suche, Fit, Startseite und globale Suche", async () => {
  const { c } = await loggedIn();
  const nb = await c.post("/api/orgs", { kind: "investor", name: "Northbridge Ventures", type: "vc", focus: "Fintech, AI agents, pre-seed and seed", country: "US", city: "San Francisco", ticketMinMio: 0.1, ticketMaxMio: 1, nextStep: "Datenraum", nextDate: "2020-01-01" });
  await c.post("/api/orgs", { kind: "investor", name: "Dr. Henrik Sommer", type: "angel" });
  await c.post("/api/orgs", { kind: "partner", name: "Rhein Marktdaten", type: "data", city: "Köln" });
  assert.equal((await c.get("/api/orgs?kind=investor")).json.length, 2);
  assert.equal((await c.get("/api/orgs?kind=investor&type=angel")).json.length, 1);
  assert.equal((await c.get("/api/orgs?kind=partner&q=köln")).json.length, 1);
  assert.equal((await c.get("/api/orgs?kind=investor&q=fintech")).json[0].name, "Northbridge Ventures");
  assert.equal((await c.get("/api/orgs")).status, 422, "Art ist Pflicht");
  // Fokus-Ids und Fit werden beim Anlegen abgeleitet; Filter nach Fokus, Phase, Land und Fit
  assert.ok(nb.json.focusTags.includes("fintech") && nb.json.focusTags.includes("ai"), "focus ids derived from the text");
  assert.ok(nb.json.stageFocus.includes("pre_seed"));
  assert.ok(nb.json.fitScore >= 65, `fit for nalpia is high: ${nb.json.fitScore}`);
  assert.equal(nb.json.priority, "hoch", "priority follows the fit");
  assert.equal((await c.get("/api/orgs?kind=investor&focus=fintech")).json.length, 1);
  assert.equal((await c.get("/api/orgs?kind=investor&stageFocus=pre_seed")).json.length, 1);
  assert.equal((await c.get("/api/orgs?kind=investor&country=us")).json.length, 1);
  assert.equal((await c.get("/api/orgs?kind=investor&fit=hoch")).json.length, 1);
  assert.equal((await c.get("/api/orgs?kind=investor&outreach=none")).json.length, 2);
  const meta = (await c.get("/api/orgs/meta")).json;
  assert.ok(meta.focusTags.fintech && meta.stageFocus.pre_seed && meta.outreachStatus.draft && meta.priorOutcomes.absage);
  // Priorität von Hand bleibt bei Neuberechnung erhalten
  await c.patch(`/api/orgs/${nb.json.id}`, { priority: "niedrig" });
  assert.equal((await c.get(`/api/orgs/${nb.json.id}`)).json.priority, "niedrig");
  assert.equal((await c.get(`/api/orgs/${nb.json.id}`)).json.priorityManual, true);
  const home = await c.get("/api/home");
  assert.ok(home.json.followUps.some((f: { href: string; source: string }) => f.source === "org" && f.href.startsWith("/investoren/")));
  const s = await c.get("/api/search?q=marktdaten");
  assert.equal(s.json.orgs.length, 1);
});

test("Löschen nur durch Zuständige, Anlegende oder Admins; Rundenziel nur durch Admins", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "a@nalpia.com", password: PW });
  await addUser(deps, { email: "b@nalpia.com", password: PW });
  await addUser(deps, { email: "admin@nalpia.com", password: PW, role: "admin" });
  const a = new Client(app);
  const b = new Client(app);
  const admin = new Client(app);
  await a.login("a@nalpia.com", PW);
  await b.login("b@nalpia.com", PW);
  await admin.login("admin@nalpia.com", PW);
  const o = await a.post("/api/orgs", { kind: "investor", name: "Isarvest Capital" });
  assert.equal((await b.del(`/api/orgs/${o.json.id}`)).status, 403);
  assert.equal((await b.patch("/api/orgs/round", { targetMio: 3 })).status, 403);
  assert.equal((await admin.patch("/api/orgs/round", { name: "Seed", targetMio: 2.5 })).json.targetMio, 2.5);
  assert.equal((await b.get("/api/orgs/round")).json.name, "Seed");
  assert.equal((await admin.del(`/api/orgs/${o.json.id}`)).status, 200);
  const logged = deps.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'org.deleted'").get() as { n: number };
  assert.equal(logged.n, 1);
});

test("CSV-Import: Vorschau ändert nichts, Import erkennt Spalten, Beträge, Arten und Dubletten", async () => {
  const { c, deps } = await loggedIn();
  const csv = [
    "Organisation;Art;Status;Ort;AuM;Potenzial;Ansprechpartner;E-Mail;Position",
    'Nordsee Broker AG;;Im Gespräch;Hamburg;"4.200";25;Dr. A. Beispiel;a.beispiel@nordsee-broker.example;Head of Partnerships',
    "Evangelische Stiftung Nord;Stiftung;Lead;Kiel;1,2 Mrd;10 Mio;;;",
    "Nordsee Broker AG;;;;;;B. Zweite;b.zweite@nordsee-broker.example;Risiko",
    ";;;;;;;;",
    "Kleine Börse;Börse;kontaktiert;;500.000.000;5000000;;;",
  ].join("\n");
  const dry = await c.post("/api/orgs/import", { kind: "partner", text: csv, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.json.created, 3);
  assert.equal(dry.json.contacts, 2);
  assert.ok(dry.json.columns.includes("aumMio"));
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM organizations").get() as { n: number }).n, 0, "Vorschau schreibt nichts");

  const run = await c.post("/api/orgs/import", { kind: "partner", text: csv });
  assert.equal(run.json.created, 3);
  const list = (await c.get("/api/orgs?kind=partner")).json as { name: string; type: string; stage: string; aumMio: number; potentialMio: number; contactCount: number; source: string }[];
  const vw = list.find((o) => o.name === "Nordsee Broker AG")!;
  assert.equal(vw.type, "broker", "Art aus dem Namen erkannt");
  assert.equal(vw.stage, "gespraech");
  assert.equal(vw.aumMio, 4200);
  assert.equal(vw.contactCount, 2, "zweite Zeile ergänzt einen Ansprechpartner");
  assert.equal(vw.source, "CSV import");
  const st = list.find((o) => o.name === "Evangelische Stiftung Nord")!;
  assert.equal(st.aumMio, 1200);
  assert.equal(st.potentialMio, 10);
  const pk = list.find((o) => o.name === "Kleine Börse")!;
  assert.equal(pk.aumMio, 500, "Euro-Beträge werden in Mio. umgerechnet");
  assert.equal(pk.potentialMio, 5);
  assert.equal(pk.stage, "kontaktiert");

  // Zweiter Import derselben Datei legt nichts doppelt an
  const again = await c.post("/api/orgs/import", { kind: "partner", text: csv });
  assert.equal(again.json.created, 0);
  assert.equal(again.json.contacts, 0);
  assert.equal((await c.post("/api/orgs/import", { kind: "partner", text: "Foo;Bar\n1;2" })).json.code, "no_name_column");
});

test("CSV-Export: Excel-tauglich, mit Ansprechpartnern, ohne Formel-Injection, protokolliert", async () => {
  const { c, deps, app } = await loggedIn();
  const o = await c.post("/api/orgs", { kind: "investor", name: "=HYPERLINK(\"http://evil\")", type: "vc", potentialMio: 1.5, notes: "Zeile 1\nZeile 2; mit Semikolon" });
  await c.post("/api/contacts", { name: "Maja Lindqvist", email: "maja@nb.example", organizationId: o.json.id });
  const res = await app.request("/api/orgs/export?kind=investor", { headers: { cookie: c.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /nalpia-investoren-\d{4}-\d{2}-\d{2}\.csv/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8-BOM für Excel");
  const text = bytes.toString("utf8");
  assert.ok(text.startsWith("\uFEFFName;Type;Status"));
  assert.ok(text.includes("'=HYPERLINK"), "Formel wird entschärft");
  assert.ok(text.includes("1,5"), "Dezimalkomma");
  assert.ok(text.includes("maja@nb.example"));
  assert.ok(text.includes('"Zeile 1\nZeile 2; mit Semikolon"'));
  const a = deps.db.prepare("SELECT meta FROM audit_log WHERE action = 'org.exported'").get() as { meta: string };
  assert.equal(JSON.parse(a.meta).rows, 1);
});

test("CSV-Hilfen: Trennzeichen, Anführungszeichen, Beträge", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","He said ""hi"""\n'), [
    ["a", "b"],
    ["x, y", 'He said "hi"'],
  ]);
  assert.deepEqual(parseCsv("﻿a\tb\r\n1\t2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.equal(parseMio("2,5"), 2.5);
  assert.equal(parseMio("500k"), 0.5);
  assert.equal(parseMio("150 Tsd. €"), 0.15);
  assert.equal(parseMio("1,2 Mrd"), 1200);
  assert.equal(parseMio("€ 250.000"), 0.25);
  assert.equal(parseMio("1.250"), 1250);
  assert.equal(parseMio(""), null);
  assert.equal(parseMio("k.A."), null);
  assert.equal(toCsv(["x"], [["@SUM(A1)"], ["-1"], [null]]), "﻿x\r\n'@SUM(A1)\r\n'-1\r\n\r\n");
});
