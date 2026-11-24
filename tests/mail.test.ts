import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";
import { parseLosslessJson } from "../server/mail/zoho.js";

const PW = "korrekt-pferd-batterie";
const BIG_MSG = "1792967313527003600"; // > Number.MAX_SAFE_INTEGER
const BIG_FOLDER = "6366010000000002014";

interface Acc {
  key: string;
  accountId: string;
  email: string;
  aliases: string[];
  messages: { id: string; subject: string; from: string; html: string }[];
}

/** Simuliert Zoho Accounts + Mail-API (EU). Jedes Konto sieht nur seine eigenen Nachrichten. */
function fakeZoho(accounts: Acc[]) {
  const calls: { method: string; url: URL; token?: string; body?: string }[] = [];
  const codes = new Map<string, string>(); // code → key
  const invalid = new Set<string>();
  const revoked: string[] = [];
  let n = 0;
  const byKey = new Map(accounts.map((a) => [a.key, a]));
  const json = (data: unknown, status = 200) => new Response(typeof data === "string" ? data : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    const token = auth?.replace("Zoho-oauthtoken ", "");
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method: init?.method ?? "GET", url, token, body });
    if (url.host === "accounts.zoho.eu") {
      if (url.pathname === "/oauth/v2/token/revoke") {
        revoked.push(url.searchParams.get("token")!);
        return json({ status: "success" });
      }
      const p = new URLSearchParams(body);
      if (p.get("client_id") !== "cid" || p.get("client_secret") !== "csecret") return json({ error: "invalid_client" });
      if (p.get("grant_type") === "authorization_code") {
        const key = codes.get(p.get("code")!);
        if (!key) return json({ error: "invalid_code" });
        if (p.get("redirect_uri") !== "http://localhost:5173/api/mail/oauth/callback") return json({ error: "invalid_redirect_uri" });
        return json({ access_token: `at-${key}-${++n}`, refresh_token: `rt-${key}`, expires_in: 3600, api_domain: "https://www.zohoapis.eu" });
      }
      if (p.get("grant_type") === "refresh_token") {
        const key = p.get("refresh_token")!.replace(/^rt-/, "");
        if (!byKey.has(key)) return json({ error: "invalid_code" });
        return json({ access_token: `at-${key}-${++n}`, expires_in: 3600 });
      }
      return json({ error: "unsupported" }, 400);
    }
    if (url.host === "mail.zoho.eu") {
      const key = token?.match(/^at-(.+)-\d+$/)?.[1];
      if (!token || !key || invalid.has(token)) return json({ status: { code: 404, description: "Invalid Input" }, data: { errorCode: "INVALID_OAUTHTOKEN" } }, 404);
      const acc = byKey.get(key)!;
      if (url.pathname === "/api/accounts") {
        return json({
          status: { code: 200 },
          data: [{ accountId: acc.accountId, primaryEmailAddress: acc.email, displayName: acc.key, isDefaultAccount: true, type: "ZOHO_ACCOUNT", emailAddress: [acc.email, ...acc.aliases].map((m) => ({ mailId: m, isConfirmed: true })) }],
        });
      }
      const m = url.pathname.match(/^\/api\/accounts\/(\d+)(\/.*)$/);
      if (!m || m[1] !== acc.accountId) return json({ status: { code: 403, description: "Forbidden" } }, 403);
      const rest = m[2]!;
      if (rest === "/folders") return json({ status: { code: 200 }, data: [{ folderId: BIG_FOLDER, folderName: "Inbox", folderType: "Inbox", path: "/Inbox" }, { folderId: "6366010000000002022", folderName: "Sent", folderType: "Sent", path: "/Sent" }] });
      if (rest === "/messages/view") {
        // folderId absichtlich als ungequotete große Zahl (Präzisionstest)
        const items = acc.messages
          .map((x) => `{"messageId":"${x.id}","folderId":${BIG_FOLDER},"subject":"${x.subject}","fromAddress":"${x.from}","sender":"Absender","toAddress":"&lt;${acc.email}&gt;","ccAddress":"Not Provided","receivedTime":"1792967313513","summary":"Vorschau &amp; mehr","status":"0","hasAttachment":"0","flagid":"flag_not_set"}`)
          .join(",");
        return json(`{"status":{"code":200},"data":[${items}]}`);
      }
      const msg = rest.match(/^\/folders\/(\d+)\/messages\/(\d+)\/(details|content|attachmentinfo)$/);
      if (msg) {
        const x = acc.messages.find((y) => y.id === msg[2]);
        if (!x) return json({ status: { code: 404, description: "Not found" } }, 404);
        if (msg[3] === "details") return json({ status: { code: 200 }, data: { subject: x.subject, fromAddress: x.from, sender: "Absender", toAddress: `&lt;${acc.email}&gt;`, receivedTime: "1792967313513", status: "1" } });
        if (msg[3] === "content") return json({ status: { code: 200 }, data: { messageId: Number(x.id), content: x.html } });
        return json({ status: { code: 200 }, data: { attachments: [] } });
      }
      if (rest === "/updatemessage" && init?.method === "PUT") return json({ status: { code: 200 } });
      if (rest === "/messages" && init?.method === "POST") return json({ status: { code: 200 }, data: {} });
      if (/^\/messages\/\d+$/.test(rest) && init?.method === "POST") return json({ status: { code: 200 }, data: {} });
      return json({ status: { code: 404 } }, 404);
    }
    throw new Error("Unerwarteter Host im Test: " + url.host);
  };
  return { fetchImpl, calls, codes, invalid, revoked };
}

