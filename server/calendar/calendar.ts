/**
 * Calendar via the Zoho Calendar API (same Zoho sign-in as the mailbox).
 * Every person only sees and changes their own calendar. In demo mode a fictitious
 * calendar is kept in memory.
 */
import { MailError } from "../mail/types.js";
import { tr } from "../lib/i18n.js";

export interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  /** owner | write | read … – events can only be created in own or writable calendars */
  canWrite: boolean;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  /** Timestamp in ms (all-day events: midnight UTC of the day) */
  start: number;
  end: number;
  allDay: boolean;
  /** All-day: YYYY-MM-DD (end inclusive) */
  startDate?: string;
  endDate?: string;
  location: string;
  description: string;
  organizer: string;
  attendees: { email: string; status: string }[];
  etag: string;
  recurrenceId: string | null;
  isOrganizer: boolean;
}

export interface NewEvent {
  calendarId: string;
  title: string;
  allDay: boolean;
  /** ISO timestamp (timed events) */
  start?: string;
  end?: string;
  /** YYYY-MM-DD (all-day, end inclusive) */
  startDate?: string;
  endDate?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  /** Send email invitations to the attendees */
  notify?: boolean;
  timezone?: string;
}

export interface CalendarClient {
  calendars(): Promise<CalendarInfo[]>;
  events(calendarId: string, from: Date, to: Date): Promise<CalendarEvent[]>;
  create(e: NewEvent): Promise<CalendarEvent>;
  remove(calendarId: string, eventId: string, etag: string, recurrenceId?: string | null): Promise<void>;
}

/* ---------- Date formats ---------- */

const pad = (n: number) => String(n).padStart(2, "0");
/** Date → 20261105T090000Z */
export const toZohoUtc = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
/** 2026-11-05 → 20261105 */
export const toZohoDate = (iso: string) => iso.replace(/-/g, "");
/** 20261105 → 2026-11-05 */
const fromZohoDate = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/** Zoho time ("20170722T150000+0530", "…Z", "20170722") → ms */
export function parseZohoTime(s: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})?)?$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", se = "00", tz] = m;
  const base = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +se);
  if (!tz || tz === "Z") return base;
  const sign = tz[0] === "-" ? -1 : 1;
  const off = sign * (+tz.slice(1, 3) * 60 + +tz.slice(3, 5)) * 60_000;
  return base - off;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Raw = Record<string, any>;

export function mapZohoEvent(e: Raw, calendarId: string, me: string): CalendarEvent {
  const dt = (e.dateandtime ?? {}) as Raw;
  const allDay = e.isallday === true || e.isallday === "true";
  const rawStart = String(dt.start ?? e.start ?? "");
  const rawEnd = String(dt.end ?? e.end ?? rawStart);
  let startDate: string | undefined;
  let endDate: string | undefined;
  if (allDay) {
    startDate = fromZohoDate(rawStart.slice(0, 8));
    endDate = fromZohoDate(rawEnd.slice(0, 8));
    if (endDate < startDate) endDate = startDate;
  }
  const start = allDay ? Date.parse(startDate + "T00:00:00Z") : (parseZohoTime(rawStart) ?? 0);
  const end = allDay ? Date.parse(addDays(endDate!, 1) + "T00:00:00Z") : (parseZohoTime(rawEnd) ?? start);
  const organizer = String(e.organizer ?? "");
  return {
    id: String(e.uid ?? e.id ?? ""),
    calendarId,
    title: String(e.title ?? "").trim() || tr("(untitled)", "(ohne Titel)"),
    start,
    end: Math.max(end, start),
    allDay,
    startDate,
    endDate,
    location: String(e.location ?? ""),
    description: String(e.description ?? ""),
    organizer,
    attendees: Array.isArray(e.attendees) ? (e.attendees as Raw[]).map((a) => ({ email: String(a.email ?? ""), status: String(a.status ?? "") })).filter((a) => a.email) : [],
    etag: String(e.etag ?? ""),
    recurrenceId: e.recurrenceid ? String(e.recurrenceid) : null,
    isOrganizer: e.role ? e.role === "organizer" : !organizer || organizer.toLowerCase() === me.toLowerCase(),
  };
}

/* ---------- Zoho ---------- */

/** https://mail.zoho.eu → https://calendar.zoho.eu */
export const calendarApiFor = (mailApi: string) => mailApi.replace("://mail.", "://calendar.");

const MAX_RANGE_DAYS = 31;

