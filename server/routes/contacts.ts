import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Ctx } from "../context.js";
import { parseJson } from "../db/index.js";
import { audit, notify } from "../lib/audit.js";
import { body, forbidden, HttpError, notFound, query, zDate, zId, zMsg, zText } from "../lib/http.js";
import { lazyLabels, newId } from "../lib/util.js";
import { mapTask, taskSelect, type TaskRow } from "./tasks.js";
import { tr } from "../lib/i18n.js";
import type { OrgKind } from "./orgs.js";

export const contactRoutes = new Hono<AppEnv>();

export const CONTACT_CATEGORIES = ["investor", "partner", "kunde", "bewerber", "stakeholder", "sonstige"] as const;
export const STAGES: Record<(typeof CONTACT_CATEGORIES)[number], string[]> = {
  investor: ["Recherche", "Kontaktiert", "Im Gespräch", "Due Diligence", "Commitment", "Investiert", "Pausiert", "Abgesagt"],
  partner: ["Kontakt", "In Abstimmung", "Aktiv", "Ruhend"],
  // Early users, beta testers and customers of the nalpia app
  kunde: ["Lead", "Kontaktiert", "Erstgespräch", "Onboarding", "Aktiv", "Pausiert", "Verloren"],
  bewerber: ["Eingang", "Interview", "Angebot", "Eingestellt", "Abgesagt"],
  stakeholder: ["Kontakt", "Geplant", "Aktiv", "Wartet", "Erledigt", "Ruhend"],
  sonstige: ["Offen", "Aktiv", "Archiv"],
};

/** Contact stages are stored as the German strings above (ids) – these are their display labels (translated per request). */
export const STAGE_LABELS: Record<string, string> = lazyLabels<string>({
  Recherche: ["Research", "Recherche"],
  Kontaktiert: ["Contacted", "Kontaktiert"],
  "Im Gespräch": ["In talks", "Im Gespräch"],
  "Due Diligence": ["Due diligence", "Due Diligence"],
  Commitment: ["Commitment", "Commitment"],
  Investiert: ["Invested", "Investiert"],
  Pausiert: ["Paused", "Pausiert"],
  Abgesagt: ["Declined", "Abgesagt"],
  Lead: ["Lead", "Lead"],
  Erstgespräch: ["First meeting", "Erstgespräch"],
  Angebot: ["Proposal", "Angebot"],
  Onboarding: ["Onboarding", "Onboarding"],
  Aktiv: ["Active", "Aktiv"],
  Verloren: ["Lost", "Verloren"],
  Kontakt: ["Contact", "Kontakt"],
  "In Abstimmung": ["In discussion", "In Abstimmung"],
  Ruhend: ["Dormant", "Ruhend"],
  Eingang: ["Received", "Eingang"],
  Interview: ["Interview", "Interview"],
  Eingestellt: ["Hired", "Eingestellt"],
  Geplant: ["Planned", "Geplant"],
  Wartet: ["Waiting", "Wartet"],
  Erledigt: ["Done", "Erledigt"],
  Offen: ["Open", "Offen"],
  Archiv: ["Archive", "Archiv"],
});
export const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage;

/** Display labels for the contact categories (ids stay unchanged). */
export const CATEGORY_LABELS: Record<(typeof CONTACT_CATEGORIES)[number], string> = lazyLabels({
  investor: ["Investor", "Investor"],
  partner: ["Partner", "Partner"],
  kunde: ["User / customer", "Nutzer / Kunde"],
  bewerber: ["Applicant", "Bewerber"],
  stakeholder: ["Stakeholder", "Stakeholder"],
  sonstige: ["Other", "Sonstige"],
});

interface ContactRow {
  id: string;
  name: string;
  email: string;
  company: string;
  position: string;
  category: (typeof CONTACT_CATEGORIES)[number];
  stage: string;
  owner_id: string | null;
  phone: string;
  linkedin: string;
  tags: string;
  notes: string;
  next_step: string;
  next_date: string | null;
  last_contact_at: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  organization_id: string | null;
  org_name?: string | null;
  org_kind?: OrgKind | null;
  open_tasks?: number;
  fit_score?: number | null;
}