const ACC_A: Acc = { key: "anna", accountId: "111", email: "anna@nalpia.com", aliases: ["info@nalpia.com"], messages: [{ id: BIG_MSG, subject: "Nur für Anna", from: "lp@fonds.example", html: "<p>Geheim für Anna</p>" }] };
const ACC_B: Acc = { key: "ben", accountId: "222", email: "ben@nalpia.com", aliases: [], messages: [{ id: "1792967313527009999", subject: "Nur für Ben", from: "x@y.example", html: "<p>Bens Mail</p>" }] };
const ACC_EVIL: Acc = { key: "fremd", accountId: "333", email: "chef@nalpia.com", aliases: [], messages: [] };

async function env() {
  const z = fakeZoho([ACC_A, ACC_B, ACC_EVIL]);
  const s = setup({ ZOHO_CLIENT_ID: "cid", ZOHO_CLIENT_SECRET: "csecret" }, { fetch: z.fetchImpl });
  await addUser(s.deps, { email: "anna@nalpia.com", password: PW, role: "admin" });
  await addUser(s.deps, { email: "ben@nalpia.com", password: PW });
  await addUser(s.deps, { email: "carl@nalpia.com", password: PW });
  return { ...s, z };
}

async function connect(c: Client, z: ReturnType<typeof fakeZoho>, key: string) {
  const r = await c.post("/api/mail/connect");
  assert.equal(r.status, 200);
  const u = new URL(r.json.url);
  const state = u.searchParams.get("state")!;
  const code = `code-${key}-${Math.random()}`;
  z.codes.set(code, key);
  return c.get(`/api/mail/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&location=eu&accounts-server=${encodeURIComponent("https://accounts.zoho.eu")}`);
}

test("OAuth-URL: EU-Accounts-Server, minimale Scopes, Offline-Zugriff, State", async () => {
  const { app } = await env();
  const c = new Client(app);
  await c.login("anna@nalpia.com", PW);
  const r = await c.post("/api/mail/connect");
  const u = new URL(r.json.url);
  assert.equal(u.origin, "https://accounts.zoho.eu");
  assert.equal(u.pathname, "/oauth/v2/auth");
  assert.equal(u.searchParams.get("scope"), "ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.ALL,ZohoCalendar.calendar.READ,ZohoCalendar.event.ALL");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:5173/api/mail/oauth/callback");
  assert.ok((u.searchParams.get("state") ?? "").length >= 24);
});

test("OAuth-Callback: Erfolg speichert Tokens verschlüsselt; Status zeigt Hauptadresse und Aliase", async () => {
  const { app, deps, z } = await env();
  const c = new Client(app);
  await c.login("anna@nalpia.com", PW);
  const r = await connect(c, z, "anna");
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location")!, /\/postfach\?verbunden=1/);
  const row = deps.db.prepare("SELECT * FROM mail_accounts").get() as Record<string, string>;
  assert.ok(!JSON.stringify(row).includes("rt-anna"), "Refresh-Token darf nicht im Klartext gespeichert sein");
  assert.ok(!JSON.stringify(row).includes("at-anna"), "Access-Token darf nicht im Klartext gespeichert sein");
  const st = await c.get("/api/mail/status");
  assert.equal(st.json.connected, true);
  assert.deepEqual(st.json.addresses.sort(), ["anna@nalpia.com", "info@nalpia.com"]);
});

