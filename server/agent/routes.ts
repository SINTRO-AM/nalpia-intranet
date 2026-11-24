import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { parseJson } from "../db/index.js";
import { body, forbidden, HttpError, notFound, query, zId, zText } from "../lib/http.js";
import { tr } from "../lib/i18n.js";
import { BAY_AREA_CITIES, DEFAULT_SETTINGS } from "./defaults.js";
import type { MessageRow, OutreachRow } from "./service.js";

export const agentRoutes = new Hono<AppEnv>();

const OUTREACH_STATUSES = ["draft", "needs_note", "approved", "sent", "followup", "replied", "declined", "bounced", "paused", "discarded", "done"] as const;

function mapOutreach(r: OutreachRow & { org_name?: string; org_city?: string; org_country?: string; org_stage?: string; fit_score?: number | null; org_type?: string; pending?: number }) {
  return {
    id: r.id,
    orgId: r.org_id,
    orgName: r.org_name ?? "",
    orgCity: r.org_city ?? "",
    orgCountry: r.org_country ?? "",
    orgStage: r.org_stage ?? "",
    orgType: r.org_type ?? "",
    fitScore: r.fit_score ?? null,
    contactId: r.contact_id,
    ownerId: r.owner_id,
    status: r.status,
    lang: r.lang,
    toEmail: r.to_email,
    toName: r.to_name,
    subject: r.subject,
    personal: r.personal,
    body: r.body,
    research: r.research,
    quality: r.quality,
    sequenceStep: r.sequence_step,
    nextActionAt: r.next_action_at,
    sentAt: r.sent_at,
    repliedAt: r.replied_at,
    replyKind: r.reply_kind,
    replySummary: r.reply_summary,
    error: r.error,
    pendingMessages: r.pending ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapMessage(m: MessageRow) {
  return {
    id: m.id,
    outreachId: m.outreach_id,
    dir: m.dir,
    kind: m.kind,
    status: m.status,
    subject: m.subject,
    body: m.body,
    mailRef: parseJson<{ messageId: string; folderId: string; subject: string; date: number; ownerId: string } | null>(m.mail_ref, null),
    createdAt: m.created_at,
  };
}

const outreachSelect = `SELECT o.*, g.name AS org_name, g.city AS org_city, g.country AS org_country, g.stage AS org_stage, g.type AS org_type, g.fit_score,
  (SELECT COUNT(*) FROM agent_messages m WHERE m.outreach_id = o.id AND m.status = 'draft') AS pending
  FROM agent_outreach o JOIN organizations g ON g.id = o.org_id`;

const requireAdmin = (c: { get: (k: "user") => { role: string } }) => {
  if (c.get("user").role !== "admin") throw forbidden(tr("Only admins can control the agent.", "Nur Admins können den Agenten steuern."));
};

/* ---------- Status & settings ---------- */

agentRoutes.get("/status", (c) => c.json(c.get("deps").agent.status()));

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const settingsPatch = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["review", "autopilot"]).optional(),
  ownerEmail: z.string().trim().toLowerCase().max(254).optional(),
  dailyDrafts: z.number().int().min(1).max(100).optional(),
  dailyCap: z.number().int().min(1).max(200).optional(),
  maxOpen: z.number().int().min(1).max(2000).optional(),
  countries: z.array(z.string().trim().toUpperCase().length(2)).max(40).optional(),
  priorityCities: z.array(zText(60)).max(60).optional(),
  minFit: z.number().int().min(0).max(100).optional(),
  includePriorDeclined: z.boolean().optional(),
  onePerFirm: z.boolean().optional(),
  followUpDays: z.array(z.number().int().min(1).max(60)).max(4).optional(),
  sendWindow: z.object({ from: hhmm, to: hhmm, tz: zText(60).min(1) }).optional(),
  draftHour: z.number().int().min(0).max(23).optional(),
  workdaysOnly: z.boolean().optional(),
  autoReply: z.boolean().optional(),
  webResearch: z.boolean().optional(),
  subject: zText(200).min(1).optional(),
  bodyEn: zText(5000).optional(),
  bodyDe: zText(5000).optional(),
  yesReplyEn: zText(3000).optional(),
  yesReplyDe: zText(3000).optional(),
  passReplyEn: zText(3000).optional(),
  passReplyDe: zText(3000).optional(),
  deckUrl: zText(300).optional(),
  calendlyUrl: zText(300).optional(),
  playbook: zText(20000).optional(),
  styleProfile: zText(20000).optional(),
});