export class ZohoCalendar implements CalendarClient {
  constructor(
    private o: { api: string; email: string; token: (force?: boolean) => Promise<string>; fetch: typeof fetch },
  ) {}

  private async request(method: string, path: string, opts: { query?: Record<string, string>; headers?: Record<string, string> } = {}, retried = false): Promise<Raw> {
    const url = new URL(`${this.o.api}/api/v1${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const token = await this.o.token(retried);
    const res = await this.o.fetch(url, {
      method,
      headers: { authorization: `Zoho-oauthtoken ${token}`, accept: "application/json", ...(opts.headers ?? {}) },
      signal: AbortSignal.timeout(25_000),
    });
    const text = await res.text();
    let data: Raw = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* not JSON */
    }
    const errText = JSON.stringify(data.error ?? data.message ?? "");
    if ((res.status === 401 || /INVALID_OAUTHTOKEN|OAUTH_SCOPE|scope/i.test(errText)) && !retried) return this.request(method, path, opts, true);
    if (res.status === 401 || res.status === 403 || /OAUTH_SCOPE|scope/i.test(errText)) {
      throw new MailError(tr("Calendar access has not been granted in Zoho. Please reconnect your mailbox once – this also grants calendar access.", "Für den Kalender fehlt die Freigabe in Zoho. Bitte verbinde dein Postfach einmal neu – dabei wird der Kalender mit freigegeben."), "reconnect", 409);
    }
    if (res.status === 404) throw new MailError(tr("This event was not found – it may already have been deleted.", "Dieser Termin wurde nicht gefunden – evtl. schon gelöscht."), "not_found", 404);
    if (!res.ok || data.error) {
      const desc = Array.isArray(data.error) ? data.error.map((x: Raw) => x.description ?? x.message ?? x.code).join(", ") : String(data.error?.description ?? data.message ?? res.statusText ?? "");
      throw new MailError(tr(`Zoho Calendar reported an error${desc ? `: ${desc}` : ""}.`, `Zoho Kalender meldet einen Fehler${desc ? `: ${desc}` : ""}.`), "upstream", 502);
    }
    return data;
  }

  async calendars(): Promise<CalendarInfo[]> {
    const data = await this.request("GET", "/calendars", { query: { category: "all" } });
    const list = Array.isArray(data.calendars) ? (data.calendars as Raw[]) : [];
    return list.map((c) => ({
      id: String(c.uid),
      name: String(c.name ?? tr("Calendar", "Kalender")),
      color: /^#[0-9a-f]{6}$/i.test(String(c.color ?? "")) ? String(c.color) : "#2C64A8",
      isDefault: !!c.isdefault,
      canWrite: ["owner", "write", "edit", "delegate"].includes(String(c.privilege ?? "owner").toLowerCase()),
    }));
  }

  async events(calendarId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    const out: CalendarEvent[] = [];
    for (let s = from.getTime(); s < to.getTime(); s += MAX_RANGE_DAYS * 86_400_000) {
      const e = Math.min(to.getTime(), s + MAX_RANGE_DAYS * 86_400_000 - 1000);
      const data = await this.request("GET", `/calendars/${encodeURIComponent(calendarId)}/events`, {
        query: { range: JSON.stringify({ start: toZohoUtc(new Date(s)), end: toZohoUtc(new Date(e)) }), byinstance: "true" },
      });
      for (const ev of Array.isArray(data.events) ? (data.events as Raw[]) : []) out.push(mapZohoEvent(ev, calendarId, this.o.email));
    }
    const seen = new Set<string>();
    return out.filter((e) => {
      const k = `${e.id}|${e.recurrenceId ?? ""}|${e.start}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async create(n: NewEvent): Promise<CalendarEvent> {
    const eventdata: Raw = {
      title: n.title,
      isallday: n.allDay,
      dateandtime: n.allDay
        ? { start: toZohoDate(n.startDate!), end: toZohoDate(n.endDate ?? n.startDate!), timezone: n.timezone ?? "Europe/Berlin" }
        : { start: toZohoUtc(new Date(n.start!)), end: toZohoUtc(new Date(n.end!)), timezone: n.timezone ?? "Europe/Berlin" },
    };
    if (n.location) eventdata.location = n.location;
    if (n.description) eventdata.description = n.description;
    if (n.attendees?.length) {
      eventdata.attendees = n.attendees.map((email) => ({ email, permission: 1, attendance: 1 }));
      eventdata.notify_attendee = n.notify ? 1 : 0;
    }
    const data = await this.request("POST", `/calendars/${encodeURIComponent(n.calendarId)}/events`, { query: { eventdata: JSON.stringify(eventdata) } });
    const ev = Array.isArray(data.events) ? (data.events[0] as Raw) : undefined;
    if (!ev) throw new MailError(tr("Zoho did not confirm the event.", "Zoho hat den Termin nicht bestätigt."), "upstream", 502);
    return mapZohoEvent(ev, n.calendarId, this.o.email);
  }

  async remove(calendarId: string, eventId: string, etag: string, recurrenceId?: string | null) {
    const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    if (recurrenceId) {
      await this.request("DELETE", path, { query: { eventdata: JSON.stringify({ uid: eventId, recurrenceid: recurrenceId, etag: Number(etag) || etag, recurrence_edittype: "only", notify_attendee: 0 }) } });
    } else {
      await this.request("DELETE", path, { headers: { etag } });
    }
  }
}

/* ---------- Demo ---------- */

export class MockCalendar implements CalendarClient {
  private items: CalendarEvent[];
  private seq = 1;
  constructor(private email: string) {
    const day = (offset: number, h: number, m = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      d.setHours(h, m, 0, 0);
      return d.getTime();
    };
    const iso = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const mk = (title: string, start: number, mins: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
      id: `demo-${this.seq++}`,
      calendarId: extra.calendarId ?? "demo-main",
      title,
      start,
      end: start + mins * 60_000,
      allDay: false,
      location: "",
      description: "",
      organizer: email,
      attendees: [],
      etag: "1",
      recurrenceId: null,
      isOrganizer: true,
      ...extra,
    });
    this.items = [
      mk("Management weekly", day(0, 9), 45, { location: "Teams" }),
      mk("Call Isarvest Capital – partner meeting prep", day(0, 14), 30, { attendees: [{ email: "t.brandt@isarvest-capital.example", status: "ACCEPTED" }] }),
      mk("Investment committee Rhein Pensionskasse", day(1, 10, 30), 90, { location: "Cologne" }),
      mk("Deep work: EIC application", day(2, 8), 180, { calendarId: "demo-focus" }),
      mk("Prepare investor update", day(3, 16), 60),
      mk("Padel", day(4, 19), 90, { calendarId: "demo-private" }),
      { ...mk("Plug and Play Summit", 0, 0), allDay: true, startDate: iso(6), endDate: iso(8), start: Date.parse(iso(6) + "T00:00:00Z"), end: Date.parse(iso(9) + "T00:00:00Z"), location: "Sunnyvale" },
      mk("Due diligence meeting, pension scheme", day(9, 11), 120),
    ];
  }
  async calendars(): Promise<CalendarInfo[]> {
    return [
      { id: "demo-main", name: "My calendar", color: "#2C64A8", isDefault: true, canWrite: true },
      { id: "demo-focus", name: "Focus time", color: "#C9821F", isDefault: false, canWrite: true },
      { id: "demo-private", name: "Personal", color: "#1D7F55", isDefault: false, canWrite: true },
    ];
  }
  async events(calendarId: string, from: Date, to: Date) {
    return this.items.filter((e) => e.calendarId === calendarId && e.end > from.getTime() && e.start < to.getTime());
  }
  async create(n: NewEvent) {
    const allDay = n.allDay;
    const ev: CalendarEvent = {
      id: `demo-${this.seq++}`,
      calendarId: n.calendarId,
      title: n.title,
      allDay,
      startDate: allDay ? n.startDate : undefined,
      endDate: allDay ? (n.endDate ?? n.startDate) : undefined,
      start: allDay ? Date.parse(n.startDate + "T00:00:00Z") : Date.parse(n.start!),
      end: allDay ? Date.parse(addDays(n.endDate ?? n.startDate!, 1) + "T00:00:00Z") : Date.parse(n.end!),
      location: n.location ?? "",
      description: n.description ?? "",
      organizer: this.email,
      attendees: (n.attendees ?? []).map((email) => ({ email, status: "NEEDS-ACTION" })),
      etag: "1",
      recurrenceId: null,
      isOrganizer: true,
    };
    this.items.push(ev);
    return ev;
  }
  async remove(calendarId: string, eventId: string) {
    const before = this.items.length;
    this.items = this.items.filter((e) => !(e.calendarId === calendarId && e.id === eventId));
    if (this.items.length === before) throw new MailError(tr("This event was not found – it may already have been deleted.", "Dieser Termin wurde nicht gefunden – evtl. schon gelöscht."), "not_found", 404);
  }
}
