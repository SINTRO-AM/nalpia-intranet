import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Ctx } from "../context.js";
import { parseJson } from "../db/index.js";
import { audit, notify } from "../lib/audit.js";
import { body, forbidden, notFound, query, zDate, zId, zMsg, zText } from "../lib/http.js";
import { newId } from "../lib/util.js";
import { readHistory, recordEvent } from "../lib/history.js";
import type { DB } from "../db/index.js";
import type { UserRow } from "../context.js";
import { tr } from "../lib/i18n.js";
import type { OrgKind } from "./orgs.js";

export const taskRoutes = new Hono<AppEnv>();

export const TASK_STATUSES = ["offen", "in_arbeit", "wartet", "erledigt"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  created_by: string | null;
  due_date: string | null;
  priority: "hoch" | "mittel" | "niedrig";
  status: TaskStatus;
  milestone_id: string | null;
  topic_id: string | null;
  waiting_on: string;
  contact_id: string | null;
  organization_id: string | null;
  source_mail: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  milestone_title: string | null;
  topic_title: string | null;
  topic_kind: "intern" | "extern" | null;
  topic_stage: string | null;
  contact_name: string | null;
  contact_company: string | null;
  org_name: string | null;
  org_kind: OrgKind | null;
  comment_count: number;
}

export const taskSelect = `SELECT t.*, m.title AS milestone_title, tp.title AS topic_title, tp.kind AS topic_kind, tp.stage AS topic_stage,
  ct.name AS contact_name, ct.company AS contact_company, og.name AS org_name, og.kind AS org_kind,
  (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id AND tc.kind = 'comment') AS comment_count
  FROM tasks t LEFT JOIN milestones m ON m.id = t.milestone_id LEFT JOIN topics tp ON tp.id = t.topic_id
  LEFT JOIN contacts ct ON ct.id = t.contact_id LEFT JOIN organizations og ON og.id = t.organization_id`;

export interface SourceMail {
  ownerId: string;
  messageId: string;
  folderId: string;
  subject: string;
  from: string;
}

export function mapTask(r: TaskRow) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    assigneeId: r.assignee_id,
    createdBy: r.created_by,
    dueDate: r.due_date,
    priority: r.priority,
    status: r.status,
    milestoneId: r.milestone_id,
    milestoneTitle: r.milestone_title,
    topicId: r.topic_id,
    topicTitle: r.topic_title,
    topicKind: r.topic_kind,
    topicStage: r.topic_stage,
    waitingOn: r.waiting_on ?? "",
    contactId: r.contact_id,
    contactName: r.contact_name,
    contactCompany: r.contact_company,
    organizationId: r.organization_id,
    organizationName: r.org_name,
    organizationKind: r.org_kind,
    sourceMail: parseJson<SourceMail | null>(r.source_mail, null),
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    commentCount: r.comment_count,
  };
}

const sourceMailSchema = z.object({
  messageId: z.string().max(40),
  folderId: z.string().max(40),
  subject: zText(300),
  from: zText(300),
});

const taskInput = z.object({
  title: zText(200).min(1, zMsg("Please enter a title.", "Bitte gib einen Titel ein.")),
  description: zText(8000).optional(),
  assigneeId: zId.nullable().optional(),
  dueDate: zDate.nullable().optional(),
  priority: z.enum(["hoch", "mittel", "niedrig"]).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  milestoneId: zId.nullable().optional(),
  topicId: zId.nullable().optional(),
  waitingOn: zText(300).optional(),
  contactId: zId.nullable().optional(),
  organizationId: zId.nullable().optional(),
  sourceMail: sourceMailSchema.nullable().optional(),
  sortOrder: z.number().finite().optional(),
});

function assertRefs(c: Ctx, p: Partial<z.infer<typeof taskInput>>) {
  const { db } = c.get("deps");
  if (p.assigneeId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active'").get(p.assigneeId)) {
    throw notFound(tr("The assignee does not exist.", "Die zugewiesene Person gibt es nicht."));
  }
  if (p.milestoneId && !db.prepare("SELECT 1 FROM milestones WHERE id = ?").get(p.milestoneId)) throw notFound(tr("Milestone not found.", "Meilenstein nicht gefunden."));
  if (p.topicId && !db.prepare("SELECT 1 FROM topics WHERE id = ?").get(p.topicId)) throw notFound(tr("Topic not found.", "Thema nicht gefunden."));
  if (p.contactId && !db.prepare("SELECT 1 FROM contacts WHERE id = ?").get(p.contactId)) throw notFound(tr("Contact not found.", "Kontakt nicht gefunden."));
  if (p.organizationId && !db.prepare("SELECT 1 FROM organizations WHERE id = ?").get(p.organizationId)) throw notFound(tr("Organization not found.", "Institution nicht gefunden."));
}