agentRoutes.patch("/settings", async (c) => {
  requireAdmin(c);
  const deps = c.get("deps");
  const p = await body(c, settingsPatch);
  if (p.ownerEmail) {
    const u = deps.db.prepare("SELECT 1 FROM users WHERE email = ? AND status = 'active'").get(p.ownerEmail);
    if (!u) throw new HttpError(422, tr("No active account with this e-mail address.", "Kein aktives Konto mit dieser E-Mail-Adresse."), "unknown_owner");
  }
  if (p.sendWindow) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: p.sendWindow.tz });
    } catch {
      throw new HttpError(422, tr("Unknown time zone.", "Unbekannte Zeitzone."), "invalid_tz");
    }
  }
  const s = deps.agent.saveSettings(p, c.get("user"), c.get("ip"));
  return c.json(s);
});

agentRoutes.get("/defaults", (c) => c.json({ ...DEFAULT_SETTINGS, bayArea: BAY_AREA_CITIES }));

/* ---------- Runs ---------- */

agentRoutes.post("/run", async (c) => {
  requireAdmin(c);
  const deps = c.get("deps");
  const p = await body(c, z.object({ kind: z.enum(["inbox", "followups", "drafts", "send", "all"]), wait: z.boolean().optional() }));
  const run = deps.agent.run(p.kind, { triggeredBy: c.get("user").id, force: true });
  if (p.wait) return c.json({ results: await run });
  run.catch((e) => console.error("[agent] run failed:", e));
  return c.json({ started: true });
});

agentRoutes.get("/runs", (c) => {
  const { db } = c.get("deps");
  const q = query(c, z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }));
  const rows = db.prepare("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?").all(q.limit ?? 50) as Record<string, unknown>[];
  return c.json(
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      triggeredBy: r.triggered_by,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      summary: r.summary,
      log: parseJson(r.log as string, []),
      counts: parseJson(r.counts as string, {}),
    })),
  );
});

agentRoutes.get("/candidates", (c) => {
  const deps = c.get("deps");
  const q = query(c, z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }));
  const list = deps.agent.candidates(q.limit ?? 20).map((x) => ({
    orgId: x.org.id,
    name: x.org.name,
    type: x.org.type,
    city: x.org.city,
    country: x.org.country,
    fitScore: x.org.fit_score,
    priority: x.org.priority,
    priorOutcome: x.org.prior_outcome,
    contact: { id: x.contact.id, name: x.contact.name, email: x.contact.email, position: x.contact.position },
  }));
  return c.json({ ...deps.agent.candidateCounts(), next: list });
});

/* ---------- Outreach ---------- */

agentRoutes.get("/outreach", (c) => {
  const { db } = c.get("deps");
  const q = query(
    c,
    z.object({
      status: z.string().max(200).optional(),
      q: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
    }),
  );
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.status) {
    const list = q.status.split(",").filter((s) => (OUTREACH_STATUSES as readonly string[]).includes(s));
    if (list.length) {
      where.push(`o.status IN (${list.map(() => "?").join(",")})`);
      args.push(...list);
    }
  }
  if (q.q) {
    const like = `%${q.q.replace(/[%_]/g, "")}%`;
    where.push("(g.name LIKE ? OR o.to_name LIKE ? OR o.to_email LIKE ? OR o.subject LIKE ?)");
    args.push(like, like, like, like);
  }
  const rows = db.prepare(`${outreachSelect} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY o.updated_at DESC LIMIT ?`).all(...args, q.limit ?? 300) as Parameters<typeof mapOutreach>[0][];
  return c.json(rows.map(mapOutreach));
});