function mapContact(r: ContactRow) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    company: r.company,
    position: r.position,
    category: r.category,
    stage: r.stage,
    ownerId: r.owner_id,
    phone: r.phone,
    linkedin: r.linkedin,
    tags: parseJson<string[]>(r.tags, []),
    notes: r.notes,
    nextStep: r.next_step,
    nextDate: r.next_date,
    lastContactAt: r.last_contact_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    openTasks: r.open_tasks ?? 0,
    organizationId: r.organization_id,
    organizationName: r.org_name ?? null,
    organizationKind: r.org_kind ?? null,
    fitScore: r.fit_score ?? null,
  };
}

const select = `SELECT c.*, og.name AS org_name, og.kind AS org_kind,
  (SELECT COUNT(*) FROM tasks t WHERE t.contact_id = c.id AND t.status != 'erledigt') AS open_tasks
  FROM contacts c LEFT JOIN organizations og ON og.id = c.organization_id`;

const input = z.object({
  name: zText(120).min(1, zMsg("Please enter a name.", "Bitte gib einen Namen ein.")),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().pipe(z.email(zMsg("Invalid email address", "Ungültige E-Mail-Adresse")))]).optional(),
  company: zText(120).optional(),
  position: zText(120).optional(),
  category: z.enum(CONTACT_CATEGORIES).optional(),
  stage: zText(40).optional(),
  ownerId: zId.nullable().optional(),
  phone: zText(40).optional(),
  linkedin: z
    .union([z.literal(""), z.string().trim().max(300).refine((u) => /^https:\/\/[^\s/$.?#][^\s]*$/i.test(u), zMsg("Please enter a complete https address", "Bitte eine vollständige https-Adresse angeben"))])
    .optional(),
  tags: z.array(zText(40).min(1)).max(20).optional(),
  notes: zText(20000).optional(),
  nextStep: zText(300).optional(),
  nextDate: zDate.nullable().optional(),
  organizationId: zId.nullable().optional(),
});

function orgOf(c: Ctx, id: string | null | undefined) {
  if (!id) return undefined;
  const o = c.get("deps").db.prepare("SELECT id, name, kind FROM organizations WHERE id = ?").get(id) as { id: string; name: string; kind: OrgKind } | undefined;
  if (!o) throw notFound(tr("Organization not found.", "Institution nicht gefunden."));
  return o;
}

function getContact(c: Ctx, id: string) {
  const row = c.get("deps").db.prepare(`${select} WHERE c.id = ?`).get(id) as ContactRow | undefined;
  if (!row) throw notFound(tr("This contact does not exist (anymore).", "Diesen Kontakt gibt es nicht (mehr)."));
  return row;
}

function validStage(category: keyof typeof STAGES, stage: string | undefined) {
  const list = STAGES[category];
  return stage && list.includes(stage) ? stage : list[0]!;
}

contactRoutes.get("/meta", (c) => c.json({ categories: CONTACT_CATEGORIES, stages: STAGES, stageLabels: STAGE_LABELS, categoryLabels: CATEGORY_LABELS }));

contactRoutes.get("/", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const q = query(
    c,
    z.object({
      q: z.string().max(100).optional(),
      category: z.enum(CONTACT_CATEGORIES).optional(),
      owner: z.string().max(64).optional(),
      stage: z.string().max(40).optional(),
      limit: z.coerce.number().int().min(1).max(5000).optional(),
    }),
  );
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.q) {
    where.push("(c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ? OR c.tags LIKE ?)");
    const like = `%${q.q}%`;
    args.push(like, like, like, like);
  }
  if (q.category) {
    where.push("c.category = ?");
    args.push(q.category);
  }
  if (q.owner) {
    where.push("c.owner_id = ?");
    args.push(q.owner === "me" ? me.id : q.owner);
  }
  if (q.stage) {
    where.push("c.stage = ?");
    args.push(q.stage);
  }
  const rows = db
    .prepare(`${select} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY c.updated_at DESC LIMIT ?`)
    .all(...args, q.limit ?? 5000) as ContactRow[];
  // Notes only in the detail view – keeps the list small with many contacts
  return c.json(rows.map((r) => ({ ...mapContact(r), notes: "" })));
});

/** Count per category (for the filter chips) */
contactRoutes.get("/counts", (c) => {
  const rows = c.get("deps").db.prepare("SELECT category, COUNT(*) AS n FROM contacts GROUP BY category").all() as { category: string; n: number }[];
  return c.json({ total: rows.reduce((a, r) => a + r.n, 0), byCategory: Object.fromEntries(rows.map((r) => [r.category, r.n])) });
});

