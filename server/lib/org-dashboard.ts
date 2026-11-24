/**
 * Overview (dashboard) for investors or partners: KPIs, workflow columns, funnel,
 * weekly activity, distribution by type, recent activity and open tasks.
 *
 * Workflow columns (each organization lands in at most one, priority top to bottom):
 *  antwort   – last incoming email is newer than the last outgoing one: your turn
 *  gespraech – status first meeting or later (but not yet won)
 *  faellig   – next step overdue; without an open request also everything in the next 7 days
 *  wartet    – contacted, no reply yet (follow-up date is on the card)
 *  gewonnen  – committed / invested
 * Paused and declined organizations appear in no column.
 * Activity bodies start with the stored markers "Gesendet:" / "Erhalten:" (sent / received) – they are data, not UI text.
 */
import type { DB } from "../db/index.js";
import { ORG_STAGES, type OrgKind } from "../routes/orgs.js";
import { mapTask, taskSelect, type TaskRow } from "../routes/tasks.js";
import { addDaysISO, todayISO } from "./util.js";

const DAY = 86_400_000;
const LANE_LIMIT = 200;
const PRIO_RANK: Record<string, number> = { hoch: 0, mittel: 1, niedrig: 2 };

interface Row {
  id: string;
  name: string;
  type: string;
  stage: string;
  priority: string;
  owner_id: string | null;
  city: string;
  next_step: string;
  next_date: string | null;
  updated_at: number;
  primary_contact: string | null;
}
interface Act {
  org_id: string;
  kind: string;
  body: string;
  created_at: number;
  contact_name: string | null;
  user_id: string | null;
}

export type Direction = "in" | "out" | null;
/** Out-of-office notes and calendar notifications do not count as a reply */
const AUTO_REPLY =
  /^Erhalten:\s*(Automatische Antwort|Abwesenheit|Out of Office|Auto-?Reply|Automatic reply|Angenommen|Accepted|Abgelehnt|Declined|Einladung|Aktualisierte Einladung|Invitation|Updated invitation|Neue Veranstaltung)\b/i;

export const mailDirection = (kind: string, body: string): Direction =>
  kind !== "mail" ? null : /^Erhalten:/i.test(body) ? (AUTO_REPLY.test(body) ? null : "in") : /^Gesendet:/i.test(body) ? "out" : null;

const firstLine = (s: string) =>
  s
    .replace(/^(Gesendet|Erhalten|Status):\s*/i, "")
    .split("\n")
    .find((l) => l.trim())
    ?.trim()
    .slice(0, 140) ?? "";

