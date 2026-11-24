import { runWithLang } from "./i18n.js";
import crypto from "node:crypto";
import type { DB } from "../db/index.js";
import { newId } from "./util.js";

export interface AuditEntry {
  userId?: string | null;
  action: string;
  target?: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

function chainHash(prev: string, r: { ts: number; user_id: string | null; action: string; target: string; ip: string; meta: string }) {
  return crypto
    .createHash("sha256")
    .update([prev, r.ts, r.user_id ?? "", r.action, r.target, r.ip, r.meta].join("\u001f"))
    .digest("hex");
}

/**
 * Log of security-relevant events (append-only, no email content).
 * Every entry is chained to the previous one by hash – later changes or
 * deletions are detected by `cli.js verify-audit` (tamper-evident).
 */
export function audit(db: DB, e: AuditEntry) {
  const row = {
    ts: Date.now(),
    user_id: e.userId ?? null,
    action: e.action,
    target: e.target ?? "",
    ip: e.ip ?? "",
    meta: JSON.stringify(e.meta ?? {}),
  };
  db.transaction(() => {
    const prev = (db.prepare("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1").get() as { hash: string } | undefined)?.hash ?? "";
    db.prepare("INSERT INTO audit_log (ts, user_id, action, target, ip, meta, hash) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      row.ts,
      row.user_id,
      row.action,
      row.target,
      row.ip,
      row.meta,
      chainHash(prev, row),
    );
  })();
}

/** Verifies the log's hash chain. */
export function verifyAuditChain(db: DB): { ok: boolean; entries: number; brokenAtId?: number } {
  const rows = db.prepare("SELECT id, ts, user_id, action, target, ip, meta, hash FROM audit_log ORDER BY id").all() as {
    id: number;
    ts: number;
    user_id: string | null;
    action: string;
    target: string;
    ip: string;
    meta: string;
    hash: string;
  }[];
  let prev = "";
  for (const r of rows) {
    if (chainHash(prev, r) !== r.hash) return { ok: false, entries: rows.length, brokenAtId: r.id };
    prev = r.hash;
  }
  return { ok: true, entries: rows.length };
}

export interface NotifyInput {
  userId: string;
  actorId?: string | null;
  kind: string;
  /** A function returning tr(…) – it is called once per language, so each person reads it in their own */
  title: string | (() => string);
  link?: string;
}

/** Creates an in-app notification – never for the acting person themselves. */
export function notify(db: DB, n: NotifyInput) {
  if (!n.userId || n.userId === n.actorId) return;
  const target = db.prepare("SELECT status FROM users WHERE id = ?").get(n.userId) as { status: string } | undefined;
  if (!target || target.status === "disabled") return;
  const en = typeof n.title === "function" ? runWithLang("en", n.title) : n.title;
  const de = typeof n.title === "function" ? runWithLang("de", n.title) : null;
  db.prepare(
    "INSERT INTO notifications (id, user_id, actor_id, kind, title, title_de, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(newId(), n.userId, n.actorId ?? null, n.kind, en.slice(0, 240), de?.slice(0, 240) ?? null, n.link ?? "", Date.now());
}
