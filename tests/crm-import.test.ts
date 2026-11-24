import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, elevatedAdmin, setup } from "./helpers.js";
import { importCrmBundle, parseCrmBundle } from "../server/lib/crm-import.js";

const PW = "korrekt-pferd-batterie";

function bundle(extra: Record<string, unknown> = {}) {
  return {
    format: "sintro-crm-bundle",
    version: 1,
    source: "Test",
    ownerEmail: "dk@nalpia.com",
    round: { name: "Pre-Seed-Runde", targetMio: 0.5, committedExtraMio: 0.1, preMoneyMio: 2.5 },
    orgs: [
      { ref: "crm:investor-org:alpha", kind: "investor", name: "Alpha Ventures", type: "vc", stage: "kontaktiert", priority: "hoch", priorityManual: true, website: "alpha.example", ticketMinMio: 0.5, ticketMaxMio: 2, tags: ["Seed"], notes: "Aufhänger: Fintech", createdAt: 1_700_000_000_000 },
      { ref: "crm:partner-org:vw", kind: "partner", name: "BrokerHub", type: "broker", stage: "gespraech", priority: "mittel" },
      { ref: "crm:investor-org:bad", kind: "investor", name: "Unbekannt GmbH", type: "erfunden", stage: "erfunden", website: "javascript:alert(1)" },
    ],
    contacts: [
      { ref: "crm:investors:a1", orgRef: "crm:investor-org:alpha", name: "Anna Alpha", email: "Anna@Alpha.example", position: "Partner", category: "investor", stage: "Kontaktiert", linkedin: "linkedin.com/in/anna" },
      { ref: "crm:investors:a2", orgRef: "crm:investor-org:alpha", name: "Ben Alpha", email: "kaputt", category: "investor", stage: "gibtsnicht" },
      { ref: "crm:customers:k1", orgRef: "crm:partner-org:vw", name: "Dr. Erika Muster", email: "e.muster@vw.example", category: "partner", stage: "In Abstimmung" },
      { ref: "crm:stakeholders:s1", name: "Kanzlei Kontakt", email: "law@kanzlei.example", company: "Kanzlei", category: "stakeholder", stage: "Wartet", tags: ["Recht & Steuern"] },
    ],
    activities: [
      { ref: "crm:act:1", contactRef: "crm:investors:a1", kind: "mail", body: "Gesendet: Seed\n\nHallo Anna", createdAt: 1_790_000_000_000, mail: { messageId: "111", folderId: "22", subject: "Seed" } },
      { ref: "crm:act:2", contactRef: "crm:investors:a1", kind: "status", body: "Status: Neu → Kontaktiert", createdAt: 1_790_000_100_000 },
      { ref: "crm:act:3", contactRef: "crm:fehlt:x", kind: "notiz", body: "verwaist", createdAt: 1_790_000_200_000 },
    ],
    ...extra,
  };
}

