import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";
import { ImportanceIndex, websiteDomain } from "../server/mail/important.js";

const PW = "korrekt-pferd-batterie";

test("Wichtig: Absender aus dem CRM per Adresse oder Domain, Freemail nur exakt", async () => {
  const { deps, app } = setup({ DEMO_MODE: "1", ALLOWED_EMAIL_DOMAINS: "nalpia.com" });
  const id = await addUser(deps, { email: "dk@nalpia.com", name: "Denis Keller", password: PW });
  const now = Date.now();
  const db = deps.db;
  db.prepare("INSERT INTO organizations (id, kind, name, website, created_at, updated_at) VALUES ('o1', 'investor', 'Isarvest Capital', 'https://www.isarvest-capital.example/team', ?, ?)").run(now, now);
  db.prepare("INSERT INTO organizations (id, kind, name, website, created_at, updated_at) VALUES ('o2', 'partner', 'Nordlicht', '', ?, ?)").run(now, now);
  db.prepare("INSERT INTO contacts (id, name, email, category, organization_id, created_at, updated_at) VALUES ('c1', 'Clara Weiß', 'clara.weiss@nordlicht-family-office.example', 'partner', 'o2', ?, ?)").run(now, now);
  db.prepare("INSERT INTO contacts (id, name, email, category, created_at, updated_at) VALUES ('c2', 'Angel Privat', 'angel@gmail.com', 'investor', ?, ?)").run(now, now);
  db.prepare("INSERT INTO contacts (id, name, email, category, created_at, updated_at) VALUES ('c3', 'Bewerberin', 'b@firma.example', 'bewerber', ?, ?)").run(now, now);

  assert.equal(websiteDomain("https://www.alpha.vc/team"), "alpha.vc");
  const idx = new ImportanceIndex(db, ["nalpia.com"]);
  assert.equal(idx.match("t.brandt@isarvest-capital.example")?.label, "Isarvest Capital");
  assert.equal(idx.match("someone@mail.isarvest-capital.example")?.kind, "investor", "Subdomain");
  assert.equal(idx.match("kollegin@nordlicht-family-office.example")?.label, "Nordlicht", "Domain eines Ansprechpartners");
  assert.equal(idx.match("angel@gmail.com")?.via, "kontakt");
  assert.equal(idx.match("fremd@gmail.com"), null, "Freemail-Domain zählt nicht");
  assert.equal(idx.match("b@firma.example"), null, "Bewerber sind nicht wichtig");

  db.prepare(
    `INSERT INTO mail_accounts (user_id, provider, account_id, email, addresses, accounts_server, mail_api, refresh_token_enc, connected_at, updated_at)
     VALUES (?, 'demo', '1', 'dk@nalpia.com', '["dk@nalpia.com"]', 'demo', 'demo', ?, ?, ?)`,
  ).run(id, deps.vault.encrypt("demo"), now, now);
  const c = new Client(app);
  await c.login("dk@nalpia.com", PW);
  const r = await c.get("/api/mail/important");
  assert.equal(r.status, 200, r.text);
  const froms = (r.json.items as { from: { email: string } }[]).map((m) => m.from.email);
  assert.ok(froms.includes("clara.weiss@nordlicht-family-office.example"));
  assert.ok(froms.includes("t.brandt@isarvest-capital.example"));
  assert.ok(!froms.some((f) => f.startsWith("noreply@")), "automatische Mails nicht");
  assert.ok(r.json.scanned > 0);
});
