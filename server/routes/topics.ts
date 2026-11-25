import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import type { DB } from "../db/index.js";
import { audit, notify } from "../lib/audit.js";
import { readHistory, recordEvent } from "../lib/history.js";
import { body, forbidden, notFound, query, zDate, zId, zMsg, zText } from "../lib/http.js";
import { tr } from "../lib/i18n.js";
import { newId, todayISO } from "../lib/util.js";
import type { OrgKind } from "./orgs.js";
import { mapTask, taskSelect, type TaskRow } from "./tasks.js";

/**
 * Topics: internal and external matters that run over weeks – a funding application,
 * a partner talk, the architecture rebuild. They move through a pipeline
 * (idea → planned → in progress → waiting → done), bundle tasks and show
 * who they are waiting on and when to follow up.
 */
export const topicRoutes = new Hono<AppEnv>();

export const TOPIC_STAGES = ["idee", "geplant", "in_arbeit", "wartet", "erledigt", "verworfen"] as const;
export type TopicStage = (typeof TOPIC_STAGES)[number];
const CLOSED: TopicStage[] = ["erledigt", "verworfen"];

export interface TopicRow {
  id: string;
  title: string;
  description: string;
  kind: "intern" | "extern";
  stage: TopicStage;
  area: string;
  owner_id: string | null;
  organization_id: string | null;
  counterpart: string;
  waiting_on: string;
  waiting_since: number | null;
  next_step: string;
  follow_up: string | null;
  due_date: string | null;
  sort_order: number;
  external_ref: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  org_name: string | null;
  org_kind: OrgKind | null;
  task_total: number;
  task_done: number;
  task_overdue: number;
  next_task_id: string | null;
  next_task_title: string | null;
  next_task_due: string | null;
  next_task_assignee: string | null;
  comment_count: number;
  last_activity: number | null;
}

/** One query for lists: counts, the next open task (earliest due date) and the last activity. */
export const topicSelect = (today: string) => `SELECT tp.*, og.name AS org_name, og.kind AS org_kind,
  (SELECT COUNT(*) FROM tasks t WHERE t.topic_id = tp.id) AS task_total,
  (SELECT COUNT(*) FROM tasks t WHERE t.topic_id = tp.id AND t.status = 'erledigt') AS task_done,
  (SELECT COUNT(*) FROM tasks t WHERE t.topic_id = tp.id AND t.status != 'erledigt' AND t.due_date < '${today}') AS task_overdue,
  nt.id AS next_task_id, nt.title AS next_task_title, nt.due_date AS next_task_due, nt.assignee_id AS next_task_assignee,
  (SELECT COUNT(*) FROM topic_updates u WHERE u.topic_id = tp.id AND u.kind = 'comment') AS comment_count,
  (SELECT MAX(u.created_at) FROM topic_updates u WHERE u.topic_id = tp.id) AS last_activity
  FROM topics tp
  LEFT JOIN organizations og ON og.id = tp.organization_id
  LEFT JOIN tasks nt ON nt.id = (
    SELECT t.id FROM tasks t WHERE t.topic_id = tp.id AND t.status != 'erledigt'
    ORDER BY t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'hoch' THEN 0 WHEN 'mittel' THEN 1 ELSE 2 END, t.created_at LIMIT 1)`;

export function mapTopic(r: TopicRow) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    kind: r.kind,
    stage: r.stage,
    area: r.area,
    ownerId: r.owner_id,
    organizationId: r.organization_id,
    organizationName: r.org_name,
    organizationKind: r.org_kind,
    counterpart: r.counterpart,
    waitingOn: r.waiting_on,
    waitingSince: r.waiting_since,
    nextStep: r.next_step,
    followUp: r.follow_up,
    dueDate: r.due_date,
    sortOrder: r.sort_order,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    closedAt: r.closed_at,
    taskTotal: r.task_total,
    taskDone: r.task_done,
    taskOverdue: r.task_overdue,
    nextTask: r.next_task_id ? { id: r.next_task_id, title: r.next_task_title ?? "", dueDate: r.next_task_due, assigneeId: r.next_task_assignee } : null,
    commentCount: r.comment_count,
    lastActivity: Math.max(r.last_activity ?? 0, r.updated_at),
  };
}

