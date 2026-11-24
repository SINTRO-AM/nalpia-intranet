/**
 * Data for the AI assistant: page context (what is the person looking at?) and the tools the
 * assistant uses to look things up in the intranet and – only on explicit request – create tasks,
 * notes and next steps. Everything runs with the signed-in person's permissions;
 * e-mails are never sent.
 */
import type { UserRow } from "../context.js";
import type { DB } from "../db/index.js";
import { audit, notify } from "../lib/audit.js";
import { localeTag, tr } from "../lib/i18n.js";
import { orgDashboard } from "../lib/org-dashboard.js";
import { addDaysISO, newId, todayISO } from "../lib/util.js";
import { CATEGORY_LABELS, stageLabel as contactStageLabel } from "../routes/contacts.js";
import { ORG_STAGES, ORG_TYPES, orgPath, type OrgKind } from "../routes/orgs.js";

/* ---------- Pages ---------- */

export type Page =
  | { kind: "start" }
  | { kind: "news" }
  | { kind: "newsItem"; id: string }
  | { kind: "tasks" }
  | { kind: "milestone"; id: string }
  | { kind: "mail" }
  | { kind: "contacts" }
  | { kind: "contact"; id: string }
  | { kind: "orgs"; orgKind: OrgKind }
  | { kind: "org"; orgKind: OrgKind; id: string }
  | { kind: "team" }
  | { kind: "person"; id: string }
  | { kind: "settings" }
  | { kind: "admin" }
  | { kind: "agent" }
  | { kind: "other" };

const ID = "([A-Za-z0-9-]{8,64})";

export function parsePage(path: string): Page {
  const p = (path || "/").split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  let m: RegExpExecArray | null;
  if (p === "/") return { kind: "start" };
  if (p === "/news") return { kind: "news" };
  if ((m = new RegExp(`^/news/${ID}$`).exec(p))) return { kind: "newsItem", id: m[1]! };
  if (p === "/aufgaben") return { kind: "tasks" };
  if ((m = new RegExp(`^/aufgaben/meilensteine/${ID}$`).exec(p))) return { kind: "milestone", id: m[1]! };
  if (p === "/postfach") return { kind: "mail" };
  if (p === "/kontakte") return { kind: "contacts" };
  if ((m = new RegExp(`^/kontakte/${ID}$`).exec(p))) return { kind: "contact", id: m[1]! };
  if (p === "/partner") return { kind: "orgs", orgKind: "partner" };
  if (p === "/investoren") return { kind: "orgs", orgKind: "investor" };
  if (p === "/agent") return { kind: "agent" };
  if ((m = new RegExp(`^/(partner|investoren)/${ID}$`).exec(p))) return { kind: "org", orgKind: m[1] === "partner" ? "partner" : "investor", id: m[2]! };
  if (p === "/team") return { kind: "team" };
  if ((m = new RegExp(`^/team/${ID}$`).exec(p))) return { kind: "person", id: m[1]! };
  if (p === "/einstellungen") return { kind: "settings" };
  if (p === "/admin") return { kind: "admin" };
  return { kind: "other" };
}

/** Key for the briefing cache */
export const pageKey = (p: Page) => [p.kind, "orgKind" in p ? p.orgKind : "", "id" in p ? p.id : ""].filter(Boolean).join(":");

/* ---------- Helpers ---------- */

const DAY = 86_400_000;
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso + "T12:00:00Z").toLocaleDateString(localeTag(), { day: "numeric", month: "short", year: "numeric" }) : "");
const fmtTs = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleDateString(localeTag(), { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" }) : "";
/** Quotation marks per language */
const q = (s: string) => tr(`"${s}"`, `„${s}“`);
/** Money in millions: "€1.5m" / "1,5 Mio. €" */
const mio = (v: number | string) => tr(`€${v}m`, `${String(v).replace(".", ",")} Mio. €`);
const mioRange = (a: unknown, b: unknown) => {
  const f = (v: unknown) => (v === null || v === undefined ? "?" : tr(String(v), String(v).replace(".", ",")));
  return tr(`€${f(a)}–${f(b)}m`, `${f(a)}–${f(b)} Mio. €`);
};
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + " …" : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
export const firstName = (u: { name: string }) => u.name.trim().split(/\s+/)[0] || u.name;
const parseTags = (s: string) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
};
const prioLabel = (p: string) =>
  (({ hoch: tr("high", "hoch"), mittel: tr("medium", "mittel"), niedrig: tr("low", "niedrig") }) as Record<string, string>)[p] ?? p;
const statusLabel = (s: string) =>
  (({ offen: tr("open", "offen"), in_arbeit: tr("in progress", "in Arbeit"), erledigt: tr("done", "erledigt") }) as Record<string, string>)[s] ?? s;
const msStatusLabel = (s: string) =>
  (({ geplant: tr("planned", "geplant"), aktiv: tr("active", "aktiv"), erreicht: tr("reached", "erreicht"), verschoben: tr("postponed", "verschoben") }) as Record<string, string>)[s] ?? s;
const catLabel = (c: string) =>
  ((
    {
      allgemein: tr("general", "Allgemein"),
      fundraising: "Fundraising",
      produkt: tr("product", "Produkt"),
      vertrieb: tr("sales", "Vertrieb"),
      regulatorik: tr("regulatory", "Regulatorik"),
      team: "Team",
    }
  ) as Record<string, string>)[c] ?? c;
const actLabel = (k: string) =>
  ((
    {
      notiz: tr("note", "Notiz"),
      anruf: tr("call", "Anruf"),
      meeting: "Meeting",
      mail: tr("e-mail", "Mail"),
      status: tr("status change", "Statuswechsel"),
    }
  ) as Record<string, string>)[k] ?? k;
const userStatusLabel = (s: string) =>
  (({ active: tr("active", "aktiv"), invited: tr("invited", "eingeladen"), disabled: tr("disabled", "deaktiviert") }) as Record<string, string>)[s] ?? s;
const stageLabel = (kind: OrgKind, id: string) => ORG_STAGES[kind].find((s) => s.id === id)?.label ?? id;
const orgTypeLabel = (kind: OrgKind, type: string) => ORG_TYPES[kind]?.[type] ?? type;
const contactCatLabel = (c: string) => CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] ?? c;
const kindLabel = (k: OrgKind) => (k === "investor" ? tr("Investors", "Investoren") : tr("Partners", "Partner"));
const kindOne = (k: OrgKind | null | undefined) => (k === "investor" ? "Investor" : "Partner");
const nobody = () => tr("nobody", "niemand");
const nextStepWord = () => tr("next step", "nächster Schritt");

interface TaskRow {
  id: string;
  title: string;
  description: string;
  due_date: string | null;
  priority: string;
  status: string;
  assignee_id: string | null;
  assignee: string | null;
  org_name: string | null;
  org_kind: OrgKind | null;
  organization_id: string | null;
  contact_name: string | null;
  milestone: string | null;
}

const TASK_SELECT = `SELECT t.id, t.title, t.description, t.due_date, t.priority, t.status, t.assignee_id, t.organization_id,
  u.name AS assignee, o.name AS org_name, o.kind AS org_kind, c.name AS contact_name, m.title AS milestone
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assignee_id
  LEFT JOIN organizations o ON o.id = t.organization_id
  LEFT JOIN contacts c ON c.id = t.contact_id
  LEFT JOIN milestones m ON m.id = t.milestone_id`;

function taskLine(t: TaskRow, today: string, withAssignee = false) {
  const due = t.due_date
    ? t.due_date < today
      ? tr(`overdue since ${fmtDate(t.due_date)}`, `überfällig seit ${fmtDate(t.due_date)}`)
      : t.due_date === today
        ? tr("due today", "heute fällig")
        : tr(`due ${fmtDate(t.due_date)}`, `fällig ${fmtDate(t.due_date)}`)
    : tr("no due date", "ohne Termin");
  const ctx = [t.org_name && `${t.org_name}`, t.contact_name && !t.org_name && t.contact_name, t.milestone && `${tr("Milestone", "Meilenstein")}: ${t.milestone}`].filter(Boolean).join(", ");
  return `- [${t.title}](/aufgaben?task=${t.id}) – ${due}, ${tr("priority", "Priorität")} ${prioLabel(t.priority)}${t.status === "in_arbeit" ? tr(", in progress", ", in Arbeit") : ""}${withAssignee ? `, ${tr("owner", "zuständig")}: ${t.assignee ?? nobody()}` : ""}${ctx ? ` (${ctx})` : ""} {id: ${t.id}}`;
}

function myOpenTasks(db: DB, userId: string, limit = 25) {
  return db
    .prepare(`${TASK_SELECT} WHERE t.assignee_id = ? AND t.status != 'erledigt' ORDER BY t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'hoch' THEN 0 WHEN 'mittel' THEN 1 ELSE 2 END LIMIT ?`)
    .all(userId, limit) as TaskRow[];
}