const berlinDate = (ts: number) => todayISO("Europe/Berlin", new Date(ts));
const weekStart = (iso: string) => {
  const d = new Date(iso + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDaysISO(iso, -dow);
};

export function orgDashboard(db: DB, kind: OrgKind, now = Date.now()) {
  const today = todayISO("Europe/Berlin", new Date(now));
  const weekEnd = addDaysISO(today, 7);
  const stages = ORG_STAGES[kind];
  const stageIdx = new Map(stages.map((s, i) => [s.id, i]));
  const closed = new Set(stages.filter((s) => s.closed).map((s) => s.id));
  const won = new Set(stages.filter((s) => s.won).map((s) => s.id));

  const orgs = db
    .prepare(
      `SELECT o.id, o.name, o.type, o.stage, o.priority, o.owner_id, o.city, o.next_step, o.next_date, o.updated_at,
         (SELECT ct.name FROM contacts ct WHERE ct.organization_id = o.id ORDER BY ct.created_at LIMIT 1) AS primary_contact
       FROM organizations o WHERE o.kind = ?`,
    )
    .all(kind) as Row[];

  const acts = db
    .prepare(
      `SELECT ct.organization_id AS org_id, ca.kind, substr(ca.body, 1, 400) AS body, ca.created_at, ct.name AS contact_name, ca.user_id
         FROM contact_activities ca JOIN contacts ct ON ct.id = ca.contact_id JOIN organizations o ON o.id = ct.organization_id
        WHERE o.kind = ?
       UNION ALL
       SELECT a.org_id, a.kind, substr(a.body, 1, 400), a.created_at, NULL, a.user_id
         FROM org_activities a JOIN organizations o ON o.id = a.org_id WHERE o.kind = ?`,
    )
    .all(kind, kind) as Act[];

  /* ---------- per organization: latest activity ---------- */
  const per = new Map<string, { lastIn: number; lastOut: number; last: Act | null; lastMail: Act | null }>();
  for (const a of acts) {
    const p = per.get(a.org_id) ?? { lastIn: 0, lastOut: 0, last: null, lastMail: null };
    const dir = mailDirection(a.kind, a.body);
    if (dir === "in") p.lastIn = Math.max(p.lastIn, a.created_at);
    if (dir === "out") p.lastOut = Math.max(p.lastOut, a.created_at);
    if (!p.last || a.created_at > p.last.created_at) p.last = a;
    if (a.kind === "mail" && (!p.lastMail || a.created_at > p.lastMail.created_at)) p.lastMail = a;
    per.set(a.org_id, p);
  }

  const card = (o: Row) => {
    const p = per.get(o.id);
    const show = p?.lastMail && p.lastMail.created_at >= (p.last?.created_at ?? 0) - DAY ? p.lastMail : p?.last;
    return {
      id: o.id,
      name: o.name,
      type: o.type,
      stage: o.stage,
      priority: o.priority,
      ownerId: o.owner_id,
      city: o.city,
      contact: o.primary_contact,
      nextStep: o.next_step,
      nextDate: o.next_date,
      lastIn: p?.lastIn || null,
      lastOut: p?.lastOut || null,
      last: show
        ? { kind: show.kind, dir: mailDirection(show.kind, show.body), text: firstLine(show.body), at: show.created_at, contactName: show.contact_name }
        : null,
    };
  };

  /* ---------- Workflow columns ---------- */
  type Card = ReturnType<typeof card>;
  const lanes: Record<"antwort" | "faellig" | "gespraech" | "wartet" | "gewonnen", Card[]> = {
    antwort: [],
    faellig: [],
    gespraech: [],
    wartet: [],
    gewonnen: [],
  };
  const conversationFrom = stageIdx.get("gespraech") ?? 2;
  for (const o of orgs) {
    if (closed.has(o.stage)) continue;
    const c = card(o);
    if (won.has(o.stage)) {
      lanes.gewonnen.push(c);
      continue;
    }
    const p = per.get(o.id);
    const waiting = !!p && p.lastOut > 0 && p.lastOut >= p.lastIn;
    if (p && p.lastIn && p.lastIn > p.lastOut) lanes.antwort.push(c);
    else if ((stageIdx.get(o.stage) ?? 0) >= conversationFrom) lanes.gespraech.push(c);
    else if (o.next_date && o.next_date < today) lanes.faellig.push(c);
    else if (waiting || o.stage !== "identifiziert") lanes.wartet.push(c);
    else if (o.next_date && o.next_date <= weekEnd) lanes.faellig.push(c);
  }
  const prio = (c: Card) => PRIO_RANK[c.priority] ?? 1;
  lanes.antwort.sort((a, b) => (b.lastIn ?? 0) - (a.lastIn ?? 0));
  lanes.faellig.sort((a, b) => (a.nextDate ?? "").localeCompare(b.nextDate ?? "") || prio(a) - prio(b));
  lanes.gewonnen.sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  lanes.gespraech.sort((a, b) => (stageIdx.get(b.stage) ?? 0) - (stageIdx.get(a.stage) ?? 0) || (b.last?.at ?? 0) - (a.last?.at ?? 0));
  lanes.wartet.sort((a, b) => prio(a) - prio(b) || (a.lastOut ?? Infinity) - (b.lastOut ?? Infinity));
  const laneOut = Object.fromEntries(Object.entries(lanes).map(([k, l]) => [k, { total: l.length, items: l.slice(0, LANE_LIMIT) }])) as Record<
    keyof typeof lanes,
    { total: number; items: Card[] }
  >;

  /* ---------- KPIs ---------- */
  const mails = acts.filter((a) => a.kind === "mail").map((a) => ({ at: a.created_at, dir: mailDirection(a.kind, a.body) }));
  const inRange = (from: number, to: number, dir: Direction) => mails.filter((m) => m.dir === dir && m.at >= from && m.at < to).length;
  const contacted = orgs.filter((o) => (per.get(o.id)?.lastOut ?? 0) > 0 || o.stage !== "identifiziert").length;
  const replied = orgs.filter((o) => (per.get(o.id)?.lastIn ?? 0) > 0).length;
  const kpis = {
    total: orgs.length,
    backlog: orgs.filter((o) => o.stage === "identifiziert" && !per.get(o.id)).length,
    active: orgs.filter((o) => !closed.has(o.stage) && !won.has(o.stage) && o.stage !== "identifiziert").length,
    won: orgs.filter((o) => won.has(o.stage)).length,
    closed: orgs.filter((o) => closed.has(o.stage)).length,
    contacted,
    replied,
    responseRate: contacted ? replied / contacted : null,
    sent7: inRange(now - 7 * DAY, now + DAY, "out"),
    sentPrev7: inRange(now - 14 * DAY, now - 7 * DAY, "out"),
    received7: inRange(now - 7 * DAY, now + DAY, "in"),
    receivedPrev7: inRange(now - 14 * DAY, now - 7 * DAY, "in"),
  };

  /* ---------- Funnel (current state) ---------- */
  const open = stages.filter((s) => !s.closed);
  const funnel = open.map((s, i) => {
    const reached = orgs.filter((o) => {
      if (closed.has(o.stage)) return i <= 1; // declined/paused: at least contacted
      return (stageIdx.get(o.stage) ?? 0) >= (stageIdx.get(s.id) ?? 0);
    }).length;
    return { stage: s.id, label: s.label, current: orgs.filter((o) => o.stage === s.id).length, reached };
  });

  /* ---------- Activity per week (last 10 weeks) ---------- */
  const thisWeek = weekStart(today);
  const weeks = Array.from({ length: 10 }, (_, i) => addDaysISO(thisWeek, -7 * (9 - i)));
  const weekly = weeks.map((w) => ({ week: w, sent: 0, received: 0, other: 0 }));
  const wIdx = new Map(weeks.map((w, i) => [w, i]));
  for (const a of acts) {
    const i = wIdx.get(weekStart(berlinDate(a.created_at)));
    if (i === undefined) continue;
    const dir = mailDirection(a.kind, a.body);
    if (dir === "out") weekly[i]!.sent++;
    else if (dir === "in") weekly[i]!.received++;
    else if (a.kind !== "status") weekly[i]!.other++;
  }

  /* ---------- Distribution by type ---------- */
  const byTypeMap = new Map<string, { type: string; total: number; active: number; won: number }>();
  for (const o of orgs) {
    const t = byTypeMap.get(o.type) ?? { type: o.type, total: 0, active: 0, won: 0 };
    t.total++;
    if (won.has(o.stage)) t.won++;
    else if (!closed.has(o.stage) && o.stage !== "identifiziert") t.active++;
    byTypeMap.set(o.type, t);
  }
  const byType = [...byTypeMap.values()].sort((a, b) => b.total - a.total);

  /* ---------- Recent activity ---------- */
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  const recent = [...acts]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 14)
    .map((a) => ({
      orgId: a.org_id,
      orgName: names.get(a.org_id) ?? "",
      kind: a.kind,
      dir: mailDirection(a.kind, a.body),
      text: firstLine(a.body),
      at: a.created_at,
      contactName: a.contact_name,
      userId: a.user_id,
    }));

  /* ---------- Open tasks ---------- */
  const tasks = (
    db
      .prepare(
        `${taskSelect} WHERE t.status != 'erledigt' AND (
           t.organization_id IN (SELECT id FROM organizations WHERE kind = ?)
           OR t.contact_id IN (SELECT ct.id FROM contacts ct JOIN organizations o ON o.id = ct.organization_id WHERE o.kind = ?))
         ORDER BY t.due_date IS NULL, t.due_date LIMIT 8`,
      )
      .all(kind, kind) as TaskRow[]
  ).map(mapTask);

  return { today, kpis, lanes: laneOut, funnel, weekly, byType, recent, tasks };
}