/** Email address → contact mapping (for sender badges in Mail). */
contactRoutes.get("/lookup", (c) => {
  const { db } = c.get("deps");
  const raw = c.req.query("emails") ?? "";
  const emails = [...new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))].slice(0, 200);
  if (!emails.length) return c.json({});
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.email, c.company, c.category, c.stage, c.owner_id, c.organization_id, og.name AS org_name, og.kind AS org_kind
       FROM contacts c LEFT JOIN organizations og ON og.id = c.organization_id WHERE c.email IN (${emails.map(() => "?").join(",")})
       ORDER BY c.updated_at`,
    )
    .all(...emails) as Pick<ContactRow, "id" | "name" | "email" | "company" | "category" | "stage" | "owner_id" | "organization_id" | "org_name" | "org_kind">[];
  const out: Record<string, unknown> = {};
  for (const r of rows)
    out[r.email.toLowerCase()] = {
      id: r.id,
      name: r.name,
      company: r.company,
      category: r.category,
      stage: r.stage,
      ownerId: r.owner_id,
      organizationId: r.organization_id,
      organizationName: r.org_name ?? null,
      organizationKind: r.org_kind ?? null,
    };
  return c.json(out);
});

contactRoutes.post("/", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const parsed = await body(c, input);
  const org = orgOf(c, parsed.organizationId);
  // Contacts of an organization inherit its kind and name unless specified otherwise
  const p = { ...parsed, category: parsed.category ?? org?.kind ?? ("sonstige" as const), company: parsed.company || org?.name || "" };
  if (p.email) {
    const dup = db.prepare("SELECT id, name FROM contacts WHERE email = ?").get(p.email) as { id: string; name: string } | undefined;
    if (dup) throw new HttpError(409, tr(`This email address already belongs to “${dup.name}”.`, `Diese E-Mail-Adresse gehört bereits zu „${dup.name}“.`), "duplicate", { id: dup.id });
  }
  const id = newId();
  const now = Date.now();
  const owner = p.ownerId === undefined ? me.id : p.ownerId;
  db.prepare(
    `INSERT INTO contacts (id, name, email, company, position, category, stage, owner_id, phone, linkedin, tags, notes, next_step, next_date, organization_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    p.name,
    p.email ?? "",
    p.company ?? "",
    p.position ?? "",
    p.category,
    validStage(p.category, p.stage),
    owner,
    p.phone ?? "",
    p.linkedin ?? "",
    JSON.stringify(p.tags ?? []),
    p.notes ?? "",
    p.nextStep ?? "",
    p.nextDate ?? null,
    org?.id ?? null,
    me.id,
    now,
    now,
  );
  if (owner) notify(db, { userId: owner, actorId: me.id, kind: "contact.owner", title: () => tr(`${me.name} assigned the contact “${p.name}” to you`, `${me.name} hat dir den Kontakt „${p.name}“ zugeordnet`), link: `/kontakte/${id}` });
  return c.json(mapContact(getContact(c, id)), 201);
});

contactRoutes.get("/:id", (c) => {
  const { db } = c.get("deps");
  const ct = getContact(c, c.req.param("id"));
  const activities = (
    db
      .prepare("SELECT id, user_id, kind, body, mail_ref, created_at FROM contact_activities WHERE contact_id = ? ORDER BY created_at DESC LIMIT 300")
      .all(ct.id) as { id: string; user_id: string | null; kind: string; body: string; mail_ref: string | null; created_at: number }[]
  ).map((a) => ({ id: a.id, userId: a.user_id, kind: a.kind, body: a.body, mailRef: parseJson(a.mail_ref, null), createdAt: a.created_at }));
  const tasks = (db.prepare(`${taskSelect} WHERE t.contact_id = ? ORDER BY CASE t.status WHEN 'erledigt' THEN 1 ELSE 0 END, t.due_date IS NULL, t.due_date`).all(ct.id) as TaskRow[]).map(mapTask);
  return c.json({ ...mapContact(ct), activities, tasks });
});

