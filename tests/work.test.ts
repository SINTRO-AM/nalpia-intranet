import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";
import { htmlToText, parseAddresses, textToHtml } from "../server/lib/util.js";

const PW = "korrekt-pferd-batterie";

async function team() {
  const s = setup();
  const anna = await addUser(s.deps, { email: "anna@nalpia.com", name: "Anna A", password: PW, role: "admin" });
  const ben = await addUser(s.deps, { email: "ben@nalpia.com", name: "Ben B", password: PW });
  const a = new Client(s.app);
  const b = new Client(s.app);
  await a.login("anna@nalpia.com", PW);
  await b.login("ben@nalpia.com", PW);
  return { ...s, ids: { anna, ben }, a, b };
}

test("Aufgaben: zuweisen benachrichtigt, Erledigen setzt Zeitpunkt, Löschrechte", async () => {
  const { a, b, ids } = await team();
  const t = await a.post("/api/tasks", { title: "Deck schicken", assigneeId: ids.ben, dueDate: "2030-01-15", priority: "hoch" });
  assert.equal(t.status, 201);
  const n = await b.get("/api/notifications");
  assert.equal(n.json.unread, 1);
  assert.match(n.json.items[0].title, /Anna A assigned “Deck schicken” to you/);
  const mine = await b.get("/api/tasks?assignee=me");
  assert.equal(mine.json.length, 1);
  const done = await b.patch(`/api/tasks/${t.json.id}`, { status: "erledigt" });
  assert.ok(done.json.completedAt > 0);
  assert.equal((await a.get("/api/notifications")).json.unread, 1, "Ersteller wird über Erledigung informiert");
  const other = await a.post("/api/tasks", { title: "Annas Aufgabe" });
  assert.equal((await b.del(`/api/tasks/${other.json.id}`)).status, 403);
  assert.equal((await a.del(`/api/tasks/${other.json.id}`)).status, 200);
  assert.equal((await a.post("/api/tasks", { title: "x", dueDate: "2030-13-45" })).status, 422);
  assert.equal((await a.post("/api/tasks", { title: "x", assigneeId: "gibt-es-nicht" })).status, 404);
});

test("Meilensteine: Fortschritt aus verknüpften Aufgaben", async () => {
  const { a } = await team();
  const m = await a.post("/api/milestones", { title: "Seed-Runde", dueDate: "2030-03-01" });
  const t1 = await a.post("/api/tasks", { title: "A", milestoneId: m.json.id });
  await a.post("/api/tasks", { title: "B", milestoneId: m.json.id });
  await a.patch(`/api/tasks/${t1.json.id}`, { status: "erledigt" });
  const got = await a.get(`/api/milestones/${m.json.id}`);
  assert.equal(got.json.taskTotal, 2);
  assert.equal(got.json.taskDone, 1);
  assert.equal(got.json.progress, 0.5);
  assert.equal(got.json.tasks.length, 2);
});

test("News: Beitrag benachrichtigt alle, Lesestatus je Person, nur Admins heften an, Reaktionen umschalten", async () => {
  const { a, b } = await team();
  assert.equal((await b.post("/api/news", { title: "Hallo Team", body: "Text", pinned: true })).status, 403);
  const p = await b.post("/api/news", { title: "Hallo Team", body: "**Neu**", category: "produkt" });
  assert.equal(p.status, 201);
  assert.equal((await a.get("/api/news")).json.unread, 1);
  assert.equal((await b.get("/api/news")).json.unread, 0, "Eigene Beiträge gelten als gelesen");
  await a.get(`/api/news/${p.json.id}`);
  assert.equal((await a.get("/api/news")).json.unread, 0);
  const r1 = await a.post(`/api/news/${p.json.id}/reactions`, { emoji: "🎉" });
  assert.equal(r1.json.reactions[0].count, 1);
  const r2 = await a.post(`/api/news/${p.json.id}/reactions`, { emoji: "🎉" });
  assert.equal(r2.json.reactions.length, 0);
  assert.equal((await a.post(`/api/news/${p.json.id}/reactions`, { emoji: "💩" })).status, 422);
  await a.post(`/api/news/${p.json.id}/comments`, { body: "Super!" });
  assert.ok((await b.get("/api/notifications")).json.items.some((x: { title: string }) => /commented on/.test(x.title)));
  const edited = await b.patch(`/api/news/${p.json.id}`, { title: "Geändert" });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.category, "produkt", "Teil-Update darf die Kategorie nicht zurücksetzen");
  assert.equal((await a.patch(`/api/news/${p.json.id}`, { pinned: true })).json.pinned, true);
});