test("CRM-Import: legt Institutionen, Kontakte und Verlauf an und ist wiederholbar", async () => {
  const { deps } = setup();
  const dk = await addUser(deps, { email: "dk@nalpia.com", name: "Denis Keller", role: "admin", password: PW });
  const b = parseCrmBundle(bundle());

  const dry = importCrmBundle(deps.db, b, { actorId: dk, fallbackOwnerId: dk, dryRun: true });
  assert.equal(dry.orgs.created, 3);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM organizations").get() as { n: number }).n, 0, "Probelauf speichert nichts");
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'crm.import'").get() as { n: number }).n, 0);

  const r = importCrmBundle(deps.db, b, { actorId: dk, fallbackOwnerId: dk });
  assert.deepEqual(r.orgs, { created: 3, linked: 0, updated: 0, unchanged: 0 });
  assert.deepEqual(r.contacts, { created: 4, linked: 0, updated: 0, unchanged: 0 });
  assert.deepEqual(r.activities, { created: 2, skipped: 1 });
  assert.equal(r.owner?.name, "Denis Keller");
  assert.equal(r.round, "gesetzt");

  const alpha = deps.db.prepare("SELECT * FROM organizations WHERE external_ref = 'crm:investor-org:alpha'").get() as Record<string, unknown>;
  assert.equal(alpha.owner_id, dk);
  assert.equal(alpha.website, "https://alpha.example");
  assert.equal(alpha.ticket_max_mio, 2);
  assert.equal(alpha.created_at, 1_700_000_000_000);
  const bad = deps.db.prepare("SELECT type, stage, website FROM organizations WHERE external_ref = 'crm:investor-org:bad'").get() as Record<string, unknown>;
  assert.deepEqual(bad, { type: "sonstige", stage: "identifiziert", website: "" }, "unbekannte Werte fallen auf Standard zurück, unsichere Links werden verworfen");

  const anna = deps.db.prepare("SELECT * FROM contacts WHERE external_ref = 'crm:investors:a1'").get() as Record<string, unknown>;
  assert.equal(anna.email, "anna@alpha.example");
  assert.equal(anna.organization_id, alpha.id);
  assert.equal(anna.company, "Alpha Ventures", "Firma kommt von der Institution");
  assert.equal(anna.linkedin, "https://linkedin.com/in/anna");
  assert.equal(anna.last_contact_at, 1_790_000_000_000, "letzter Kontakt aus der Mail");
  const ben = deps.db.prepare("SELECT email, stage FROM contacts WHERE external_ref = 'crm:investors:a2'").get();
  assert.deepEqual(ben, { email: "", stage: "Recherche" });
  const st = deps.db.prepare("SELECT category, stage, organization_id FROM contacts WHERE external_ref = 'crm:stakeholders:s1'").get();
  assert.deepEqual(st, { category: "stakeholder", stage: "Wartet", organization_id: null });

  const mail = deps.db.prepare("SELECT mail_ref, user_id FROM contact_activities WHERE external_ref = 'crm:act:1'").get() as { mail_ref: string; user_id: string };
  assert.deepEqual(JSON.parse(mail.mail_ref), { messageId: "111", folderId: "22", subject: "Seed", date: 1_790_000_000_000, ownerId: dk });

  const round = JSON.parse((deps.db.prepare("SELECT value FROM settings WHERE key = 'investor_round'").get() as { value: string }).value);
  assert.deepEqual(round, { name: "Pre-Seed-Runde", targetMio: 0.5, committedExtraMio: 0.1, preMoneyMio: 2.5 });
  assert.ok(typeof alpha.fit_score === "number" && (alpha.fit_score as number) > 0, "fit for nalpia is calculated on import");

  // Zweiter Lauf: nichts doppelt, Änderungen im Intranet bleiben erhalten
  deps.db.prepare("UPDATE organizations SET stage = 'termsheet', notes = 'eigene Notiz' WHERE id = ?").run(alpha.id);
  const again = importCrmBundle(deps.db, b, { actorId: dk, fallbackOwnerId: dk });
  assert.deepEqual(again.orgs, { created: 0, linked: 0, updated: 0, unchanged: 3 });
  assert.deepEqual(again.contacts, { created: 0, linked: 0, updated: 0, unchanged: 4 });
  assert.deepEqual(again.activities, { created: 0, skipped: 3 });
  assert.equal(again.round, "unverändert");
  assert.deepEqual(deps.db.prepare("SELECT stage, notes FROM organizations WHERE id = ?").get(alpha.id), { stage: "termsheet", notes: "eigene Notiz" });

  // Mit „aktualisieren“ gewinnt das CRM
  const upd = importCrmBundle(deps.db, b, { actorId: dk, fallbackOwnerId: dk, update: true });
  assert.equal(upd.orgs.updated, 3);
  assert.deepEqual(deps.db.prepare("SELECT stage, notes FROM organizations WHERE id = ?").get(alpha.id), { stage: "kontaktiert", notes: "Aufhänger: Fintech" });
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM contact_activities").get() as { n: number }).n, 2);
});

