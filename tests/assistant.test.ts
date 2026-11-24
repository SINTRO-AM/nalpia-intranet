import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";
import { pageContext, parsePage, runTool } from "../server/ai/assistant-data.js";
import { todayISO, addDaysISO } from "../server/lib/util.js";
import type { UserRow } from "../server/context.js";

const PW = "korrekt-pferd-batterie";

async function world() {
  const s = setup({ DEMO_MODE: "0" });
  const { deps } = s;
  const denis = await addUser(deps, { email: "dk@nalpia.com", name: "Denis Keller", role: "admin", password: PW });
  const jona = await addUser(deps, { email: "jona@nalpia.com", name: "Jona Detjen", password: PW });
  const now = Date.now();
  const today = todayISO();
  const ins = deps.db.prepare(
    "INSERT INTO tasks (id, title, assignee_id, created_by, due_date, priority, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'hoch', 'offen', 0, ?, ?)",
  );
  ins.run("t-overdue-0001", "Term Sheet prüfen", denis, denis, addDaysISO(today, -2), now, now);
  ins.run("t-today-000001", "Deck an Alpha schicken", denis, denis, today, now, now);
  ins.run("t-jona-0000001", "Server härten", jona, jona, addDaysISO(today, 3), now, now);
  deps.db
    .prepare("INSERT INTO organizations (id, kind, name, stage, priority, owner_id, next_step, next_date, tags, created_at, updated_at) VALUES (?, 'investor', ?, 'gespraech', 'hoch', ?, 'Follow-up Call', ?, '[\"Seed\"]', ?, ?)")
    .run("org-alpha-0001", "Alpha Ventures", denis, addDaysISO(today, -1), now, now);
  const me = deps.db.prepare("SELECT * FROM users WHERE id = ?").get(denis) as UserRow;
  return { ...s, denis, jona, me, today };
}

test("Assistant: pages are recognized", () => {
  assert.deepEqual(parsePage("/"), { kind: "start" });
  assert.deepEqual(parsePage("/investoren/org-alpha-0001"), { kind: "org", orgKind: "investor", id: "org-alpha-0001" });
  assert.deepEqual(parsePage("/partner?ansicht=liste"), { kind: "orgs", orgKind: "partner" });
  assert.deepEqual(parsePage("/agent"), { kind: "agent" });
  assert.deepEqual(parsePage("/news/abc-def-ghij"), { kind: "newsItem", id: "abc-def-ghij" });
  assert.deepEqual(parsePage("/irgendwas"), { kind: "other" });
});

test("Assistant: page context with facts, suggestions and data for the model", async () => {
  const { deps, me } = await world();
  const start = pageContext(deps.db, me, parsePage("/"));
  assert.ok(start.facts.includes("1 overdue task"));
  assert.ok(start.facts.includes("1 due today"));
  assert.match(start.detail, /Term Sheet prüfen/);
  assert.match(start.detail, /Alpha Ventures.*Follow-up Call/s, "follow-ups due");
  assert.doesNotMatch(start.detail, /Server härten/, "own tasks only");
  assert.ok(start.suggestions.length >= 2);

  const org = pageContext(deps.db, me, parsePage("/investoren/org-alpha-0001"));
  assert.equal(org.label, "Alpha Ventures");
  assert.match(org.detail, /First meeting/);
  const pipe = pageContext(deps.db, me, parsePage("/investoren"));
  assert.equal(pipe.label, "Investors");
  assert.match(pipe.detail, /Investor pipeline/);
});

test("Assistant: tools – search, create and change tasks with permissions", async () => {
  const { deps, me, jona, today } = await world();
  assert.match(runTool(deps.db, me, "suche", { begriff: "alpha" }).text, /Alpha Ventures.*\/investoren\/org-alpha-0001/s);
  assert.match(runTool(deps.db, me, "aufgaben_auflisten", { person: "Jona" }).text, /Server härten/);

  const created = runTool(deps.db, me, "aufgabe_anlegen", { titel: "Datenraum aktualisieren", zustaendig: "Jona", faellig: addDaysISO(today, 5), institution_id: "org-alpha-0001" });
  assert.deepEqual(created.changed, ["tasks", "home"]);
  const t = deps.db.prepare("SELECT * FROM tasks WHERE title = 'Datenraum aktualisieren'").get() as Record<string, string>;
  assert.equal(t.assignee_id, jona);
  assert.equal(t.organization_id, "org-alpha-0001");
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?").get(jona) as { n: number }).n, 1, "Jona is notified");

  assert.equal(runTool(deps.db, me, "aufgabe_anlegen", { titel: "X erledigen", zustaendig: "Niemand Bekanntes" }).isError, true);

  // Jona must not change Denis's task
  const jonaRow = deps.db.prepare("SELECT * FROM users WHERE id = ?").get(jona) as UserRow;
  assert.equal(runTool(deps.db, jonaRow, "aufgabe_aktualisieren", { id: "t-overdue-0001", status: "erledigt" }).isError, true);
  const done = runTool(deps.db, me, "aufgabe_aktualisieren", { id: "t-overdue-0001", status: "erledigt" });
  assert.ok(!done.isError);
  assert.equal((deps.db.prepare("SELECT status FROM tasks WHERE id = 't-overdue-0001'").get() as { status: string }).status, "erledigt");

  runTool(deps.db, me, "notiz_hinzufuegen", { institution_id: "org-alpha-0001", text: "Call: Interesse an Lead-Rolle", art: "anruf" });
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM org_activities WHERE org_id = 'org-alpha-0001' AND kind = 'anruf'").get() as { n: number }).n, 1);
  runTool(deps.db, me, "naechsten_schritt_setzen", { institution_id: "org-alpha-0001", schritt: "Term Sheet besprechen", datum: addDaysISO(today, 7) });
  assert.equal((deps.db.prepare("SELECT next_step FROM organizations WHERE id = 'org-alpha-0001'").get() as { next_step: string }).next_step, "Term Sheet besprechen");
});

