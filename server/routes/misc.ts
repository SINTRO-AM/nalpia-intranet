import { Hono } from "hono";
import { z } from "zod";
import { toPublicUser, type AppEnv, type UserRow } from "../context.js";
import { body, query } from "../lib/http.js";
import { addDaysISO, todayISO } from "../lib/util.js";
import { currentLang } from "../lib/i18n.js";
import { HttpError } from "../lib/http.js";
import { MAX_TEXT_CHARS, MAX_TEXTS, translateTexts } from "../lib/translate.js";
import {
  mapMilestone,
  milestoneSelect,
  type MilestoneRow,
} from "./milestones.js";
import { mapTask, taskSelect, type TaskRow } from "./tasks.js";
import { orgPath, type OrgKind } from "./orgs.js";
import { mapTopic, topicSelect, type TopicRow } from "./topics.js";

export const miscRoutes = new Hono<AppEnv>();

/* ---------- Notifications ---------- */

miscRoutes.get("/notifications", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const items = (
    db
      .prepare(
        "SELECT id, actor_id AS actorId, kind, title, title_de AS titleDe, link, created_at AS createdAt, read_at AS readAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60",
      )
      .all(me.id) as { titleDe: string | null; title: string }[]
  ).map(({ titleDe, ...n }) => ({
    ...n,
    title: currentLang() === "de" && titleDe ? titleDe : n.title,
  }));
  // (written in both languages since November 2026; older ones only in the language of the person acting)
  const unread = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL",
      )
      .get(me.id) as { n: number }
  ).n;
  // Clean up old entries (> 90 days)
  db.prepare(
    "DELETE FROM notifications WHERE user_id = ? AND created_at < ?",
  ).run(me.id, Date.now() - 90 * 86400_000);
  return c.json({ items, unread });
});

