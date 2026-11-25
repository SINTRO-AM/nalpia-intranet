import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";
import { importCrmBundle, parseCrmBundle } from "../server/lib/crm-import.js";
import { todayISO } from "../server/lib/util.js";

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

test("Themen: anlegen, Pipeline-Phasen, Wartet-seit, Verlauf, Benachrichtigung, Löschen lässt Aufgaben stehen", async () => {
  const { a, b, ids } = await team();
  const t = await a.post("/api/topics", { title: "EXIST-Antrag", counterpart: "Projektträger Jülich", ownerId: ids.ben, area: "Förderung" });
  assert.equal(t.status, 201);
  assert.equal(t.json.kind, "extern", "Mit Gegenüber automatisch extern");
  assert.equal(t.json.stage, "geplant");
  assert.match((await b.get("/api/notifications")).json.items[0].title, /made you responsible for “EXIST-Antrag”/);
  const t2 = await a.post("/api/topics", { title: "Monorepo", stage: "geplant" });
  assert.equal(t2.json.kind, "intern");
  assert.equal(t2.json.ownerId, ids.anna, "Ohne Angabe verantwortlich: wer anlegt");
  assert.ok(t2.json.sortOrder < t.json.sortOrder, "Neue Karten oben in der Spalte");

  const w = await b.patch(`/api/topics/${t.json.id}`, { stage: "wartet", waitingOn: "Rückmeldung der Hochschule", followUp: "2030-02-01" });
  assert.ok(w.json.waitingSince > 0);
  const w2 = await b.patch(`/api/topics/${t.json.id}`, { nextStep: "Mentor anrufen" });
  assert.equal(w2.json.waitingSince, w.json.waitingSince, "Wartet-seit bleibt beim Bearbeiten");
  const done = await a.patch(`/api/topics/${t.json.id}`, { stage: "erledigt" });
  assert.ok(done.json.closedAt > 0);
  assert.equal(done.json.waitingSince, null);
  assert.ok((await b.get("/api/notifications")).json.items.some((n: { title: string }) => /moved “EXIST-Antrag” to Done/.test(n.title)), "Verantwortliche erfährt Abschluss durch andere");

  const task = await a.post("/api/tasks", { title: "Formulare", topicId: t.json.id });
  await a.post(`/api/topics/${t.json.id}/updates`, { body: "Unterlagen sind raus." });
  const d = await a.get(`/api/topics/${t.json.id}`);
  assert.equal(d.json.tasks.length, 1);
  assert.equal(d.json.updates.length, 1);
  const kinds = d.json.events.map((e: { event: { t: string } }) => e.event.t);
  assert.ok(kinds.includes("stage") && kinds.includes("follow_up") && kinds.includes("waiting") && kinds.includes("task_added"), kinds.join(","));
  assert.equal(d.json.commentCount, 1);

  // Board: closed topics stay visible for 30 days, "open" hides them
  assert.equal((await a.get("/api/topics")).json.length, 2);
  assert.equal((await a.get("/api/topics?state=open")).json.length, 1);
  assert.equal((await a.get("/api/topics?kind=extern")).json.length, 1);
  assert.deepEqual((await a.get("/api/topics/areas")).json, ["Förderung"]);

  assert.equal((await b.del(`/api/topics/${t2.json.id}`)).status, 403, "Nur Ersteller, Verantwortliche oder Admins löschen");
  assert.equal((await a.del(`/api/topics/${t.json.id}`)).status, 200);
  const after = await a.get(`/api/tasks/${task.json.id}`);
  assert.equal(after.status, 200, "Aufgabe bleibt");
  assert.equal(after.json.topicId, null);
});