const input = z.object({
  title: zText(200).min(1, zMsg("Please enter a title.", "Bitte gib einen Titel ein.")),
  description: zText(8000).optional(),
  kind: z.enum(["intern", "extern"]).optional(),
  stage: z.enum(TOPIC_STAGES).optional(),
  area: zText(60).optional(),
  ownerId: zId.nullable().optional(),
  organizationId: zId.nullable().optional(),
  counterpart: zText(160).optional(),
  waitingOn: zText(300).optional(),
  nextStep: zText(300).optional(),
  followUp: zDate.nullable().optional(),
  dueDate: zDate.nullable().optional(),
  sortOrder: z.number().finite().optional(),
});
type TopicInput = z.infer<typeof input>;

function assertRefs(db: DB, p: Partial<TopicInput>) {
  if (p.ownerId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND status != 'disabled'").get(p.ownerId)) {
    throw notFound(tr("This person does not exist.", "Diese Person gibt es nicht."));
  }
  if (p.organizationId && !db.prepare("SELECT 1 FROM organizations WHERE id = ?").get(p.organizationId)) {
    throw notFound(tr("Organization not found.", "Institution nicht gefunden."));
  }
}

export function getTopicRow(db: DB, id: string) {
  const row = db.prepare(`${topicSelect(todayISO())} WHERE tp.id = ?`).get(id) as TopicRow | undefined;
  if (!row) throw notFound(tr("This topic does not exist (anymore).", "Dieses Thema gibt es nicht (mehr)."));
  return row;
}

topicRoutes.get("/", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const q = query(
    c,
    z.object({
      kind: z.enum(["intern", "extern"]).optional(),
      state: z.enum(["open", "closed", "all", "board"]).optional(),
      owner: z.string().max(64).optional(),
      area: z.string().max(60).optional(),
      q: z.string().max(100).optional(),
    }),
  );
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.kind) {
    where.push("tp.kind = ?");
    args.push(q.kind);
  }
  const state = q.state ?? "board";
  if (state === "open") where.push("tp.stage NOT IN ('erledigt','verworfen')");
  if (state === "closed") where.push("tp.stage IN ('erledigt','verworfen')");
  // Board: everything open plus what was finished in the last 30 days
  if (state === "board") {
    where.push("(tp.stage NOT IN ('erledigt','verworfen') OR (tp.stage = 'erledigt' AND tp.closed_at > ?))");
    args.push(Date.now() - 30 * 86400_000);
  }
  if (q.owner === "me") {
    where.push("tp.owner_id = ?");
    args.push(me.id);
  } else if (q.owner && q.owner !== "all") {
    where.push("tp.owner_id = ?");
    args.push(q.owner);
  }
  if (q.area) {
    where.push("tp.area = ?");
    args.push(q.area);
  }
  if (q.q) {
    where.push("(tp.title LIKE ? OR tp.description LIKE ? OR tp.counterpart LIKE ? OR tp.area LIKE ?)");
    args.push(...Array(4).fill(`%${q.q}%`));
  }
  const rows = db
    .prepare(
      `${topicSelect(todayISO())} ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY tp.sort_order, tp.created_at`,
    )
    .all(...args) as TopicRow[];
  return c.json(rows.map(mapTopic));
});

/** Areas in use (for filters and suggestions). */
topicRoutes.get("/areas", (c) => {
  const { db } = c.get("deps");
  const rows = db.prepare("SELECT area, COUNT(*) AS n FROM topics WHERE area != '' GROUP BY area ORDER BY n DESC, area").all() as { area: string; n: number }[];
  return c.json(rows.map((r) => r.area));
});