miscRoutes.post("/notifications/read", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const p = await body(
    c,
    z.object({ ids: z.array(z.string().max(64)).max(200).optional() }),
  );
  const now = Date.now();
  if (p.ids?.length) {
    db.prepare(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${p.ids.map(() => "?").join(",")})`,
    ).run(now, me.id, ...p.ids);
  } else {
    db.prepare(
      "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
    ).run(now, me.id);
  }
  return c.json({ ok: true });
});

/* ---------- Home page (aggregated, one request) ---------- */

miscRoutes.get("/home", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const today = todayISO();
  const horizonEnd = addDaysISO(today, 27);
  const myTasks = (
    db
      .prepare(
        `${taskSelect} WHERE t.assignee_id = ? AND t.status != 'erledigt'
         ORDER BY t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'hoch' THEN 0 WHEN 'mittel' THEN 1 ELSE 2 END LIMIT 12`,
      )
      .all(me.id) as TaskRow[]
  ).map(mapTask);
  const openCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status != 'erledigt'",
      )
      .get(me.id) as { n: number }
  ).n;
  const overdue = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status != 'erledigt' AND due_date < ?",
      )
      .get(me.id, today) as { n: number }
  ).n;
  const doneThisWeek = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status = 'erledigt' AND completed_at > ?",
      )
      .get(me.id, Date.now() - 7 * 86400_000) as { n: number }
  ).n;
  const milestones = (
    db
      .prepare(
        `${milestoneSelect} WHERE m.status IN ('aktiv','geplant','verschoben') GROUP BY m.id ORDER BY m.due_date IS NULL, m.due_date LIMIT 8`,
      )
      .all() as MilestoneRow[]
  ).map(mapMilestone);
  // Horizon: all due dates in the next 4 weeks (team), for the timeline band
  const horizonTasks = db
    .prepare(
      "SELECT id, title, due_date AS dueDate, assignee_id AS assigneeId, priority FROM tasks WHERE status != 'erledigt' AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date",
    )
    .all(horizonEnd) as {
    id: string;
    title: string;
    dueDate: string;
    assigneeId: string | null;
    priority: string;
  }[];
  const horizonMilestones = db
    .prepare(
      "SELECT id, title, due_date AS dueDate, owner_id AS ownerId, status FROM milestones WHERE status != 'erreicht' AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date",
    )
    .all(horizonEnd);
  const newsRows = db
    .prepare(
      `SELECT n.id, n.title, n.body, n.category, n.pinned, n.created_at AS createdAt, n.author_id AS authorId,
       EXISTS(SELECT 1 FROM news_reads r WHERE r.news_id = n.id AND r.user_id = ?) AS read
       FROM news n ORDER BY n.pinned DESC, n.created_at DESC LIMIT 4`,
    )
    .all(me.id) as { pinned: number; read: number }[];
  const news = newsRows.map((n) => ({
    ...n,
    pinned: !!n.pinned,
    read: !!n.read,
  }));
  const newsUnread = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM news n WHERE NOT EXISTS(SELECT 1 FROM news_reads r WHERE r.news_id = n.id AND r.user_id = ?)",
      )
      .get(me.id) as {
      n: number;
    }
  ).n;
  const contactFollowUps = (
    db
      .prepare(
        `SELECT id, name, company, category, stage, next_step AS nextStep, next_date AS nextDate FROM contacts ct WHERE owner_id = ? AND next_date IS NOT NULL AND next_date <= ?
           AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = ct.organization_id AND o.owner_id = ct.owner_id AND o.next_date = ct.next_date)
         ORDER BY next_date LIMIT 8`,
      )
      .all(me.id, addDaysISO(today, 7)) as {
      id: string;
      name: string;
      company: string;
      category: string;
      stage: string;
      nextStep: string;
      nextDate: string;
    }[]
  ).map((r) => ({
    ...r,
    href: `/kontakte/${r.id}`,
    source: "contact" as const,
  }));
  const orgFollowUps = (
    db
      .prepare(
        `SELECT id, name, kind, city, next_step AS nextStep, next_date AS nextDate FROM organizations
         WHERE owner_id = ? AND next_date IS NOT NULL AND next_date <= ? AND stage NOT IN ('abgesagt','pausiert') ORDER BY next_date LIMIT 8`,
      )
      .all(me.id, addDaysISO(today, 7)) as {
      id: string;
      name: string;
      kind: OrgKind;
      city: string;
      nextStep: string;
      nextDate: string;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    company: r.city,
    category: r.kind,
    stage: "",
    nextStep: r.nextStep,
    nextDate: r.nextDate,
    href: orgPath(r.kind, r.id),
    source: "org" as const,
  }));
  // Topics I own: what is waiting, what needs a follow-up soon, what is in progress
  const topics = (
    db
      .prepare(
        `${topicSelect(today)} WHERE tp.owner_id = ? AND tp.stage IN ('idee','geplant','in_arbeit','wartet')
         ORDER BY tp.follow_up IS NULL, tp.follow_up, CASE tp.stage WHEN 'wartet' THEN 0 WHEN 'in_arbeit' THEN 1 WHEN 'geplant' THEN 2 ELSE 3 END, tp.due_date IS NULL, tp.due_date
         LIMIT 6`,
      )
      .all(me.id) as TopicRow[]
  ).map(mapTopic);
  const topicFollowUps = (
    db
      .prepare(
        `SELECT id, title, counterpart, next_step AS nextStep, waiting_on AS waitingOn, follow_up AS nextDate FROM topics
         WHERE owner_id = ? AND follow_up IS NOT NULL AND follow_up <= ? AND stage NOT IN ('erledigt','verworfen') ORDER BY follow_up LIMIT 8`,
      )
      .all(me.id, addDaysISO(today, 7)) as { id: string; title: string; counterpart: string; nextStep: string; waitingOn: string; nextDate: string }[]
  ).map((r) => ({
    id: r.id,
    name: r.title,
    company: r.counterpart,
    category: "topic",
    stage: "",
    nextStep: r.nextStep || r.waitingOn,
    nextDate: r.nextDate,
    href: `/themen?thema=${r.id}`,
    source: "topic" as const,
  }));
  const followUps = [...contactFollowUps, ...orgFollowUps, ...topicFollowUps]
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    .slice(0, 8);
  return c.json({
    today,
    tasks: myTasks,
    stats: { open: openCount, overdue, doneThisWeek },
    milestones,
    horizon: {
      start: today,
      end: horizonEnd,
      tasks: horizonTasks,
      milestones: horizonMilestones,
    },
    news,
    newsUnread,
    followUps,
    topics,
  });
});

/* ---------- Global search ---------- */

miscRoutes.get("/search", (c) => {
  const { db } = c.get("deps");
  const { q } = query(c, z.object({ q: z.string().trim().min(1).max(100) }));
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const tasks = db
    .prepare(
      "SELECT id, title, status, due_date AS dueDate, assignee_id AS assigneeId FROM tasks WHERE title LIKE ? OR description LIKE ? ORDER BY updated_at DESC LIMIT 8",
    )
    .all(like, like);
  const news = db
    .prepare(
      "SELECT id, title, category, created_at AS createdAt FROM news WHERE title LIKE ? OR body LIKE ? ORDER BY created_at DESC LIMIT 6",
    )
    .all(like, like);
  const contacts = db
    .prepare(
      "SELECT id, name, company, category, email FROM contacts WHERE name LIKE ? OR company LIKE ? OR email LIKE ? ORDER BY updated_at DESC LIMIT 8",
    )
    .all(like, like, like);
  const milestones = db
    .prepare(
      "SELECT id, title, due_date AS dueDate, status FROM milestones WHERE title LIKE ? ORDER BY due_date LIMIT 5",
    )
    .all(like);
  const orgs = db
    .prepare(
      "SELECT id, name, kind, type, stage, city FROM organizations WHERE name LIKE ? OR city LIKE ? OR focus LIKE ? OR tags LIKE ? ORDER BY updated_at DESC LIMIT 8",
    )
    .all(like, like, like, like);
  const topics = db
    .prepare(
      "SELECT id, title, kind, stage, area, counterpart FROM topics WHERE title LIKE ? OR description LIKE ? OR counterpart LIKE ? OR area LIKE ? ORDER BY stage IN ('erledigt','verworfen'), updated_at DESC LIMIT 6",
    )
    .all(like, like, like, like);
  const people = (
    db
      .prepare(
        "SELECT * FROM users WHERE status = 'active' AND (name LIKE ? OR title LIKE ? OR responsibilities LIKE ? OR email LIKE ?) LIMIT 6",
      )
      .all(like, like, like, like) as UserRow[]
  ).map(toPublicUser);
  return c.json({ tasks, news, contacts, milestones, people, orgs, topics });
});

/* ---------- Content translation (interface language) ---------- */

miscRoutes.post("/translate", async (c) => {
  const deps = c.get("deps");
  const me = c.get("user");
  const p = await body(
    c,
    z.object({
      lang: z.enum(["en", "de"]),
      texts: z.array(z.string().max(MAX_TEXT_CHARS)).min(1).max(MAX_TEXTS),
    }),
  );
  if (
    !deps.limiter.take(
      `translate:${me.id}`,
      deps.config.TRANSLATE_HOURLY_LIMIT,
      3600_000,
    )
  ) {
    throw new HttpError(429, "rate limited", "rate_limited");
  }
  const translations = await translateTexts(deps, p.texts, p.lang);
  return c.json({ translations });
});
