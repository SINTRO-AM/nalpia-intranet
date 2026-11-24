import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Ctx, Deps, UserRow } from "../context.js";
import { getSetting, parseJson, setSetting } from "../db/index.js";
import { audit, notify } from "../lib/audit.js";
import { normHeader, parseCsv, parseMio, toCsv } from "../lib/csv.js";
import { body, forbidden, HttpError, notFound, query, zDate, zId, zMsg, zText } from "../lib/http.js";
import { lazyLabels, newId } from "../lib/util.js";
import { mapTask, taskSelect, type TaskRow } from "./tasks.js";
import { orgDashboard } from "../lib/org-dashboard.js";
import { tr } from "../lib/i18n.js";
import { FIT_HIGH, FIT_MEDIUM, FOCUS_LABEL, STAGE_LABEL, fitPriority, fitReasonLabel, fitScore, guessFocusTags, guessStageFocus, rescoreInvestors } from "../lib/nalpia-fit.js";

export const orgRoutes = new Hono<AppEnv>();

/* ---------- Master data ---------- */

export const ORG_KINDS = ["investor", "partner"] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/** Organization types: id → [English, German] */
const ORG_TYPE_TEXT: Record<OrgKind, Record<string, readonly [string, string]>> = {
  investor: {
    vc: ["Venture Capital", "Venture Capital"],
    angel: ["Business Angel", "Business Angel"],
    syndikat: ["Angel network / syndicate", "Angel-Netzwerk / Syndikat"],
    cvc: ["Corporate VC", "Corporate VC"],
    family_office: ["Family Office", "Family Office"],
    accelerator: ["Accelerator / incubator", "Accelerator / Inkubator"],
    foerder: ["Development bank / public", "Förderbank / öffentlich"],
    allokator: ["Allocator / fund seeder", "Allokator / Fund-Seeder"],
    netzwerk: ["Network / intermediary", "Netzwerk / Vermittler"],
    sonstige: ["Other", "Sonstige"],
  },
  // Partners of the nalpia platform: where orders are executed, where data and distribution come from
  partner: {
    broker: ["Broker / neobroker", "Broker / Neobroker"],
    bank: ["Bank / custodian", "Bank / Depotbank"],
    exchange: ["Exchange / market infrastructure", "Börse / Marktinfrastruktur"],
    data: ["Data / API provider", "Daten- / API-Anbieter"],
    regulatory: ["Liability umbrella / regulatory", "Haftungsdach / Regulatorik"],
    accelerator: ["Accelerator / program", "Accelerator / Programm"],
    media: ["Media / community / distribution", "Medien / Community / Vertrieb"],
    tech: ["Technology partner", "Technologiepartner"],
    service: ["Legal / tax / service provider", "Recht / Steuern / Dienstleister"],
    sonstige: ["Other", "Sonstige"],
  },
};

/** Organization types: id → label in the language of the request */
export const ORG_TYPES: Record<OrgKind, Record<string, string>> = {
  investor: lazyLabels(ORG_TYPE_TEXT.investor),
  partner: lazyLabels(ORG_TYPE_TEXT.partner),
};

/** Thematic focus and stage focus of investors (ids → label in the language of the request) */
export const FOCUS_TAGS: Record<string, string> = lazyLabels(FOCUS_LABEL);
export const STAGE_FOCUS: Record<string, string> = lazyLabels(STAGE_LABEL);
export const FOCUS_IDS = Object.keys(FOCUS_LABEL);
export const STAGE_IDS = Object.keys(STAGE_LABEL);

/** What happened before nalpia (e.g. the SINTRO fundraising) – ids → label */
export const PRIOR_OUTCOMES: Record<string, string> = lazyLabels({
  "": ["No earlier contact", "Kein früherer Kontakt"],
  kontaktiert: ["Contacted (no reply)", "Kontaktiert (keine Antwort)"],
  antwort: ["Replied", "Hat geantwortet"],
  call: ["Call held", "Call geführt"],
  deck: ["Deck received", "Deck erhalten"],
  committed: ["Committed", "Zugesagt"],
  absage: ["Declined", "Abgesagt"],
  pausiert: ["Paused", "Pausiert"],
} as Record<string, readonly [string, string]>);

/** Outreach state the fundraising agent keeps per organization – ids → label */
export const OUTREACH_STATUS: Record<string, string> = lazyLabels({
  "": ["Not in outreach", "Nicht im Outreach"],
  draft: ["Draft to review", "Entwurf zur Prüfung"],
  needs_note: ["Needs a personal note", "Persönlicher Absatz fehlt"],
  approved: ["Approved – sending", "Freigegeben – wird gesendet"],
  sent: ["First mail sent", "Erstmail gesendet"],
  followup: ["Follow-up sent", "Follow-up gesendet"],
  replied: ["Replied", "Hat geantwortet"],
  declined: ["Declined", "Abgesagt"],
  bounced: ["Bounced", "Unzustellbar"],
  paused: ["Paused", "Pausiert"],
  done: ["Done", "Abgeschlossen"],
} as Record<string, readonly [string, string]>);

export interface StageDef {
  id: string;
  label: string;
  /** won (invested / committed / live) */
  won?: boolean;
  /** outside the active pipeline (declined, paused) */
  closed?: boolean;
  /** [English, German] label – for matching imports in either language (not serialized) */
  readonly labels?: readonly string[];
}

/** Stage with a label translated per request (enumerable getter, so it is serialized in /meta) */
function stageDef(id: string, en: string, de: string, flags: { won?: boolean; closed?: boolean } = {}): StageDef {
  const d = { id, get label() { return tr(en, de); }, ...flags } as StageDef;
  Object.defineProperty(d, "labels", { value: [en, de], enumerable: false });
  return d;
}

export const ORG_STAGES: Record<OrgKind, StageDef[]> = {
  investor: [
    stageDef("identifiziert", "Identified", "Identifiziert"),
    stageDef("kontaktiert", "Contacted", "Kontaktiert"),
    stageDef("gespraech", "First meeting", "Erstgespräch"),
    stageDef("pruefung", "Due diligence", "Due Diligence"),
    stageDef("termsheet", "Term sheet", "Term Sheet"),
    stageDef("zugesagt", "Committed", "Zugesagt", { won: true }),
    stageDef("investiert", "Invested", "Investiert", { won: true }),
    stageDef("pausiert", "Paused", "Pausiert", { closed: true }),
    stageDef("abgesagt", "Declined", "Abgesagt", { closed: true }),
  ],
  partner: [
    stageDef("identifiziert", "Identified", "Identifiziert"),
    stageDef("kontaktiert", "Contacted", "Kontaktiert"),
    stageDef("gespraech", "In talks", "Im Gespräch"),
    stageDef("pruefung", "Evaluation / pilot", "Prüfung / Pilot"),
    stageDef("vertrag", "Contract", "Vertrag"),
    stageDef("aktiv", "Live partner", "Aktiver Partner", { won: true }),
    stageDef("pausiert", "Paused", "Pausiert", { closed: true }),
    stageDef("abgesagt", "Declined", "Abgesagt", { closed: true }),
  ],
};

