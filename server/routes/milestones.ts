import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Ctx } from "../context.js";
import { audit, notify } from "../lib/audit.js";
import { body, forbidden, notFound, zDate, zId, zMsg, zText } from "../lib/http.js";
import { newId } from "../lib/util.js";
import { mapTask, taskSelect, type TaskRow } from "./tasks.js";
import { tr } from "../lib/i18n.js";

export const milestoneRoutes = new Hono<AppEnv>();

export interface MilestoneRow {
  id: string;
  title: string;
  description: string;
  owner_id: string | null;
  due_date: string | null;
  status: "geplant" | "aktiv" | "erreicht" | "verschoben";
  area: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  task_total: number;
  task_done: number;
}

export const milestoneSelect = `SELECT m.*, COUNT(t.id) AS task_total,
  COALESCE(SUM(CASE WHEN t.status = 'erledigt' THEN 1 ELSE 0 END), 0) AS task_done
  FROM milestones m LEFT JOIN tasks t ON t.milestone_id = m.id`;

export function mapMilestone(r: MilestoneRow) {
  const progress = r.status === "erreicht" ? 1 : r.task_total ? r.task_done / r.task_total : 0;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    ownerId: r.owner_id,
    dueDate: r.due_date,
    status: r.status,
    area: r.area,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    taskTotal: r.task_total,
    taskDone: r.task_done,
    progress,
  };
}

const input = z.object({
  title: zText(160).min(1, zMsg("Please enter a title.", "Bitte gib einen Titel ein.")),
  description: zText(6000).optional(),
  ownerId: zId.nullable().optional(),
  dueDate: zDate.nullable().optional(),
  status: z.enum(["geplant", "aktiv", "erreicht", "verschoben"]).optional(),
  area: zText(60).optional(),
});

function getMilestone(c: Ctx, id: string) {
  const row = c.get("deps").db.prepare(`${milestoneSelect} WHERE m.id = ? GROUP BY m.id`).get(id) as MilestoneRow | undefined;
  if (!row) throw notFound(tr("This milestone does not exist (anymore).", "Diesen Meilenstein gibt es nicht (mehr)."));
  return row;
}

milestoneRoutes.get("/", (c) => {
  const { db } = c.get("deps");
  const rows = db
    .prepare(
      `${milestoneSelect} GROUP BY m.id ORDER BY CASE m.status WHEN 'erreicht' THEN 1 ELSE 0 END, m.due_date IS NULL, m.due_date, m.created_at`,
    )
    .all() as MilestoneRow[];
  return c.json(rows.map(mapMilestone));
});

milestoneRoutes.post("/", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const p = await body(c, input);
  if (p.ownerId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active'").get(p.ownerId)) throw notFound(tr("Person not found.", "Person nicht gefunden."));
  const id = newId();
  const now = Date.now();
  const owner = p.ownerId === undefined ? me.id : p.ownerId;
  db.prepare(
    "INSERT INTO milestones (id, title, description, owner_id, due_date, status, area, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, p.title, p.description ?? "", owner, p.dueDate ?? null, p.status ?? "aktiv", p.area ?? "", me.id, now, now);
  if (owner) notify(db, { userId: owner, actorId: me.id, kind: "milestone.owner", title: () => tr(`${me.name} made you the owner of “${p.title}”`, `${me.name} hat dich als verantwortlich für „${p.title}“ eingetragen`), link: `/aufgaben/meilensteine/${id}` });
  return c.json(mapMilestone(getMilestone(c, id)), 201);
});

milestoneRoutes.get("/:id", (c) => {
  const { db } = c.get("deps");
  const m = getMilestone(c, c.req.param("id"));
  const tasks = (
    db
      .prepare(`${taskSelect} WHERE t.milestone_id = ? ORDER BY CASE t.status WHEN 'erledigt' THEN 1 ELSE 0 END, t.due_date IS NULL, t.due_date`)
      .all(m.id) as TaskRow[]
  ).map(mapTask);
  return c.json({ ...mapMilestone(m), tasks });
});

milestoneRoutes.patch("/:id", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const before = getMilestone(c, c.req.param("id"));
  const p = await body(c, input.partial());
  if (p.ownerId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active'").get(p.ownerId)) throw notFound(tr("Person not found.", "Person nicht gefunden."));
  db.prepare(
    "UPDATE milestones SET title = ?, description = ?, owner_id = ?, due_date = ?, status = ?, area = ?, updated_at = ? WHERE id = ?",
  ).run(
    p.title ?? before.title,
    p.description ?? before.description,
    p.ownerId === undefined ? before.owner_id : p.ownerId,
    p.dueDate === undefined ? before.due_date : p.dueDate,
    p.status ?? before.status,
    p.area ?? before.area,
    Date.now(),
    before.id,
  );
  if (p.ownerId && p.ownerId !== before.owner_id) {
    notify(db, { userId: p.ownerId, actorId: me.id, kind: "milestone.owner", title: () => tr(`${me.name} made you the owner of “${p.title ?? before.title}”`, `${me.name} hat dich als verantwortlich für „${p.title ?? before.title}“ eingetragen`), link: `/aufgaben/meilensteine/${before.id}` });
  }
  return c.json(mapMilestone(getMilestone(c, before.id)));
});

milestoneRoutes.delete("/:id", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const m = getMilestone(c, c.req.param("id"));
  if (me.role !== "admin" && m.created_by !== me.id && m.owner_id !== me.id) throw forbidden(tr("Only owners or admins can delete milestones.", "Nur Verantwortliche oder Admins können Meilensteine löschen."));
  db.prepare("DELETE FROM milestones WHERE id = ?").run(m.id);
  audit(db, { userId: me.id, action: "milestone.deleted", target: m.id, ip: c.get("ip"), meta: { title: m.title } });
  return c.json({ ok: true });
});