function taskStats(db: DB, userId: string, today: string) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS open,
        SUM(CASE WHEN due_date < @today THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN due_date = @today THEN 1 ELSE 0 END) AS dueToday,
        SUM(CASE WHEN due_date > @today AND due_date <= @week THEN 1 ELSE 0 END) AS week
       FROM tasks WHERE assignee_id = @me AND status != 'erledigt'`,
    )
    .get({ me: userId, today, week: addDaysISO(today, 7) }) as { open: number; overdue: number | null; dueToday: number | null; week: number | null };
  return { open: r.open, overdue: r.overdue ?? 0, dueToday: r.dueToday ?? 0, week: r.week ?? 0 };
}

function unreadNews(db: DB, userId: string, limit = 6) {
  return db
    .prepare(
      `SELECT n.id, n.title, n.body, n.category, n.created_at FROM news n
       WHERE NOT EXISTS (SELECT 1 FROM news_reads r WHERE r.news_id = n.id AND r.user_id = ?)
       ORDER BY n.pinned DESC, n.created_at DESC LIMIT ?`,
    )
    .all(userId, limit) as { id: string; title: string; body: string; category: string; created_at: number }[];
}

function followUps(db: DB, userId: string, today: string, limit = 12) {
  const until = addDaysISO(today, 2);
  const orgs = db
    .prepare(
      `SELECT id, kind, name, stage, next_step, next_date FROM organizations
       WHERE owner_id = ? AND next_date IS NOT NULL AND next_date <= ? AND stage NOT IN ('abgesagt','pausiert','investiert','zugesagt')
       ORDER BY next_date LIMIT ?`,
    )
    .all(userId, until, limit) as { id: string; kind: OrgKind; name: string; stage: string; next_step: string; next_date: string }[];
  const contacts = db
    .prepare(
      `SELECT id, name, company, next_step, next_date FROM contacts
       WHERE owner_id = ? AND next_date IS NOT NULL AND next_date <= ? AND organization_id IS NULL ORDER BY next_date LIMIT ?`,
    )
    .all(userId, until, limit) as { id: string; name: string; company: string; next_step: string; next_date: string }[];
  return { orgs, contacts };
}

/* ---------- Page context ---------- */

export interface Suggestion {
  label: string;
  prompt: string;
}

export interface PageContext {
  label: string;
  /** Short facts for display (without AI) */
  facts: string[];
  /** Suggestions for the page */
  suggestions: Suggestion[];
  /** Detailed context for the model */
  detail: string;
}

export function pageContext(db: DB, user: UserRow, page: Page, now = Date.now()): PageContext {
  const today = todayISO("Europe/Berlin", new Date(now));
  const stats = taskStats(db, user.id, today);
  const news = unreadNews(db, user.id);
  const facts: string[] = [];
  const parts: string[] = [];
  let label = "Intranet";
  let suggestions: Suggestion[] = [];
  const S = (en: string, de: string, pen: string, pde: string): Suggestion => ({ label: tr(en, de), prompt: tr(pen, pde) });

  const taskFacts = () => {
    if (stats.overdue) facts.push(tr(`${stats.overdue} overdue ${stats.overdue === 1 ? "task" : "tasks"}`, `${stats.overdue} überfällige ${stats.overdue === 1 ? "Aufgabe" : "Aufgaben"}`));
    if (stats.dueToday) facts.push(tr(`${stats.dueToday} due today`, `${stats.dueToday} heute fällig`));
  };
  const tasksBlock = (limit: number) => {
    const list = myOpenTasks(db, user.id, limit);
    parts.push(
      tr(
        `## Open tasks of ${firstName(user)} (${stats.open} total, ${stats.overdue} overdue, ${stats.dueToday} today, ${stats.week} in the next 7 days)\n`,
        `## Offene Aufgaben von ${firstName(user)} (${stats.open} insgesamt, ${stats.overdue} überfällig, ${stats.dueToday} heute, ${stats.week} in den nächsten 7 Tagen)\n`,
      ) + (list.length ? list.map((t) => taskLine(t, today)).join("\n") : tr("No open tasks.", "Keine offenen Aufgaben.")),
    );
  };
  const newsBlock = (withBody: boolean) => {
    if (!news.length) return;
    parts.push(
      `## ${tr("Unread news", "Ungelesene News")} (${news.length})\n` +
        news.map((n) => `- [${n.title}](/news/${n.id}) (${catLabel(n.category)}, ${fmtTs(n.created_at)})${withBody ? `\n  ${clip(oneLine(n.body), 700)}` : ""}`).join("\n"),
    );
  };
  const followBlock = () => {
    const f = followUps(db, user.id, today);
    const lines = [
      ...f.orgs.map(
        (o) =>
          `- [${o.name}](${orgPath(o.kind, o.id)}) (${kindOne(o.kind)}, ${stageLabel(o.kind, o.stage)}): ${o.next_step || nextStepWord()} – ${o.next_date < today ? tr(`overdue since ${fmtDate(o.next_date)}`, `überfällig seit ${fmtDate(o.next_date)}`) : fmtDate(o.next_date)}`,
      ),
      ...f.contacts.map((c) => `- [${c.name}](/kontakte/${c.id})${c.company ? ` (${c.company})` : ""}: ${c.next_step || nextStepWord()} – ${fmtDate(c.next_date)}`),
    ];
    if (lines.length) {
      parts.push(`${tr(`## Follow-ups due for ${firstName(user)}`, `## Fällige Nachfass-Termine von ${firstName(user)}`)}\n${lines.join("\n")}`);
      facts.push(
        lines.length === 1 ? tr("1 follow-up due", "1 Nachfass-Termin fällig") : tr(`${lines.length} follow-ups due`, `${lines.length} Nachfass-Termine fällig`),
      );
    }
  };

  switch (page.kind) {
    case "start": {
      label = tr("Home", "Start");
      taskFacts();
      if (news.length) facts.push(tr(`${news.length} unread news`, `${news.length} ungelesene News`));
      tasksBlock(15);
      followBlock();
      newsBlock(false);
      const ms = db
        .prepare(`SELECT m.id, m.title, m.due_date, m.status, u.name AS owner FROM milestones m LEFT JOIN users u ON u.id = m.owner_id WHERE m.status IN ('geplant','aktiv') ORDER BY m.due_date IS NULL, m.due_date LIMIT 6`)
        .all() as { id: string; title: string; due_date: string | null; status: string; owner: string | null }[];
      if (ms.length)
        parts.push(
          `## ${tr("Upcoming milestones", "Anstehende Meilensteine")}\n${ms.map((m) => `- [${m.title}](/aufgaben/meilensteine/${m.id}) – ${m.due_date ? fmtDate(m.due_date) : tr("no due date", "ohne Termin")}${m.owner ? `, ${m.owner}` : ""}`).join("\n")}`,
        );
      suggestions = [
        S("My day", "Mein Tag", "Give me a short briefing for today: what is urgent, and what should I do first?", "Gib mir ein kurzes Briefing für heute: Was ist dringend, was sollte ich zuerst erledigen?"),
        S(
          "Week plan",
          "Wochenplan",
          "Plan my week: rank my open tasks and follow-ups by priority and suggest an order.",
          "Plane meine Woche: Ordne meine offenen Aufgaben und Nachfass-Termine nach Priorität und schlage eine Reihenfolge vor.",
        ),
        S("What's new?", "Was ist neu?", "Summarize the unread news for me.", "Fasse die ungelesenen News für mich zusammen."),
      ];
      break;
    }
    case "tasks": {
      label = tr("Tasks", "Aufgaben");
      taskFacts();
      if (stats.week) facts.push(tr(`${stats.week} in the next 7 days`, `${stats.week} in den nächsten 7 Tagen`));
      tasksBlock(40);
      const team = db
        .prepare(
          `SELECT u.name, COUNT(*) AS open, SUM(CASE WHEN t.due_date < ? THEN 1 ELSE 0 END) AS overdue
           FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE t.status != 'erledigt' GROUP BY u.id ORDER BY overdue DESC, open DESC LIMIT 12`,
        )
        .all(today) as { name: string; open: number; overdue: number }[];
      if (team.length)
        parts.push(
          `## ${tr("Open tasks in the team", "Offene Aufgaben im Team")}\n${team.map((t) => `- ${t.name}: ${tr(`${t.open} open, ${t.overdue} overdue`, `${t.open} offen, ${t.overdue} überfällig`)}`).join("\n")}`,
        );
      suggestions = [
        S(
          "Prioritize",
          "Priorisieren",
          "Prioritize my open tasks and tell me what to start with now – with a short reason.",
          "Priorisiere meine offenen Aufgaben und sag mir, womit ich jetzt anfangen sollte – mit kurzer Begründung.",
        ),
        S(
          "Clear overdue",
          "Überfälliges aufräumen",
          "Which of my tasks are overdue? Suggest a realistic new date for each.",
          "Welche meiner Aufgaben sind überfällig? Schlag für jede ein realistisches neues Datum vor.",
        ),
        S("Create task", "Aufgabe anlegen", "Create a task for me: ", "Lege mir eine Aufgabe an: "),
      ];
      break;
    }
    case "milestone": {
      const m = db.prepare(`SELECT m.*, u.name AS owner FROM milestones m LEFT JOIN users u ON u.id = m.owner_id WHERE m.id = ?`).get(page.id) as
        | { title: string; description: string; due_date: string | null; status: string; area: string; owner: string | null }
        | undefined;
      label = m ? `${tr("Milestone", "Meilenstein")}: ${m.title}` : tr("Milestone", "Meilenstein");
      if (m) {
        const tasks = db.prepare(`${TASK_SELECT} WHERE t.milestone_id = ? ORDER BY t.status = 'erledigt', t.due_date`).all(page.id) as TaskRow[];
        const done = tasks.filter((t) => t.status === "erledigt").length;
        facts.push(tr(`${done} of ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} done`, `${done} von ${tasks.length} ${tasks.length === 1 ? "Aufgabe" : "Aufgaben"} erledigt`));
        parts.push(
          tr(
            `## Milestone ${q(m.title)}\nStatus: ${msStatusLabel(m.status)}, due: ${m.due_date ? fmtDate(m.due_date) : "open"}, owner: ${m.owner ?? nobody()}${m.area ? `, area: ${m.area}` : ""}`,
            `## Meilenstein ${q(m.title)}\nStatus: ${msStatusLabel(m.status)}, Fällig: ${m.due_date ? fmtDate(m.due_date) : "offen"}, Verantwortlich: ${m.owner ?? nobody()}${m.area ? `, Bereich: ${m.area}` : ""}`,
          ) +
            `\n${clip(m.description, 1500)}\n\n### ${tr("Tasks", "Aufgaben")}\n${tasks.map((t) => taskLine(t, today, true) + (t.status === "erledigt" ? tr(" ✓ done", " ✓ erledigt") : "")).join("\n") || tr("None.", "Keine.")}`,
        );
      }
      suggestions = [
        S(
          "Status briefing",
          "Status-Briefing",
          "Where does this milestone stand? What is still missing, and where are the risks?",
          "Wie steht dieser Meilenstein? Was fehlt noch, und wo gibt es Risiken?",
        ),
        S(
          "Next steps",
          "Nächste Schritte",
          "Which tasks are still missing to reach this milestone? Suggest them.",
          "Welche Aufgaben fehlen noch, um diesen Meilenstein zu erreichen? Schlag sie vor.",
        ),
      ];
      break;
    }
    case "news": {
      label = "News";
      if (news.length) facts.push(tr(`${news.length} unread`, `${news.length} ungelesen`));
      newsBlock(true);
      const recent = db.prepare(`SELECT id, title, category, created_at FROM news ORDER BY created_at DESC LIMIT 12`).all() as { id: string; title: string; category: string; created_at: number }[];
      parts.push(`## ${tr("Latest posts", "Neueste Beiträge")}\n${recent.map((n) => `- [${n.title}](/news/${n.id}) (${catLabel(n.category)}, ${fmtTs(n.created_at)})`).join("\n")}`);
      suggestions = [
        S("Summarize", "Zusammenfassen", "Summarize the most important news of the last few weeks in five points.", "Fasse die wichtigsten News der letzten Wochen in fünf Punkten zusammen."),
        S(
          "What affects me?",
          "Was betrifft mich?",
          "Which news items are relevant to my role, and what follows from them for me?",
          "Welche News sind für meine Rolle relevant, und was folgt daraus für mich?",
        ),
        S("Draft a post", "Beitrag entwerfen", "Help me write a news post about: ", "Hilf mir, einen News-Beitrag zu schreiben über: "),
      ];
      break;
    }
    case "newsItem": {
      const n = db.prepare(`SELECT n.*, u.name AS author FROM news n LEFT JOIN users u ON u.id = n.author_id WHERE n.id = ?`).get(page.id) as
        | { title: string; body: string; category: string; created_at: number; author: string | null }
        | undefined;
      label = n ? `News: ${n.title}` : "News";
      if (n) {
        const comments = db
          .prepare(`SELECT c.body, u.name FROM news_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.news_id = ? ORDER BY c.created_at LIMIT 20`)
          .all(page.id) as { body: string; name: string | null }[];
        parts.push(
          tr(
            `## Open post: ${q(n.title)} (${catLabel(n.category)}, by ${n.author ?? "unknown"}, ${fmtTs(n.created_at)})`,
            `## Geöffneter Beitrag: ${q(n.title)} (${catLabel(n.category)}, von ${n.author ?? "unbekannt"}, ${fmtTs(n.created_at)})`,
          ) +
            `\n${clip(n.body, 8000)}` +
            (comments.length ? `\n\n### ${tr("Comments", "Kommentare")}\n${comments.map((c) => `- ${c.name ?? "?"}: ${clip(oneLine(c.body), 300)}`).join("\n")}` : ""),
        );
      }
      suggestions = [
        S("Summary", "Kurzfassung", "Summarize this post in three sentences.", "Fasse diesen Beitrag in drei Sätzen zusammen."),
        S(
          "What does it mean for me?",
          "Was heißt das für mich?",
          "What does this post mean for my work in concrete terms? Is there anything to do?",
          "Was bedeutet dieser Beitrag konkret für meine Arbeit? Gibt es etwas zu tun?",
        ),
        S("Write a comment", "Kommentar formulieren", "Write a short, constructive comment on this post.", "Formuliere einen kurzen, konstruktiven Kommentar zu diesem Beitrag."),
      ];
      break;
    }
    case "mail": {
      label = tr("Mail", "Postfach");
      taskFacts();
      parts.push(
        tr(
          "## Mail\nThe person is in their own mailbox. You have no access to individual e-mails; for an open e-mail, the Mail page has its own AI reply suggestions and the drafting assistant. You can help with wording if the person pastes content here, and you can name follow-ups from the CRM.",
          "## Postfach\nDie Person ist in ihrem eigenen Postfach. Du hast keinen Zugriff auf einzelne Mails; zu einer geöffneten Mail gibt es im Postfach eigene KI-Antwortvorschläge und den Entwurfs-Assistenten. Du kannst beim Formulieren helfen, wenn die Person Inhalte hier einfügt, und Nachfass-Termine aus dem CRM nennen.",
        ),
      );
      followBlock();
      suggestions = [
        S("Follow up", "Nachfassen", "Which investors or clients should I follow up with today?", "Bei welchen Investoren oder Kunden sollte ich heute nachfassen?"),
        S("Write an e-mail", "Mail formulieren", "Help me write an e-mail to: ", "Hilf mir, eine Mail zu formulieren an: "),
      ];
      break;
    }
    case "contacts": {
      label = tr("Contacts", "Kontakte");
      const counts = db.prepare(`SELECT category, COUNT(*) AS n FROM contacts GROUP BY category ORDER BY n DESC`).all() as { category: string; n: number }[];
      parts.push(`## ${tr("Contacts by category", "Kontakte nach Kategorie")}\n${counts.map((c) => `- ${contactCatLabel(c.category)}: ${c.n}`).join("\n")}`);
      followBlock();
      suggestions = [
        S("Contacts due", "Fällige Kontakte", "Which contacts should I call or write to next – and why?", "Welche Kontakte sollte ich als Nächstes anrufen oder anschreiben – und warum?"),
        S("Find a contact", "Kontakt finden", "Find contacts for: ", "Finde Kontakte zu: "),
      ];
      break;
    }
    case "contact": {
      const ct = db
        .prepare(`SELECT c.*, u.name AS owner, o.name AS org_name, o.kind AS org_kind FROM contacts c LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN organizations o ON o.id = c.organization_id WHERE c.id = ?`)
        .get(page.id) as Record<string, unknown> | undefined;
      label = ct ? `${tr("Contact", "Kontakt")}: ${ct.name as string}` : tr("Contact", "Kontakt");
      if (ct) parts.push(contactDetail(db, page.id, today));
      suggestions = [
        S(
          "Person briefing",
          "Briefing zur Person",
          "Give me a briefing on this contact: who is this, where do things stand, and what is the sensible next step?",
          "Gib mir ein Briefing zu diesem Kontakt: Wer ist das, wie ist der Stand, was ist der nächste sinnvolle Schritt?",
        ),
        S(
          "Follow-up e-mail",
          "Nachfass-Mail",
          "Draft a short follow-up e-mail to this contact that fits the activity so far.",
          "Entwirf eine kurze Nachfass-Mail an diesen Kontakt, passend zum bisherigen Verlauf.",
        ),
        S("Add a note", "Notiz festhalten", "Add a note to this contact: ", "Halte als Notiz bei diesem Kontakt fest: "),
      ];
      break;
    }
    case "orgs": {
      label = kindLabel(page.orgKind);
      const d = orgDashboard(db, page.orgKind, now);
      facts.push(
        tr(`${d.lanes.antwort.total} awaiting our reply`, `${d.lanes.antwort.total} warten auf Antwort`),
        tr(`${d.lanes.faellig.total} due`, `${d.lanes.faellig.total} fällig`),
        tr(`${d.lanes.gespraech.total} in talks`, `${d.lanes.gespraech.total} im Gespräch`),
      );
      parts.push(dashboardText(page.orgKind, d));
      suggestions =
        page.orgKind === "investor"
          ? [
              S(
                "Pipeline briefing",
                "Pipeline-Briefing",
                "Give me a briefing on the investor pipeline: where do we stand, what needs doing today, and who is waiting for a reply?",
                "Gib mir ein Briefing zur Investoren-Pipeline: Wo stehen wir, was ist heute zu tun, wer wartet auf eine Antwort?",
              ),
              S(
                "Top 5 for today",
                "Top 5 für heute",
                "Which five investors should I prioritize today – and with what next step?",
                "Welche fünf Investoren sollte ich heute priorisieren – und mit welchem nächsten Schritt?",
              ),
              S(
                "Lead candidates",
                "Lead-Kandidaten",
                "Which investors in the pipeline could lead the seed round? Give a short reason.",
                "Welche Investoren in der Pipeline kommen als Lead für die Seed-Runde in Frage? Begründe kurz.",
              ),
            ]
          : [
              S(
                "Partner briefing",
                "Partner-Briefing",
                "Give me a briefing on the partner pipeline: where do we stand with brokers, data providers and regulatory partners, and what needs doing?",
                "Gib mir ein Briefing zur Partner-Pipeline: Wo stehen wir bei Brokern, Datenanbietern und Regulierungspartnern, was ist zu tun?",
              ),
              S(
                "Top 5 for today",
                "Top 5 für heute",
                "Which five partners should I prioritize today – and with what next step?",
                "Welche fünf Partner sollte ich heute priorisieren – und mit welchem nächsten Schritt?",
              ),
              S(
                "Launch blockers",
                "Launch-Blocker",
                "Which partner contracts are still missing for the launch (broker, data, regulatory), and what is the next step for each?",
                "Welche Partnerverträge fehlen noch für den Launch (Broker, Daten, Regulierung), und was ist jeweils der nächste Schritt?",
              ),
            ];
      break;
    }
    case "org": {
      const o = db.prepare(`SELECT name FROM organizations WHERE id = ?`).get(page.id) as { name: string } | undefined;
      label = o ? o.name : kindOne(page.orgKind);
      if (o) parts.push(orgDetail(db, page.id, today));
      suggestions = [
        S(
          "Briefing",
          "Briefing",
          `Give me a briefing on ${o?.name ?? "this organization"}: status, contacts, recent touchpoints and the best next step.`,
          `Gib mir ein Briefing zu ${o?.name ?? "dieser Organisation"}: Stand, Ansprechpartner, letzte Kontakte und der beste nächste Schritt.`,
        ),
        S(
          "Meeting prep",
          "Gesprächsvorbereitung",
          "Prepare me for the next meeting: goals, questions, likely objections and good answers.",
          "Bereite mich auf das nächste Gespräch vor: Ziele, Fragen, mögliche Einwände und passende Antworten.",
        ),
        S("Follow-up e-mail", "Nachfass-Mail", "Draft a follow-up e-mail that fits the activity so far.", "Entwirf eine Nachfass-Mail passend zum bisherigen Verlauf."),
        S("Set next step", "Nächsten Schritt setzen", "Set as next step: ", "Setze als nächsten Schritt: "),
      ];
      break;
    }
    case "team": {
      label = "Team";
      parts.push(teamText(db));
      suggestions = [
        S("Who does what?", "Wer macht was?", "Who in the team is responsible for what? Give me a short overview.", "Wer im Team ist wofür zuständig? Gib mir eine kurze Übersicht."),
        S(
          "Find the right person",
          "Ansprechpartner finden",
          "Who in the team is the right person to talk to about: ",
          "Wer ist im Team der richtige Ansprechpartner für: ",
        ),
      ];
      break;
    }
    case "person": {
      const u = db.prepare(`SELECT u.*, m.name AS manager FROM users u LEFT JOIN users m ON m.id = u.manager_id WHERE u.id = ?`).get(page.id) as
        | { name: string; title: string; department: string; bio: string; responsibilities: string; manager: string | null; status: string }
        | undefined;
      label = u ? u.name : "Person";
      if (u) {
        const open = (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status != 'erledigt'`).get(page.id) as { n: number }).n;
        const resp = parseTags(u.responsibilities).join(", ") || "–";
        parts.push(
          tr(
            `## Profile: ${u.name}\nRole: ${u.title || "–"}, department: ${u.department || "–"}, reports to: ${u.manager ?? "–"}, status: ${userStatusLabel(u.status)}\nResponsibilities: ${resp}\nBio: ${u.bio || "–"}\nOpen tasks: ${open}`,
            `## Profil: ${u.name}\nRolle: ${u.title || "–"}, Bereich: ${u.department || "–"}, berichtet an: ${u.manager ?? "–"}, Status: ${userStatusLabel(u.status)}\nZuständigkeiten: ${resp}\nKurzprofil: ${u.bio || "–"}\nOffene Aufgaben: ${open}`,
          ),
        );
      }
      suggestions = [
        S("Shared topics", "Gemeinsame Themen", "Which open tasks or topics do we share?", "Welche offenen Aufgaben oder Themen haben wir gemeinsam?"),
        S("Hand over a task", "Aufgabe übergeben", "Create a task for this person: ", "Lege für diese Person eine Aufgabe an: "),
      ];
      break;
    }
    case "settings":
      label = tr("Settings", "Einstellungen");
      suggestions = [
        S("What can I change?", "Was kann ich einstellen?", "What can I adjust in the settings, and what do you recommend?", "Was kann ich in den Einstellungen anpassen, und was empfiehlst du mir?"),
      ];
      break;
    case "admin":
      label = tr("Admin", "Verwaltung");
      suggestions = [S("Invite the team", "Team einladen", "How do I invite more team members to the intranet?", "Wie lade ich weitere Teammitglieder ins Intranet ein?")];
      break;
    case "agent": {
      label = tr("Fundraising agent", "Fundraising-Agent");
      const a = db
        .prepare(
          `SELECT SUM(status IN ('draft','needs_note')) AS drafts, SUM(status IN ('sent','followup')) AS open, SUM(status = 'replied') AS replied, SUM(status = 'declined') AS declined FROM agent_outreach`,
        )
        .get() as { drafts: number | null; open: number | null; replied: number | null; declined: number | null };
      parts.push(
        tr(
          `Fundraising agent: ${a.drafts ?? 0} drafts to review, ${a.open ?? 0} first mails or follow-ups waiting for a reply, ${a.replied ?? 0} replies, ${a.declined ?? 0} declines.`,
          `Fundraising-Agent: ${a.drafts ?? 0} Entwürfe zur Prüfung, ${a.open ?? 0} Erstmails oder Follow-ups warten auf Antwort, ${a.replied ?? 0} Antworten, ${a.declined ?? 0} Absagen.`,
        ),
      );
      suggestions = [
        S("Which drafts first?", "Welche Entwürfe zuerst?", "Which of the agent's drafts should I review and send first, and why?", "Welche Entwürfe des Agenten sollte ich zuerst prüfen und senden, und warum?"),
        S("Replies to handle", "Antworten bearbeiten", "Which investor replies are waiting for me, and what is the best next step for each?", "Welche Investorenantworten warten auf mich, und was ist jeweils der beste nächste Schritt?"),
      ];
      break;
    }
    default:
      taskFacts();
      tasksBlock(10);
      suggestions = [S("My day", "Mein Tag", "What is on my plate today?", "Was steht heute bei mir an?")];
  }
  return { label, facts: facts.slice(0, 4), suggestions, detail: parts.join("\n\n") };
}