function getTask(c: Ctx, id: string) {
  const row = c.get("deps").db.prepare(`${taskSelect} WHERE t.id = ?`).get(id) as TaskRow | undefined;
  if (!row) throw notFound(tr("This task does not exist (anymore).", "Diese Aufgabe gibt es nicht (mehr)."));
  return row;
}

taskRoutes.get("/", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const q = query(
    c,
    z.object({
      assignee: z.string().max(64).optional(),
      status: z.enum(["open", "done", "all", "waiting"]).optional(),
      milestone: z.string().max(64).optional(),
      topic: z.string().max(64).optional(),
      contact: z.string().max(64).optional(),
      q: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
    }),
  );
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.assignee === "me") {
    where.push("t.assignee_id = ?");
    args.push(me.id);
  } else if (q.assignee === "none") {
    where.push("t.assignee_id IS NULL");
  } else if (q.assignee && q.assignee !== "all") {
    where.push("t.assignee_id = ?");
    args.push(q.assignee);
  }
  if (q.status === "open" || !q.status) where.push("t.status != 'erledigt'");
  if (q.status === "done") where.push("t.status = 'erledigt'");
  if (q.status === "waiting") where.push("t.status = 'wartet'");
  if (q.milestone) {
    where.push("t.milestone_id = ?");
    args.push(q.milestone);
  }
  if (q.topic === "none") where.push("t.topic_id IS NULL");
  else if (q.topic) {
    where.push("t.topic_id = ?");
    args.push(q.topic);
  }
  if (q.contact) {
    where.push("t.contact_id = ?");
    args.push(q.contact);
  }
  if (q.q) {
    where.push("(t.title LIKE ? OR t.description LIKE ?)");
    args.push(`%${q.q}%`, `%${q.q}%`);
  }
  const order =
    q.status === "done"
      ? "t.completed_at DESC"
      : "CASE t.status WHEN 'in_arbeit' THEN 0 WHEN 'offen' THEN 1 WHEN 'wartet' THEN 2 ELSE 3 END, t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'hoch' THEN 0 WHEN 'mittel' THEN 1 ELSE 2 END, t.sort_order, t.created_at";
  const rows = db
    .prepare(`${taskSelect} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT ?`)
    .all(...args, q.limit ?? 500) as TaskRow[];
  return c.json(rows.map(mapTask));
});

const topicTitle = (db: DB, id: string | null) =>
  id ? ((db.prepare("SELECT title FROM topics WHERE id = ?").get(id) as { title: string } | undefined)?.title ?? null) : null;