test("OAuth-Callback: State einer anderen Person wird abgelehnt", async () => {
  const { app, z } = await env();
  const anna = new Client(app);
  await anna.login("anna@nalpia.com", PW);
  const ben = new Client(app);
  await ben.login("ben@nalpia.com", PW);
  const r = await anna.post("/api/mail/connect");
  const state = new URL(r.json.url).searchParams.get("state")!;
  z.codes.set("c1", "ben");
  const cb = await ben.get(`/api/mail/oauth/callback?code=c1&state=${state}`);
  assert.match(cb.headers.get("location")!, /fehler=/);
  assert.equal((await ben.get("/api/mail/status")).json.connected, false);
});

test("OAuth-Callback: fremdes Postfach (andere E-Mail) wird abgelehnt und das Token widerrufen", async () => {
  const { app, deps, z } = await env();
  const carl = new Client(app);
  await carl.login("carl@nalpia.com", PW);
  const r = await connect(carl, z, "fremd");
  assert.equal(r.headers.get("location"), "/postfach?fehler=mismatch");
  assert.deepEqual(z.revoked, ["rt-fremd"]);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM mail_accounts").get() as { n: number }).n, 0);
});

test("OAuth-Callback: fremder accounts-server wird nicht kontaktiert", async () => {
  const { app, z } = await env();
  const c = new Client(app);
  await c.login("anna@nalpia.com", PW);
  const r = await c.post("/api/mail/connect");
  const state = new URL(r.json.url).searchParams.get("state")!;
  z.codes.set("c2", "anna");
  const cb = await c.get(`/api/mail/oauth/callback?code=c2&state=${state}&accounts-server=${encodeURIComponent("https://evil.example")}`);
  assert.match(cb.headers.get("location")!, /fehler=/);
  assert.ok(!z.calls.some((x) => x.url.host === "evil.example"));
});

test("Isolation: jede Person sieht ausschließlich ihr eigenes Postfach – auch Admins nicht fremde", async () => {
  const { app, z } = await env();
  const anna = new Client(app);
  await anna.login("anna@nalpia.com", PW);
  const ben = new Client(app);
  await ben.login("ben@nalpia.com", PW);
  const carl = new Client(app);
  await carl.login("carl@nalpia.com", PW);
  await connect(anna, z, "anna");
  await connect(ben, z, "ben");

  const la = await anna.get(`/api/mail/messages?folderId=${BIG_FOLDER}`);
  assert.equal(la.status, 200);
  assert.deepEqual(la.json.items.map((m: { subject: string }) => m.subject), ["Nur für Anna"]);
  assert.equal(la.json.items[0].folderId, BIG_FOLDER, "Große IDs bleiben exakt erhalten");
  assert.equal(la.json.items[0].snippet, "Vorschau & mehr");
  const lb = await ben.get(`/api/mail/messages?folderId=${BIG_FOLDER}`);
  assert.deepEqual(lb.json.items.map((m: { subject: string }) => m.subject), ["Nur für Ben"]);

  // Ben versucht Annas Nachricht direkt zu öffnen → läuft mit Bens Token gegen Bens Konto → nicht gefunden
  const steal = await ben.get(`/api/mail/messages/${BIG_FOLDER}/${BIG_MSG}`);
  assert.equal(steal.status, 404);
  // Jeder API-Aufruf trägt das Token der aufrufenden Person
  for (const call of z.calls.filter((x) => x.url.host === "mail.zoho.eu" && x.url.pathname.startsWith("/api/accounts/"))) {
    const acc = call.url.pathname.split("/")[3];
    assert.ok(call.token?.startsWith(acc === "111" ? "at-anna-" : "at-ben-"), `Token passt nicht zum Konto ${acc}`);
  }
  // Nicht verbunden → kein Zugriff (auch nicht über irgendeinen Parameter)
  const lc = await carl.get(`/api/mail/messages?folderId=${BIG_FOLDER}`);
  assert.equal(lc.status, 409);
  assert.equal(lc.json.code, "not_connected");
});