topicRoutes.post("/", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const p = await body(c, input);
  assertRefs(db, p);
  const id = newId();
  const now = Date.now();
  const stage = p.stage ?? "geplant";
  // New cards go to the top of their column
  const minSort = (db.prepare("SELECT MIN(sort_order) AS m FROM topics WHERE stage = ?").get(stage) as { m: number | null }).m;
  const owner = p.ownerId === undefined ? me.id : p.ownerId;
  db.prepare(
    `INSERT INTO topics (id, title, description, kind, stage, area, owner_id, organization_id, counterpart, waiting_on, waiting_since, next_step, follow_up, due_date, sort_order, created_by, created_at, updated_at, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    p.title,
    p.description ?? "",
    p.kind ?? (p.organizationId || p.counterpart ? "extern" : "intern"),
    stage,
    p.area ?? "",
    owner,
    p.organizationId ?? null,
    p.counterpart ?? "",
    p.waitingOn ?? "",
    stage === "wartet" ? now : null,
    p.nextStep ?? "",
    p.followUp ?? null,
    p.dueDate ?? null,
    p.sortOrder ?? (minSort === null ? now : minSort - 1000),
    me.id,
    now,
    now,
    CLOSED.includes(stage) ? now : null,
  );
  if (owner) notify(db, { userId: owner, actorId: me.id, kind: "topic.owner", title: () => tr(`${me.name} made you responsible for “${p.title}”`, `${me.name} hat dir das Thema „${p.title}“ übertragen`), link: `/themen?thema=${id}` });
  return c.json(mapTopic(getTopicRow(db, id)), 201);
});

topicRoutes.get("/:id", (c) => {
  const { db } = c.get("deps");
  const t = getTopicRow(db, c.req.param("id"));
  const tasks = (
    db
      .prepare(
        `${taskSelect} WHERE t.topic_id = ?
         ORDER BY t.status = 'erledigt', CASE t.status WHEN 'in_arbeit' THEN 0 WHEN 'offen' THEN 1 WHEN 'wartet' THEN 2 ELSE 3 END,
           t.due_date IS NULL, t.due_date, t.completed_at DESC, t.created_at`,
      )
      .all(t.id) as TaskRow[]
  ).map(mapTask);
  const h = readHistory(db, "topic", t.id);
  return c.json({ ...mapTopic(t), tasks, updates: h.comments, events: h.events });
});

topicRoutes.patch("/:id", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const before = getTopicRow(db, c.req.param("id"));
  const p = await body(c, input.partial());
  assertRefs(db, p);
  const now = Date.now();
  const stage = p.stage ?? before.stage;
  const ownerId = p.ownerId === undefined ? before.owner_id : p.ownerId;
  const followUp = p.followUp === undefined ? before.follow_up : p.followUp;
  const waitingOn = p.waitingOn ?? before.waiting_on;
  const waitingSince = stage === "wartet" ? (before.stage === "wartet" ? (before.waiting_since ?? now) : now) : null;
  const closedAt = CLOSED.includes(stage) ? (CLOSED.includes(before.stage) ? before.closed_at : now) : null;
  db.prepare(
    `UPDATE topics SET title = ?, description = ?, kind = ?, stage = ?, area = ?, owner_id = ?, organization_id = ?, counterpart = ?, waiting_on = ?,
     waiting_since = ?, next_step = ?, follow_up = ?, due_date = ?, sort_order = ?, updated_at = ?, closed_at = ? WHERE id = ?`,
  ).run(
    p.title ?? before.title,
    p.description ?? before.description,
    p.kind ?? before.kind,
    stage,
    p.area ?? before.area,
    ownerId,
    p.organizationId === undefined ? before.organization_id : p.organizationId,
    p.counterpart ?? before.counterpart,
    waitingOn,
    waitingSince,
    p.nextStep ?? before.next_step,
    followUp,
    p.dueDate === undefined ? before.due_date : p.dueDate,
    p.sortOrder ?? before.sort_order,
    now,
    closedAt,
    before.id,
  );
  const title = p.title ?? before.title;
  if (stage !== before.stage) recordEvent(db, "topic", before.id, me.id, { t: "stage", from: before.stage, to: stage }, now);
  if (ownerId !== before.owner_id) {
    recordEvent(db, "topic", before.id, me.id, { t: "owner", from: before.owner_id, to: ownerId }, now);
    if (ownerId) notify(db, { userId: ownerId, actorId: me.id, kind: "topic.owner", title: () => tr(`${me.name} made you responsible for “${title}”`, `${me.name} hat dir das Thema „${title}“ übertragen`), link: `/themen?thema=${before.id}` });
  }
  if (followUp !== before.follow_up) recordEvent(db, "topic", before.id, me.id, { t: "follow_up", from: before.follow_up, to: followUp }, now);
  if (stage === "wartet" && waitingOn && waitingOn !== before.waiting_on) recordEvent(db, "topic", before.id, me.id, { t: "waiting", from: before.waiting_on, to: waitingOn }, now);
  // Phase changes are worth knowing for the owner if someone else moves the topic
  if (stage !== before.stage && ownerId && ownerId === before.owner_id && ["wartet", "erledigt", "verworfen"].includes(stage)) {
    const label = stageLabel(stage);
    notify(db, { userId: ownerId, actorId: me.id, kind: "topic.stage", title: () => tr(`${me.name} moved “${title}” to ${label()}`, `${me.name} hat „${title}“ auf ${label()} gesetzt`), link: `/themen?thema=${before.id}` });
  }
  return c.json(mapTopic(getTopicRow(db, before.id)));
});

function stageLabel(s: TopicStage) {
  const m: Record<TopicStage, [string, string]> = {
    idee: ["Inbox", "Eingang"],
    geplant: ["Planned", "Geplant"],
    in_arbeit: ["In progress", "In Arbeit"],
    wartet: ["Waiting", "Wartet"],
    erledigt: ["Done", "Erledigt"],
    verworfen: ["Dropped", "Verworfen"],
  };
  return () => tr(m[s][0], m[s][1]);
}

topicRoutes.delete("/:id", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const t = getTopicRow(db, c.req.param("id"));
  if (me.role !== "admin" && t.created_by !== me.id && t.owner_id !== me.id) {
    throw forbidden(tr("Only the creator or the owner can delete this topic.", "Nur die erstellende oder verantwortliche Person kann dieses Thema löschen."));
  }
  // Tasks stay (they only lose the link)
  db.prepare("DELETE FROM topics WHERE id = ?").run(t.id);
  audit(db, { userId: me.id, action: "topic.deleted", target: t.id, ip: c.get("ip"), meta: { title: t.title, tasks: t.task_total } });
  return c.json({ ok: true });
});

topicRoutes.post("/:id/updates", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const t = getTopicRow(db, c.req.param("id"));
  const p = await body(c, z.object({ body: zText(4000).min(1, zMsg("Please write an update.", "Bitte schreibe ein Update.")) }));
  const id = newId();
  const now = Date.now();
  db.prepare("INSERT INTO topic_updates (id, topic_id, user_id, kind, body, created_at) VALUES (?, ?, ?, 'comment', ?, ?)").run(id, t.id, me.id, p.body, now);
  db.prepare("UPDATE topics SET updated_at = ? WHERE id = ?").run(now, t.id);
  for (const r of new Set([t.owner_id, t.created_by].filter((x): x is string => !!x))) {
    notify(db, { userId: r, actorId: me.id, kind: "topic.update", title: () => tr(`${me.name} posted an update on “${t.title}”`, `${me.name} hat ein Update zu „${t.title}“ geschrieben`), link: `/themen?thema=${t.id}` });
  }
  return c.json({ id, userId: me.id, body: p.body, createdAt: now }, 201);
});

topicRoutes.delete("/:id/updates/:uid", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const row = db.prepare("SELECT user_id FROM topic_updates WHERE id = ? AND topic_id = ? AND kind = 'comment'").get(c.req.param("uid"), c.req.param("id")) as
    | { user_id: string | null }
    | undefined;
  if (!row) throw notFound();
  if (row.user_id !== me.id && me.role !== "admin") throw forbidden();
  db.prepare("DELETE FROM topic_updates WHERE id = ?").run(c.req.param("uid"));
  return c.json({ ok: true });
});