test("CRM-Import: verknüpft von Hand angelegte Institutionen und Kontakte statt sie zu verdoppeln", async () => {
  const { deps } = setup();
  const dk = await addUser(deps, { email: "dk@nalpia.com", role: "admin", password: PW });
  const now = Date.now();
  deps.db
    .prepare("INSERT INTO organizations (id, kind, name, stage, notes, created_at, updated_at) VALUES ('o1', 'investor', ' alpha ventures', 'gespraech', 'bleibt', ?, ?)")
    .run(now, now);
  deps.db
    .prepare("INSERT INTO contacts (id, name, email, category, stage, phone, created_at, updated_at) VALUES ('c1', 'Anna A.', 'anna@alpha.example', 'investor', 'Im Gespräch', '+49 1', ?, ?)")
    .run(now, now);
  const r = importCrmBundle(deps.db, parseCrmBundle(bundle()), { actorId: dk, fallbackOwnerId: dk });
  assert.equal(r.orgs.linked, 1);
  assert.equal(r.contacts.linked, 1);
  const o = deps.db.prepare("SELECT external_ref, stage, notes, website FROM organizations WHERE id = 'o1'").get();
  assert.deepEqual(o, { external_ref: "crm:investor-org:alpha", stage: "gespraech", notes: "bleibt", website: "https://alpha.example" });
  const c = deps.db.prepare("SELECT name, phone, organization_id, external_ref FROM contacts WHERE id = 'c1'").get();
  assert.deepEqual(c, { name: "Anna A.", phone: "+49 1", organization_id: "o1", external_ref: "crm:investors:a1" });
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM organizations WHERE kind = 'investor'").get() as { n: number }).n, 2);
});

test("CRM-Import: ohne passendes Konto gehören Datensätze der importierenden Person, Mail-Verweise entfallen", async () => {
  const { deps } = setup();
  const other = await addUser(deps, { email: "admin@nalpia.com", name: "Admin", role: "admin", password: PW });
  const r = importCrmBundle(deps.db, parseCrmBundle(bundle()), { actorId: other, fallbackOwnerId: other });
  assert.equal(r.owner?.id, other);
  assert.match(r.warnings.join(" "), /dk@nalpia\.com/);
  assert.equal((deps.db.prepare("SELECT mail_ref FROM contact_activities WHERE external_ref = 'crm:act:1'").get() as { mail_ref: string | null }).mail_ref, null);
});

test("CRM-Import: ungültige Pakete werden abgelehnt", () => {
  assert.throws(() => parseCrmBundle({ format: "anders" }), /not a valid CRM bundle/);
  assert.throws(() => parseCrmBundle(bundle({ orgs: [{ ref: "x", kind: "lieferant", name: "X" }] })), /orgs\.0\.kind/);
});

test("CRM-Import über die Verwaltung: nur Admins, echter Import nur mit Bestätigung, große Pakete erlaubt", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "dk@nalpia.com", role: "admin", password: PW });
  await addUser(deps, { email: "m@nalpia.com", role: "member", password: PW });
  const member = new Client(app);
  await member.login("m@nalpia.com", PW);
  assert.equal((await member.post("/api/admin/import-crm?probe=1", bundle())).status, 403);

  const plain = new Client(app);
  await plain.login("dk@nalpia.com", PW);
  const probe = await plain.post("/api/admin/import-crm?probe=1", bundle());
  assert.equal(probe.status, 200, probe.text);
  assert.equal(probe.json.dryRun, true);
  assert.equal(probe.json.orgs.created, 3);
  const real = await plain.post("/api/admin/import-crm", bundle());
  assert.equal(real.status, 403);
  assert.equal(real.json.code, "admin_2fa_required", "heikle Admin-Aktion verlangt 2FA");
  assert.equal((await plain.post("/api/admin/import-crm/bereit")).json.code, "admin_2fa_required", "Vorabprüfung ohne Upload");

  const { client: admin } = await elevatedAdmin(app, deps, "dk@nalpia.com", PW);
  assert.equal((await admin.post("/api/admin/import-crm/bereit")).status, 200);
  // ~3 MB Paket: über dem allgemeinen 1-MB-Limit, unter dem Import-Limit
  const many = Array.from({ length: 2500 }, (_, i) => ({ ref: `crm:investors:p${i}`, name: `Person ${i}`, category: "investor", notes: "x".repeat(1100) }));
  const big = await admin.post("/api/admin/import-crm", bundle({ contacts: [...bundle().contacts, ...many] }));
  assert.equal(big.status, 200, big.text);
  assert.equal(big.json.contacts.created, 2504);
  assert.equal((await admin.get("/api/contacts/counts")).json.byCategory.investor, 2502);
  const list = (await admin.get("/api/orgs?kind=investor")).json as { name: string; notes: string }[];
  assert.ok(list.every((o) => o.notes === ""), "Liste ohne Notizen");
  const audit = deps.db.prepare("SELECT meta FROM audit_log WHERE action = 'crm.import'").all() as { meta: string }[];
  assert.equal(audit.length, 1);

  // Das allgemeine Limit gilt weiter für andere Routen
  const tooBig = await admin.post("/api/news", { title: "x", body: "y".repeat(1_200_000) });
  assert.equal(tooBig.status, 413);
});