const stageLabel = (kind: OrgKind, id: string) => ORG_STAGES[kind].find((s) => s.id === id)?.label ?? id;
/** URL segment of each kind in the web app */
export const ORG_PATH: Record<OrgKind, string> = { investor: "investoren", partner: "partner" };
export const orgPath = (kind: OrgKind, id: string) => `/${ORG_PATH[kind] ?? "investoren"}/${id}`;

/* ---------- Data access ---------- */

export interface OrgRow {
  id: string;
  kind: OrgKind;
  name: string;
  type: string;
  stage: string;
  priority: "hoch" | "mittel" | "niedrig";
  priority_manual: number;
  owner_id: string | null;
  website: string;
  linkedin: string;
  city: string;
  country: string;
  aum_mio: number | null;
  potential_mio: number | null;
  ticket_min_mio: number | null;
  ticket_max_mio: number | null;
  committed_mio: number | null;
  probability: number | null;
  focus: string;
  focus_tags: string;
  stage_focus: string;
  region_focus: string;
  fit_score: number | null;
  fit_reasons: string;
  prior_outcome: string;
  history: string;
  outreach_status: string;
  outreach_at: number | null;
  source: string;
  tags: string;
  notes: string;
  next_step: string;
  next_date: string | null;
  last_contact_at: number | null;
  external_ref: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  contact_count: number;
  primary_contact: string | null;
  primary_email: string | null;
  open_tasks: number;
  contacts_last: number | null;
}

export const orgSelect = `SELECT o.*,
  (SELECT COUNT(*) FROM contacts ct WHERE ct.organization_id = o.id) AS contact_count,
  (SELECT ct.name FROM contacts ct WHERE ct.organization_id = o.id ORDER BY ct.email = '', ct.created_at LIMIT 1) AS primary_contact,
  (SELECT ct.email FROM contacts ct WHERE ct.organization_id = o.id AND ct.email != '' ORDER BY ct.created_at LIMIT 1) AS primary_email,
  (SELECT COUNT(*) FROM tasks t WHERE t.organization_id = o.id AND t.status != 'erledigt') AS open_tasks,
  (SELECT MAX(ct.last_contact_at) FROM contacts ct WHERE ct.organization_id = o.id) AS contacts_last
  FROM organizations o`;

export function mapOrg(r: OrgRow) {
  const last = Math.max(r.last_contact_at ?? 0, r.contacts_last ?? 0) || null;
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    type: r.type,
    stage: r.stage,
    priority: r.priority,
    priorityManual: !!r.priority_manual,
    ownerId: r.owner_id,
    website: r.website,
    linkedin: r.linkedin,
    city: r.city,
    country: r.country,
    aumMio: r.aum_mio,
    potentialMio: r.potential_mio,
    ticketMinMio: r.ticket_min_mio,
    ticketMaxMio: r.ticket_max_mio,
    committedMio: r.committed_mio,
    probability: r.probability,
    focus: r.focus,
    focusTags: parseJson<string[]>(r.focus_tags, []),
    stageFocus: parseJson<string[]>(r.stage_focus, []),
    regionFocus: r.region_focus,
    fitScore: r.fit_score,
    fitReasons: parseJson<string[]>(r.fit_reasons, []).map((code) => fitReasonLabel(code, (t) => ORG_TYPES[r.kind]?.[t] ?? t)),
    priorOutcome: r.prior_outcome,
    history: r.history,
    outreachStatus: r.outreach_status,
    outreachAt: r.outreach_at,
    source: r.source,
    tags: parseJson<string[]>(r.tags, []),
    notes: r.notes,
    nextStep: r.next_step,
    nextDate: r.next_date,
    lastContactAt: last,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    contactCount: r.contact_count,
    primaryContact: r.primary_contact,
    primaryEmail: r.primary_email,
    openTasks: r.open_tasks,
  };
}

export function getOrg(c: Ctx, id: string) {
  const row = c.get("deps").db.prepare(`${orgSelect} WHERE o.id = ?`).get(id) as OrgRow | undefined;
  if (!row) throw notFound(tr("This organization does not exist (anymore).", "Diese Organisation gibt es nicht (mehr)."));
  return row;
}

/** Recalculate the fit of one investor (after create/update) unless the priority was set by hand. */
export function refit(db: Deps["db"], id: string) {
  const r = db
    .prepare(
      `SELECT o.*, EXISTS (SELECT 1 FROM contacts ct WHERE ct.organization_id = o.id AND ct.email != '') AS has_email FROM organizations o WHERE o.id = ? AND o.kind = 'investor'`,
    )
    .get(id) as (OrgRow & { has_email: number }) | undefined;
  if (!r) return;
  const f = fitScore({
    type: r.type,
    focusTags: parseJson<string[]>(r.focus_tags, []),
    stageFocus: parseJson<string[]>(r.stage_focus, []),
    regionFocus: r.region_focus,
    ticketMinMio: r.ticket_min_mio,
    ticketMaxMio: r.ticket_max_mio,
    country: r.country,
    city: r.city,
    focus: r.focus,
    notes: r.notes,
    history: r.history,
    priorOutcome: r.prior_outcome,
    tags: parseJson<string[]>(r.tags, []),
    hasEmail: !!r.has_email,
  });
  db.prepare("UPDATE organizations SET fit_score = ?, fit_reasons = ?, priority = CASE WHEN priority_manual THEN priority ELSE ? END WHERE id = ?").run(
    f.score,
    JSON.stringify(f.reasons),
    fitPriority(f.score),
    id,
  );
}

/* ---------- Input ---------- */

const mio = z.number().finite().min(0, zMsg("Please enter a positive amount.", "Bitte einen positiven Betrag angeben.")).max(10_000_000).nullable().optional();
const url = (label: string) =>
  z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .max(300)
        .transform((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))
        .refine((u) => /^https:\/\/[^\s/$.?#][^\s]*$/i.test(u), { error: () => tr(`${label}: please enter a valid address`, `${label}: bitte eine gültige Adresse angeben`) }),
    ])
    .optional();

