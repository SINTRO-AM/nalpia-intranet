import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";
import { newId } from "../server/lib/util.js";
import type { Deps } from "../server/context.js";
import type { MockMailbox } from "../server/mail/mock.js";

const PW = "korrekt-pferd-batterie";

/** Demo mailbox for the owner – the agent sends through it and reads replies from it */
function connectMailbox(deps: Deps, userId: string, email: string) {
  const now = Date.now();
  deps.db
    .prepare(
      `INSERT INTO mail_accounts (user_id, provider, account_id, email, addresses, accounts_server, mail_api, refresh_token_enc, connected_at, updated_at)
       VALUES (?, 'demo', '1', ?, ?, 'demo', 'demo', ?, ?, ?)`,
    )
    .run(userId, email, JSON.stringify([email]), deps.vault.encrypt("demo"), now, now);
}

function investor(deps: Deps, p: { name: string; city?: string; country?: string; focus?: string; email?: string; contact?: string; fit?: number; prior?: string; type?: string }) {
  const id = newId();
  const now = Date.now();
  deps.db
    .prepare(
      `INSERT INTO organizations (id, kind, name, type, stage, priority, city, country, focus, focus_tags, stage_focus, fit_score, prior_outcome, created_at, updated_at)
       VALUES (?, 'investor', ?, ?, 'identifiziert', 'mittel', ?, ?, ?, '["fintech","ai"]', '["pre_seed"]', ?, ?, ?, ?)`,
    )
    .run(id, p.name, p.type ?? "vc", p.city ?? "San Francisco", p.country ?? "US", p.focus ?? "Consumer fintech and AI agents", p.fit ?? 80, p.prior ?? "", now, now);
  if (p.email !== "") {
    deps.db
      .prepare("INSERT INTO contacts (id, name, email, company, position, category, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'Partner', 'investor', ?, ?, ?)")
      .run(newId(), p.contact ?? "Priya Nair", p.email ?? `${p.name.toLowerCase().replace(/\W+/g, "")}@example.com`, p.name, id, now, now);
  }
  return id;
}

async function world() {
  const s = setup({ DEMO_MODE: "1", AGENT_SCHEDULER: "0" });
  const denis = await addUser(s.deps, { email: "denis@nalpia.com", name: "Denis Keller", role: "admin", password: PW });
  const member = await addUser(s.deps, { email: "m@nalpia.com", name: "Mia Member", password: PW });
  connectMailbox(s.deps, denis, "denis@nalpia.com");
  const admin = new Client(s.app);
  await admin.login("denis@nalpia.com", PW);
  const mia = new Client(s.app);
  await mia.login("m@nalpia.com", PW);
  return { ...s, denis, member, admin, mia };
}

test("Agent: candidates follow fit, country filter, one contact per firm and priority cities", async () => {
  const { deps, admin } = await world();
  investor(deps, { name: "Baylight Ventures", city: "San Francisco", fit: 70 });
  investor(deps, { name: "Hudson Capital", city: "New York", fit: 90 });
  investor(deps, { name: "Baylight Ventures", city: "Palo Alto", fit: 95, email: "second@baylight.example" }); // same firm, second person
  investor(deps, { name: "Alpen Angels", country: "AT", fit: 90 });
  investor(deps, { name: "Low Fit Corp", fit: 30 });
  investor(deps, { name: "No Mail Ventures", fit: 90, email: "" });
  investor(deps, { name: "Declined Before", fit: 90, prior: "absage" });
  investor(deps, { name: "Allocator FO", fit: 90, type: "allokator" });

  const r = await admin.get("/api/agent/candidates?limit=10");
  assert.equal(r.status, 200, r.text);
  const names = (r.json.next as { name: string; city: string }[]).map((c) => c.name);
  // Bay Area first (fit 95 beats 70), then the rest of the US by fit; AT, low fit, no mail, declined and allocators are out; one per firm
  assert.deepEqual(names, ["Baylight Ventures", "Hudson Capital"]);
  assert.equal(r.json.total, 3, "both Baylight rows count before the one-per-firm rule");
  assert.equal(r.json.priority, 2);

  // Widen the filters: Austria and declined investors join
  const p = await admin.patch("/api/agent/settings", { countries: [], includePriorDeclined: true, minFit: 50 });
  assert.equal(p.status, 200, p.text);
  const r2 = await admin.get("/api/agent/candidates?limit=10");
  const names2 = (r2.json.next as { name: string }[]).map((c) => c.name);
  assert.ok(names2.includes("Alpen Angels") && names2.includes("Declined Before"));
  assert.ok(!names2.includes("Low Fit Corp") && !names2.includes("Allocator FO"));
});

