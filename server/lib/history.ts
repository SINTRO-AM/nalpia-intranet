import type { DB } from "../db/index.js";
import { parseJson } from "../db/index.js";
import { newId } from "./util.js";

/**
 * History entries for tasks (table task_comments) and topics (table topic_updates).
 * Events are stored as JSON with a type and from/to values and rendered in the
 * interface language on the client.
 *
 * Changes of the same kind by the same person within a few minutes are merged into the
 * latest entry of that kind (dragging a card back and forth does not flood the history). If a change is undone
 * within that window, the entry disappears.
 */

export type HistoryEvent =
  | { t: "status"; from: string; to: string }
  | { t: "assignee"; from: string | null; to: string | null }
  | { t: "due"; from: string | null; to: string | null }
  | { t: "priority"; from: string; to: string }
  | { t: "topic"; from: string | null; to: string | null }
  | { t: "stage"; from: string; to: string }
  | { t: "owner"; from: string | null; to: string | null }
  | { t: "follow_up"; from: string | null; to: string | null }
  | { t: "waiting"; from: string; to: string }
  | { t: "task_done"; taskId: string; title: string }
  | { t: "task_added"; taskId: string; title: string };

const MERGE_WINDOW = 10 * 60_000;
const MERGEABLE = new Set(["status", "assignee", "due", "priority", "topic", "stage", "owner", "follow_up", "waiting"]);

const TABLES = {
  task: { table: "task_comments", parent: "task_id" },
  topic: { table: "topic_updates", parent: "topic_id" },
} as const;

export function recordEvent(db: DB, target: keyof typeof TABLES, parentId: string, userId: string | null, ev: HistoryEvent, now = Date.now()) {
  const { table, parent } = TABLES[target];
  if (MERGEABLE.has(ev.t) && "from" in ev) {
    const last = db
      .prepare(`SELECT id, user_id, body, created_at FROM ${table} WHERE ${parent} = ? AND kind = 'event' AND json_extract(body, '$.t') = ? ORDER BY created_at DESC LIMIT 1`)
      .get(parentId, ev.t) as { id: string; user_id: string | null; body: string; created_at: number } | undefined;
    const prev = last ? parseJson<HistoryEvent | null>(last.body, null) : null;
    if (last && prev && prev.t === ev.t && "from" in prev && last.user_id === userId && now - last.created_at < MERGE_WINDOW) {
      if ((prev.from ?? null) === (ev.to ?? null)) {
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(last.id);
      } else {
        db.prepare(`UPDATE ${table} SET body = ?, created_at = ? WHERE id = ?`).run(JSON.stringify({ ...ev, from: prev.from }), now, last.id);
      }
      return;
    }
  }
  db.prepare(`INSERT INTO ${table} (id, ${parent}, user_id, kind, body, created_at) VALUES (?, ?, ?, 'event', ?, ?)`).run(newId(), parentId, userId, JSON.stringify(ev), now);
}

export interface HistoryRow {
  id: string;
  userId: string | null;
  kind: "comment" | "event";
  body: string;
  createdAt: number;
}

/** Comments and events of a task or topic, oldest first; events with their parsed payload. */
export function readHistory(db: DB, target: keyof typeof TABLES, parentId: string) {
  const { table, parent } = TABLES[target];
  const rows = db
    .prepare(`SELECT id, user_id AS userId, kind, body, created_at AS createdAt FROM ${table} WHERE ${parent} = ? ORDER BY created_at, rowid`)
    .all(parentId) as HistoryRow[];
  return {
    comments: rows.filter((r) => r.kind === "comment").map(({ kind: _k, ...r }) => r),
    events: rows.filter((r) => r.kind === "event").map((r) => ({ id: r.id, userId: r.userId, createdAt: r.createdAt, event: parseJson<HistoryEvent | null>(r.body, null) })).filter((r) => r.event),
  };
}