const input = z.object({
  kind: z.enum(ORG_KINDS),
  name: zText(160).min(1, zMsg("Please enter a name.", "Bitte gib einen Namen ein.")),
  type: zText(40).optional(),
  stage: zText(40).optional(),
  priority: z.enum(["hoch", "mittel", "niedrig"]).optional(),
  ownerId: zId.nullable().optional(),
  website: url("Website"),
  linkedin: url("LinkedIn"),
  city: zText(80).optional(),
  country: zText(80).optional(),
  aumMio: mio,
  potentialMio: mio,
  ticketMinMio: mio,
  ticketMaxMio: mio,
  committedMio: mio,
  probability: z.number().int().min(0).max(100).nullable().optional(),
  focus: zText(500).optional(),
  focusTags: z.array(z.enum(FOCUS_IDS as [string, ...string[]])).max(8).optional(),
  stageFocus: z.array(z.enum(STAGE_IDS as [string, ...string[]])).max(5).optional(),
  regionFocus: zText(160).optional(),
  priorOutcome: z.enum(Object.keys(PRIOR_OUTCOMES) as [string, ...string[]]).optional(),
  history: zText(2000).optional(),
  source: zText(160).optional(),
  tags: z.array(zText(40).min(1)).max(20).optional(),
  notes: zText(20000).optional(),
  nextStep: zText(300).optional(),
  nextDate: zDate.nullable().optional(),
});

const validType = (kind: OrgKind, t: string | undefined) => (t && t in ORG_TYPES[kind] ? t : "sonstige");
function validStage(kind: OrgKind, s: string | undefined) {
  if (s === undefined || s === "") return "identifiziert";
  if (!ORG_STAGES[kind].some((x) => x.id === s)) throw new HttpError(422, tr("Unknown status.", "Unbekannter Status."), "invalid_stage", { fields: { stage: tr("Unknown status", "Unbekannter Status") } });
  return s;
}

function assertOwner(db: Deps["db"], ownerId: string | null | undefined) {
  if (ownerId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active'").get(ownerId)) throw notFound(tr("The owner does not exist.", "Die zuständige Person gibt es nicht."));
}

/* ---------- Routes ---------- */

orgRoutes.get("/meta", (c) =>
  c.json({ types: ORG_TYPES, stages: ORG_STAGES, focusTags: FOCUS_TAGS, stageFocus: STAGE_FOCUS, priorOutcomes: PRIOR_OUTCOMES, outreachStatus: OUTREACH_STATUS }),
);

export interface RoundSetting {
  name: string;
  targetMio: number | null;
  /** Capital already committed that is not (yet) assigned to an organization in the intranet */
  committedExtraMio: number | null;
  preMoneyMio: number | null;
}
/** nalpia's first round: €500k pre-seed at €2.5m pre-money (angels and pre-seed funds) */
export const defaultRound: RoundSetting = {
  get name() {
    return tr("Pre-seed round", "Pre-Seed-Runde");
  },
  // Figures are maintained in the UI (Investors → Round); nothing is hard-coded here.
  targetMio: null,
  committedExtraMio: null,
  preMoneyMio: null,
};
export const getRound = (db: Deps["db"]): RoundSetting => ({ ...defaultRound, ...getSetting(db, "investor_round", defaultRound) });

orgRoutes.get("/round", (c) => c.json(getRound(c.get("deps").db)));

orgRoutes.patch("/round", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  if (me.role !== "admin") throw forbidden(tr("Only admins can change the funding round.", "Nur Admins können die Finanzierungsrunde ändern."));
  const p = await body(c, z.object({ name: zText(80).min(1).optional(), targetMio: mio, committedExtraMio: mio, preMoneyMio: mio }));
  const cur = getRound(db);
  const pick = <K extends keyof RoundSetting>(k: K) => (p[k] === undefined ? cur[k] : (p[k] as RoundSetting[K]));
  const next: RoundSetting = { name: pick("name"), targetMio: pick("targetMio"), committedExtraMio: pick("committedExtraMio"), preMoneyMio: pick("preMoneyMio") };
  setSetting(db, "investor_round", next);
  audit(db, { userId: me.id, action: "settings.investor_round", ip: c.get("ip"), meta: { ...next } });
  return c.json(next);
});

const listQuery = z.object({
  kind: z.enum(ORG_KINDS),
  q: z.string().max(100).optional(),
  stage: z.string().max(40).optional(),
  type: z.string().max(40).optional(),
  owner: z.string().max(64).optional(),
  priority: z.enum(["hoch", "mittel", "niedrig"]).optional(),
  /** investors: thematic focus id, stage focus id, country code, fit bucket, outreach status, earlier outcome */
  focus: z.string().max(40).optional(),
  stageFocus: z.string().max(40).optional(),
  country: z.string().max(8).optional(),
  fit: z.enum(["hoch", "mittel", "niedrig"]).optional(),
  outreach: z.string().max(40).optional(),
  prior: z.string().max(40).optional(),
});

function listWhere(q: z.infer<typeof listQuery>, meId: string) {
  const where = ["o.kind = ?"];
  const args: unknown[] = [q.kind];
  if (q.q) {
    const like = `%${q.q.replace(/[%_]/g, "")}%`;
    where.push(
      "(o.name LIKE ? OR o.city LIKE ? OR o.focus LIKE ? OR o.tags LIKE ? OR o.history LIKE ? OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.organization_id = o.id AND (ct.name LIKE ? OR ct.email LIKE ?)))",
    );
    args.push(like, like, like, like, like, like, like);
  }
  if (q.stage) {
    where.push("o.stage = ?");
    args.push(q.stage);
  }
  if (q.type) {
    where.push("o.type = ?");
    args.push(q.type);
  }
  if (q.owner) {
    where.push("o.owner_id = ?");
    args.push(q.owner === "me" ? meId : q.owner);
  }
  if (q.priority) {
    where.push("o.priority = ?");
    args.push(q.priority);
  }
  if (q.focus) {
    where.push("o.focus_tags LIKE ?");
    args.push(`%"${q.focus.replace(/[%"]/g, "")}"%`);
  }
  if (q.stageFocus) {
    where.push("o.stage_focus LIKE ?");
    args.push(`%"${q.stageFocus.replace(/[%"]/g, "")}"%`);
  }
  if (q.country) {
    where.push("upper(o.country) = ?");
    args.push(q.country.toUpperCase());
  }
  if (q.fit) {
    where.push(q.fit === "hoch" ? `o.fit_score >= ${FIT_HIGH}` : q.fit === "mittel" ? `o.fit_score >= ${FIT_MEDIUM} AND o.fit_score < ${FIT_HIGH}` : `(o.fit_score IS NULL OR o.fit_score < ${FIT_MEDIUM})`);
  }
  if (q.outreach !== undefined && q.outreach !== "") {
    where.push("o.outreach_status = ?");
    args.push(q.outreach === "none" ? "" : q.outreach);
  }
  if (q.prior !== undefined && q.prior !== "") {
    where.push("o.prior_outcome = ?");
    args.push(q.prior === "none" ? "" : q.prior);
  }
  return { where: where.join(" AND "), args };
}

