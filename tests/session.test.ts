import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";

const PW = "korrekt-pferd-batterie";

// Regression 25.11.: a mailbox that needs reconnecting answered with 401, the interface took that for
// "signed out" and sent the person back to the login screen after every sign-in.
test("Postfach „neu verbinden“ antwortet nie mit 401 – die Anmeldung bleibt bestehen", async () => {
  const { app, deps } = setup({ MAIL_PROVIDER: "imap", MAIL_IMAP_HOST: "127.0.0.1", MAIL_IMAP_PORT: "1", MAIL_CALDAV_URL: "http://127.0.0.1:1/" });
  const id = await addUser(deps, { email: "denis@nalpia.com", name: "Denis K", password: PW, role: "admin" });
  const now = Date.now();
  deps.db
    .prepare(
      `INSERT INTO mail_accounts (user_id, provider, account_id, email, display_name, addresses, accounts_server, mail_api, refresh_token_enc, needs_reconnect, connected_at, updated_at)
       VALUES (?, 'imap', 'denis@nalpia.com', 'denis@nalpia.com', 'Denis K', '["denis@nalpia.com"]', '', '', ?, 1, ?, ?)`,
    )
    .run(id, deps.vault.encrypt("altes-passwort"), now, now);
  const c = new Client(app);
  await c.login("denis@nalpia.com", PW);
  const status = (await c.get("/api/mail/status")).json;
  assert.equal(status.connected, true);
  assert.equal(status.needsReconnect, true);
  for (const url of ["/api/mail/folders", "/api/mail/messages?folderId=1", "/api/calendar/events?from=2026-11-01T00:00:00.000Z&to=2026-12-01T00:00:00.000Z"]) {
    const r = await c.get(url);
    assert.notEqual(r.status, 401, `${url} darf nicht 401 liefern`);
    assert.equal(r.status, 409, `${url}: ${r.text}`);
    assert.equal(r.json.code, "reconnect");
  }
  assert.equal((await c.get("/api/mail/unread")).status, 200);
  assert.ok((await c.get("/api/auth/me")).json.user, "weiter angemeldet");
  // Without a session it is still a real 401 with the code the interface listens for
  const anon = await new Client(app).get("/api/tasks");
  assert.equal(anon.status, 401);
  assert.equal(anon.json.code, "unauthenticated");
});