test("Token-Erneuerung: abgelaufenes Access-Token wird per Refresh-Token ersetzt; INVALID_OAUTHTOKEN → einmal neu versuchen", async () => {
  const { app, deps, z } = await env();
  const anna = new Client(app);
  await anna.login("anna@nalpia.com", PW);
  await connect(anna, z, "anna");
  deps.db.prepare("UPDATE mail_accounts SET access_expires_at = 0").run();
  const r = await anna.get("/api/mail/folders");
  assert.equal(r.status, 200);
  assert.ok(z.calls.some((x) => x.url.host === "accounts.zoho.eu" && new URLSearchParams(x.body).get("grant_type") === "refresh_token"));
  // Aktuelles Token serverseitig ungültig machen → Retry mit frischem Token
  const last = [...z.calls].reverse().find((x) => x.token)!.token!;
  z.invalid.add(last);
  const r2 = await anna.get(`/api/mail/messages?folderId=${BIG_FOLDER}`);
  assert.equal(r2.status, 200);
});

test("Gelesen-Markieren sendet große IDs als exakte JSON-Zahlen", async () => {
  const { app, z } = await env();
  const anna = new Client(app);
  await anna.login("anna@nalpia.com", PW);
  await connect(anna, z, "anna");
  const r = await anna.post("/api/mail/messages/read", { ids: [BIG_MSG], read: true });
  assert.equal(r.status, 200);
  const put = z.calls.find((x) => x.method === "PUT")!;
  assert.equal(put.body, `{"mode":"markAsRead","messageId":[${BIG_MSG}]}`);
  const bad = await anna.post("/api/mail/messages/read", { ids: ["1,2"], read: true });
  assert.equal(bad.status, 422);
});

test("Antworten: richtiger Endpunkt, gewählter Alias als Absender, Text wird HTML-escaped, Audit ohne Inhalt", async () => {
  const { app, deps, z } = await env();
  const anna = new Client(app);
  await anna.login("anna@nalpia.com", PW);
  await connect(anna, z, "anna");
  const r = await anna.post("/api/mail/send", {
    to: ["lp@fonds.example"],
    subject: "Re: Nur für Anna",
    body: "Hallo <script>alert(1)</script>\nZeile 2",
    from: "info@nalpia.com",
    reply: { messageId: BIG_MSG, folderId: BIG_FOLDER },
    quote: true,
  });
  assert.equal(r.status, 200);
  const post = z.calls.find((x) => x.method === "POST" && x.url.pathname === `/api/accounts/111/messages/${BIG_MSG}`)!;
  const payload = JSON.parse(post.body!);
  assert.equal(payload.action, "reply");
  assert.equal(payload.fromAddress, "info@nalpia.com");
  assert.equal(payload.toAddress, "lp@fonds.example");
  assert.ok(payload.content.includes("&lt;script&gt;"));
  assert.ok(!payload.content.includes("<script>"));
  assert.ok(payload.content.includes("Geheim für Anna"), "Original wird zitiert");
  const a = deps.db.prepare("SELECT meta FROM audit_log WHERE action = 'mail.replied'").get() as { meta: string };
  assert.ok(!a.meta.includes("Nur für Anna") && !a.meta.includes("script"), "Audit enthält keine Inhalte");
  // Fremde Absenderadresse wird ignoriert → Hauptadresse
  await anna.post("/api/mail/send", { to: ["a@b.example"], subject: "x", body: "y", from: "chef@nalpia.com" });
  const last = z.calls.filter((x) => x.method === "POST" && x.url.pathname === "/api/accounts/111/messages").pop()!;
  assert.equal(JSON.parse(last.body!).fromAddress, "anna@nalpia.com");
});

test("Trennen widerruft das Token bei Zoho und löscht die Verbindung", async () => {
  const { app, deps, z } = await env();
  const anna = new Client(app);
  await anna.login("anna@nalpia.com", PW);
  await connect(anna, z, "anna");
  await anna.post("/api/mail/disconnect");
  assert.deepEqual(z.revoked, ["rt-anna"]);
  assert.equal((deps.db.prepare("SELECT COUNT(*) AS n FROM mail_accounts").get() as { n: number }).n, 0);
});

test("Callback ohne Anmeldung leitet zum Login", async () => {
  const { app } = await env();
  const r = await new Client(app).get("/api/mail/oauth/callback?code=x&state=y");
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location")!, /^\/login/);
});

test("parseLosslessJson erhält lange Ganzzahlen und lässt Strings unberührt", () => {
  const v = parseLosslessJson('{"a":1792967313527003600,"b":"Tel: 12345678901234567","c":[6366010000000002014,1.5,-3],"d":42}') as Record<string, unknown>;
  assert.equal(v.a, "1792967313527003600");
  assert.equal(v.b, "Tel: 12345678901234567");
  assert.deepEqual(v.c, ["6366010000000002014", 1.5, -3]);
  assert.equal(v.d, 42);
});