test("Agent: settings are admin-only and validated; status reports the owner's mailbox", async () => {
  const { admin, mia } = await world();
  assert.equal((await mia.patch("/api/agent/settings", { mode: "autopilot" })).status, 403);
  assert.equal((await admin.patch("/api/agent/settings", { ownerEmail: "nobody@nalpia.com" })).status, 422);
  assert.equal((await admin.patch("/api/agent/settings", { sendWindow: { from: "09:00", to: "17:00", tz: "Mars/Olympus" } })).status, 422);
  const st = await mia.get("/api/agent/status");
  assert.equal(st.status, 200, st.text);
  assert.equal(st.json.settings.mode, "review", "review mode is the default");
  assert.equal(st.json.owner.email, "denis@nalpia.com", "first admin owns the agent by default");
  assert.equal(st.json.mail.connected, true);
  assert.equal(st.json.ai, "demo");
  assert.equal(st.json.settings.dailyDrafts, 20);
  assert.deepEqual(st.json.settings.countries, ["US"]);
});

test("Agent: drafts, review, send through the owner's mailbox, CRM bookkeeping, follow-up and reply handling", async () => {
  const { deps, admin, denis } = await world();
  const orgId = investor(deps, { name: "Baylight Ventures", email: "priya@baylight.example" });
  investor(deps, { name: "Empty Focus Fund", focus: "", email: "x@emptyfocus.example" });

  // 1) Draft batch (demo mode: template paragraph from the stored focus)
  const run = await admin.post("/api/agent/run", { kind: "drafts", wait: true });
  assert.equal(run.status, 200, run.text);
  assert.equal(run.json.results[0].status, "ok", run.json.results[0].summary);
  const drafts = (await admin.get("/api/agent/outreach?status=draft,needs_note")).json as { id: string; status: string; orgName: string; body: string; personal: string; subject: string }[];
  assert.equal(drafts.length, 2);
  const bay = drafts.find((d) => d.orgName === "Baylight Ventures")!;
  const empty = drafts.find((d) => d.orgName === "Empty Focus Fund")!;
  assert.equal(bay.status, "draft");
  assert.equal(empty.status, "needs_note", "without a verifiable hook the draft is not sendable");
  assert.match(bay.subject, /\[Baylight Ventures\/nalpia\]/);
  assert.ok(bay.body.includes("Hi Priya,") && bay.body.includes(bay.personal) && bay.body.includes("Best, Denis"));
  assert.equal((deps.db.prepare("SELECT outreach_status FROM organizations WHERE id = ?").get(orgId) as { outreach_status: string }).outreach_status, "draft");
  // Investor filter sees it
  assert.equal((await admin.get("/api/orgs?kind=investor&outreach=draft")).json.length, 1);
  // A second batch does not touch investors already in outreach
  const again = await admin.post("/api/agent/run", { kind: "drafts", wait: true });
  assert.match(again.json.results[0].summary, /Keine Kandidaten/);

  // 2) needs_note cannot be sent; adding the paragraph by hand makes it a draft
  assert.equal((await admin.post(`/api/agent/outreach/${empty.id}/send`)).status, 409);
  const fixed = await admin.patch(`/api/agent/outreach/${empty.id}`, { personal: "Your note on agent-driven consumer finance is the reason I am writing." });
  assert.equal(fixed.status, 200, fixed.text);
  assert.equal(fixed.json.status, "draft");
  assert.ok(fixed.json.body.includes("agent-driven consumer finance"), "the paragraph lands inside the mail text");

  // 3) Review mode: nothing goes out by itself; the "send" run does nothing
  const noSend = await admin.post("/api/agent/run", { kind: "send", wait: true });
  assert.match(noSend.json.results[0].summary, /Prüfmodus/);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM agent_outreach WHERE status = 'sent'").get() as { n: number }).n, 0);

  // 4) One click sends through Denis's (demo) mailbox and updates the CRM
  const sent = await admin.post(`/api/agent/outreach/${bay.id}/send`);
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.json.status, "sent");
  assert.ok(sent.json.nextActionAt > Date.now(), "follow-up is scheduled");
  const org = deps.db.prepare("SELECT stage, outreach_status, last_contact_at, next_step FROM organizations WHERE id = ?").get(orgId) as Record<string, unknown>;
  assert.equal(org.stage, "kontaktiert");
  assert.equal(org.outreach_status, "sent");
  assert.ok(org.last_contact_at);
  const act = deps.db.prepare("SELECT body FROM contact_activities WHERE contact_id IN (SELECT id FROM contacts WHERE organization_id = ?)").get(orgId) as { body: string };
  assert.match(act.body, /^Gesendet: \[Baylight Ventures\/nalpia\]/);
  const owner = deps.db.prepare("SELECT * FROM users WHERE id = ?").get(denis) as Parameters<typeof deps.mail.client>[0];
  const mailbox = deps.mail.client(owner) as MockMailbox;
  const sentFolder = await mailbox.list({ folderId: "1002", start: 1, limit: 10 });
  assert.equal(sentFolder.length, 1, "exactly one mail left the mailbox");
  assert.equal(sentFolder[0]!.to[0]!.email, "priya@baylight.example");
  assert.equal((await admin.get("/api/agent/status")).json.state.sentToday, 1);

  // 5) Follow-up becomes due → drafted for review (review mode), not sent
  deps.db.prepare("UPDATE agent_outreach SET next_action_at = ? WHERE id = ?").run(Date.now() - 1000, bay.id);
  const fu = await admin.post("/api/agent/run", { kind: "followups", wait: true });
  assert.equal(fu.json.results[0].status, "ok", fu.json.results[0].summary);
  const pending = (await admin.get("/api/agent/messages?status=draft")).json as { id: string; kind: string; subject: string; body: string }[];
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.kind, "followup");
  assert.match(pending[0]!.subject, /^Re: /);
  assert.equal((await mailbox.list({ folderId: "1002", start: 1, limit: 10 })).length, 1, "review mode: follow-up waits");
  const fuSent = await admin.post(`/api/agent/messages/${pending[0]!.id}/send`);
  assert.equal(fuSent.status, 200, fuSent.text);
  const afterFu = deps.db.prepare("SELECT status, sequence_step, next_action_at FROM agent_outreach WHERE id = ?").get(bay.id) as { status: string; sequence_step: number; next_action_at: number | null };
  assert.equal(afterFu.status, "followup");
  assert.equal(afterFu.sequence_step, 1);
  assert.ok(afterFu.next_action_at && afterFu.next_action_at > Date.now(), "second follow-up scheduled");
  assert.equal((await mailbox.list({ folderId: "1002", start: 1, limit: 10 })).length, 2);

  // 6) A reply arrives in the inbox → classified, stage moves, task + drafted answer
  await mailbox.send({ from: "priya@baylight.example", to: ["denis@nalpia.com"], cc: [], bcc: [], subject: `Re: ${bay.subject}`, html: "<p>Yes, interested – please send the deck and let's find a slot for a call.</p>", mode: "send" });
  // the mock puts sent mails into "Sent"; move it to the inbox to simulate an incoming reply
  const incoming = (await mailbox.list({ folderId: "1002", start: 1, limit: 10 })).find((m) => m.from.email === "priya@baylight.example")!;
  const full = await mailbox.get("1002", incoming.id);
  (full as { folderId: string }).folderId = "1001";
  const inbox = await admin.post("/api/agent/run", { kind: "inbox", wait: true });
  assert.equal(inbox.json.results[0].status, "ok", inbox.json.results[0].summary);
  assert.match(inbox.json.results[0].summary, /1 Antworten verarbeitet/);
  const replied = deps.db.prepare("SELECT status, reply_kind FROM agent_outreach WHERE id = ?").get(bay.id) as { status: string; reply_kind: string };
  assert.deepEqual(replied, { status: "replied", reply_kind: "ja" });
  assert.equal((deps.db.prepare("SELECT stage, outreach_status FROM organizations WHERE id = ?").get(orgId) as { stage: string }).stage, "gespraech");
  const task = deps.db.prepare("SELECT title, assignee_id, priority FROM tasks WHERE organization_id = ?").get(orgId) as { title: string; assignee_id: string; priority: string };
  assert.match(task.title, /Baylight Ventures: Antwort von/);
  assert.equal(task.assignee_id, denis);
  assert.equal(task.priority, "hoch");
  const answers = (await admin.get("/api/agent/messages?status=draft")).json as { kind: string; body: string }[];
  assert.equal(answers.length, 1);
  assert.equal(answers[0]!.kind, "auto_reply");
  assert.match(answers[0]!.body, /Thanks, Priya/);
  // Running the inbox again does not process the same mail twice
  const inbox2 = await admin.post("/api/agent/run", { kind: "inbox", wait: true });
  assert.match(inbox2.json.results[0].summary, /Keine neuen Antworten/);
  // The investor page shows the outreach thread
  const detail = await admin.get(`/api/orgs/${orgId}`);
  assert.equal(detail.json.outreach.length, 1);
  assert.equal(detail.json.outreach[0].replyKind, "ja");
  const thread = await admin.get(`/api/agent/outreach/${bay.id}`);
  assert.deepEqual(
    (thread.json.messages as { dir: string; kind: string; status: string }[]).map((m) => `${m.dir}:${m.kind}:${m.status}`),
    ["out:first:sent", "out:followup:sent", "in:reply:received", "out:auto_reply:draft"],
  );
  // Runs are logged
  const runs = (await admin.get("/api/agent/runs")).json as { kind: string; status: string }[];
  assert.ok(runs.length >= 5 && runs.every((r) => r.status === "ok"));
});

