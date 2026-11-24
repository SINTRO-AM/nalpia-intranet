/**
 * Calendar via CalDAV (Spacemail: caldav.spacemail.com) with the same credentials as the mailbox.
 * Every person only sees and changes their own calendars. Recurring events are expanded here
 * (not every server supports server-side expansion).
 *
 * IDs: calendar ID = base64url of the calendar URL; event ID = base64url of the object URL, for an
 * occurrence of a series followed by ":" and the occurrence start in ms.
 */
import { randomUUID } from "node:crypto";
import ICAL from "ical.js";
import { DAVClient, type DAVCalendar, type DAVCalendarObject } from "tsdav";
import { MailError } from "../mail/types.js";
import { tr } from "../lib/i18n.js";
import type { CalendarClient, CalendarEvent, CalendarInfo, NewEvent } from "./calendar.js";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

const MAX_OCCURRENCES = 400;
const discovery = new Map<string, { at: number; client: DAVClient; calendars: DAVCalendar[] }>();
const DISCOVERY_TTL = 10 * 60_000;

const addDaysISO = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function displayName(c: DAVCalendar): string {
  const n = c.displayName;
  if (typeof n === "string" && n.trim()) return n.trim();
  const last = decodeURIComponent(c.url.replace(/\/+$/, "").split("/").pop() ?? "");
  return last || tr("Calendar", "Kalender");
}

function color(c: DAVCalendar): string {
  const v = typeof c.calendarColor === "string" ? c.calendarColor.trim() : "";
  const m = /^#([0-9a-f]{6})/i.exec(v);
  return m ? `#${m[1]}` : "#05224B";
}

function mailto(v: unknown): string {
  return String(v ?? "")
    .replace(/^mailto:/i, "")
    .trim()
    .toLowerCase();
}

export class CaldavCalendar implements CalendarClient {
  constructor(
    private o: {
      serverUrl: string;
      cred: { user: string; pass: string };
      email: string;
      onReconnectNeeded: () => void;
      fetch?: typeof fetch;
    },
  ) {}

  private get key() {
    return `${this.o.serverUrl}|${this.o.cred.user}|${this.o.cred.pass.length}`;
  }