test("Assistant API: context, chat with tool loop, off switch", async () => {
  const { app, deps } = await world();
  const c = new Client(app);
  await c.login("dk@nalpia.com", PW);
  const ctx = await c.get("/api/assistant/context?path=%2F");
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.firstName, "Denis");
  assert.equal(ctx.json.available, false);
  assert.equal((await c.post("/api/assistant/chat", { path: "/", messages: [{ role: "user", content: "Hallo" }] })).status, 503, "without an AI key");
  // German interface: labels, facts and suggestions in German; errors too
  const de = await c.req("GET", "/api/assistant/context?path=%2Faufgaben", undefined, { "x-lang": "de" });
  assert.equal(de.json.label, "Aufgaben");
  assert.ok(de.json.facts.includes("1 überfällige Aufgabe"), JSON.stringify(de.json.facts));
  assert.equal(de.json.suggestions[0].label, "Priorisieren");
  const off = await c.req("POST", "/api/assistant/chat", { path: "/", messages: [{ role: "user", content: "Hallo" }] }, { "x-lang": "de" });
  assert.match(off.text, /KI-Assistent ist nicht eingerichtet/);

  // Fake model: first a tool call, then the answer
  const calls: { tools: boolean; system: string; last: unknown }[] = [];
  const fake = {
    messages: {
      stream(params: { tools?: unknown[]; system: { text: string }[]; messages: { content: unknown }[] }) {
        calls.push({ tools: !!params.tools, system: params.system.map((b) => b.text).join("\n"), last: params.messages[params.messages.length - 1]!.content });
        const round = calls.length;
        const handlers: ((t: string) => void)[] = [];
        return {
          on(_e: string, fn: (t: string) => void) {
            handlers.push(fn);
          },
          async finalMessage() {
            if (round % 2 === 1)
              return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", name: "aufgabe_anlegen", input: { titel: "Lead-Liste schärfen", faellig: todayISO() } }] };
            handlers.forEach((h) => h("Erledigt, Denis: [Lead-Liste schärfen](/aufgaben)."));
            return { stop_reason: "end_turn", content: [{ type: "text", text: "Erledigt, Denis." }] };
          },
        };
      },
    },
  };
  Object.defineProperty(deps.ai, "sdk", { get: () => fake });
  Object.defineProperty(deps.ai, "available", { get: () => true });
  const res = await c.post("/api/assistant/chat", { path: "/investoren/org-alpha-0001", messages: [{ role: "user", content: "Leg mir eine Aufgabe an: Lead-Liste schärfen, heute" }] });
  assert.equal(res.status, 200);
  assert.match(res.text, /event: tool\ndata: \{"label":"Creating the task"\}/);
  assert.match(res.text, /event: changed/);
  assert.match(res.text, /event: delta\ndata: \{"text":"Erledigt, Denis/);
  assert.match(res.text, /event: done/);
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.system, /Address Denis by first name/);
  assert.match(calls[0]!.system, /Reply in English/);
  assert.match(calls[0]!.system, /page "Alpha Ventures"/);
  assert.match(JSON.stringify(calls[1]!.last), /tool_result.*Task created/);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE title = 'Lead-Liste schärfen'").get() as { n: number }).n, 1);
  // German interface: German reply instruction, tool status and tool results
  const deRes = await c.req("POST", "/api/assistant/chat", { path: "/", messages: [{ role: "user", content: "Leg mir eine Aufgabe an" }] }, { "x-lang": "de" });
  assert.match(deRes.text, /"label":"Lege die Aufgabe an"/);
  assert.match(calls[2]!.system, /Reply in German/);
  assert.match(JSON.stringify(calls[3]!.last), /Aufgabe angelegt/);

  // Invalid histories and off switch
  assert.equal((await c.post("/api/assistant/chat", { path: "/", messages: [{ role: "assistant", content: "x" }] })).status, 422);
  await c.patch("/api/me/prefs", { assistant: false });
  assert.equal((await c.post("/api/assistant/chat", { path: "/", messages: [{ role: "user", content: "Hallo" }] })).status, 403);
});