test("Kontakte: Dubletten per E-Mail, Statuswechsel landet im Verlauf, Lookup für das Postfach", async () => {
  const { a } = await team();
  const c = await a.post("/api/contacts", { name: "Clara W", email: "Clara@Fonds.example", category: "investor" });
  assert.equal(c.status, 201);
  assert.equal(c.json.stage, "Recherche");
  const dup = await a.post("/api/contacts", { name: "Doppelt", email: "clara@fonds.example" });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.id, c.json.id);
  await a.patch(`/api/contacts/${c.json.id}`, { stage: "Due Diligence" });
  await a.patch(`/api/contacts/${c.json.id}`, { stage: "Gibt es nicht" });
  const d = await a.get(`/api/contacts/${c.json.id}`);
  assert.equal(d.json.stage, "Recherche", "Ungültige Stufe fällt auf die erste zurück");
  assert.ok(d.json.activities.some((x: { body: string }) => x.body.includes("Due diligence")));
  const l = await a.get("/api/contacts/lookup?emails=clara@fonds.example,unbekannt@x.de");
  assert.deepEqual(Object.keys(l.json), ["clara@fonds.example"]);
  assert.equal((await a.post("/api/contacts", { name: "X", linkedin: "javascript:alert(1)" })).status, 422);
});

test("Startseite und Suche liefern aggregierte Daten", async () => {
  const { a, ids } = await team();
  await a.post("/api/tasks", { title: "Überfällige Sache", assigneeId: ids.anna, dueDate: "2020-01-01" });
  const h = await a.get("/api/home");
  assert.equal(h.status, 200);
  assert.equal(h.json.stats.overdue, 1);
  const s = await a.get("/api/search?q=Überfällig");
  assert.equal(s.json.tasks.length, 1);
});

test("Body-Limit und unbekannte Endpunkte", async () => {
  const { a } = await team();
  const big = await a.post("/api/tasks", { title: "x", description: "y".repeat(1_100_000) });
  assert.equal(big.status, 413);
  assert.equal((await a.get("/api/gibtsnicht")).status, 404);
});

test("Hilfsfunktionen: Adressen, HTML → Text, Text → HTML", () => {
  assert.deepEqual(parseAddresses("&quot;Max M&quot;&lt;max@x.de&gt;, anna@y.de"), [
    { name: "Max M", email: "max@x.de" },
    { name: "", email: "anna@y.de" },
  ]);
  assert.deepEqual(parseAddresses("Not Provided"), []);
  assert.equal(htmlToText("<style>p{}</style><p>Hallo&nbsp;Welt</p><p>Zeile<br>2</p>"), "Hallo Welt\nZeile\n2");
  assert.equal(textToHtml("a<b>\nc\n\nd"), "<div>a&lt;b&gt;<br>c</div><div><br></div><div>d</div>");
});

test("Konfiguration: Produktion verlangt starkes APP_SECRET und https", async () => {
  const { loadConfig } = await import("../server/config.js");
  assert.throws(() => loadConfig({ NODE_ENV: "production", APP_URL: "https://intranet.nalpia.com" }), /APP_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: "production", APP_URL: "http://intranet.nalpia.com", APP_SECRET: "x".repeat(40) }), /https/);
  const ok = loadConfig({ NODE_ENV: "production", APP_URL: "https://intranet.nalpia.com", APP_SECRET: "x".repeat(40) });
  assert.equal(ok.secureCookies, true);
});