contactRoutes.patch("/:id", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const before = getContact(c, c.req.param("id"));
  const p = await body(c, input.partial());
  orgOf(c, p.organizationId);
  if (p.email && p.email !== before.email) {
    const dup = db.prepare("SELECT name FROM contacts WHERE email = ? AND id != ?").get(p.email, before.id) as { name: string } | undefined;
    if (dup) throw new HttpError(409, tr(`This email address already belongs to “${dup.name}”.`, `Diese E-Mail-Adresse gehört bereits zu „${dup.name}“.`), "duplicate");
  }
  const category = p.category ?? before.category;
  const stage = p.stage !== undefined || p.category !== undefined ? validStage(category, p.stage ?? before.stage) : before.stage;
  const now = Date.now();
  db.prepare(
    `UPDATE contacts SET name = ?, email = ?, company = ?, position = ?, category = ?, stage = ?, owner_id = ?, phone = ?, linkedin = ?, tags = ?,
     notes = ?, next_step = ?, next_date = ?, organization_id = ?, updated_at = ? WHERE id = ?`,
  ).run(
    p.name ?? before.name,
    p.email ?? before.email,
    p.company ?? before.company,
    p.position ?? before.position,
    category,
    stage,
    p.ownerId === undefined ? before.owner_id : p.ownerId,
    p.phone ?? before.phone,
    p.linkedin ?? before.linkedin,
    p.tags ? JSON.stringify(p.tags) : before.tags,
    p.notes ?? before.notes,
    p.nextStep ?? before.next_step,
    p.nextDate === undefined ? before.next_date : p.nextDate,
    p.organizationId === undefined ? before.organization_id : p.organizationId,
    now,
    before.id,
  );
  if (stage !== before.stage) {
    db.prepare("INSERT INTO contact_activities (id, contact_id, user_id, kind, body, created_at) VALUES (?, ?, ?, 'status', ?, ?)").run(
      newId(),
      before.id,
      me.id,
      `Status: ${before.stage ? stageLabel(before.stage) : "–"} → ${stageLabel(stage)}`,
      now,
    );
  }
  if (p.ownerId && p.ownerId !== before.owner_id) {
    notify(db, { userId: p.ownerId, actorId: me.id, kind: "contact.owner", title: () => tr(`${me.name} assigned the contact “${p.name ?? before.name}” to you`, `${me.name} hat dir den Kontakt „${p.name ?? before.name}“ zugeordnet`), link: `/kontakte/${before.id}` });
  }
  return c.json(mapContact(getContact(c, before.id)));
});

contactRoutes.delete("/:id", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const ct = getContact(c, c.req.param("id"));
  if (me.role !== "admin" && ct.owner_id !== me.id && ct.created_by !== me.id) throw forbidden(tr("Only the owner or admins can delete contacts.", "Nur die zuständige Person oder Admins können Kontakte löschen."));
  db.prepare("DELETE FROM contacts WHERE id = ?").run(ct.id);
  audit(db, { userId: me.id, action: "contact.deleted", target: ct.id, ip: c.get("ip"), meta: { name: ct.name, company: ct.company } });
  return c.json({ ok: true });
});

const mailRef = z.object({ messageId: z.string().max(40), folderId: z.string().max(40), subject: zText(300), date: z.number().int().optional() });

contactRoutes.post("/:id/activities", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const ct = getContact(c, c.req.param("id"));
  const p = await body(
    c,
    z.object({ kind: z.enum(["notiz", "mail", "anruf", "meeting"]), body: zText(10000).min(1, zMsg("Please enter some text.", "Bitte gib einen Text ein.")), mailRef: mailRef.optional() }),
  );
  const id = newId();
  const now = Date.now();
  db.prepare("INSERT INTO contact_activities (id, contact_id, user_id, kind, body, mail_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    id,
    ct.id,
    me.id,
    p.kind,
    p.body,
    p.mailRef ? JSON.stringify({ ...p.mailRef, ownerId: me.id }) : null,
    now,
  );
  const touch = p.kind === "notiz" ? ct.last_contact_at : (p.mailRef?.date ?? now);
  db.prepare("UPDATE contacts SET last_contact_at = ?, updated_at = ? WHERE id = ?").run(touch, now, ct.id);
  return c.json({ id, userId: me.id, kind: p.kind, body: p.body, mailRef: p.mailRef ? { ...p.mailRef, ownerId: me.id } : null, createdAt: now }, 201);
});

contactRoutes.delete("/:id/activities/:aid", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const a = db.prepare("SELECT user_id FROM contact_activities WHERE id = ? AND contact_id = ?").get(c.req.param("aid"), c.req.param("id")) as
    | { user_id: string | null }
    | undefined;
  if (!a) throw notFound();
  if (a.user_id !== me.id && me.role !== "admin") throw forbidden();
  db.prepare("DELETE FROM contact_activities WHERE id = ?").run(c.req.param("aid"));
  return c.json({ ok: true });
});