orgRoutes.get("/", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const q = query(c, listQuery);
  const { where, args } = listWhere(q, me.id);
  const rows = db.prepare(`${orgSelect} WHERE ${where} ORDER BY o.updated_at DESC LIMIT 6000`).all(...args) as OrgRow[];
  // Notes and reasons only in the detail view – keeps the list small with thousands of organizations
  return c.json(rows.map((r) => ({ ...mapOrg({ ...r, fit_reasons: "[]" }), notes: "" })));
});

/** CSV export (Excel). Audited, because a lot of contact data leaves the system at once. */
orgRoutes.get("/export", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const { kind } = query(c, z.object({ kind: z.enum(ORG_KINDS) }));
  const orgs = db.prepare(`${orgSelect} WHERE o.kind = ? ORDER BY ${kind === "investor" ? "o.fit_score DESC," : ""} o.name COLLATE NOCASE`).all(kind) as OrgRow[];
  const users = new Map((db.prepare("SELECT id, name FROM users").all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  const contacts = db
    .prepare("SELECT organization_id, name, email, phone, position FROM contacts WHERE organization_id IN (SELECT id FROM organizations WHERE kind = ?) ORDER BY created_at")
    .all(kind) as { organization_id: string; name: string; email: string; phone: string; position: string }[];
  const byOrg = new Map<string, typeof contacts>();
  for (const ct of contacts) byOrg.set(ct.organization_id, [...(byOrg.get(ct.organization_id) ?? []), ct]);
  const inv = kind === "investor";
  const header = [
    "Name",
    tr("Type", "Typ"),
    "Status",
    tr("Priority", "Priorität"),
    ...(inv ? [tr("Fit for nalpia (0–100)", "Fit für nalpia (0–100)"), tr("Thematic focus", "Thematischer Fokus"), tr("Stage focus", "Phasenfokus"), tr("Regional focus", "Regionaler Fokus"), tr("Earlier outcome", "Früheres Ergebnis"), tr("History", "Vorgeschichte"), tr("Outreach", "Outreach")] : []),
    tr("Owner", "Zuständig"),
    tr("City", "Stadt"),
    tr("Country", "Land"),
    "Website",
    inv ? tr("Fund size (€m)", "Fondsgröße (Mio. €)") : tr("Volume (€m)", "Volumen (Mio. €)"),
    inv ? tr("Expected ticket (€m)", "Erwartetes Ticket (Mio. €)") : tr("Potential (€m)", "Potenzial (Mio. €)"),
    tr("Ticket min (€m)", "Ticket min (Mio. €)"),
    tr("Ticket max (€m)", "Ticket max (Mio. €)"),
    inv ? tr("Committed (€m)", "Zugesagt (Mio. €)") : tr("Contract value (€m)", "Vertragswert (Mio. €)"),
    tr("Probability (%)", "Wahrscheinlichkeit (%)"),
    tr("Focus", "Fokus"),
    tr("Source", "Quelle"),
    tr("Tags", "Schlagworte"),
    tr("Next step", "Nächster Schritt"),
    tr("Due", "Bis"),
    tr("Contact person", "Ansprechpartner"),
    tr("Email", "E-Mail"),
    tr("Phone", "Telefon"),
    "Position",
    tr("Other contacts", "Weitere Ansprechpartner"),
    tr("Notes", "Notizen"),
  ];
  const rows = orgs.map((o) => {
    const [first, ...rest] = byOrg.get(o.id) ?? [];
    return [
      o.name,
      ORG_TYPES[kind][o.type] ?? o.type,
      stageLabel(kind, o.stage),
      o.priority,
      ...(inv
        ? [
            o.fit_score,
            parseJson<string[]>(o.focus_tags, []).map((f) => FOCUS_TAGS[f] ?? f).join(", "),
            parseJson<string[]>(o.stage_focus, []).map((f) => STAGE_FOCUS[f] ?? f).join(", "),
            o.region_focus,
            PRIOR_OUTCOMES[o.prior_outcome] ?? o.prior_outcome,
            o.history,
            OUTREACH_STATUS[o.outreach_status] ?? o.outreach_status,
          ]
        : []),
      o.owner_id ? (users.get(o.owner_id) ?? "") : "",
      o.city,
      o.country,
      o.website,
      o.aum_mio,
      o.potential_mio,
      o.ticket_min_mio,
      o.ticket_max_mio,
      o.committed_mio,
      o.probability,
      o.focus,
      o.source,
      parseJson<string[]>(o.tags, []).join(", "),
      o.next_step,
      o.next_date,
      first?.name ?? "",
      first?.email ?? "",
      first?.phone ?? "",
      first?.position ?? "",
      rest.map((r) => [r.name, r.email].filter(Boolean).join(" ")).join(" | "),
      o.notes,
    ];
  });
  audit(db, { userId: me.id, action: "org.exported", ip: c.get("ip"), meta: { kind, rows: rows.length } });
  const date = new Date().toISOString().slice(0, 10);
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", `attachment; filename="nalpia-${ORG_PATH[kind]}-${date}.csv"`);
  return c.body(toCsv(header, rows));
});

/* ---------- CSV import ---------- */

const COLS: Record<string, string[]> = {
  name: ["name", "organisation", "organization", "institution", "firma", "unternehmen", "company", "investor", "partner", "fonds", "fund"],
  type: ["typ", "type", "art", "kategorie", "category", "investorentyp"],
  stage: ["status", "stage", "phase", "pipeline", "pipelinestatus"],
  priority: ["prioritaet", "priority", "prio"],
  owner: ["zustaendig", "owner", "verantwortlich", "betreuer"],
  city: ["stadt", "city", "ort", "sitz"],
  country: ["land", "country"],
  website: ["website", "webseite", "url", "web", "homepage", "domain"],
  linkedin: ["linkedin", "linkedinurl"],
  aumMio: ["aum", "aummio", "aummioeur", "volumen", "fondsgroesse", "fondsgroessemioeur", "fundsize", "fundsizem", "aumm", "assets"],
  potentialMio: ["potenzial", "potenzialmioeur", "potential", "ticket", "erwartetesticket", "erwartetesticketmioeur", "potentialm", "expectedticket", "expectedticketm", "investment", "betrag"],
  ticketMinMio: ["ticketmin", "ticketminmioeur", "ticketminm", "minticket", "mindestticket"],
  ticketMaxMio: ["ticketmax", "ticketmaxmioeur", "ticketmaxm", "maxticket", "hoechstticket"],
  committedMio: ["investiert", "investiertmioeur", "zugesagt", "zugesagtmioeur", "committed", "committedm", "commitment", "invested", "investedm"],
  probability: ["wahrscheinlichkeit", "wahrscheinlichkeitprozent", "probability", "chance"],
  focus: ["fokus", "focus", "investmentfokus", "thesis", "schwerpunkt", "branchen", "sektoren", "sectors", "thematischerfokus", "thematicfocus"],
  stageFocus: ["phasenfokus", "stagefocus", "stages", "phasen", "investmentphase"],
  regionFocus: ["regionalerfokus", "regionalfocus", "region", "regionen", "geography", "geografie"],
  history: ["vorgeschichte", "history", "historie", "sintro"],
  source: ["quelle", "source", "herkunft", "kanal"],
  tags: ["tags", "schlagworte", "labels", "segment"],
  notes: ["notizen", "notes", "kommentar", "kommentare", "bemerkung", "bemerkungen", "beschreibung", "description", "background", "hintergrund"],
  nextStep: ["naechsterschritt", "nextstep", "todo"],
  nextDate: ["bis", "faellig", "due", "duedate", "naechsterkontakt", "datum", "nextdate", "followup"],
  contactName: ["ansprechpartner", "kontakt", "kontaktperson", "contact", "contactname", "contactperson", "person"],
  firstName: ["vorname", "firstname"],
  lastName: ["nachname", "lastname", "surname"],
  email: ["email", "emailadresse", "mail", "emailaddress"],
  phone: ["telefon", "phone", "tel", "mobil", "mobile", "telefonnummer"],
  position: ["position", "rolle", "funktion", "title", "titel", "jobtitle", "role"],
};

const TYPE_WORDS: Record<OrgKind, [RegExp, string][]> = {
  investor: [
    [/syndikat|netzwerk|network|club|syndicate/, "syndikat"],
    [/angel|privatinvestor|business angel/, "angel"],
    [/corporate|\bcvc\b/, "cvc"],
    [/family ?office|\bsfo\b|\bmfo\b/, "family_office"],
    [/accelerator|inkubator|incubator|programm|program/, "accelerator"],
    [/allokator|allocator|seeder|dachfonds|fund of funds/, "allokator"],
    [/foerder|kfw|eif|eic|public|oeffentlich|landesbank|\bibb\b|wibank|htgf|high-tech|\bbmh\b/, "foerder"],
    [/placement|vermittler|intermediary|consult|beratung/, "netzwerk"],
    [/\bvc\b|venture|capital|ventures|fonds|fund|partners/, "vc"],
  ],
  partner: [
    [/broker|neobroker|brokerage|depot/, "broker"],
    [/bank|sparkasse|custod|depotbank|baas/, "bank"],
    [/boerse|exchange|market infrastructure|clearing|trading venue/, "exchange"],
    [/data|daten|api|market data|kursdaten/, "data"],
    [/haftungsdach|regulat|liability umbrella|compliance|kvg/, "regulatory"],
    [/accelerator|inkubator|incubator|programm|program/, "accelerator"],
    [/media|medien|community|newsletter|podcast|verlag|publisher|influencer|vertrieb|distribution/, "media"],
    [/tech|software|cloud|ki|\bai\b|llm/, "tech"],
    [/recht|legal|steuer|tax|kanzlei|law|notar|service|dienstleist/, "service"],
  ],
};

function guessType(kind: OrgKind, raw: string, name: string) {
  const v = normHeader(raw);
  for (const [id, labels] of Object.entries(ORG_TYPE_TEXT[kind])) if (v && (v === normHeader(id) || labels.some((l) => v === normHeader(l)))) return id;
  const hay = `${raw} ${name}`.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");
  for (const [re, id] of TYPE_WORDS[kind]) if (re.test(hay)) return id;
  return "sonstige";
}

function guessStage(kind: OrgKind, raw: string) {
  const v = normHeader(raw);
  if (!v) return "identifiziert";
  const hit = ORG_STAGES[kind].find((s) => normHeader(s.id) === v || (s.labels ?? [s.label]).some((l) => normHeader(l) === v || normHeader(l).startsWith(v)));
  if (hit) return hit.id;
  if (/lead|neu|new|recherche|research|identif/.test(v)) return "identifiziert";
  if (/kontakt|contacted|angeschrieben|outreach|gesendet|sent/.test(v)) return "kontaktiert";
  if (/gespraech|meeting|call|intro|antwort|reply|replied|deck/.test(v)) return "gespraech";
  if (/dd|diligence|pruefung|pilot|evaluation/.test(v)) return "pruefung";
  if (/termsheet|loi|vertrag|contract/.test(v)) return kind === "investor" ? "termsheet" : "vertrag";
  if (/commit|zusage|zugesagt/.test(v)) return kind === "investor" ? "zugesagt" : "aktiv";
  if (/invest|won|gewonnen|aktiv|live|active/.test(v)) return kind === "investor" ? "investiert" : "aktiv";
  if (/pause|spaeter|later|hold/.test(v)) return "pausiert";
  if (/pass|absage|abgesagt|lost|verloren|declin|no/.test(v)) return "abgesagt";
  return "identifiziert";
}

function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

/** "€250k – €1m", "0,5–3 Mio.", "$100k-5M", "bis 1 Mio" → [min, max] in €m */
export function parseTicket(raw: string): [number | null, number | null] {
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s || /k\. ?a\.|n\. ?a\.|unbekannt|unknown/.test(s)) return [null, null];
  const nums: number[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(tsd|k|mio|m|mrd|bn|b)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const n = Number(m[1]!.replace(",", "."));
    const unit = m[2] ?? "";
    let v: number;
    if (unit === "k" || unit === "tsd") v = n / 1000;
    else if (unit === "mrd" || unit === "bn" || unit === "b") v = n * 1000;
    else if (unit === "mio" || unit === "m") v = n;
    else v = n >= 1000 ? n / 1_000_000 : n; // bare "250000" → €0.25m; bare "0.5" → €0.5m
    if (Number.isFinite(v)) nums.push(v);
  }
  if (!nums.length) return [null, null];
  if (/^(bis|up to|max|<|≤)/.test(s)) return [null, nums[0]!];
  if (/^(ab|from|>|≥|min)/.test(s) && nums.length === 1) return [nums[0]!, null];
  if (nums.length === 1) return [nums[0]!, nums[0]!];
  return [Math.min(nums[0]!, nums[1]!), Math.max(nums[0]!, nums[1]!)];
}