test("Themen: Fortschritt, nächste Aufgabe und überfällige Aufgaben in der Liste", async () => {
  const { a } = await team();
  const t = await a.post("/api/topics", { title: "Pro FIT" });
  await a.post("/api/tasks", { title: "Später", topicId: t.json.id, dueDate: "2031-01-01" });
  const early = await a.post("/api/tasks", { title: "Erstgespräch", topicId: t.json.id, dueDate: "2030-01-01" });
  await a.post("/api/tasks", { title: "Überfällig", topicId: t.json.id, dueDate: "2020-01-01", status: "erledigt" });
  await a.post("/api/tasks", { title: "Liegt", topicId: t.json.id, dueDate: "2021-01-01" });
  const [row] = (await a.get("/api/topics")).json;
  assert.equal(row.taskTotal, 4);
  assert.equal(row.taskDone, 1);
  assert.equal(row.taskOverdue, 1);
  assert.equal(row.nextTask.title, "Liegt");
  await a.patch(`/api/tasks/${early.json.id}`, { status: "erledigt" });
  const d = await a.get(`/api/topics/${t.json.id}`);
  assert.ok(d.json.events.some((e: { event: { t: string; title?: string } }) => e.event.t === "task_done" && e.event.title === "Erstgespräch"));
});

test("Aufgaben: Status „Wartet“, Verlauf mit Zusammenfassen, Kommentare zählen ohne Ereignisse", async () => {
  const { a, ids } = await team();
  const t = await a.post("/api/tasks", { title: "Antwort IBB", dueDate: "2030-01-10" });
  const w = await a.patch(`/api/tasks/${t.json.id}`, { status: "wartet", waitingOn: "IBB-Kundencenter" });
  assert.equal(w.json.status, "wartet");
  assert.equal(w.json.waitingOn, "IBB-Kundencenter");
  // Moving back and forth within minutes: one entry, and undone changes disappear
  await a.patch(`/api/tasks/${t.json.id}`, { status: "in_arbeit" });
  await a.patch(`/api/tasks/${t.json.id}`, { dueDate: "2030-01-12" });
  await a.patch(`/api/tasks/${t.json.id}`, { dueDate: "2030-01-10" });
  await a.patch(`/api/tasks/${t.json.id}`, { assigneeId: ids.ben });
  await a.post(`/api/tasks/${t.json.id}/comments`, { body: "Nachgefragt" });
  const d = await a.get(`/api/tasks/${t.json.id}`);
  const ev = d.json.events.map((e: { event: { t: string; from?: string; to?: string } }) => e.event);
  const status = ev.filter((e: { t: string }) => e.t === "status");
  assert.equal(status.length, 1, JSON.stringify(ev));
  assert.deepEqual([status[0].from, status[0].to], ["offen", "in_arbeit"]);
  assert.equal(ev.filter((e: { t: string }) => e.t === "due").length, 0, "Zurückgesetztes Datum hinterlässt keinen Eintrag");
  assert.ok(ev.some((e: { t: string }) => e.t === "assignee"));
  assert.ok(ev.some((e: { t: string }) => e.t === "waiting"));
  assert.equal(d.json.comments.length, 1);
  assert.equal(d.json.commentCount, 1);
  assert.equal((await a.get("/api/tasks?status=waiting")).json.length, 0);
  assert.equal((await a.patch(`/api/tasks/${t.json.id}`, { status: "blockiert" })).status, 422);
});

test("Aufgaben: Sammelaktion ändert mehrere, eine Benachrichtigung pro Person", async () => {
  const { a, b, ids } = await team();
  const topic = await a.post("/api/topics", { title: "Fördermittel" });
  const made = [];
  for (const title of ["A", "B", "C"]) made.push((await a.post("/api/tasks", { title })).json.id);
  const r = await a.post("/api/tasks/bulk", { ids: made, patch: { assigneeId: ids.ben, dueDate: "2030-05-05", topicId: topic.json.id } });
  assert.equal(r.status, 200);
  assert.equal(r.json.updated, 3);
  const n = (await b.get("/api/notifications")).json;
  assert.equal(n.unread, 1);
  assert.match(n.items[0].title, /assigned 3 tasks to you/);
  const list = (await b.get(`/api/tasks?topic=${topic.json.id}`)).json;
  assert.equal(list.length, 3);
  assert.ok(list.every((t: { dueDate: string; topicTitle: string }) => t.dueDate === "2030-05-05" && t.topicTitle === "Fördermittel"));
  const done = await b.post("/api/tasks/bulk", { ids: made, patch: { status: "erledigt" } });
  assert.ok(done.json.tasks.every((t: { completedAt: number }) => t.completedAt > 0));
  assert.equal((await a.post("/api/tasks/bulk", { ids: [], patch: { status: "erledigt" } })).status, 422);
  assert.equal((await a.post("/api/tasks/bulk", { ids: made, patch: { topicId: "gibt-es-nicht" } })).status, 404);
});