test("Übersicht: Workflow-Spalten, Kennzahlen und Trichter", async () => {
  const { app, deps } = setup();
  const dk = await addUser(deps, { email: "dk@nalpia.com", name: "Denis Keller", role: "admin", password: PW });
  importCrmBundle(deps.db, parseCrmBundle(bundle()), { actorId: dk, fallbackOwnerId: dk });
  const c = new Client(app);
  await c.login("dk@nalpia.com", PW);

  let d = (await c.get("/api/orgs/dashboard?kind=investor")).json;
  assert.equal(d.lanes.wartet.total, 1, "angeschrieben, keine Antwort");
  assert.equal(d.lanes.wartet.items[0].name, "Alpha Ventures");
  assert.equal(d.lanes.wartet.items[0].last.dir, "out");
  assert.equal(d.kpis.contacted, 1);
  assert.equal(d.kpis.replied, 0);
  assert.deepEqual(
    d.funnel.slice(0, 2).map((f: { reached: number }) => f.reached),
    [2, 1],
  );

  // Antwort kommt rein → „Antwort offen“
  const anna = deps.db.prepare("SELECT id FROM contacts WHERE external_ref = 'crm:investors:a1'").get() as { id: string };
  const r = await c.post(`/api/contacts/${anna.id}/activities`, { kind: "mail", body: "Erhalten: Re: Seed\n\nGerne!" });
  assert.equal(r.status, 201, r.text);
  d = (await c.get("/api/orgs/dashboard?kind=investor")).json;
  assert.equal(d.lanes.antwort.total, 1);
  assert.equal(d.lanes.wartet.total, 0);
  assert.equal(d.kpis.replied, 1);
  assert.equal(d.kpis.responseRate, 1);
  assert.equal(d.weekly.length, 10);
  assert.ok(d.recent[0].text.startsWith("Re: Seed"));

  // Im Gespräch → eigene Spalte, auch mit offener Antwort nicht mehr „wartet“
  const alpha = deps.db.prepare("SELECT id FROM organizations WHERE external_ref = 'crm:investor-org:alpha'").get() as { id: string };
  await c.post(`/api/contacts/${anna.id}/activities`, { kind: "mail", body: "Gesendet: Termin" });
  await c.patch(`/api/orgs/${alpha.id}`, { stage: "gespraech" });
  d = (await c.get("/api/orgs/dashboard?kind=investor")).json;
  assert.equal(d.lanes.gespraech.items[0].id, alpha.id);

  // Partner: eigene Daten, Typ-Verteilung
  const k = (await c.get("/api/orgs/dashboard?kind=partner")).json;
  assert.equal(k.byType[0].type, "broker");
  assert.equal(k.lanes.gespraech.total, 1);
  assert.equal((await c.get("/api/orgs/dashboard?kind=lieferant")).status, 422);
});

test("Übersicht: Abwesenheitsnotizen und Kalender-Antworten gelten nicht als Antwort", async () => {
  const { mailDirection } = await import("../server/lib/org-dashboard.js");
  assert.equal(mailDirection("mail", "Erhalten: Re: Seed"), "in");
  assert.equal(mailDirection("mail", "Erhalten: Automatische Antwort: [X/SINTRO]"), null);
  assert.equal(mailDirection("mail", "Erhalten: Angenommen: Call SINTRO"), null);
  assert.equal(mailDirection("mail", "Erhalten: Updated invitation: 30 min"), null);
  assert.equal(mailDirection("mail", "Gesendet: Seed"), "out");
  assert.equal(mailDirection("notiz", "Erhalten: x"), null);
});