taskRoutes.post("/", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const p = await body(c, taskInput);
  assertRefs(c, p);
  const id = newId();
  const now = Date.now();
  const status = p.status ?? "offen";
  const source = p.sourceMail ? JSON.stringify({ ...p.sourceMail, ownerId: me.id }) : null;
  db.prepare(
    `INSERT INTO tasks (id, title, description, assignee_id, created_by, due_date, priority, status, milestone_id, topic_id, contact_id, organization_id, waiting_on, source_mail, sort_order, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    p.title,
    p.description ?? "",
    p.assigneeId === undefined ? me.id : p.assigneeId,
    me.id,
    p.dueDate ?? null,
    p.priority ?? "mittel",
    status,
    p.milestoneId ?? null,
    p.topicId ?? null,
    p.contactId ?? null,
    p.organizationId ?? null,
    p.waitingOn ?? "",
    source,
    p.sortOrder ?? now,
    now,
    now,
    status === "erledigt" ? now : null,
  );
  const assignee = p.assigneeId === undefined ? me.id : p.assigneeId;
  if (assignee) notify(db, { userId: assignee, actorId: me.id, kind: "task.assigned", title: () => tr(`${me.name} assigned “${p.title}” to you`, `${me.name} hat dir „${p.title}“ zugewiesen`), link: `/aufgaben?task=${id}` });
  if (p.contactId) db.prepare("UPDATE contacts SET updated_at = ? WHERE id = ?").run(now, p.contactId);
  if (p.topicId) {
    recordEvent(db, "topic", p.topicId, me.id, { t: "task_added", taskId: id, title: p.title }, now);
    db.prepare("UPDATE topics SET updated_at = ? WHERE id = ?").run(now, p.topicId);
  }
  return c.json(mapTask(getTask(c, id)), 201);
});

/** Bulk changes from the task list (several tasks at once). */
const bulkPatch = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: zId.nullable().optional(),
  dueDate: zDate.nullable().optional(),
  priority: z.enum(["hoch", "mittel", "niedrig"]).optional(),
  topicId: zId.nullable().optional(),
});

taskRoutes.post("/bulk", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const p = await body(c, z.object({ ids: z.array(zId).min(1).max(200), patch: bulkPatch }));
  if (!Object.keys(p.patch).length) return c.json({ updated: 0 });
  assertRefs(c, p.patch);
  const ids = [...new Set(p.ids)];
  const rows = db.prepare(`${taskSelect} WHERE t.id IN (${ids.map(() => "?").join(",")})`).all(...ids) as TaskRow[];
  const assigned = new Map<string, string[]>();
  db.transaction(() => {
    for (const before of rows) {
      const r = applyTaskPatch(db, me, before, p.patch, { notifyAssignee: false });
      if (r.newAssignee) assigned.set(r.newAssignee, [...(assigned.get(r.newAssignee) ?? []), before.title]);
    }
  })();
  for (const [userId, titles] of assigned) {
    notify(db, {
      userId,
      actorId: me.id,
      kind: "task.assigned",
      title: () =>
        titles.length === 1
          ? tr(`${me.name} assigned “${titles[0]}” to you`, `${me.name} hat dir „${titles[0]}“ zugewiesen`)
          : tr(`${me.name} assigned ${titles.length} tasks to you`, `${me.name} hat dir ${titles.length} Aufgaben zugewiesen`),
      link: "/aufgaben",
    });
  }
  return c.json({ updated: rows.length, tasks: (db.prepare(`${taskSelect} WHERE t.id IN (${ids.map(() => "?").join(",")})`).all(...ids) as TaskRow[]).map(mapTask) });
});

taskRoutes.get("/:id", (c) => {
  const { db } = c.get("deps");
  const t = getTask(c, c.req.param("id"));
  return c.json({ ...mapTask(t), ...readHistory(db, "task", t.id) });
});

type TaskPatch = Partial<z.infer<typeof taskInput>>;

/**
 * Applies a change to a task: writes it, records history (status, owner, due date, priority, topic),
 * and notifies the new owner and – when done – the creator.
 */
export function applyTaskPatch(db: DB, me: Pick<UserRow, "id" | "name">, before: TaskRow, p: TaskPatch, opts: { notifyAssignee?: boolean } = {}) {
  const now = Date.now();
  const status = p.status ?? before.status;
  const completedAt = status === "erledigt" ? (before.status === "erledigt" ? before.completed_at : now) : null;
  const assigneeId = p.assigneeId === undefined ? before.assignee_id : p.assigneeId;
  const dueDate = p.dueDate === undefined ? before.due_date : p.dueDate;
  const priority = p.priority ?? before.priority;
  const topicId = p.topicId === undefined ? before.topic_id : p.topicId;
  const waitingOn = p.waitingOn ?? before.waiting_on ?? "";
  db.prepare(
    `UPDATE tasks SET title = ?, description = ?, assignee_id = ?, due_date = ?, priority = ?, status = ?, milestone_id = ?, topic_id = ?, contact_id = ?,
     organization_id = ?, waiting_on = ?, sort_order = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
  ).run(
    p.title ?? before.title,
    p.description ?? before.description,
    assigneeId,
    dueDate,
    priority,
    status,
    p.milestoneId === undefined ? before.milestone_id : p.milestoneId,
    topicId,
    p.contactId === undefined ? before.contact_id : p.contactId,
    p.organizationId === undefined ? before.organization_id : p.organizationId,
    waitingOn,
    p.sortOrder ?? before.sort_order,
    now,
    completedAt,
    before.id,
  );
  const title = p.title ?? before.title;
  if (status !== before.status) recordEvent(db, "task", before.id, me.id, { t: "status", from: before.status, to: status }, now);
  if (assigneeId !== before.assignee_id) recordEvent(db, "task", before.id, me.id, { t: "assignee", from: before.assignee_id, to: assigneeId }, now);
  if (dueDate !== before.due_date) recordEvent(db, "task", before.id, me.id, { t: "due", from: before.due_date, to: dueDate }, now);
  if (priority !== before.priority) recordEvent(db, "task", before.id, me.id, { t: "priority", from: before.priority, to: priority }, now);
  if (topicId !== before.topic_id) recordEvent(db, "task", before.id, me.id, { t: "topic", from: before.topic_title, to: topicTitle(db, topicId) }, now);
  if (status === "wartet" && waitingOn !== (before.waiting_on ?? "") && waitingOn) recordEvent(db, "task", before.id, me.id, { t: "waiting", from: before.waiting_on ?? "", to: waitingOn }, now);
  if (topicId && status === "erledigt" && before.status !== "erledigt") {
    recordEvent(db, "topic", topicId, me.id, { t: "task_done", taskId: before.id, title }, now);
  }
  if (topicId && topicId !== before.topic_id) recordEvent(db, "topic", topicId, me.id, { t: "task_added", taskId: before.id, title }, now);
  if (topicId) db.prepare("UPDATE topics SET updated_at = ? WHERE id = ?").run(now, topicId);
  const newAssignee = assigneeId && assigneeId !== before.assignee_id && assigneeId !== me.id ? assigneeId : null;
  if (newAssignee && opts.notifyAssignee !== false) {
    notify(db, { userId: newAssignee, actorId: me.id, kind: "task.assigned", title: () => tr(`${me.name} assigned “${title}” to you`, `${me.name} hat dir „${title}“ zugewiesen`), link: `/aufgaben?task=${before.id}` });
  }
  if (status === "erledigt" && before.status !== "erledigt" && before.created_by) {
    notify(db, { userId: before.created_by, actorId: me.id, kind: "task.done", title: () => tr(`${me.name} completed “${title}”`, `${me.name} hat „${title}“ erledigt`), link: `/aufgaben?task=${before.id}` });
  }
  return { newAssignee };
}