test("Startseite und Suche zeigen Themen und Wiedervorlagen", async () => {
  const { a } = await team();
  const t = await a.post("/api/topics", { title: "Upvest-Sandbox", counterpart: "Upvest", followUp: todayISO(), stage: "wartet", waitingOn: "API-Zugang" });
  const home = (await a.get("/api/home")).json;
  assert.equal(home.topics[0].id, t.json.id);
  const f = home.followUps.find((x: { source: string }) => x.source === "topic");
  assert.equal(f.href, `/themen?thema=${t.json.id}`);
  assert.equal(f.nextStep, "API-Zugang");
  assert.equal((await a.get("/api/search?q=upvest")).json.topics.length, 1);
});

test("CRM-Paket: Themen anlegen und bestehende Aufgaben nachträglich verknüpfen", async () => {
  const { deps, ids } = await team();
  const base = { format: "nalpia-crm-bundle", version: 1, source: "Test" };
  // First import: tasks only (as on 25.11.)
  const first = parseCrmBundle({ ...base, tasks: [{ ref: "s:1", title: "EXIST-Antrag einreichen", assigneeEmail: "anna@nalpia.com" }, { ref: "s:2", title: "Monorepo" }] });
  importCrmBundle(deps.db, first, { actorId: ids.anna });
  // Second import: same tasks with topicRef plus topics
  const second = parseCrmBundle({
    ...base,
    topics: [
      { ref: "exist", title: "EXIST-Gründungsstipendium", kind: "extern", stage: "in_arbeit", ownerEmail: "anna@nalpia.com", counterpart: "Hochschule", area: "Förderung" },
      { ref: "arch", title: "Architektur 2.0", ownerEmail: "niemand@nalpia.com" },
    ],
    tasks: [
      { ref: "s:1", title: "EXIST-Antrag einreichen", topicRef: "exist" },
      { ref: "s:2", title: "Monorepo", topicRef: "arch" },
      { ref: "s:3", title: "Neu", topicRef: "gibt-es-nicht" },
    ],
  });
  const dry = importCrmBundle(deps.db, second, { actorId: ids.anna, dryRun: true });
  assert.deepEqual(dry.topics, { created: 2, skipped: 0, updated: 0 });
  assert.equal(dry.tasks.linked, 2);
  assert.equal(deps.db.prepare("SELECT COUNT(*) AS n FROM topics").get().n, 0, "Probelauf speichert nichts");
  const r = importCrmBundle(deps.db, second, { actorId: ids.anna });
  assert.equal(r.tasks.linked, 2);
  assert.equal(r.tasks.created, 1);
  assert.ok(r.warnings.some((w) => w.includes("niemand@nalpia.com")));
  assert.ok(r.warnings.some((w) => w.includes("gibt-es-nicht")));
  const row = deps.db.prepare("SELECT t.assignee_id, tp.title FROM tasks t JOIN topics tp ON tp.id = t.topic_id WHERE t.external_ref = 'plan:s:1'").get() as { assignee_id: string; title: string };
  assert.equal(row.title, "EXIST-Gründungsstipendium");
  assert.equal(row.assignee_id, ids.anna, "Zuständigkeit bleibt unangetastet");
  // Repeat: nothing changes
  const again = importCrmBundle(deps.db, second, { actorId: ids.anna });
  assert.deepEqual(again.topics, { created: 0, skipped: 2, updated: 0 });
  assert.equal(again.tasks.linked ?? 0, 0);
});