/** Drafted replies and follow-ups waiting for a click (review mode) or for the sending window (autopilot) */
agentRoutes.get("/messages", (c) => {
  const { db } = c.get("deps");
  const q = query(c, z.object({ status: z.enum(["draft", "sent", "received", "discarded"]).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }));
  const rows = db
    .prepare(
      `SELECT m.*, o.to_name, o.to_email, o.org_id, g.name AS org_name, o.reply_kind, o.reply_summary
         FROM agent_messages m JOIN agent_outreach o ON o.id = m.outreach_id JOIN organizations g ON g.id = o.org_id
        WHERE ${q.status ? "m.status = ?" : "m.status = 'draft'"} AND m.dir = 'out' ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(...(q.status ? [q.status] : []), q.limit ?? 200) as (MessageRow & { to_name: string; to_email: string; org_id: string; org_name: string; reply_kind: string; reply_summary: string })[];
  return c.json(rows.map((m) => ({ ...mapMessage(m), toName: m.to_name, toEmail: m.to_email, orgId: m.org_id, orgName: m.org_name, replyKind: m.reply_kind, replySummary: m.reply_summary })));
});

agentRoutes.get("/outreach/:id", (c) => {
  const { db } = c.get("deps");
  const r = db.prepare(`${outreachSelect} WHERE o.id = ?`).get(c.req.param("id")) as Parameters<typeof mapOutreach>[0] | undefined;
  if (!r) throw notFound();
  const messages = (db.prepare("SELECT * FROM agent_messages WHERE outreach_id = ? ORDER BY created_at").all(r.id) as MessageRow[]).map(mapMessage);
  return c.json({ ...mapOutreach(r), messages });
});

agentRoutes.patch("/outreach/:id", async (c) => {
  const { db } = c.get("deps");
  const id = c.req.param("id");
  const o = db.prepare("SELECT * FROM agent_outreach WHERE id = ?").get(id) as OutreachRow | undefined;
  if (!o) throw notFound();
  const p = await body(c, z.object({ subject: zText(200).min(1).optional(), personal: zText(3000).optional(), body: zText(8000).min(1).optional(), lang: z.enum(["en", "de"]).optional(), toEmail: z.string().trim().toLowerCase().email().max(254).optional() }));
  if (!["draft", "needs_note", "approved"].includes(o.status)) throw new HttpError(409, tr("Only drafts can be edited.", "Nur Entwürfe können bearbeitet werden."), "not_editable");
  let bodyText = p.body ?? o.body;
  // Editing the personal paragraph alone swaps it inside the mail text
  if (p.personal !== undefined && p.body === undefined && o.personal && bodyText.includes(o.personal)) bodyText = bodyText.replace(o.personal, p.personal);
  if (p.personal !== undefined && p.body === undefined && !o.personal) bodyText = bodyText.replace("{personal}", p.personal);
  const personal = p.personal ?? o.personal;
  // A draft that received its personal note by hand becomes sendable
  const status = o.status === "needs_note" && personal.trim() ? "draft" : o.status;
  const now = Date.now();
  db.prepare("UPDATE agent_outreach SET subject = ?, personal = ?, body = ?, lang = ?, to_email = ?, status = ?, updated_at = ? WHERE id = ?").run(p.subject ?? o.subject, personal, bodyText, p.lang ?? o.lang, p.toEmail ?? o.to_email, status, now, id);
  if (status !== o.status) db.prepare("UPDATE organizations SET outreach_status = ?, updated_at = ? WHERE id = ?").run(status, now, o.org_id);
  const r = db.prepare(`${outreachSelect} WHERE o.id = ?`).get(id) as Parameters<typeof mapOutreach>[0];
  return c.json(mapOutreach(r));
});

agentRoutes.post("/outreach/:id/send", async (c) => {
  const deps = c.get("deps");
  const r = await deps.agent.sendOutreach(c.req.param("id"), c.get("user"), { force: true }).catch((e) => {
    throw new HttpError(409, (e as Error).message, "send_failed");
  });
  return c.json(mapOutreach(deps.db.prepare(`${outreachSelect} WHERE o.id = ?`).get(r.id) as Parameters<typeof mapOutreach>[0]));
});

agentRoutes.post("/outreach/:id/regenerate", async (c) => {
  const deps = c.get("deps");
  const p = await body(c, z.object({ instruction: zText(1000).optional() }).optional().default({}));
  const r = await deps.agent.regenerate(c.req.param("id"), c.get("user"), p?.instruction).catch((e) => {
    throw new HttpError(409, (e as Error).message, "regenerate_failed");
  });
  return c.json(mapOutreach(deps.db.prepare(`${outreachSelect} WHERE o.id = ?`).get(r.id) as Parameters<typeof mapOutreach>[0]));
});

agentRoutes.post("/outreach/:id/status", async (c) => {
  const deps = c.get("deps");
  const p = await body(c, z.object({ status: z.enum(["paused", "discarded", "done", "draft", "approved"]) }));
  try {
    deps.agent.setOutreachStatus(c.req.param("id"), p.status, c.get("user"));
  } catch (e) {
    throw new HttpError(409, (e as Error).message, "status_failed");
  }
  return c.json({ ok: true });
});

/** Start outreach for one organization by hand */
agentRoutes.post("/outreach", async (c) => {
  const deps = c.get("deps");
  const p = await body(c, z.object({ orgId: zId, contactId: zId.nullable().optional() }));
  const r = await deps.agent.draftForOrg(p.orgId, p.contactId ?? null, c.get("user")).catch((e) => {
    throw new HttpError(409, (e as Error).message, "draft_failed");
  });
  return c.json(mapOutreach(deps.db.prepare(`${outreachSelect} WHERE o.id = ?`).get(r.id) as Parameters<typeof mapOutreach>[0]), 201);
});

/* ---------- Messages (replies, follow-ups) ---------- */

agentRoutes.patch("/messages/:id", async (c) => {
  const { db } = c.get("deps");
  const m = db.prepare("SELECT * FROM agent_messages WHERE id = ?").get(c.req.param("id")) as MessageRow | undefined;
  if (!m) throw notFound();
  if (m.status !== "draft") throw new HttpError(409, tr("Only drafts can be edited.", "Nur Entwürfe können bearbeitet werden."), "not_editable");
  const p = await body(c, z.object({ subject: zText(200).optional(), body: zText(8000).min(1).optional() }));
  db.prepare("UPDATE agent_messages SET subject = ?, body = ? WHERE id = ?").run(p.subject ?? m.subject, p.body ?? m.body, m.id);
  return c.json(mapMessage(db.prepare("SELECT * FROM agent_messages WHERE id = ?").get(m.id) as MessageRow));
});

agentRoutes.post("/messages/:id/send", async (c) => {
  const deps = c.get("deps");
  const m = await deps.agent.sendMessage(c.req.param("id"), c.get("user"), { force: true }).catch((e) => {
    throw new HttpError(409, (e as Error).message, "send_failed");
  });
  return c.json(mapMessage(m));
});

agentRoutes.post("/messages/:id/discard", (c) => {
  const { db } = c.get("deps");
  const r = db.prepare("UPDATE agent_messages SET status = 'discarded' WHERE id = ? AND status = 'draft'").run(c.req.param("id"));
  if (!r.changes) throw notFound();
  return c.json({ ok: true });
});