taskRoutes.patch("/:id", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const before = getTask(c, c.req.param("id"));
  const p = await body(c, taskInput.partial());
  assertRefs(c, p);
  applyTaskPatch(db, me, before, p);
  return c.json(mapTask(getTask(c, before.id)));
});

taskRoutes.delete("/:id", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const t = getTask(c, c.req.param("id"));
  if (me.role !== "admin" && t.created_by !== me.id && t.assignee_id !== me.id) {
    throw forbidden(tr("Only the creator or the assignee can delete this task.", "Nur die erstellende oder zuständige Person kann diese Aufgabe löschen."));
  }
  db.prepare("DELETE FROM tasks WHERE id = ?").run(t.id);
  audit(db, { userId: me.id, action: "task.deleted", target: t.id, ip: c.get("ip"), meta: { title: t.title } });
  return c.json({ ok: true });
});

taskRoutes.post("/:id/comments", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const t = getTask(c, c.req.param("id"));
  const p = await body(c, z.object({ body: zText(4000).min(1, zMsg("Please write a comment.", "Bitte schreibe einen Kommentar.")) }));
  const id = newId();
  const now = Date.now();
  db.prepare("INSERT INTO task_comments (id, task_id, user_id, kind, body, created_at) VALUES (?, ?, ?, 'comment', ?, ?)").run(id, t.id, me.id, p.body, now);
  db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(now, t.id);
  const recipients = new Set([t.assignee_id, t.created_by].filter((x): x is string => !!x));
  for (const r of recipients) {
    notify(db, { userId: r, actorId: me.id, kind: "task.comment", title: () => tr(`${me.name} commented on “${t.title}”`, `${me.name} hat „${t.title}“ kommentiert`), link: `/aufgaben?task=${t.id}` });
  }
  return c.json({ id, userId: me.id, body: p.body, createdAt: now }, 201);
});

taskRoutes.delete("/:id/comments/:cid", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const row = db.prepare("SELECT user_id FROM task_comments WHERE id = ? AND task_id = ? AND kind = 'comment'").get(c.req.param("cid"), c.req.param("id")) as
    | { user_id: string }
    | undefined;
  if (!row) throw notFound();
  if (row.user_id !== me.id && me.role !== "admin") throw forbidden();
  db.prepare("DELETE FROM task_comments WHERE id = ?").run(c.req.param("cid"));
  return c.json({ ok: true });
});
