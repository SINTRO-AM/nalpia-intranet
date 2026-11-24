/**
 * IMAP/SMTP/CalDAV mailbox (Spacemail-compatible).
 *
 * The ID tests always run. The integration tests run against real servers when they are available:
 *   IMAP_TEST_PORT   – IMAPS port of a local server (e.g. Dovecot) with user denis@nalpia.com / geheim-123
 *   CALDAV_TEST_URL  – CalDAV server (e.g. Radicale) with the same user
 * The SMTP server is started by the test itself.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ImapFlow } from "imapflow";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { folderIdFor, messageIdFor, parseMessageId } from "../server/mail/imap.js";
import { addUser, Client, setup } from "./helpers.js";

test("IDs: folder and UID are encoded in the message ID", () => {
  const f = folderIdFor("INBOX");
  assert.match(f, /^\d{1,10}$/);
  assert.equal(folderIdFor("INBOX"), f);
  assert.notEqual(folderIdFor("Sent"), f);
  const id = messageIdFor(f, 42);
  assert.match(id, /^\d{11,20}$/);
  assert.deepEqual(parseMessageId(id), { folderId: f, uid: 42 });
  assert.deepEqual(parseMessageId(messageIdFor("7", 4294967295)), { folderId: "7", uid: 4294967295 });
  assert.throws(() => parseMessageId("123"));
});

test("Config: IMAP is the default provider without Zoho credentials", () => {
  const { deps } = setup({});
  assert.equal(deps.mail.mode, "imap");
  assert.equal(deps.mail.providerName, "Spacemail");
  const z = setup({ ZOHO_CLIENT_ID: "x", ZOHO_CLIENT_SECRET: "y" });
  assert.equal(z.deps.mail.mode, "zoho");
  const forced = setup({ ZOHO_CLIENT_ID: "x", ZOHO_CLIENT_SECRET: "y", MAIL_PROVIDER: "imap" });
  assert.equal(forced.deps.mail.mode, "imap");
});

const IMAP_PORT = Number(process.env.IMAP_TEST_PORT || 0);
const CALDAV = process.env.CALDAV_TEST_URL || "";
const CERT = process.env.MAIL_TEST_CERT_DIR || "/tmp/mailtest";
const live = IMAP_PORT > 0 && fs.existsSync(`${CERT}/cert.pem`);
const SMTP_PORT = 10465 + Math.floor(Math.random() * 400);
const sent: { from: string; to: string[]; raw: Buffer }[] = [];
let smtp: SMTPServer | null = null;

before(async () => {
  if (!live) return;
  smtp = new SMTPServer({
    secure: true,
    key: fs.readFileSync(`${CERT}/key.pem`),
    cert: fs.readFileSync(`${CERT}/cert.pem`),
    authOptional: false,
    onAuth(auth, _s, cb) {
      if (auth.username === "denis@nalpia.com" && auth.password === "geheim-123") cb(null, { user: auth.username });
      else cb(new Error("Invalid credentials"));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        sent.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks) });
        cb();
      });
    },
    logger: false,
  });
  await new Promise<void>((r) => smtp!.listen(SMTP_PORT, "127.0.0.1", () => r()));

  // Fresh mailbox state: empty INBOX/Sent/Drafts, then deliver two mails
  const c = new ImapFlow({ host: "127.0.0.1", port: IMAP_PORT, secure: true, auth: { user: "denis@nalpia.com", pass: "geheim-123" }, logger: false, tls: { rejectUnauthorized: false } });
  await c.connect();
  for (const box of ["INBOX", "Sent", "Drafts"]) {
    const lock = await c.getMailboxLock(box);
    try {
      if (c.mailbox && c.mailbox.exists) await c.messageDelete("1:*");
    } finally {
      lock.release();
    }
  }
  const mk = (from: string, subject: string, body: string, id: string, attach = false) => {
    const boundary = "b1";
    const head = `From: ${from}\r\nTo: Denis Keller <denis@nalpia.com>\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: <${id}>\r\nMIME-Version: 1.0\r\n`;
    if (!attach) return Buffer.from(`${head}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`);
    return Buffer.from(
      `${head}Content-Type: multipart/mixed; boundary=${boundary}\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n--${boundary}\r\nContent-Type: application/pdf; name=deck.pdf\r\nContent-Disposition: attachment; filename=deck.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from("%PDF-1.4 test").toString("base64")}\r\n--${boundary}--\r\n`,
    );
  };
  await c.append("INBOX", mk("Ana Investor <ana@seedfund.example>", "Re: nalpia pre-seed", "Yes, please send the deck. Grüße", "ana-1@seedfund.example"));
  await c.append("INBOX", mk("Bob <bob@other.example>", "Unterlagen", "Anbei die Unterlagen.", "bob-1@other.example", true));
  await c.logout();
});

after(async () => {
  if (smtp) await new Promise<void>((r) => smtp!.close(() => r()));
});

function liveSetup() {
  return setup({
    MAIL_PROVIDER: "imap",
    MAIL_IMAP_HOST: "127.0.0.1",
    MAIL_IMAP_PORT: String(IMAP_PORT),
    MAIL_SMTP_HOST: "127.0.0.1",
    MAIL_SMTP_PORT: String(SMTP_PORT),
    MAIL_TLS_SELF_SIGNED: "true",
    MAIL_CALDAV_URL: CALDAV,
  });
}

test("IMAP: connect with mailbox password, read, mark, reply, draft", { skip: !live && "no local IMAP server (IMAP_TEST_PORT)" }, async () => {
  const { deps, app } = liveSetup();
  await addUser(deps, { email: "denis@nalpia.com", name: "Denis Keller", password: "intranet-passwort-1" });
  await addUser(deps, { email: "carlo@nalpia.com", name: "Carlo", password: "intranet-passwort-2" });
  const c = new Client(app);
  await c.login("denis@nalpia.com", "intranet-passwort-1");

  let st = await c.get("/api/mail/status");
  assert.equal(st.json.mode, "imap");
  assert.equal(st.json.providerName, "Spacemail");
  assert.equal(st.json.connected, false);

  // Wrong password is rejected and nothing is stored
  const bad = await c.post("/api/mail/connect-password", { password: "falsch" });
  assert.equal(bad.status, 400, bad.text);
  assert.match(bad.json.error, /Passwort|password/i);
  assert.equal((await c.get("/api/mail/status")).json.connected, false);

  // Someone else's mailbox cannot be connected
  const other = await c.post("/api/mail/connect-password", { email: "carlo@nalpia.com", password: "geheim-123" });
  assert.equal(other.status, 403);

  const ok = await c.post("/api/mail/connect-password", { password: "geheim-123" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.connected, true);
  assert.equal(ok.json.email, "denis@nalpia.com");
  const row = deps.db.prepare("SELECT provider, refresh_token_enc FROM mail_accounts").get() as { provider: string; refresh_token_enc: string };
  assert.equal(row.provider, "imap");
  assert.ok(!row.refresh_token_enc.includes("geheim-123"), "password is stored encrypted");

  const folders = (await c.get("/api/mail/folders")).json as { id: string; type: string; name: string }[];
  const inbox = folders.find((f) => f.type === "inbox")!;
  assert.ok(inbox, JSON.stringify(folders));
  assert.ok(folders.some((f) => f.type === "sent") && folders.some((f) => f.type === "drafts"));

  const unread = await c.get("/api/mail/unread?fresh=1");
  assert.equal(unread.json.unread, 2);

  const list = await c.get(`/api/mail/messages?folderId=${inbox.id}`);
  assert.equal(list.status, 200, list.text);
  assert.equal(list.json.items.length, 2);
  const [first, second] = list.json.items;
  assert.equal(first.subject, "Unterlagen"); // newest first
  assert.equal(first.hasAttachment, true);
  assert.equal(second.from.email, "ana@seedfund.example");

  const search = await c.get(`/api/mail/messages?folderId=${inbox.id}&q=pre-seed`);
  assert.equal(search.json.items.length, 1);

  const msg = await c.get(`/api/mail/messages/${inbox.id}/${second.id}`);
  assert.equal(msg.status, 200, msg.text);
  assert.match(msg.json.html, /send the deck/);
  assert.equal(msg.json.unread, false);
  const att = (await c.get(`/api/mail/messages/${inbox.id}/${first.id}`)).json.attachments;
  assert.equal(att.length, 1);
  assert.equal(att[0].name, "deck.pdf");
  const dl = await c.get(`/api/mail/messages/${inbox.id}/${first.id}/attachments/${att[0].id}`);
  assert.equal(dl.status, 200);
  assert.match(dl.text, /%PDF-1.4 test/);

  assert.equal((await c.get("/api/mail/unread?fresh=1")).json.unread, 0);
  await c.post("/api/mail/messages/read", { ids: [second.id], read: false });
  assert.equal((await c.get("/api/mail/unread?fresh=1")).json.unread, 1);

  // Reply: goes out via SMTP with threading headers, copy in "Sent", original marked answered
  const reply = await c.post("/api/mail/send", { to: ["ana@seedfund.example"], subject: "Re: nalpia pre-seed", body: "Here is the deck.", reply: { messageId: second.id, folderId: inbox.id } });
  assert.equal(reply.status, 200, reply.text);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.to, ["ana@seedfund.example"]);
  const parsed = await simpleParser(sent[0]!.raw);
  assert.equal(parsed.inReplyTo, "<ana-1@seedfund.example>");
  assert.match(parsed.from?.text ?? "", /Denis Keller/);
  assert.match(parsed.html || "", /Here is the deck/);
  const sentFolder = folders.find((f) => f.type === "sent")!;
  const sentList = await c.get(`/api/mail/messages?folderId=${sentFolder.id}`);
  assert.equal(sentList.json.items.length, 1);

  const draft = await c.post("/api/mail/send", { to: ["bob@other.example"], subject: "Entwurf", body: "Noch nicht senden", mode: "draft" });
  assert.equal(draft.status, 200, draft.text);
  assert.equal(sent.length, 1, "a draft is not sent");
  const drafts = folders.find((f) => f.type === "drafts")!;
  assert.equal((await c.get(`/api/mail/messages?folderId=${drafts.id}`)).json.items.length, 1);

  // The agent uses the same mailbox
  const user = deps.db.prepare("SELECT * FROM users WHERE email = ?").get("denis@nalpia.com") as any;
  const client = deps.mail.client(user);
  const page = await client.list({ folderId: inbox.id, start: 1, limit: 10 });
  assert.equal(page.length, 2);

  // Changed password → reconnect state instead of endless errors
  deps.db.prepare("UPDATE mail_accounts SET refresh_token_enc = ?").run(deps.vault.encrypt("altes-passwort"));
  deps.mail.close();
  const stale = await c.get(`/api/mail/messages?folderId=${inbox.id}`);
  assert.equal(stale.status, 401, stale.text);
  st = await c.get("/api/mail/status");
  assert.equal(st.json.needsReconnect, true);
  const again = await c.post("/api/mail/connect-password", { password: "geheim-123" });
  assert.equal(again.status, 200);
  assert.equal((await c.get("/api/mail/status")).json.needsReconnect, false);

  await c.post("/api/mail/disconnect");
  assert.equal((await c.get("/api/mail/status")).json.connected, false);
  deps.mail.close();
});

test("CalDAV: list calendars, create, read and delete events", { skip: (!live || !CALDAV) && "no local CalDAV server (CALDAV_TEST_URL)" }, async () => {
  const { deps, app } = liveSetup();
  await addUser(deps, { email: "denis@nalpia.com", name: "Denis Keller", password: "intranet-passwort-1" });
  const c = new Client(app);
  await c.login("denis@nalpia.com", "intranet-passwort-1");
  assert.equal((await c.post("/api/mail/connect-password", { password: "geheim-123" })).status, 200);

  const cals = await c.get("/api/calendar/calendars?fresh=1");
  assert.equal(cals.status, 200, cals.text);
  assert.ok(cals.json.length >= 1, cals.text);
  const cal = cals.json[0];

  const start = new Date(Date.now() + 86_400_000);
  start.setUTCHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 3600_000);
  const created = await c.post("/api/calendar/events", { calendarId: cal.id, title: "Call mit Seed Fund", start: start.toISOString(), end: end.toISOString(), location: "Zoom", attendees: ["ana@seedfund.example"] });
  assert.ok([200, 201].includes(created.status), created.text);
  const allDay = await c.post("/api/calendar/events", { calendarId: cal.id, title: "Investor Day", allDay: true, startDate: start.toISOString().slice(0, 10), endDate: new Date(start.getTime() + 86_400_000).toISOString().slice(0, 10) });
  assert.ok([200, 201].includes(allDay.status), allDay.text);

  const from = new Date(start.getTime() - 2 * 86_400_000).toISOString();
  const to = new Date(start.getTime() + 5 * 86_400_000).toISOString();
  const evs = await c.get(`/api/calendar/events?from=${from}&to=${to}&fresh=1`);
  assert.equal(evs.status, 200, evs.text);
  const call = evs.json.find((e: any) => e.title === "Call mit Seed Fund");
  assert.ok(call, evs.text);
  assert.equal(call.start, start.getTime());
  assert.equal(call.location, "Zoom");
  assert.equal(call.attendees[0].email, "ana@seedfund.example");
  const day = evs.json.find((e: any) => e.title === "Investor Day");
  assert.equal(day.allDay, true);
  assert.equal(day.endDate, new Date(start.getTime() + 86_400_000).toISOString().slice(0, 10));

  for (const e of [call, day]) {
    const del = await c.req("DELETE", `/api/calendar/events/${encodeURIComponent(e.calendarId)}/${encodeURIComponent(e.id)}?etag=${encodeURIComponent(e.etag)}`);
    assert.ok([200, 204].includes(del.status), del.text);
  }
  const after2 = await c.get(`/api/calendar/events?from=${from}&to=${to}&fresh=1`);
  assert.equal(after2.json.filter((e: any) => ["Call mit Seed Fund", "Investor Day"].includes(e.title)).length, 0, JSON.stringify(after2.json));

  // Weekly series (4 dates) with a time zone: expanded here; deleting one occurrence keeps the rest
  const first = new Date(start.getTime() + 86_400_000);
  const ymd = first.toISOString().slice(0, 10).replace(/-/g, "");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN",
    "BEGIN:VTIMEZONE", "TZID:Europe/Berlin",
    "BEGIN:STANDARD", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "END:STANDARD",
    "BEGIN:DAYLIGHT", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "END:DAYLIGHT",
    "END:VTIMEZONE",
    "BEGIN:VEVENT", "UID:series-1@test", `DTSTAMP:${ymd}T000000Z`, `DTSTART;TZID=Europe/Berlin:${ymd}T100000`, `DTEND;TZID=Europe/Berlin:${ymd}T103000`,
    "RRULE:FREQ=WEEKLY;COUNT=4", "SUMMARY:Jour fixe", "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
  const calUrl = Buffer.from(cal.id, "base64url").toString("utf8");
  const put = await fetch(new URL("series-1.ics", calUrl), { method: "PUT", body: ics, headers: { "content-type": "text/calendar", authorization: "Basic " + Buffer.from("denis@nalpia.com:geheim-123").toString("base64") } });
  assert.ok(put.ok, String(put.status));
  const range = `from=${new Date(first.getTime() - 86_400_000).toISOString()}&to=${new Date(first.getTime() + 40 * 86_400_000).toISOString()}&fresh=1`;
  let series = (await c.get(`/api/calendar/events?${range}`)).json.filter((e: any) => e.title === "Jour fixe");
  assert.equal(series.length, 4, JSON.stringify(series));
  assert.equal(new Date(series[0].start).toISOString().slice(11, 16), first.getUTCMonth() >= 3 && first.getUTCMonth() <= 9 ? "08:00" : "09:00");
  assert.ok(series.every((e: any) => e.recurrenceId));
  const second = series[1];
  const delOcc = await c.req("DELETE", `/api/calendar/events/${encodeURIComponent(second.calendarId)}/${encodeURIComponent(second.id)}?etag=${encodeURIComponent(second.etag)}&recurrenceId=${encodeURIComponent(second.recurrenceId)}`);
  assert.equal(delOcc.status, 200, delOcc.text);
  series = (await c.get(`/api/calendar/events?${range}`)).json.filter((e: any) => e.title === "Jour fixe");
  assert.equal(series.length, 3);
  assert.ok(!series.some((e: any) => e.start === second.start));
  await fetch(new URL("series-1.ics", calUrl), { method: "DELETE", headers: { authorization: "Basic " + Buffer.from("denis@nalpia.com:geheim-123").toString("base64") } });
  deps.mail.close();
});
