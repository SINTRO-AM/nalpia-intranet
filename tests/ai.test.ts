import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";

const PW = "korrekt-pferd-batterie";

async function demoUser() {
  const ctx = setup({ DEMO_MODE: "1" });
  const id = await addUser(ctx.deps, { email: "dk@nalpia.com", name: "Denis Keller", password: PW });
  const now = Date.now();
  ctx.deps.db
    .prepare(
      `INSERT INTO mail_accounts (user_id, provider, account_id, email, addresses, accounts_server, mail_api, refresh_token_enc, connected_at, updated_at)
       VALUES (?, 'demo', '1', 'dk@nalpia.com', '["dk@nalpia.com"]', 'demo', 'demo', ?, ?, ?)`,
    )
    .run(id, ctx.deps.vault.encrypt("demo"), now, now);
  const c = new Client(ctx.app);
  await c.login("dk@nalpia.com", PW);
  return { ...ctx, c, id };
}

test("AI reply suggestions: up to three variants, cached, refreshing costs quota", async () => {
  const { c, deps } = await demoUser();
  const list = await c.get("/api/mail/messages?folderId=1001");
  assert.equal(list.status, 200, list.text);
  const msg = (list.json.messages ?? list.json.items ?? list.json)[0] as { id: string; folderId: string };
  const r = await c.post("/api/ai/suggestions", { folderId: msg.folderId, messageId: msg.id });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.suggestions.length >= 1 && r.json.suggestions.length <= 3);
  for (const sg of r.json.suggestions) assert.ok(sg.label && sg.gist && sg.text.includes("Denis"));
  assert.equal(r.json.cached, false);
  const again = await c.post("/api/ai/suggestions", { folderId: msg.folderId, messageId: msg.id });
  assert.equal(again.json.cached, true, "second open served from the cache");
  const fresh = await c.post("/api/ai/suggestions", { folderId: msg.folderId, messageId: msg.id, refresh: true });
  assert.equal(fresh.json.cached, false);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ai.suggestions'").get() as { n: number }).n, 2);
  assert.equal((await c.post("/api/ai/suggestions", { folderId: "1001", messageId: "abc" })).status, 422, "numeric IDs only");
});

test("AI chat: draft takes earlier instructions into account", async () => {
  const { app, c } = await demoUser();
  const res = await app.request("/api/ai/draft", {
    method: "POST",
    headers: { cookie: c.cookie, "content-type": "application/json", "x-requested-with": "nalpia-intranet" },
    body: JSON.stringify({ compose: { to: "a@b.de", subject: "Test" }, instruction: "Make it shorter", history: ["Suggest a meeting on Tuesday"] }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /event: done/);
  const bad = await c.post("/api/ai/draft", { compose: { to: "", subject: "" }, history: Array(25).fill("x") });
  assert.equal(bad.status, 422, "at most 20 earlier instructions");
});

test("Setting: automatic reply suggestions on/off", async () => {
  const { c } = await demoUser();
  const r = await c.patch("/api/me/prefs", { autoSuggest: false });
  assert.equal(r.json.autoSuggest, false);
});