test("Agent: autopilot sends drafts and follow-ups by itself within the window and the daily cap", async () => {
  const { deps, admin } = await world();
  investor(deps, { name: "Fund One", email: "one@fund.example" });
  investor(deps, { name: "Fund Two", email: "two@fund.example" });
  investor(deps, { name: "Fund Three", email: "three@fund.example" });
  await admin.patch("/api/agent/settings", { mode: "autopilot", dailyCap: 2, workdaysOnly: false, sendWindow: { from: "00:00", to: "23:59", tz: "UTC" } });
  await admin.post("/api/agent/run", { kind: "drafts", wait: true });
  assert.equal((await admin.get("/api/agent/outreach?status=draft")).json.length, 3);
  const send = await admin.post("/api/agent/run", { kind: "send", wait: true });
  assert.equal(send.json.results[0].status, "ok", send.json.results[0].summary);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM agent_outreach WHERE status = 'sent'").get() as { n: number }).n, 2, "daily cap of 2 respected");
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM agent_outreach WHERE status = 'draft'").get() as { n: number }).n, 1);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM organizations WHERE stage = 'kontaktiert'").get() as { n: number }).n, 2);
  // Outside the window the scheduled run sends nothing (a manual run would skip the window, never the cap)
  await admin.patch("/api/agent/settings", { dailyCap: 20, sendWindow: { from: "00:00", to: "00:01", tz: "UTC" } });
  deps.db.prepare("UPDATE settings SET value = json_set(value, '$.sentToday', 0) WHERE key = 'agent_state'").run();
  const closed = await deps.agent.run("send", { triggeredBy: null });
  assert.match(closed[0]!.summary, /Sendefenster|Außerhalb/);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM agent_outreach WHERE status = 'draft'").get() as { n: number }).n, 1);
  // Pausing a thread stops its follow-ups
  const sentOne = deps.db.prepare("SELECT id FROM agent_outreach WHERE status = 'sent' LIMIT 1").get() as { id: string };
  assert.equal((await admin.post(`/api/agent/outreach/${sentOne.id}/status`, { status: "paused" })).status, 200);
  deps.db.prepare("UPDATE agent_outreach SET next_action_at = ? WHERE status IN ('sent','paused')").run(Date.now() - 1000);
  await admin.patch("/api/agent/settings", { sendWindow: { from: "00:00", to: "23:59", tz: "UTC" } });
  const fu = await admin.post("/api/agent/run", { kind: "followups", wait: true });
  assert.match(fu.json.results[0].summary, /1 Follow-ups/);
});