function dashboardText(kind: OrgKind, d: ReturnType<typeof orgDashboard>) {
  type Card = { id: string; name: string; stage: string; nextStep?: string; nextDate?: string | null; last?: { dir?: string | null; text?: string; at?: number } | null };
  const lane = (title: string, l: { total: number; items: unknown[] }, n = 8) =>
    `### ${title} (${l.total})\n` +
    ((l.items as Card[])
      .slice(0, n)
      .map(
        (c) =>
          `- [${c.name}](${orgPath(kind, c.id)}) – ${stageLabel(kind, c.stage)}${c.nextStep ? `; ${nextStepWord()}: ${c.nextStep}${c.nextDate ? ` (${fmtDate(c.nextDate)})` : ""}` : ""}${c.last?.text ? `; ${tr("last", "zuletzt")} ${c.last.dir === "in" ? tr("received", "erhalten") : c.last.dir === "out" ? tr("sent", "gesendet") : tr("activity", "Aktivität")} ${fmtTs(c.last.at)}: ${clip(c.last.text, 100)}` : ""} {id: ${c.id}}`,
      )
      .join("\n") || "–");
  const k = d.kpis;
  const rate = k.responseRate !== null ? tr(` (${Math.round(k.responseRate * 100)}%)`, ` (${Math.round(k.responseRate * 100)} %)`) : "";
  return [
    tr(`## ${kindOne(kind)} pipeline (as of ${fmtDate(d.today)})`, `## ${kindLabel(kind)}-Pipeline (Stand ${fmtDate(d.today)})`),
    tr(
      `Total ${k.total}, active ${k.active}, won ${k.won}, declined/paused ${k.closed}, not yet contacted ${k.backlog}. Contacted ${k.contacted}, replied ${k.replied}${rate}. E-mails in the last 7 days: ${k.sent7} sent, ${k.received7} received (previous week ${k.sentPrev7}/${k.receivedPrev7}).`,
      `Gesamt ${k.total}, aktiv ${k.active}, gewonnen ${k.won}, abgesagt/pausiert ${k.closed}, noch nicht kontaktiert ${k.backlog}. Kontaktiert ${k.contacted}, mit Antwort ${k.replied}${rate}. Mails letzte 7 Tage: ${k.sent7} gesendet, ${k.received7} erhalten (Vorwoche ${k.sentPrev7}/${k.receivedPrev7}).`,
    ),
    `${tr("Funnel", "Trichter")}: ${d.funnel.map((f) => `${f.label} ${f.current}`).join(", ")}`,
    lane(tr("Reply received – our move", "Antwort erhalten – wir sind dran"), d.lanes.antwort),
    lane(tr("Due", "Fällig"), d.lanes.faellig),
    lane(tr("In talks", "Im Gespräch"), d.lanes.gespraech),
    lane(tr("Won", "Gewonnen"), d.lanes.gewonnen, 5),
    lane(tr("Waiting for reply", "Wartet auf Antwort"), d.lanes.wartet, 5),
  ].join("\n");
}