orgRoutes.post("/import", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const p = await body(c, z.object({ kind: z.enum(ORG_KINDS), text: z.string().min(1, zMsg("The file is empty.", "Die Datei ist leer.")).max(900_000), dryRun: z.boolean().optional() }));
  const table = parseCsv(p.text);
  if (table.length < 2) throw new HttpError(422, tr("No data rows found. The first row must contain the column names.", "Es wurden keine Datenzeilen gefunden. Die erste Zeile muss die Spaltennamen enthalten."), "empty");
  if (table.length > 2001) throw new HttpError(422, tr("Please import at most 2,000 rows at a time.", "Bitte höchstens 2.000 Zeilen auf einmal importieren."), "too_many");
  const header = table[0]!.map(normHeader);
  const idx: Record<string, number> = {};
  for (const [key, names] of Object.entries(COLS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) idx[key] = i;
  }
  if (idx.name === undefined) {
    throw new HttpError(422, tr("No column for the name found. Expected e.g. “Name”, “Organization” or “Company”.", "Keine Spalte für den Namen gefunden. Erwartet z. B. „Name“, „Organisation“ oder „Firma“."), "no_name_column");
  }
  const users = db.prepare("SELECT id, name, email FROM users WHERE status = 'active'").all() as Pick<UserRow, "id" | "name" | "email">[];
  const findUser = (v: string) => {
    const n = v.trim().toLowerCase();
    if (!n) return undefined;
    return users.find((u) => u.email.toLowerCase() === n || u.name.toLowerCase() === n || u.name.toLowerCase().split(" ")[0] === n)?.id;
  };
  const existing = new Map(
    (db.prepare("SELECT id, name FROM organizations WHERE kind = ?").all(p.kind) as { id: string; name: string }[]).map((o) => [o.name.trim().toLowerCase(), o.id]),
  );
  const get = (row: string[], k: string) => (idx[k] !== undefined ? (row[idx[k]!] ?? "").trim() : "");

  type Result = { line: number; name: string; status: "neu" | "vorhanden" | "fehler"; message: string };
  const results: Result[] = [];
  let created = 0;
  let contactsAdded = 0;
  const seen = new Map<string, string>();
  const createdIds: string[] = [];
  const now = Date.now();

  const run = db.transaction(() => {
    table.slice(1).forEach((row, i) => {
      const line = i + 2;
      const name = get(row, "name");
      if (!name) {
        results.push({ line, name: "", status: "fehler", message: tr("No name", "Kein Name") });
        return;
      }
      const key = name.toLowerCase();
      let orgId = existing.get(key) ?? seen.get(key);
      const isNew = !orgId;
      if (!orgId) {
        orgId = newId();
        seen.set(key, orgId);
        const prob = Number(get(row, "probability").replace(/[^0-9.,]/g, "").replace(",", "."));
        const focus = get(row, "focus").slice(0, 500);
        const [tMin, tMax] = parseTicket(get(row, "potentialMio"));
        if (!p.dryRun) {
          db.prepare(
            `INSERT INTO organizations (id, kind, name, type, stage, priority, owner_id, website, linkedin, city, country, aum_mio, potential_mio, ticket_min_mio, ticket_max_mio,
             committed_mio, probability, focus, focus_tags, stage_focus, region_focus, history, source, tags, notes, next_step, next_date, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            orgId,
            p.kind,
            name.slice(0, 160),
            guessType(p.kind, get(row, "type"), name),
            guessStage(p.kind, get(row, "stage")),
            (["hoch", "mittel", "niedrig"] as const).find((x) => x === get(row, "priority").toLowerCase()) ?? "mittel",
            findUser(get(row, "owner")) ?? me.id,
            (() => {
              const w = get(row, "website");
              return w ? (/^https?:\/\//i.test(w) ? w : `https://${w}`).slice(0, 300) : "";
            })(),
            /^https:\/\//i.test(get(row, "linkedin")) ? get(row, "linkedin").slice(0, 300) : "",
            get(row, "city").slice(0, 80),
            get(row, "country").slice(0, 80),
            parseMio(get(row, "aumMio")),
            parseMio(get(row, "potentialMio")) ?? (tMin !== null && tMin === tMax ? tMin : null),
            parseMio(get(row, "ticketMinMio")) ?? (idx.ticketMinMio === undefined ? tMin : null),
            parseMio(get(row, "ticketMaxMio")) ?? (idx.ticketMaxMio === undefined ? tMax : null),
            parseMio(get(row, "committedMio")),
            Number.isFinite(prob) && get(row, "probability") ? Math.max(0, Math.min(100, Math.round(prob))) : null,
            focus,
            JSON.stringify(guessFocusTags(`${focus} ${get(row, "tags")}`)),
            JSON.stringify(guessStageFocus(`${get(row, "stageFocus")} ${focus}`)),
            get(row, "regionFocus").slice(0, 160),
            get(row, "history").slice(0, 2000),
            get(row, "source").slice(0, 160) || tr("CSV import", "CSV-Import"),
            JSON.stringify(
              get(row, "tags")
                .split(/[,|]/)
                .map((t) => t.trim())
                .filter(Boolean)
                .slice(0, 20),
            ),
            get(row, "notes").slice(0, 20000),
            get(row, "nextStep").slice(0, 300),
            parseDate(get(row, "nextDate")),
            me.id,
            now,
            now,
          );
          createdIds.push(orgId);
        }
        created++;
      }
      // Contact person
      const email = get(row, "email").toLowerCase();
      const person = get(row, "contactName") || [get(row, "firstName"), get(row, "lastName")].filter(Boolean).join(" ");
      let msg = isNew ? tr("Will be created", "Wird angelegt") : tr("Already exists – master data stays unchanged", "Gibt es schon – Stammdaten bleiben unverändert");
      if (person || email) {
        const validEmail = z.email().safeParse(email).success ? email : "";
        const dup = validEmail ? (db.prepare("SELECT id, organization_id FROM contacts WHERE email = ?").get(validEmail) as { id: string; organization_id: string | null } | undefined) : undefined;
        if (dup) {
          if (!dup.organization_id && !p.dryRun) db.prepare("UPDATE contacts SET organization_id = ?, updated_at = ? WHERE id = ?").run(orgId, now, dup.id);
          msg += dup.organization_id ? tr(" · contact person already exists", " · Ansprechpartner existiert bereits") : tr(" · existing contact linked", " · bestehender Kontakt verknüpft");
        } else {
          if (!p.dryRun) {
            db.prepare(
              `INSERT INTO contacts (id, name, email, company, position, category, stage, owner_id, phone, organization_id, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(newId(), (person || validEmail).slice(0, 120), validEmail, name.slice(0, 120), get(row, "position").slice(0, 120), p.kind, "", me.id, get(row, "phone").slice(0, 40), orgId, me.id, now, now);
          }
          contactsAdded++;
          msg += tr(` · contact person ${person || validEmail}`, ` · Ansprechpartner ${person || validEmail}`);
        }
      }
      results.push({ line, name, status: isNew ? "neu" : "vorhanden", message: msg });
    });
    if (!p.dryRun && p.kind === "investor") for (const id of createdIds) refit(db, id);
  });
  run();

  if (!p.dryRun) audit(db, { userId: me.id, action: "org.imported", ip: c.get("ip"), meta: { kind: p.kind, created, contacts: contactsAdded } });
  return c.json({
    dryRun: !!p.dryRun,
    columns: Object.keys(idx),
    created,
    contacts: contactsAdded,
    existing: results.filter((r) => r.status === "vorhanden").length,
    errors: results.filter((r) => r.status === "fehler").length,
    rows: results.slice(0, 200),
  });
});

/** Recalculate the fit of all investors (admins). `fillFocus` derives missing focus/stage ids from the free text. */
orgRoutes.post("/fit/recalc", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  if (me.role !== "admin") throw forbidden(tr("Only admins can recalculate the fit.", "Nur Admins können den Fit neu berechnen."));
  const p = await body(c, z.object({ fillFocus: z.boolean().optional() }).optional().default({}));
  const r = rescoreInvestors(db, { fillFocus: !!p?.fillFocus });
  audit(db, { userId: me.id, action: "investor.fit", ip: c.get("ip"), meta: { ...r } });
  return c.json(r);
});

/* ---------- Single organization ---------- */

orgRoutes.post("/", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const p = await body(c, input);
  assertOwner(db, p.ownerId);
  const dup = db.prepare("SELECT id FROM organizations WHERE kind = ? AND name = ? COLLATE NOCASE").get(p.kind, p.name) as { id: string } | undefined;
  if (dup) throw new HttpError(409, tr(`“${p.name}” already exists here.`, `„${p.name}“ gibt es hier bereits.`), "duplicate", { id: dup.id });
  const id = newId();
  const now = Date.now();
  const owner = p.ownerId === undefined ? me.id : p.ownerId;
  const focusTags = p.focusTags ?? guessFocusTags(`${p.focus ?? ""} ${(p.tags ?? []).join(" ")}`);
  const stageFocus = p.stageFocus ?? guessStageFocus(p.focus ?? "");
  db.prepare(
    `INSERT INTO organizations (id, kind, name, type, stage, priority, priority_manual, owner_id, website, linkedin, city, country, aum_mio, potential_mio, ticket_min_mio, ticket_max_mio,
     committed_mio, probability, focus, focus_tags, stage_focus, region_focus, prior_outcome, history, source, tags, notes, next_step, next_date, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    p.kind,
    p.name,
    validType(p.kind, p.type),
    validStage(p.kind, p.stage),
    p.priority ?? "mittel",
    p.priority ? 1 : 0,
    owner,
    p.website ?? "",
    p.linkedin ?? "",
    p.city ?? "",
    p.country ?? "",
    p.aumMio ?? null,
    p.potentialMio ?? null,
    p.ticketMinMio ?? null,
    p.ticketMaxMio ?? null,
    p.committedMio ?? null,
    p.probability ?? null,
    p.focus ?? "",
    JSON.stringify(focusTags),
    JSON.stringify(stageFocus),
    p.regionFocus ?? "",
    p.priorOutcome ?? "",
    p.history ?? "",
    p.source ?? "",
    JSON.stringify(p.tags ?? []),
    p.notes ?? "",
    p.nextStep ?? "",
    p.nextDate ?? null,
    me.id,
    now,
    now,
  );
  if (p.kind === "investor") refit(db, id);
  if (owner) notify(db, { userId: owner, actorId: me.id, kind: "org.owner", title: () => tr(`${me.name} assigned “${p.name}” to you`, `${me.name} hat dir „${p.name}“ zugeordnet`), link: orgPath(p.kind, id) });
  return c.json(mapOrg(getOrg(c, id)), 201);
});

/** Overview: KPIs, workflow columns, funnel, activity (see lib/org-dashboard.ts) */
orgRoutes.get("/dashboard", (c) => {
  const q = query(c, z.object({ kind: z.enum(ORG_KINDS) }));
  return c.json(orgDashboard(c.get("deps").db, q.kind));
});

orgRoutes.get("/:id", (c) => {
  const { db } = c.get("deps");
  const o = getOrg(c, c.req.param("id"));
  const contacts = (
    db
      .prepare("SELECT id, name, email, phone, position, linkedin, last_contact_at, fit_score FROM contacts WHERE organization_id = ? ORDER BY email = '', created_at")
      .all(o.id) as { id: string; name: string; email: string; phone: string; position: string; linkedin: string; last_contact_at: number | null; fit_score: number | null }[]
  ).map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, position: r.position, linkedin: r.linkedin, lastContactAt: r.last_contact_at, fitScore: r.fit_score }));
  const activities = (
    db
      .prepare(
        `SELECT a.id, a.user_id, a.kind, a.body, a.created_at, NULL AS contact_id, NULL AS contact_name, NULL AS mail_ref, 'org' AS src
           FROM org_activities a WHERE a.org_id = ?
         UNION ALL
         SELECT ca.id, ca.user_id, ca.kind, ca.body, ca.created_at, ca.contact_id, ct.name, ca.mail_ref, 'contact'
           FROM contact_activities ca JOIN contacts ct ON ct.id = ca.contact_id WHERE ct.organization_id = ?
         ORDER BY created_at DESC LIMIT 300`,
      )
      .all(o.id, o.id) as {
      id: string;
      user_id: string | null;
      kind: string;
      body: string;
      created_at: number;
      contact_id: string | null;
      contact_name: string | null;
      mail_ref: string | null;
      src: "org" | "contact";
    }[]
  ).map((a) => ({
    id: a.id,
    userId: a.user_id,
    kind: a.kind,
    body: a.body,
    createdAt: a.created_at,
    contactId: a.contact_id,
    contactName: a.contact_name,
    mailRef: parseJson(a.mail_ref, null),
    source: a.src,
  }));
  const tasks = (
    db
      .prepare(
        `${taskSelect} WHERE t.organization_id = ? OR t.contact_id IN (SELECT id FROM contacts WHERE organization_id = ?)
         ORDER BY CASE t.status WHEN 'erledigt' THEN 1 ELSE 0 END, t.due_date IS NULL, t.due_date LIMIT 100`,
      )
      .all(o.id, o.id) as TaskRow[]
  ).map(mapTask);
  // Outreach of the fundraising agent for this organization (latest first)
  const outreach = (
    db
      .prepare(
        `SELECT id, status, lang, to_email, to_name, subject, personal, body, research, quality, sequence_step, next_action_at, sent_at, replied_at, reply_kind, reply_summary, created_at, updated_at
           FROM agent_outreach WHERE org_id = ? ORDER BY created_at DESC LIMIT 10`,
      )
      .all(o.id) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id,
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  return c.json({ ...mapOrg(o), contacts, activities, tasks, outreach });
});

orgRoutes.patch("/:id", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const before = getOrg(c, c.req.param("id"));
  const p = await body(c, input.omit({ kind: true }).partial());
  assertOwner(db, p.ownerId);
  if (p.name && p.name.toLowerCase() !== before.name.toLowerCase()) {
    const dup = db.prepare("SELECT 1 FROM organizations WHERE kind = ? AND name = ? COLLATE NOCASE AND id != ?").get(before.kind, p.name, before.id);
    if (dup) throw new HttpError(409, tr(`“${p.name}” already exists here.`, `„${p.name}“ gibt es hier bereits.`), "duplicate");
  }
  const kind = before.kind;
  const stage = p.stage !== undefined ? validStage(kind, p.stage) : before.stage;
  const pick = <K extends keyof typeof p, T>(k: K, prev: T) => (p[k] === undefined ? prev : (p[k] as T));
  const now = Date.now();
  db.prepare(
    `UPDATE organizations SET name = ?, type = ?, stage = ?, priority = ?, owner_id = ?, website = ?, linkedin = ?, city = ?, country = ?, aum_mio = ?, potential_mio = ?,
     ticket_min_mio = ?, ticket_max_mio = ?, committed_mio = ?, probability = ?, focus = ?, focus_tags = ?, stage_focus = ?, region_focus = ?, prior_outcome = ?, history = ?,
     source = ?, tags = ?, notes = ?, next_step = ?, next_date = ?, updated_at = ?,
     priority_manual = CASE WHEN ? THEN 1 ELSE priority_manual END
     WHERE id = ?`,
  ).run(
    p.name ?? before.name,
    p.type !== undefined ? validType(kind, p.type) : before.type,
    stage,
    p.priority ?? before.priority,
    pick("ownerId", before.owner_id),
    p.website ?? before.website,
    p.linkedin ?? before.linkedin,
    p.city ?? before.city,
    p.country ?? before.country,
    pick("aumMio", before.aum_mio),
    pick("potentialMio", before.potential_mio),
    pick("ticketMinMio", before.ticket_min_mio),
    pick("ticketMaxMio", before.ticket_max_mio),
    pick("committedMio", before.committed_mio),
    pick("probability", before.probability),
    p.focus ?? before.focus,
    p.focusTags ? JSON.stringify(p.focusTags) : before.focus_tags,
    p.stageFocus ? JSON.stringify(p.stageFocus) : before.stage_focus,
    p.regionFocus ?? before.region_focus,
    p.priorOutcome ?? before.prior_outcome,
    p.history ?? before.history,
    p.source ?? before.source,
    p.tags ? JSON.stringify(p.tags) : before.tags,
    p.notes ?? before.notes,
    p.nextStep ?? before.next_step,
    pick("nextDate", before.next_date),
    now,
    // A priority changed by hand is no longer overwritten by the automatic fit
    p.priority !== undefined && p.priority !== before.priority ? 1 : 0,
    before.id,
  );
  if (kind === "investor") refit(db, before.id);
  if (stage !== before.stage) {
    db.prepare("INSERT INTO org_activities (id, org_id, user_id, kind, body, created_at) VALUES (?, ?, ?, 'status', ?, ?)").run(
      newId(),
      before.id,
      me.id,
      `Status: ${stageLabel(kind, before.stage)} → ${stageLabel(kind, stage)}`,
      now,
    );
    if (before.owner_id && before.owner_id !== me.id) {
      notify(db, { userId: before.owner_id, actorId: me.id, kind: "org.stage", title: () => tr(`${me.name}: “${before.name}” is now “${stageLabel(kind, stage)}”`, `${me.name}: „${before.name}“ ist jetzt „${stageLabel(kind, stage)}“`), link: orgPath(kind, before.id) });
    }
  }
  if (p.ownerId && p.ownerId !== before.owner_id) {
    notify(db, { userId: p.ownerId, actorId: me.id, kind: "org.owner", title: () => tr(`${me.name} assigned “${p.name ?? before.name}” to you`, `${me.name} hat dir „${p.name ?? before.name}“ zugeordnet`), link: orgPath(kind, before.id) });
  }
  return c.json(mapOrg(getOrg(c, before.id)));
});

orgRoutes.delete("/:id", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const o = getOrg(c, c.req.param("id"));
  if (me.role !== "admin" && o.owner_id !== me.id && o.created_by !== me.id) throw forbidden(tr("Only the owner or admins can delete entries.", "Nur die zuständige Person oder Admins können Einträge löschen."));
  db.prepare("DELETE FROM organizations WHERE id = ?").run(o.id);
  audit(db, { userId: me.id, action: "org.deleted", target: o.id, ip: c.get("ip"), meta: { name: o.name, kind: o.kind } });
  return c.json({ ok: true });
});

orgRoutes.post("/:id/activities", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const o = getOrg(c, c.req.param("id"));
  const p = await body(c, z.object({ kind: z.enum(["notiz", "anruf", "meeting", "mail", "dokument"]), body: zText(10000).min(1, zMsg("Please enter some text.", "Bitte gib einen Text ein.")) }));
  const id = newId();
  const now = Date.now();
  db.prepare("INSERT INTO org_activities (id, org_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, o.id, me.id, p.kind, p.body, now);
  db.prepare("UPDATE organizations SET last_contact_at = CASE WHEN ? = 'notiz' THEN last_contact_at ELSE ? END, updated_at = ? WHERE id = ?").run(p.kind, now, now, o.id);
  return c.json({ id, userId: me.id, kind: p.kind, body: p.body, createdAt: now, contactId: null, contactName: null, mailRef: null, source: "org" }, 201);
});

orgRoutes.delete("/:id/activities/:aid", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const a = db.prepare("SELECT user_id, kind FROM org_activities WHERE id = ? AND org_id = ?").get(c.req.param("aid"), c.req.param("id")) as
    | { user_id: string | null; kind: string }
    | undefined;
  if (!a) throw notFound();
  if (a.user_id !== me.id && me.role !== "admin") throw forbidden();
  db.prepare("DELETE FROM org_activities WHERE id = ?").run(c.req.param("aid"));
  return c.json({ ok: true });
});

/** Link or unlink an existing contact as contact person. */
orgRoutes.post("/:id/contacts", async (c) => {
  const { db } = c.get("deps");
  const o = getOrg(c, c.req.param("id"));
  const p = await body(c, z.object({ contactId: zId }));
  const r = db.prepare("UPDATE contacts SET organization_id = ?, company = CASE WHEN company = '' THEN ? ELSE company END, updated_at = ? WHERE id = ?").run(o.id, o.name, Date.now(), p.contactId);
  if (!r.changes) throw notFound(tr("Contact not found.", "Kontakt nicht gefunden."));
  if (o.kind === "investor") refit(db, o.id);
  return c.json({ ok: true });
});

orgRoutes.delete("/:id/contacts/:cid", (c) => {
  const { db } = c.get("deps");
  const o = getOrg(c, c.req.param("id"));
  db.prepare("UPDATE contacts SET organization_id = NULL, updated_at = ? WHERE id = ? AND organization_id = ?").run(Date.now(), c.req.param("cid"), o.id);
  if (o.kind === "investor") refit(db, o.id);
  return c.json({ ok: true });
});