test("CRM-Import: Aufgaben aus offenen Antworten und nächsten Schritten, ohne Dubletten", async () => {
  const { deps } = setup();
  const dk = await addUser(deps, { email: "dk@nalpia.com", name: "Denis Keller", role: "admin", password: PW });
  const b = bundle();
  b.orgs[1] = { ...b.orgs[1]!, nextStep: "Nachfassen, falls keine Antwort", nextDate: "2026-11-02", priority: "hoch" } as (typeof b.orgs)[number];
  b.orgs[2] = { ...b.orgs[2]!, nextStep: "Auf Antwort zur Vorab-Mail warten", nextDate: "2026-11-02" } as (typeof b.orgs)[number];
  b.activities.push({ ref: "crm:act:9", contactRef: "crm:investors:a1", kind: "mail", body: "Erhalten: Re: Seed\n\nGerne ein Call", createdAt: 1_790_000_300_000 } as (typeof b.activities)[number]);
  const parsed = parseCrmBundle(b);

  const dry = importCrmBundle(deps.db, parsed, { actorId: dk, fallbackOwnerId: dk, tasks: true, dryRun: true });
  assert.equal(dry.tasks.created, 2);
  const r = importCrmBundle(deps.db, parsed, { actorId: dk, fallbackOwnerId: dk, tasks: true });
  assert.deepEqual(r.tasks, { created: 2, skipped: 0 });
  const tasks = deps.db.prepare("SELECT title, due_date, priority, assignee_id, organization_id IS NOT NULL AS org, contact_id IS NOT NULL AS ct FROM tasks ORDER BY title").all();
  assert.deepEqual(tasks, [
    { title: "Alpha Ventures: reply to Anna Alpha", due_date: tasks[0] && (tasks[0] as { due_date: string }).due_date, priority: "hoch", assignee_id: dk, org: 1, ct: 1 },
    { title: "BrokerHub: Nachfassen, falls keine Antwort", due_date: "2026-11-02", priority: "hoch", assignee_id: dk, org: 1, ct: 1 },
  ]);
  // Erledigte Aufgaben kommen beim nächsten Import nicht wieder
  deps.db.prepare("UPDATE tasks SET status = 'erledigt'").run();
  const again = importCrmBundle(deps.db, parsed, { actorId: dk, fallbackOwnerId: dk, tasks: true });
  assert.deepEqual(again.tasks, { created: 0, skipped: 2 });
  // Ohne Option keine Aufgaben
  const { deps: d2 } = setup();
  const u2 = await addUser(d2, { email: "dk@nalpia.com", role: "admin", password: PW });
  importCrmBundle(d2.db, parsed, { actorId: u2, fallbackOwnerId: u2 });
  assert.equal((d2.db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n, 0);
});

test("CRM-Import: verpackte Pakete werden erkannt (JSON-Text, { data }, Liste)", () => {
  const b = bundle();
  for (const v of [JSON.stringify(b), { data: b }, [b], JSON.stringify(JSON.stringify(b))]) assert.equal(parseCrmBundle(v).orgs.length, 3);
  assert.throws(() => parseCrmBundle({ investors: [], customers: [] }), /not a valid CRM bundle/);
});

test("CRM-Import: ohne Überschreiben werden nur leere E-Mails nachgetragen", async () => {
  const { deps } = setup();
  const dk = await addUser(deps, { email: "dk@nalpia.com", name: "Denis Keller", role: "admin", password: PW });
  const first = bundle();
  first.contacts = first.contacts.map((c) => (c.ref === "crm:customers:k1" ? { ...c, email: "" } : c));
  importCrmBundle(deps.db, parseCrmBundle(first), { actorId: dk, fallbackOwnerId: dk });
  deps.db.prepare("UPDATE contacts SET position = 'Intranet-Edit' WHERE external_ref = 'crm:customers:k1'").run();
  const again = bundle();
  again.contacts = again.contacts.map((c) => (c.ref === "crm:investors:a1" ? { ...c, email: "neu@alpha.example", position: "CEO" } : c));
  const r = importCrmBundle(deps.db, parseCrmBundle(again), { actorId: dk, fallbackOwnerId: dk });
  const row = (ref: string) => deps.db.prepare("SELECT email, position FROM contacts WHERE external_ref = ?").get(ref) as { email: string; position: string };
  assert.equal(row("crm:customers:k1").email, "e.muster@vw.example");
  assert.equal(row("crm:customers:k1").position, "Intranet-Edit");
  assert.equal(row("crm:investors:a1").email, "anna@alpha.example");
  assert.equal(row("crm:investors:a1").position, "Partner");
  assert.equal(r.contacts.updated, 1);
});