  /** Detects a rejected password (tsdav reports discovery errors without the HTTP status). */
  private async probeAuth(): Promise<void> {
    const f = this.o.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(this.o.serverUrl.replace(/\/+$/, "") + "/", {
        method: "PROPFIND",
        headers: {
          authorization: "Basic " + Buffer.from(`${this.o.cred.user}:${this.o.cred.pass}`).toString("base64"),
          depth: "0",
          "content-type": "application/xml; charset=utf-8",
        },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
      });
    } catch {
      throw new MailError(tr("The calendar server cannot be reached right now.", "Der Kalenderserver ist gerade nicht erreichbar."), "upstream", 502);
    }
    if (res.status === 401 || res.status === 403) {
      this.o.onReconnectNeeded();
      throw new MailError(tr("The calendar server rejected the password. Please connect your mailbox again.", "Der Kalenderserver hat das Passwort abgelehnt. Bitte verbinde dein Postfach neu."), "reconnect", 401);
    }
  }

  private async session(fresh = false): Promise<{ client: DAVClient; calendars: DAVCalendar[] }> {
    const hit = discovery.get(this.key);
    if (hit && !fresh && Date.now() - hit.at < DISCOVERY_TTL) return hit;
    const client = new DAVClient({
      serverUrl: this.o.serverUrl,
      credentials: { username: this.o.cred.user, password: this.o.cred.pass },
      authMethod: "Basic",
      defaultAccountType: "caldav",
      fetch: this.o.fetch,
    });
    try {
      await client.login();
      const calendars = (await client.fetchCalendars()).filter((c) => !c.components?.length || c.components.includes("VEVENT"));
      const entry = { at: Date.now(), client, calendars };
      if (discovery.size > 200) discovery.clear();
      discovery.set(this.key, entry);
      return entry;
    } catch (e) {
      await this.probeAuth();
      throw new MailError(tr("The calendar could not be loaded: ", "Der Kalender konnte nicht geladen werden: ") + ((e as Error).message ?? ""), "upstream", 502);
    }
  }

  private async calendarById(id: string): Promise<{ client: DAVClient; cal: DAVCalendar }> {
    const url = unb64(id);
    let s = await this.session();
    let cal = s.calendars.find((c) => c.url === url);
    if (!cal) {
      s = await this.session(true);
      cal = s.calendars.find((c) => c.url === url);
    }
    if (!cal) throw new MailError(tr("This calendar was not found.", "Dieser Kalender wurde nicht gefunden."), "not_found", 404);
    return { client: s.client, cal };
  }

  async calendars(): Promise<CalendarInfo[]> {
    const { calendars } = await this.session(true);
    return calendars.map((c, i) => ({ id: b64(c.url), name: displayName(c), color: color(c), isDefault: i === 0, canWrite: true }));
  }

  async events(calendarId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    const { client, cal } = await this.calendarById(calendarId);
    let objects: DAVCalendarObject[];
    try {
      objects = await client.fetchCalendarObjects({ calendar: cal, timeRange: { start: from.toISOString(), end: to.toISOString() } });
    } catch (e) {
      await this.probeAuth();
      throw new MailError(tr("The calendar could not be loaded: ", "Der Kalender konnte nicht geladen werden: ") + ((e as Error).message ?? ""), "upstream", 502);
    }
    const out: CalendarEvent[] = [];
    for (const obj of objects) {
      if (typeof obj.data !== "string" || !obj.data.includes("BEGIN:VEVENT")) continue;
      try {
        out.push(...this.expand(obj, calendarId, from, to));
      } catch {
        /* skip objects the parser cannot read */
      }
    }
    return out;
  }

  private expand(obj: DAVCalendarObject, calendarId: string, from: Date, to: Date): CalendarEvent[] {
    const root = new ICAL.Component(ICAL.parse(obj.data as string));
    for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);
    const vevents = root.getAllSubcomponents("vevent");
    const master = vevents.find((v) => !v.hasProperty("recurrence-id")) ?? vevents[0];
    if (!master) return [];
    const ev = new ICAL.Event(master);
    const id = b64(obj.url);
    const etag = obj.etag ?? "";
    const base = (e: InstanceType<typeof ICAL.Event>, start: InstanceType<typeof ICAL.Time>, end: InstanceType<typeof ICAL.Time>, recurrence: string | null): CalendarEvent => {
      const allDay = start.isDate;
      const organizer = mailto(e.component.getFirstPropertyValue("organizer"));
      const attendees = e.component.getAllProperties("attendee").map((p) => ({ email: mailto(p.getFirstValue()), status: String(p.getParameter("partstat") ?? "NEEDS-ACTION") }));
      const startDate = allDay ? start.toString().slice(0, 10) : undefined;
      const endExclusive = allDay ? end.toString().slice(0, 10) : undefined;
      return {
        id: recurrence ? `${id}:${Date.parse(recurrence)}` : id,
        calendarId,
        title: e.summary || tr("(no title)", "(ohne Titel)"),
        start: allDay ? Date.parse(startDate + "T00:00:00Z") : start.toJSDate().getTime(),
        end: allDay ? Date.parse((endExclusive ?? startDate) + "T00:00:00Z") : end.toJSDate().getTime(),
        allDay,
        startDate,
        endDate: allDay ? (endExclusive && endExclusive > startDate! ? addDaysISO(endExclusive, -1) : startDate) : undefined,
        location: e.location ?? "",
        description: e.description ?? "",
        organizer: organizer || this.o.email,
        attendees,
        etag,
        recurrenceId: recurrence,
        isOrganizer: !organizer || organizer === this.o.email.toLowerCase(),
      };
    };

    if (!ev.isRecurring()) {
      const start = ev.startDate;
      const end = ev.endDate ?? start;
      return [base(ev, start, end, null)];
    }

    for (const ex of vevents) if (ex !== master) ev.relateException(ex);
    const out: CalendarEvent[] = [];
    const it = ev.iterator();
    const toMs = to.getTime();
    const fromMs = from.getTime();
    for (let i = 0, next = it.next(); next && i < 5000 && out.length < MAX_OCCURRENCES; i++, next = it.next()) {
      const d = ev.getOccurrenceDetails(next);
      const sMs = d.startDate.isDate ? Date.parse(d.startDate.toString().slice(0, 10) + "T00:00:00Z") : d.startDate.toJSDate().getTime();
      if (sMs >= toMs) break;
      const eMs = d.endDate.isDate ? Date.parse(d.endDate.toString().slice(0, 10) + "T00:00:00Z") : d.endDate.toJSDate().getTime();
      if (eMs <= fromMs && !(eMs === sMs && sMs >= fromMs)) continue;
      out.push(base(d.item, d.startDate, d.endDate, d.recurrenceId.toJSDate().toISOString()));
    }
    return out;
  }

  async create(n: NewEvent): Promise<CalendarEvent> {
    const { client, cal } = await this.calendarById(n.calendarId);
    const uid = `${randomUUID()}@nalpia-intranet`;
    const root = new ICAL.Component(["vcalendar", [], []]);
    root.updatePropertyWithValue("prodid", "-//nalpia//Intranet//DE");
    root.updatePropertyWithValue("version", "2.0");
    const ve = new ICAL.Component("vevent");
    ve.updatePropertyWithValue("uid", uid);
    ve.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
    if (n.allDay) {
      const s = ICAL.Time.fromDateString(n.startDate!);
      const e = ICAL.Time.fromDateString(addDaysISO(n.endDate ?? n.startDate!, 1));
      ve.updatePropertyWithValue("dtstart", s);
      ve.updatePropertyWithValue("dtend", e);
    } else {
      ve.updatePropertyWithValue("dtstart", ICAL.Time.fromJSDate(new Date(n.start!), true));
      ve.updatePropertyWithValue("dtend", ICAL.Time.fromJSDate(new Date(n.end!), true));
    }
    ve.updatePropertyWithValue("summary", n.title);
    if (n.location) ve.updatePropertyWithValue("location", n.location);
    if (n.description) ve.updatePropertyWithValue("description", n.description);
    const attendees = n.attendees ?? [];
    if (attendees.length) {
      const org = ve.addPropertyWithValue("organizer", `mailto:${this.o.email}`);
      if (!n.notify) org.setParameter("schedule-agent", "CLIENT");
      for (const a of attendees) {
        const p = ve.addPropertyWithValue("attendee", `mailto:${a}`);
        p.setParameter("partstat", "NEEDS-ACTION");
        p.setParameter("rsvp", "TRUE");
        p.setParameter("role", "REQ-PARTICIPANT");
        // Without "notify" the server must not send invitations
        if (!n.notify) p.setParameter("schedule-agent", "CLIENT");
      }
    }
    root.addSubcomponent(ve);
    const res = await client.createCalendarObject({ calendar: cal, filename: `${uid.split("@")[0]}.ics`, iCalString: root.toString() });
    if (res.status === 401 || res.status === 403) {
      this.o.onReconnectNeeded();
      throw new MailError(tr("The calendar server rejected the password.", "Der Kalenderserver hat das Passwort abgelehnt."), "reconnect", 401);
    }
    if (!res.ok) throw new MailError(tr("The event could not be created (calendar server: ", "Der Termin konnte nicht angelegt werden (Kalenderserver: ") + `${res.status}).`, "upstream", 502);
    const url = new URL(`${uid.split("@")[0]}.ics`, cal.url.endsWith("/") ? cal.url : cal.url + "/").toString();
    const etag = res.headers.get("etag") ?? "";
    const [ev] = this.expand({ url, etag, data: root.toString() }, n.calendarId, new Date(0), new Date(8.64e15));
    return ev!;
  }

  async remove(calendarId: string, eventId: string, etag: string, recurrenceId?: string | null): Promise<void> {
    const { client, cal } = await this.calendarById(calendarId);
    const url = unb64(eventId.split(":")[0]!);
    if (!url.startsWith(new URL(cal.url, this.o.serverUrl).origin) && !url.startsWith("/")) {
      throw new MailError(tr("Invalid event.", "Ungültiger Termin."), "invalid", 400);
    }
    const notFound = () => new MailError(tr("This event was not found – it may already have been deleted.", "Dieser Termin wurde nicht gefunden – evtl. schon gelöscht."), "not_found", 404);

    if (!recurrenceId) {
      const res = await client.deleteCalendarObject({ calendarObject: { url, etag } });
      if (res.status === 404) throw notFound();
      if (res.status === 412) throw new MailError(tr("The event was changed in the meantime. Please reload.", "Der Termin wurde zwischenzeitlich geändert. Bitte neu laden."), "invalid", 409);
      if (!res.ok) throw new MailError(tr("The event could not be deleted (calendar server: ", "Der Termin konnte nicht gelöscht werden (Kalenderserver: ") + `${res.status}).`, "upstream", 502);
      return;
    }

    // One occurrence of a series: add an EXDATE to the series instead of deleting the whole series
    const [obj] = await client.fetchCalendarObjects({ calendar: cal, objectUrls: [url] });
    if (!obj || typeof obj.data !== "string") throw notFound();
    const root = new ICAL.Component(ICAL.parse(obj.data));
    for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);
    const vevents = root.getAllSubcomponents("vevent");
    const master = vevents.find((v) => !v.hasProperty("recurrence-id"));
    if (!master) throw notFound();
    const when = new Date(recurrenceId);
    const dtstart = master.getFirstPropertyValue("dtstart") as InstanceType<typeof ICAL.Time>;
    let ex: InstanceType<typeof ICAL.Time>;
    if (dtstart.isDate) {
      ex = ICAL.Time.fromDateString(when.toISOString().slice(0, 10));
    } else {
      ex = ICAL.Time.fromJSDate(when, true);
    }
    master.addPropertyWithValue("exdate", ex);
    for (const v of vevents) {
      const rid = v.getFirstPropertyValue("recurrence-id") as InstanceType<typeof ICAL.Time> | null;
      if (rid && Math.abs(rid.toJSDate().getTime() - when.getTime()) < 1000) root.removeSubcomponent(v);
    }
    const res = await client.updateCalendarObject({ calendarObject: { url, etag: obj.etag ?? etag, data: root.toString() } });
    if (res.status === 412) throw new MailError(tr("The event was changed in the meantime. Please reload.", "Der Termin wurde zwischenzeitlich geändert. Bitte neu laden."), "invalid", 409);
    if (!res.ok) throw new MailError(tr("The occurrence could not be deleted (calendar server: ", "Der Einzeltermin konnte nicht gelöscht werden (Kalenderserver: ") + `${res.status}).`, "upstream", 502);
  }
}
