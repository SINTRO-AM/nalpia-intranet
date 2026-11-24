import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, Client, setup } from "./helpers.js";
import { calendarApiFor, mapZohoEvent, parseZohoTime, toZohoUtc, ZohoCalendar } from "../server/calendar/calendar.js";
import { ZOHO_SCOPES } from "../server/mail/zoho.js";

const PW = "korrekt-pferd-batterie";

test("Kalender: Zoho-Zeitformate und Termine", () => {
  assert.equal(parseZohoTime("20170722T150000+0530"), Date.UTC(2017, 6, 22, 9, 30));
  assert.equal(parseZohoTime("20250301T150000Z"), Date.UTC(2025, 2, 1, 15));
  assert.equal(toZohoUtc(new Date(Date.UTC(2026, 10, 5, 9, 0, 0))), "20261105T090000Z");
  assert.equal(calendarApiFor("https://mail.zoho.eu"), "https://calendar.zoho.eu");
  assert.match(ZOHO_SCOPES, /ZohoCalendar\.event\.ALL/);
  const timed = mapZohoEvent({ uid: "u1", title: "Call", dateandtime: { start: "20261105T100000+0100", end: "20261105T110000+0100" }, etag: 123, role: "organizer" }, "cal", "dk@nalpia.com");
  assert.equal(timed.start, Date.UTC(2026, 10, 5, 9));
  assert.equal(timed.end - timed.start, 3600_000);
  assert.equal(timed.etag, "123");
  const allDay = mapZohoEvent({ uid: "u2", title: "Summit", isallday: true, dateandtime: { start: "20261103", end: "20261105" } }, "cal", "dk@nalpia.com");
  assert.deepEqual([allDay.startDate, allDay.endDate], ["2026-11-03", "2026-11-05"]);
});

test("Kalender: Zoho-Anfragen – Zeitraum in 31-Tage-Stücken, eventdata als Parameter, etag beim Löschen", async () => {
  const calls: { method: string; url: URL; headers: Record<string, string> }[] = [];
  const fake = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.pathname.endsWith("/calendars")) return new Response(JSON.stringify({ calendars: [{ uid: "c1", name: "Ich", color: "#8cbf40", isdefault: true, privilege: "owner" }] }));
    if (init?.method === "POST") {
      const ed = JSON.parse(url.searchParams.get("eventdata")!);
      return new Response(JSON.stringify({ events: [{ uid: "neu", title: ed.title, dateandtime: ed.dateandtime, isallday: ed.isallday, etag: 9 }] }));
    }
    if (init?.method === "DELETE") return new Response(JSON.stringify({ events: [{ uid: "neu", estatus: "deleted" }] }));
    return new Response(JSON.stringify({ events: [{ uid: "e1", title: "A", dateandtime: { start: "20261105T100000Z", end: "20261105T110000Z" }, etag: 1 }] }));
  }) as typeof fetch;
  const cal = new ZohoCalendar({ api: "https://calendar.zoho.eu", email: "dk@nalpia.com", token: async () => "tok", fetch: fake });
  assert.equal((await cal.calendars())[0]!.color, "#8cbf40");
  const evs = await cal.events("c1", new Date("2026-11-01T00:00:00Z"), new Date("2026-12-31T00:00:00Z"));
  const ranges = calls.filter((c) => c.url.pathname.endsWith("/events") && c.method === "GET");
  assert.equal(ranges.length, 2, "60 Tage → zwei Abfragen");
  assert.match(ranges[0]!.url.searchParams.get("range")!, /"start":"20261101T000000Z"/);
  assert.equal(evs.length, 1, "doppelte Treffer zusammengefasst");
  assert.equal(calls[0]!.headers.authorization, "Zoho-oauthtoken tok");

  const created = await cal.create({ calendarId: "c1", title: "Neu", allDay: false, start: "2026-11-05T09:00:00.000Z", end: "2026-11-05T10:00:00.000Z", attendees: ["a@b.de"], notify: false });
  const post = calls.find((c) => c.method === "POST")!;
  const ed = JSON.parse(post.url.searchParams.get("eventdata")!);
  assert.deepEqual(ed.dateandtime, { start: "20261105T090000Z", end: "20261105T100000Z", timezone: "Europe/Berlin" });
  assert.equal(ed.notify_attendee, 0, "ohne Einladungsmail");
  assert.equal(created.id, "neu");
  await cal.remove("c1", "neu", "9");
  assert.equal(calls.at(-1)!.headers.etag, "9");
});

test("Kalender-API im Demo-Modus: Kalender, Termine anlegen und löschen, Prüfungen", async () => {
  const { deps, app } = setup({ DEMO_MODE: "1" });
  const id = await addUser(deps, { email: "dk@nalpia.com", name: "Denis Keller", password: PW });
  const c = new Client(app);
  await c.login("dk@nalpia.com", PW);
  assert.equal((await c.get("/api/calendar/calendars")).status, 409, "ohne verbundenes Postfach");
  const now = Date.now();
  deps.db
    .prepare(
      `INSERT INTO mail_accounts (user_id, provider, account_id, email, addresses, accounts_server, mail_api, refresh_token_enc, connected_at, updated_at)
       VALUES (?, 'demo', '1', 'dk@nalpia.com', '["dk@nalpia.com"]', 'demo', 'demo', ?, ?, ?)`,
    )
    .run(id, deps.vault.encrypt("demo"), now, now);
  const cals = await c.get("/api/calendar/calendars");
  assert.equal(cals.status, 200);
  assert.ok(cals.json.length >= 1);
  const from = new Date(now - 86_400_000).toISOString();
  const to = new Date(now + 14 * 86_400_000).toISOString();
  const before = (await c.get(`/api/calendar/events?from=${from}&to=${to}`)).json as { id: string }[];
  assert.ok(before.length > 0);

  const start = new Date(now + 2 * 3600_000).toISOString();
  const end = new Date(now + 3 * 3600_000).toISOString();
  assert.equal((await c.post("/api/calendar/events", { calendarId: "demo-main", title: "X", start: end, end: start })).status, 422, "Ende vor Beginn");
  const made = await c.post("/api/calendar/events", { calendarId: "demo-main", title: "Call mit Alpha", start, end, location: "Teams" });
  assert.equal(made.status, 201, made.text);
  const after = (await c.get(`/api/calendar/events?from=${from}&to=${to}`)).json as { id: string; title: string }[];
  assert.ok(after.some((e) => e.title === "Call mit Alpha"), "Cache nach dem Anlegen geleert");
  const del = await c.req("DELETE", `/api/calendar/events/demo-main/${made.json.id}?etag=1`);
  assert.equal(del.status, 200);
  assert.equal((await c.req("DELETE", `/api/calendar/events/demo-main/${made.json.id}?etag=1`)).status, 404);
  assert.equal((await c.get(`/api/calendar/events?from=${from}&to=${new Date(now + 200 * 86_400_000).toISOString()}`)).status, 400, "Zeitraum zu lang");
});
