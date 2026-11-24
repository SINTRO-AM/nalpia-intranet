import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { audit } from "../lib/audit.js";
import { body, HttpError, query, zMsg, zText } from "../lib/http.js";
import type { CalendarEvent, CalendarInfo } from "./calendar.js";
import { tr } from "../lib/i18n.js";

export const calendarRoutes = new Hono<AppEnv>();

const calCache = new Map<string, { at: number; list: CalendarInfo[] }>();
const evCache = new Map<string, { at: number; list: CalendarEvent[] }>();
const forget = (userId: string) => {
  for (const k of evCache.keys()) if (k.startsWith(userId + "|")) evCache.delete(k);
};

const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, zMsg("Date in the format YYYY-MM-DD", "Datum im Format JJJJ-MM-TT"));
const zCalId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_=+/@.-]+$/, zMsg("Invalid calendar ID", "Ungültige Kalender-ID"));
const zEventId = z.string().min(1).max(300).regex(/^[A-Za-z0-9_=+/@.:-]+$/, zMsg("Invalid event ID", "Ungültige Termin-ID"));

calendarRoutes.get("/calendars", async (c) => {
  const { mail } = c.get("deps");
  const user = c.get("user");
  const hit = calCache.get(user.id);
  if (hit && Date.now() - hit.at < 5 * 60_000 && c.req.query("fresh") !== "1") return c.json(hit.list);
  const list = await mail.calendar(user).calendars();
  calCache.set(user.id, { at: Date.now(), list });
  return c.json(list);
});

calendarRoutes.get("/events", async (c) => {
  const { mail } = c.get("deps");
  const user = c.get("user");
  const q = query(c, z.object({ from: z.string().datetime(), to: z.string().datetime(), fresh: z.enum(["1"]).optional() }));
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (!(to > from) || to.getTime() - from.getTime() > 100 * 86_400_000) throw new HttpError(400, tr("The period may span at most 100 days.", "Der Zeitraum darf höchstens 100 Tage umfassen."), "invalid_range");
  const key = `${user.id}|${q.from}|${q.to}`;
  const hit = evCache.get(key);
  if (hit && !q.fresh && Date.now() - hit.at < 60_000) return c.json(hit.list);
  const cal = mail.calendar(user);
  let cals = calCache.get(user.id)?.list;
  if (!cals) {
    cals = await cal.calendars();
    calCache.set(user.id, { at: Date.now(), list: cals });
  }
  const lists = await Promise.all(cals.map((k) => cal.events(k.id, from, to)));
  const list = lists.flat().sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
  if (evCache.size > 500) evCache.clear();
  evCache.set(key, { at: Date.now(), list });
  return c.json(list);
});

calendarRoutes.post("/events", async (c) => {
  const { mail, db } = c.get("deps");
  const user = c.get("user");
  const p = await body(
    c,
    z
      .object({
        calendarId: zCalId,
        title: zText(200).min(1, zMsg("Please enter a title.", "Bitte gib einen Titel ein.")),
        allDay: z.boolean().default(false),
        start: z.string().datetime().optional(),
        end: z.string().datetime().optional(),
        startDate: zIsoDate.optional(),
        endDate: zIsoDate.optional(),
        location: zText(255).optional(),
        description: zText(5000).optional(),
        attendees: z.array(z.string().trim().toLowerCase().email(zMsg("Invalid email address", "Ungültige E-Mail-Adresse"))).max(30).optional(),
        notify: z.boolean().optional(),
        timezone: z.string().max(60).regex(/^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/).optional(),
      })
      .superRefine((v, ctx) => {
        if (v.allDay) {
          if (!v.startDate) ctx.addIssue({ code: "custom", path: ["startDate"], message: tr("Please choose a date.", "Bitte ein Datum wählen.") });
          else if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: tr("The end is before the start.", "Das Ende liegt vor dem Beginn.") });
        } else if (!v.start || !v.end) ctx.addIssue({ code: "custom", path: ["start"], message: tr("Please enter a start and an end.", "Bitte Beginn und Ende angeben.") });
        else if (Date.parse(v.end) <= Date.parse(v.start)) ctx.addIssue({ code: "custom", path: ["end"], message: tr("The end must be after the start.", "Das Ende muss nach dem Beginn liegen.") });
      }),
  );
  const cal = mail.calendar(user);
  const ev = await cal.create(p);
  forget(user.id);
  audit(db, { userId: user.id, action: "calendar.event_created", target: ev.id, ip: c.get("ip"), meta: { attendees: p.attendees?.length ?? 0, notify: !!p.notify } });
  return c.json(ev, 201);
});

calendarRoutes.delete("/events/:calendarId/:eventId", async (c) => {
  const { mail, db } = c.get("deps");
  const user = c.get("user");
  const calendarId = zCalId.parse(decodeURIComponent(c.req.param("calendarId")));
  const eventId = zEventId.parse(decodeURIComponent(c.req.param("eventId")));
  const q = query(c, z.object({ etag: z.string().max(40).default(""), recurrenceId: z.string().max(40).optional() }));
  await mail.calendar(user).remove(calendarId, eventId, q.etag, q.recurrenceId || null);
  forget(user.id);
  audit(db, { userId: user.id, action: "calendar.event_deleted", target: eventId, ip: c.get("ip") });
  return c.json({ ok: true });
});
