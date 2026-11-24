import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, elevatedAdmin, setup } from "./helpers.js";
import { applyTeamTemplate, nalpiaTeam } from "../server/lib/team-template.js";

const PW = "korrekt-pferd-batterie";

test("Team template: creates missing people as invited, fills only empty fields, repeatable", async () => {
  const { deps } = setup();
  const dk = await addUser(deps, { email: "denis@nalpia.com", name: "Denis Keller", role: "admin", password: PW });
  deps.db.prepare("UPDATE users SET title = 'Founder' WHERE id = ?").run(dk);

  const dry = applyTeamTemplate(deps.db, { actorId: dk, dryRun: true });
  assert.equal(dry.created.length, nalpiaTeam().length - 1);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 1, "dry run saves nothing");

  const r = applyTeamTemplate(deps.db, { actorId: dk });
  assert.equal(r.created.length, nalpiaTeam().length - 1);
  assert.deepEqual(r.updated, ["Denis Keller"]);
  assert.equal(r.externals, "gesetzt");
  assert.ok(r.unconfirmedEmails.some((x) => x.name === "Carlo Elwinger"), "Carlo's address is not confirmed yet");

  const denis = deps.db.prepare("SELECT title, department, bio FROM users WHERE id = ?").get(dk) as Record<string, string>;
  assert.equal(denis.title, "Founder", "maintained title stays");
  assert.equal(denis.department, "Management");
  assert.match(denis.bio, /Financial Mathematics/);
  const carlo = deps.db.prepare("SELECT id, status, role, manager_id, department, title FROM users WHERE email = 'carlo@nalpia.com'").get() as Record<string, string>;
  assert.deepEqual({ ...carlo, id: undefined }, { id: undefined, status: "invited", role: "member", manager_id: null, department: "Management", title: "Co-Founder" });
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM auth_tokens").get() as { n: number }).n, 0, "no invite links created");
  const externals = JSON.parse((deps.db.prepare("SELECT value FROM settings WHERE key = 'team_externals'").get() as { value: string }).value) as { name: string }[];
  assert.ok(externals.some((e) => e.name === "SINTRO Asset Management"));

  const again = applyTeamTemplate(deps.db, { actorId: dk });
  assert.equal(again.created.length, 0);
  assert.equal(again.updated.length, 0);
  assert.equal(again.externals, "unverändert");

  // Reset structure: Carlo temporarily had another title
  deps.db.prepare("UPDATE users SET title = 'CTO', department = 'Tech', bio = 'eigene Notiz' WHERE id = ?").run(carlo.id);
  const keep = applyTeamTemplate(deps.db, { actorId: dk });
  assert.deepEqual(deps.db.prepare("SELECT title, department FROM users WHERE id = ?").get(carlo.id), { title: "CTO", department: "Tech" }, "without the option, maintained values stay");
  assert.equal(keep.updated.length, 0);
  const reset = applyTeamTemplate(deps.db, { actorId: dk, overwriteStructure: true });
  assert.ok(reset.updated.includes("Carlo Elwinger"));
  assert.deepEqual(deps.db.prepare("SELECT title, department, bio FROM users WHERE id = ?").get(carlo.id), { title: "Co-Founder", department: "Management", bio: "eigene Notiz" });
  assert.equal((deps.db.prepare("SELECT title FROM users WHERE id = ?").get(dk) as { title: string }).title, "CEO & Co-Founder", "applying the structure also sets the title");
});

test("Org chart: team list includes invited people, admins maintain managers without cycles, externals", async () => {
  const { app, deps } = setup();
  await addUser(deps, { email: "denis@nalpia.com", name: "Denis Keller", role: "admin", password: PW });
  await addUser(deps, { email: "m@nalpia.com", name: "Mia Member", role: "member", password: PW });
  await addUser(deps, { email: "lead@nalpia.com", name: "Lea Lead", role: "member", password: PW });
  const member = new Client(app);
  await member.login("m@nalpia.com", PW);
  const { client: admin } = await elevatedAdmin(app, deps, "denis@nalpia.com", PW);

  assert.equal((await member.post("/api/team/template")).status, 403);
  assert.equal((await admin.post("/api/team/template")).status, 200);
  const users = (await member.get("/api/users")).json as { id: string; email: string; status: string; managerId: string | null; department: string }[];
  assert.ok(users.some((u) => u.status === "invited" && u.email === "carlo@nalpia.com"), "invited people visible in the team");
  const id = (e: string) => users.find((u) => u.email === e)!.id;

  // Prevent cycles: Lea reports to Denis, so Denis cannot report to Lea
  assert.equal((await admin.patch(`/api/admin/users/${id("lead@nalpia.com")}`, { managerId: id("denis@nalpia.com") })).status, 200);
  const cycle = await admin.patch(`/api/admin/users/${id("denis@nalpia.com")}`, { managerId: id("lead@nalpia.com") });
  assert.equal(cycle.status, 400);
  assert.match(cycle.json.error, /cycle|circular|loop/i);
  assert.equal((await admin.patch(`/api/admin/users/${id("m@nalpia.com")}`, { managerId: id("m@nalpia.com") })).status, 400);

  const ok = await admin.patch(`/api/admin/users/${id("m@nalpia.com")}`, {
    managerId: id("lead@nalpia.com"),
    department: "Technology",
    bio: "Builds the intranet.",
    linkedin: "linkedin.com/in/mia",
    responsibilities: ["Intranet"],
  });
  assert.equal(ok.status, 200, ok.text);
  const mia = deps.db.prepare("SELECT manager_id, department, bio, linkedin, responsibilities FROM users WHERE email = 'm@nalpia.com'").get() as Record<string, string>;
  assert.equal(mia.manager_id, id("lead@nalpia.com"));
  assert.equal(mia.linkedin, "https://linkedin.com/in/mia");
  assert.equal(mia.responsibilities, '["Intranet"]');

  // E-mail can only be changed for invited people
  assert.equal((await admin.patch(`/api/admin/users/${id("m@nalpia.com")}`, { email: "mia@nalpia.com" })).status, 400);
  const ch = await admin.patch(`/api/admin/users/${id("carlo@nalpia.com")}`, { email: "carlo.elwinger@nalpia.com" });
  assert.equal(ch.status, 200, ch.text);
  assert.equal((await admin.patch(`/api/admin/users/${id("carlo@nalpia.com")}`, { email: "m@nalpia.com" })).status, 409);
  assert.equal((await member.patch(`/api/admin/users/${id("m@nalpia.com")}`, { bio: "x" })).status, 403);

  // Own profile: bio and LinkedIn
  const me = await member.patch("/api/me", { bio: "Hallo!", linkedin: "javascript:alert(1)" });
  assert.equal(me.json.bio, "Hallo!");
  assert.equal(me.json.linkedin, "", "unsafe links are discarded");

  // Externals
  const ext = (await member.get("/api/team/externals")).json as { name: string }[];
  assert.ok(ext.some((x) => x.name === "SINTRO Asset Management"));
  assert.equal((await member.req("PUT", "/api/team/externals", { items: [] })).status, 403);
  const put = await admin.req("PUT", "/api/team/externals", { items: [{ name: "New Advisor", role: "Advisor", group: "Advisory board & advisors" }] });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json[0].name, "New Advisor");
  assert.ok(put.json[0].id);
});