function teamText(db: DB) {
  const users = db
    .prepare(`SELECT u.id, u.name, u.title, u.department, u.responsibilities, u.status, m.name AS manager FROM users u LEFT JOIN users m ON m.id = u.manager_id WHERE u.status != 'disabled' ORDER BY u.sort_order, u.name`)
    .all() as { id: string; name: string; title: string; department: string; responsibilities: string; status: string; manager: string | null }[];
  return `## Team\n${users
    .map(
      (u) =>
        `- [${u.name}](/team/${u.id}) – ${u.title || "–"}${u.department ? `, ${u.department}` : ""}${u.manager ? tr(`, reports to ${u.manager}`, `, berichtet an ${u.manager}`) : ""}${parseTags(u.responsibilities).length ? tr(`; responsible for ${parseTags(u.responsibilities).join(", ")}`, `; zuständig für ${parseTags(u.responsibilities).join(", ")}`) : ""}${u.status === "invited" ? tr(" (not signed in yet)", " (noch nicht angemeldet)") : ""} {id: ${u.id}}`,
    )
    .join("\n")}`;
}

function orgDetail(db: DB, id: string, today: string) {
  const o = db.prepare(`SELECT o.*, u.name AS owner FROM organizations o LEFT JOIN users u ON u.id = o.owner_id WHERE o.id = ?`).get(id) as Record<string, any> | undefined;
  if (!o) return tr("No organization with this ID.", "Keine Organisation mit dieser ID.");
  const kind = o.kind as OrgKind;
  const contacts = db.prepare(`SELECT id, name, position, email, stage, last_contact_at FROM contacts WHERE organization_id = ? ORDER BY name LIMIT 20`).all(id) as Record<string, any>[];
  const acts = db
    .prepare(
      `SELECT * FROM (
         SELECT a.kind, a.body, a.created_at, u.name AS who, NULL AS contact FROM org_activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.org_id = @id
         UNION ALL
         SELECT a.kind, a.body, a.created_at, u.name AS who, c.name AS contact FROM contact_activities a JOIN contacts c ON c.id = a.contact_id LEFT JOIN users u ON u.id = a.user_id WHERE c.organization_id = @id
       ) ORDER BY created_at DESC LIMIT 12`,
    )
    .all({ id }) as { kind: string; body: string; created_at: number; who: string | null; contact: string | null }[];
  const tasks = db.prepare(`${TASK_SELECT} WHERE t.organization_id = ? AND t.status != 'erledigt' ORDER BY t.due_date`).all(id) as TaskRow[];
  const money =
    kind === "investor"
      ? [
          o.ticket_min_mio !== null || o.ticket_max_mio !== null ? `${tr("Ticket size", "Ticket")} ${mioRange(o.ticket_min_mio, o.ticket_max_mio)}` : "",
          o.committed_mio ? `${tr("committed", "zugesagt")} ${mio(o.committed_mio)}` : "",
        ]
      : [o.aum_mio ? `AuM ${mio(o.aum_mio)}` : "", o.potential_mio ? `${tr("volume potential", "Volumen-Potenzial")} ${mio(o.potential_mio)}` : ""];
  const loc = o.city || o.country ? `, ${tr("location", "Ort")}: ${[o.city, o.country].filter(Boolean).join(", ")}` : "";
  const prob = o.probability !== null ? tr(`, probability ${o.probability}%`, `, Wahrscheinlichkeit ${o.probability} %`) : "";
  return [
    `## ${kindOne(kind)}: [${o.name}](${orgPath(kind, id)}) {id: ${id}}`,
    tr(
      `Type: ${orgTypeLabel(kind, o.type)}, stage: ${stageLabel(kind, o.stage)}, priority: ${prioLabel(o.priority)}, owner: ${o.owner ?? nobody()}${loc}${prob}`,
      `Art: ${orgTypeLabel(kind, o.type)}, Status: ${stageLabel(kind, o.stage)}, Priorität: ${prioLabel(o.priority)}, zuständig: ${o.owner ?? nobody()}${loc}${prob}`,
    ),
    money.filter(Boolean).join(", "),
    o.focus ? `${tr("Focus", "Fokus")}: ${o.focus}` : "",
    parseTags(o.tags).length ? `${tr("Tags", "Schlagworte")}: ${parseTags(o.tags).join(", ")}` : "",
    `${tr("Next step", "Nächster Schritt")}: ${o.next_step || "–"}${o.next_date ? ` (${o.next_date < today ? tr("overdue since ", "überfällig seit ") : ""}${fmtDate(o.next_date)})` : ""}; ${tr("last contact", "letzter Kontakt")}: ${fmtTs(o.last_contact_at) || "–"}`,
    o.notes ? `### ${tr("Notes", "Notizen")}\n${clip(o.notes, 3000)}` : "",
    `### ${tr("Contacts", "Ansprechpartner")}\n${contacts.map((c) => `- [${c.name}](/kontakte/${c.id})${c.position ? `, ${c.position}` : ""}${c.email ? `, ${c.email}` : ""}${c.stage ? ` (${contactStageLabel(c.stage)})` : ""} {id: ${c.id}}`).join("\n") || "–"}`,
    `### ${tr("Activity (newest first)", "Verlauf (neueste zuerst)")}\n${acts.map((a) => `- ${fmtTs(a.created_at)} · ${actLabel(a.kind)}${a.contact ? ` · ${a.contact}` : ""}${a.who ? ` · ${a.who}` : ""}: ${clip(oneLine(a.body), 600)}`).join("\n") || "–"}`,
    `### ${tr("Open tasks", "Offene Aufgaben")}\n${tasks.map((t) => taskLine(t, today, true)).join("\n") || "–"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function contactDetail(db: DB, id: string, today: string) {
  const c = db
    .prepare(`SELECT c.*, u.name AS owner, o.name AS org_name, o.kind AS org_kind FROM contacts c LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN organizations o ON o.id = c.organization_id WHERE c.id = ?`)
    .get(id) as Record<string, any> | undefined;
  if (!c) return tr("No contact with this ID.", "Kein Kontakt mit dieser ID.");
  const acts = db
    .prepare(`SELECT a.kind, a.body, a.created_at, u.name AS who FROM contact_activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.contact_id = ? ORDER BY a.created_at DESC LIMIT 12`)
    .all(id) as { kind: string; body: string; created_at: number; who: string | null }[];
  const tasks = db.prepare(`${TASK_SELECT} WHERE t.contact_id = ? AND t.status != 'erledigt' ORDER BY t.due_date`).all(id) as TaskRow[];
  return [
    `## ${tr("Contact", "Kontakt")}: [${c.name}](/kontakte/${id}) {id: ${id}}`,
    `${[c.position, c.org_name ? `${tr("at", "bei")} [${c.org_name}](${orgPath(c.org_kind, c.organization_id)})` : c.company].filter(Boolean).join(" ")}; ${tr(
      `category: ${contactCatLabel(c.category)}, stage: ${c.stage ? contactStageLabel(c.stage) : "–"}, owner: ${c.owner ?? nobody()}`,
      `Kategorie: ${contactCatLabel(c.category)}, Status: ${c.stage ? contactStageLabel(c.stage) : "–"}, zuständig: ${c.owner ?? nobody()}`,
    )}`,
    [c.email && `${tr("E-mail", "E-Mail")}: ${c.email}`, c.phone && `${tr("Phone", "Telefon")}: ${c.phone}`, c.linkedin && `LinkedIn: ${c.linkedin}`].filter(Boolean).join(", "),
    `${tr("Next step", "Nächster Schritt")}: ${c.next_step || "–"}${c.next_date ? ` (${fmtDate(c.next_date)})` : ""}; ${tr("last contact", "letzter Kontakt")}: ${fmtTs(c.last_contact_at) || "–"}`,
    c.notes ? `### ${tr("Notes", "Notizen")}\n${clip(c.notes, 3000)}` : "",
    `### ${tr("Activity (newest first)", "Verlauf (neueste zuerst)")}\n${acts.map((a) => `- ${fmtTs(a.created_at)} · ${actLabel(a.kind)}${a.who ? ` · ${a.who}` : ""}: ${clip(oneLine(a.body), 600)}`).join("\n") || "–"}`,
    `### ${tr("Open tasks", "Offene Aufgaben")}\n${tasks.map((t) => taskLine(t, today, true)).join("\n") || "–"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ---------- Tools ---------- */

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const TOOLS: ToolDef[] = [
  {
    name: "suche",
    description:
      "Searches the intranet for investors, partners, contacts, tasks, news and team members (name, company, e-mail, tags, title). Returns IDs and links. Use it before you talk about a specific organization or person that is not in the page context.",
    input_schema: {
      type: "object",
      properties: {
        begriff: { type: "string", description: "Search term, e.g. company name, person's name, city or tag" },
        bereich: {
          type: "string",
          enum: ["alle", "investoren", "partner", "kontakte", "aufgaben", "news", "team"],
          description: "Optional filter: alle = all, investoren = investors, partner = partners (brokers, data providers, exchanges, programs, service providers), kontakte = contacts, aufgaben = tasks, news, team. Default: alle",
        },
      },
      required: ["begriff"],
    },
  },
  {
    name: "aufgaben_auflisten",
    description: "Lists tasks – by default the open tasks of the signed-in person. Can be extended to other people, everyone, or done tasks.",
    input_schema: {
      type: "object",
      properties: {
        person: { type: "string", description: "\"me\" (default), \"all\" or the first/last name of a team member" },
        status: { type: "string", enum: ["offen", "erledigt", "alle"], description: "offen = open (default), erledigt = done, alle = all" },
        faellig_bis: { type: "string", description: "Only tasks due on or before this date (YYYY-MM-DD)" },
      },
    },
  },
  {
    name: "institution_details",
    description: "Full details of an investor or partner: stage, fit for nalpia, focus, ticket size, notes, contacts, activity (e-mails, notes, stage changes), agent outreach and open tasks.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "ID of the organization (from the page context or search)" } }, required: ["id"] },
  },
  {
    name: "kontakt_details",
    description: "Full details of a contact, including activity and open tasks.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "pipeline_ueberblick",
    description: "Key figures and work lists of the investor or partner pipeline (reply received, due, in talks, won, waiting).",
    input_schema: { type: "object", properties: { art: { type: "string", enum: ["investor", "partner"], description: "investor = investor pipeline (fundraising), partner = partner pipeline" } }, required: ["art"] },
  },
  {
    name: "news_lesen",
    description: "Reads the latest news posts including their text.",
    input_schema: {
      type: "object",
      properties: { anzahl: { type: "integer", minimum: 1, maximum: 15 }, nur_ungelesene: { type: "boolean" }, id: { type: "string", description: "Read one specific post" } },
    },
  },
  {
    name: "team_ueberblick",
    description: "All team members with role, department, reporting line and responsibilities.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "meilensteine",
    description: "Milestones with status, due date, owner and progress.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "aufgabe_anlegen",
    description:
      "Creates a task in the intranet. ONLY use it when the person explicitly asks for it (e.g. \"create a task for me\") or has confirmed your suggestion. When assigned to someone else, that person is notified.",
    input_schema: {
      type: "object",
      properties: {
        titel: { type: "string", description: "Title – short, starts with a verb" },
        beschreibung: { type: "string", description: "Description" },
        faellig: { type: "string", description: "Due date, YYYY-MM-DD" },
        prioritaet: { type: "string", enum: ["hoch", "mittel", "niedrig"], description: "Priority: hoch = high, mittel = medium (default), niedrig = low" },
        zustaendig: { type: "string", description: "Owner: \"me\" (default) or the name of a team member" },
        institution_id: { type: "string" },
        kontakt_id: { type: "string" },
      },
      required: ["titel"],
    },
  },
  {
    name: "aufgabe_aktualisieren",
    description: "Changes an existing task (status, due date, priority, title). ONLY on explicit request. Allowed for tasks the person created or owns.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["offen", "in_arbeit", "erledigt"], description: "offen = open, in_arbeit = in progress, erledigt = done" },
        faellig: { type: "string", description: "Due date, YYYY-MM-DD, or empty to remove it" },
        prioritaet: { type: "string", enum: ["hoch", "mittel", "niedrig"], description: "Priority: hoch = high, mittel = medium, niedrig = low" },
        titel: { type: "string", description: "Title" },
      },
      required: ["id"],
    },
  },
  {
    name: "notiz_hinzufuegen",
    description: "Adds a note to the activity of an organization or contact (e.g. the outcome of a call). ONLY on explicit request. Pass institution_id (organization) or kontakt_id (contact).",
    input_schema: {
      type: "object",
      properties: { institution_id: { type: "string" }, kontakt_id: { type: "string" }, text: { type: "string" }, art: { type: "string", enum: ["notiz", "anruf", "meeting"], description: "notiz = note (default), anruf = call, meeting" } },
      required: ["text"],
    },
  },
  {
    name: "naechsten_schritt_setzen",
    description: "Sets the next step (and optionally the date) for an organization. ONLY on explicit request.",
    input_schema: {
      type: "object",
      properties: { institution_id: { type: "string" }, schritt: { type: "string", description: "The next step" }, datum: { type: "string", description: "Date, YYYY-MM-DD" } },
      required: ["institution_id", "schritt"],
    },
  },
];

/** Short status text shown while a tool runs */
export function toolStatus(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "suche": {
      const term = String(input.begriff ?? "").slice(0, 40);
      return tr(`Searching for ${q(term)}`, `Suche nach ${q(term)}`);
    }
    case "aufgaben_auflisten":
      return tr("Looking at the tasks", "Sehe mir die Aufgaben an");
    case "institution_details":
      return tr("Reading the organization", "Lese die Organisation");
    case "kontakt_details":
      return tr("Reading the contact", "Lese den Kontakt");
    case "pipeline_ueberblick":
      return input.art === "partner" ? tr("Analyzing the partner pipeline", "Analysiere die Partner-Pipeline") : tr("Analyzing the investor pipeline", "Analysiere die Investoren-Pipeline");
    case "news_lesen":
      return tr("Reading the news", "Lese die News");
    case "team_ueberblick":
      return tr("Looking at the team", "Sehe mir das Team an");
    case "meilensteine":
      return tr("Looking at the milestones", "Sehe mir die Meilensteine an");
    case "aufgabe_anlegen":
      return tr("Creating the task", "Lege die Aufgabe an");
    case "aufgabe_aktualisieren":
      return tr("Updating the task", "Aktualisiere die Aufgabe");
    case "notiz_hinzufuegen":
      return tr("Adding the note", "Halte die Notiz fest");
    case "naechsten_schritt_setzen":
      return tr("Setting the next step", "Setze den nächsten Schritt");
    default:
      return tr("Working", "Arbeite");
  }
}

export interface ToolResult {
  text: string;
  /** Which data the browser should reload */
  changed?: ("tasks" | "orgs" | "contacts" | "home")[];
  isError?: boolean;
}

const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const ambiguous = (who: string) => tr(`"${who}" is ambiguous – please give the full name.`, `„${who}“ ist nicht eindeutig – bitte den vollen Namen angeben.`);
const noSuchUser = (who: string) => tr(`Nobody in the team is called "${who}".`, `Niemand im Team heißt „${who}“.`);
const noOrg = () => tr("This organization does not exist.", "Diese Organisation gibt es nicht.");
const noContact = () => tr("This contact does not exist.", "Diesen Kontakt gibt es nicht.");

function findUser(db: DB, me: UserRow, who: unknown): { id: string; name: string } | null | "ambiguous" {
  const w = str(who, 80).toLowerCase();
  if (!w || w === "me" || w === "myself" || w === "i" || w === "ich" || w === "mir" || w === "mich") return { id: me.id, name: me.name };
  const all = db.prepare(`SELECT id, name, email FROM users WHERE status != 'disabled'`).all() as { id: string; name: string; email: string }[];
  const exact = all.filter((u) => u.name.toLowerCase() === w || u.email.toLowerCase() === w);
  if (exact.length === 1) return exact[0]!;
  const part = all.filter((u) => u.name.toLowerCase().split(/\s+/).some((n) => n === w) || u.name.toLowerCase().includes(w));
  if (part.length === 1) return part[0]!;
  return part.length > 1 ? "ambiguous" : null;
}

export function runTool(db: DB, me: UserRow, name: string, input: Record<string, unknown>, ip?: string, now = Date.now()): ToolResult {
  const today = todayISO("Europe/Berlin", new Date(now));
  switch (name) {
    case "suche": {
      const term = str(input.begriff, 80);
      if (term.length < 2) return { text: tr("Please give a search term with at least 2 characters.", "Bitte einen Suchbegriff mit mindestens 2 Zeichen angeben."), isError: true };
      const like = `%${term.replace(/[%_]/g, "")}%`;
      const area = str(input.bereich) || "alle";
      const out: string[] = [];
      const want = (a: string) => area === "alle" || area === a;
      for (const kind of ["investor", "partner"] as OrgKind[]) {
        if (!want(kind === "investor" ? "investoren" : "partner")) continue;
        const rows = db
          .prepare(
            `SELECT id, name, stage, city, country, next_step FROM organizations WHERE kind = ? AND (name LIKE @q OR tags LIKE @q OR city LIKE @q OR focus LIKE @q OR notes LIKE @q) ORDER BY (name LIKE @q) DESC, updated_at DESC LIMIT 12`,
          )
          .all(kind, { q: like }) as { id: string; name: string; stage: string; city: string; country: string; next_step: string }[];
        if (rows.length)
          out.push(
            `### ${kindLabel(kind)}\n${rows.map((r) => `- [${r.name}](${orgPath(kind, r.id)}) – ${stageLabel(kind, r.stage)}${r.city ? `, ${r.city}` : ""}${r.next_step ? `; ${nextStepWord()}: ${r.next_step}` : ""} {id: ${r.id}}`).join("\n")}`,
          );
      }
      if (want("kontakte")) {
        const rows = db
          .prepare(`SELECT c.id, c.name, c.position, c.email, c.company, o.name AS org FROM contacts c LEFT JOIN organizations o ON o.id = c.organization_id WHERE c.name LIKE @q OR c.email LIKE @q OR c.company LIKE @q OR o.name LIKE @q OR c.tags LIKE @q LIMIT 15`)
          .all({ q: like }) as Record<string, string>[];
        if (rows.length) out.push(`### ${tr("Contacts", "Kontakte")}\n${rows.map((r) => `- [${r.name}](/kontakte/${r.id})${r.position ? `, ${r.position}` : ""}${r.org || r.company ? ` – ${r.org || r.company}` : ""}${r.email ? `, ${r.email}` : ""} {id: ${r.id}}`).join("\n")}`);
      }
      if (want("aufgaben")) {
        const rows = db.prepare(`${TASK_SELECT} WHERE t.title LIKE @q OR t.description LIKE @q ORDER BY t.status = 'erledigt', t.due_date LIMIT 12`).all({ q: like }) as TaskRow[];
        if (rows.length) out.push(`### ${tr("Tasks", "Aufgaben")}\n${rows.map((t) => taskLine(t, today, true) + (t.status === "erledigt" ? tr(" ✓ done", " ✓ erledigt") : "")).join("\n")}`);
      }
      if (want("news")) {
        const rows = db.prepare(`SELECT id, title, created_at FROM news WHERE title LIKE @q OR body LIKE @q ORDER BY created_at DESC LIMIT 8`).all({ q: like }) as { id: string; title: string; created_at: number }[];
        if (rows.length) out.push(`### News\n${rows.map((n) => `- [${n.title}](/news/${n.id}) (${fmtTs(n.created_at)}) {id: ${n.id}}`).join("\n")}`);
      }
      if (want("team")) {
        const rows = db.prepare(`SELECT id, name, title FROM users WHERE status != 'disabled' AND (name LIKE @q OR title LIKE @q OR department LIKE @q OR responsibilities LIKE @q) LIMIT 10`).all({ q: like }) as Record<string, string>[];
        if (rows.length) out.push(`### Team\n${rows.map((u) => `- [${u.name}](/team/${u.id}) – ${u.title || "–"} {id: ${u.id}}`).join("\n")}`);
      }
      return { text: out.join("\n\n") || tr(`No results for ${q(term)}.`, `Keine Treffer für ${q(term)}.`) };
    }
    case "aufgaben_auflisten": {
      const rawWho = str(input.person) || "me";
      const who = rawWho.toLowerCase() === "all" ? "alle" : rawWho;
      const isMe = ["me", "myself", "i", "ich"].includes(who.toLowerCase());
      const status = str(input.status) || "offen";
      const where: string[] = [];
      const args: Record<string, unknown> = {};
      if (who.toLowerCase() !== "alle") {
        const u = findUser(db, me, who);
        if (u === "ambiguous") return { text: ambiguous(who), isError: true };
        if (!u) return { text: noSuchUser(who), isError: true };
        where.push("t.assignee_id = @uid");
        args.uid = u.id;
      }
      if (status === "offen") where.push("t.status != 'erledigt'");
      if (status === "erledigt") where.push("t.status = 'erledigt'");
      const until = isoDate(input.faellig_bis);
      if (until) {
        where.push("t.due_date <= @until");
        args.until = until;
      }
      const rows = db
        .prepare(`${TASK_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.status = 'erledigt', t.due_date IS NULL, t.due_date LIMIT 60`)
        .all(args) as TaskRow[];
      return {
        text: rows.length
          ? rows.map((t) => taskLine(t, today, !isMe) + (t.status === "erledigt" ? tr(" ✓ done", " ✓ erledigt") : "")).join("\n")
          : tr("No matching tasks.", "Keine passenden Aufgaben."),
      };
    }
    case "institution_details":
      return { text: orgDetail(db, str(input.id, 64), today) };
    case "kontakt_details":
      return { text: contactDetail(db, str(input.id, 64), today) };
    case "pipeline_ueberblick": {
      const kind: OrgKind = input.art === "partner" ? "partner" : "investor";
      return { text: dashboardText(kind, orgDashboard(db, kind, now)) };
    }
    case "news_lesen": {
      const id = str(input.id, 64);
      const n = Math.min(15, Math.max(1, Number(input.anzahl) || 6));
      const rows = (
        id
          ? db.prepare(`SELECT id, title, body, category, created_at FROM news WHERE id = ?`).all(id)
          : input.nur_ungelesene
            ? unreadNews(db, me.id, n)
            : db.prepare(`SELECT id, title, body, category, created_at FROM news ORDER BY created_at DESC LIMIT ?`).all(n)
      ) as { id: string; title: string; body: string; category: string; created_at: number }[];
      return { text: rows.map((r) => `### [${r.title}](/news/${r.id}) (${catLabel(r.category)}, ${fmtTs(r.created_at)})\n${clip(r.body, id ? 8000 : 1500)}`).join("\n\n") || tr("No posts.", "Keine Beiträge.") };
    }
    case "team_ueberblick":
      return { text: teamText(db) };
    case "meilensteine": {
      const rows = db
        .prepare(
          `SELECT m.id, m.title, m.status, m.due_date, m.area, u.name AS owner,
             (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id) AS total,
             (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id AND t.status = 'erledigt') AS done
           FROM milestones m LEFT JOIN users u ON u.id = m.owner_id ORDER BY m.status = 'erreicht', m.due_date IS NULL, m.due_date LIMIT 30`,
        )
        .all() as { id: string; title: string; status: string; due_date: string | null; area: string; owner: string | null; total: number; done: number }[];
      return {
        text:
          rows
            .map(
              (m) =>
                `- [${m.title}](/aufgaben/meilensteine/${m.id}) – ${msStatusLabel(m.status)}, ${m.due_date ? fmtDate(m.due_date) : tr("no due date", "ohne Termin")}, ${m.owner ?? tr("no owner", "ohne Verantwortliche")}, ${tr(`${m.done}/${m.total} tasks done`, `${m.done}/${m.total} Aufgaben erledigt`)}`,
            )
            .join("\n") || tr("No milestones yet.", "Noch keine Meilensteine."),
      };
    }
    case "aufgabe_anlegen": {
      const title = str(input.titel, 200);
      if (title.length < 2) return { text: tr("The title is missing.", "Der Titel fehlt."), isError: true };
      const u = findUser(db, me, input.zustaendig);
      if (u === "ambiguous") return { text: ambiguous(str(input.zustaendig)), isError: true };
      if (!u) return { text: noSuchUser(str(input.zustaendig)), isError: true };
      const orgId = str(input.institution_id, 64);
      const contactId = str(input.kontakt_id, 64);
      if (orgId && !db.prepare("SELECT 1 FROM organizations WHERE id = ?").get(orgId)) return { text: noOrg(), isError: true };
      if (contactId && !db.prepare("SELECT 1 FROM contacts WHERE id = ?").get(contactId)) return { text: noContact(), isError: true };
      const prio = ["hoch", "mittel", "niedrig"].includes(str(input.prioritaet)) ? str(input.prioritaet) : "mittel";
      const id = newId();
      const ts = Date.now();
      db.prepare(
        `INSERT INTO tasks (id, title, description, assignee_id, created_by, due_date, priority, status, contact_id, organization_id, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'offen', ?, ?, ?, ?, ?)`,
      ).run(id, title, str(input.beschreibung, 4000), u.id, me.id, isoDate(input.faellig) ?? null, prio, contactId || null, orgId || null, ts, ts, ts);
      if (u.id !== me.id)
        notify(db, { userId: u.id, actorId: me.id, kind: "task.assigned", title: () => tr(`${me.name} assigned "${title}" to you`, `${me.name} hat dir „${title}“ zugewiesen`), link: `/aufgaben?task=${id}` });
      audit(db, { userId: me.id, action: "assistant.task_created", target: id, ip, meta: { assignee: u.id } });
      const dueTxt = isoDate(input.faellig) ? tr(`, due ${fmtDate(isoDate(input.faellig))}`, `, fällig ${fmtDate(isoDate(input.faellig))}`) : "";
      return {
        text: tr(
          `Task created: [${title}](/aufgaben?task=${id}) – owner ${u.name}${dueTxt}, priority ${prioLabel(prio)}. {id: ${id}}`,
          `Aufgabe angelegt: [${title}](/aufgaben?task=${id}) – zuständig ${u.name}${dueTxt}, Priorität ${prioLabel(prio)}. {id: ${id}}`,
        ),
        changed: ["tasks", "home"],
      };
    }
    case "aufgabe_aktualisieren": {
      const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(str(input.id, 64)) as Record<string, any> | undefined;
      if (!t) return { text: tr("This task does not exist.", "Diese Aufgabe gibt es nicht."), isError: true };
      if (t.assignee_id !== me.id && t.created_by !== me.id && me.role !== "admin")
        return { text: tr("Only the task's owner or creator can change this task.", "Diese Aufgabe darf nur die zuständige oder erstellende Person ändern."), isError: true };
      const status = ["offen", "in_arbeit", "erledigt"].includes(str(input.status)) ? str(input.status) : t.status;
      const due = input.faellig === "" || input.faellig === null ? null : (isoDate(input.faellig) ?? t.due_date);
      const prio = ["hoch", "mittel", "niedrig"].includes(str(input.prioritaet)) ? str(input.prioritaet) : t.priority;
      const title = str(input.titel, 200) || t.title;
      const ts = Date.now();
      db.prepare("UPDATE tasks SET title = ?, status = ?, due_date = ?, priority = ?, updated_at = ?, completed_at = ? WHERE id = ?").run(
        title,
        status,
        due,
        prio,
        ts,
        status === "erledigt" ? (t.completed_at ?? ts) : null,
        t.id,
      );
      if (status === "erledigt" && t.status !== "erledigt" && t.created_by)
        notify(db, { userId: t.created_by, actorId: me.id, kind: "task.done", title: () => tr(`${me.name} completed "${title}"`, `${me.name} hat „${title}“ erledigt`), link: `/aufgaben?task=${t.id}` });
      audit(db, { userId: me.id, action: "assistant.task_updated", target: t.id, ip, meta: { status, due, prio } });
      return {
        text: tr(
          `Task updated: [${title}](/aufgaben?task=${t.id}) – status ${statusLabel(status)}, ${due ? `due ${fmtDate(due)}` : "no due date"}, priority ${prioLabel(prio)}.`,
          `Aufgabe aktualisiert: [${title}](/aufgaben?task=${t.id}) – Status ${statusLabel(status)}, ${due ? `fällig ${fmtDate(due)}` : "ohne Termin"}, Priorität ${prioLabel(prio)}.`,
        ),
        changed: ["tasks", "home"],
      };
    }
    case "notiz_hinzufuegen": {
      const text = str(input.text, 6000);
      if (!text) return { text: tr("The text is missing.", "Der Text fehlt."), isError: true };
      const kind = ["notiz", "anruf", "meeting"].includes(str(input.art)) ? str(input.art) : "notiz";
      const ts = Date.now();
      const orgId = str(input.institution_id, 64);
      const contactId = str(input.kontakt_id, 64);
      if (contactId) {
        const c = db.prepare("SELECT id, name FROM contacts WHERE id = ?").get(contactId) as { id: string; name: string } | undefined;
        if (!c) return { text: noContact(), isError: true };
        db.prepare("INSERT INTO contact_activities (id, contact_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(newId(), c.id, me.id, kind, text, ts);
        if (kind !== "notiz") db.prepare("UPDATE contacts SET last_contact_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, c.id);
        audit(db, { userId: me.id, action: "assistant.note", target: c.id, ip });
        return { text: tr(`Note added to [${c.name}](/kontakte/${c.id}).`, `Notiz bei [${c.name}](/kontakte/${c.id}) festgehalten.`), changed: ["contacts", "orgs"] };
      }
      if (orgId) {
        const o = db.prepare("SELECT id, name, kind FROM organizations WHERE id = ?").get(orgId) as { id: string; name: string; kind: OrgKind } | undefined;
        if (!o) return { text: noOrg(), isError: true };
        db.prepare("INSERT INTO org_activities (id, org_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(newId(), o.id, me.id, kind, text, ts);
        if (kind !== "notiz") db.prepare("UPDATE organizations SET last_contact_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, o.id);
        audit(db, { userId: me.id, action: "assistant.note", target: o.id, ip });
        return { text: tr(`Note added to [${o.name}](${orgPath(o.kind, o.id)}).`, `Notiz bei [${o.name}](${orgPath(o.kind, o.id)}) festgehalten.`), changed: ["orgs"] };
      }
      return { text: tr("Please pass institution_id or kontakt_id.", "Bitte institution_id oder kontakt_id angeben."), isError: true };
    }
    case "naechsten_schritt_setzen": {
      const o = db.prepare("SELECT id, name, kind FROM organizations WHERE id = ?").get(str(input.institution_id, 64)) as { id: string; name: string; kind: OrgKind } | undefined;
      if (!o) return { text: noOrg(), isError: true };
      const step = str(input.schritt, 300);
      if (!step) return { text: tr("The step is missing.", "Der Schritt fehlt."), isError: true };
      const date = isoDate(input.datum) ?? null;
      const ts = Date.now();
      db.prepare("UPDATE organizations SET next_step = ?, next_date = ?, updated_at = ? WHERE id = ?").run(step, date, ts, o.id);
      audit(db, { userId: me.id, action: "assistant.next_step", target: o.id, ip, meta: { date } });
      return {
        text: tr(`Next step for [${o.name}](${orgPath(o.kind, o.id)}): `, `Nächster Schritt bei [${o.name}](${orgPath(o.kind, o.id)}): `) + `${step}${date ? ` (${fmtDate(date)})` : ""}.`,
        changed: ["orgs", "home"],
      };
    }
    default:
      return { text: tr(`Unknown tool: ${name}`, `Unbekanntes Werkzeug: ${name}`), isError: true };
  }
}

/** Today's date (weekday included) for the prompt */
export const weekdayDE = (now = Date.now()) => new Date(now).toLocaleDateString(localeTag(), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
export { DAY };
