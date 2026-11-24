import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, elevatedAdmin, setup } from "./helpers.js";
import { applyNewsTemplate, NALPIA_NEWS } from "../server/lib/news-template.js";

const PW = "korrekt-pferd-batterie";

test("News template: creates starter posts once, without notifications, Denis as author", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "m@nalpia.com", name: "Mia Member", role: "member", password: PW });
  const dk = await addUser(deps, { email: "denis@nalpia.com", name: "Denis Keller", role: "admin", password: PW });

  const dry = applyNewsTemplate(deps.db, { actorId: dk, dryRun: true });
  assert.equal(dry.created.length, NALPIA_NEWS.length);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM news").get() as { n: number }).n, 0, "dry run saves nothing");

  const member = new Client(app);
  await member.login("m@nalpia.com", PW);
  assert.equal((await member.post("/api/news/template")).status, 403);
  const { client: admin } = await elevatedAdmin(app, deps, "denis@nalpia.com", PW);
  const r = await admin.post("/api/news/template");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.created.length, NALPIA_NEWS.length);
  assert.equal(r.json.author, "Denis Keller");
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM notifications").get() as { n: number }).n, 0, "no notifications");

  const list = (await member.get("/api/news")).json as { items: { title: string; pinned: boolean; read: boolean; authorId: string; createdAt: number }[]; unread: number };
  assert.equal(list.unread, NALPIA_NEWS.length, "unread for the team");
  assert.deepEqual(list.items.slice(0, 1).map((n) => n.pinned), [true]);
  assert.ok(list.items.every((n) => n.authorId === dk));
  const unpinned = list.items.filter((n) => !n.pinned).map((n) => n.createdAt);
  assert.deepEqual(unpinned, [...unpinned].sort((a, b) => b - a), "newest first");
  assert.equal(list.items.at(-1)!.title, "Team and advisors");

  // Repeatable: edited posts stay, deleted ones do not come back
  deps.db.prepare("DELETE FROM news WHERE external_ref = 'nalpia-news:partner'").run();
  deps.db.prepare("UPDATE news SET title = 'Custom title' WHERE external_ref = 'nalpia-news:willkommen'").run();
  const again = applyNewsTemplate(deps.db, { actorId: dk });
  assert.equal(again.created.length, 0);
  assert.equal(again.existing.length, NALPIA_NEWS.length);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM news").get() as { n: number }).n, NALPIA_NEWS.length - 1, "deleted post stays deleted");
  assert.equal((deps.db.prepare("SELECT title FROM news WHERE external_ref = 'nalpia-news:willkommen'").get() as { title: string }).title, "Custom title");
});

test("News template: posts are created in the language of the admin who applies it", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "denis@nalpia.com", name: "Denis Keller", role: "admin", password: PW });
  const { client: admin } = await elevatedAdmin(app, deps, "denis@nalpia.com", PW);
  const r = await admin.req("POST", "/api/news/template", undefined, { "x-lang": "de" });
  assert.equal(r.status, 200, r.text);
  const row = deps.db.prepare("SELECT title, body FROM news WHERE external_ref = 'nalpia-news:willkommen'").get() as { title: string; body: string };
  assert.equal(row.title, "Willkommen im nalpia-Intranet");
  assert.ok(NALPIA_NEWS.every((p) => p.title.de && p.title.en && p.body.de && p.body.en));
});
