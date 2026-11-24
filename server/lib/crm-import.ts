/**
 * Import of a CRM bundle (JSON) into organizations, contacts and activity.
 *
 * The bundle is produced externally (scripts/export-to-bundle.ts turns the SINTRO CRM export into one)
 * and already has the intranet's structure. Every record carries a stable source id (`ref`), stored as external_ref.
 * This makes the import repeatable:
 *  - New records are created.
 *  - Already imported ones keep their data (only empty email, LinkedIn and phone are filled in) – or are overwritten from the CRM with `update`.
 *  - Manually created organizations (same name) and contacts (same email) are
 *    linked instead of duplicated; only empty fields are filled in.
 */
import { z } from "zod";
import type { DB } from "../db/index.js";
import { getSetting, setSetting } from "../db/index.js";
import { CONTACT_CATEGORIES, STAGES } from "../routes/contacts.js";
import { FOCUS_IDS, ORG_KINDS, ORG_STAGES, ORG_TYPES, PRIOR_OUTCOMES, STAGE_IDS, defaultRound, getRound, refit, type OrgKind } from "../routes/orgs.js";
import { audit } from "./audit.js";
import { HttpError } from "./http.js";
import { guessFocusTags, guessStageFocus } from "./nalpia-fit.js";
import { mailDirection } from "./org-dashboard.js";
import { todayISO } from "./util.js";
import { newId } from "./util.js";
import { tr } from "./i18n.js";

const text = (max: number) => z.string().max(max * 4).transform((s) => s.trim().slice(0, max));
const opt = (max: number) => text(max).optional().default("");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional()
  .catch(null);
const ts = z.number().int().min(0).max(4102444800000).nullable().optional();
const mio = z.number().finite().min(0).max(10_000_000).nullable().optional();
const tags = z
  .array(z.string())
  .max(40)
  .optional()
  .default([])
  .transform((l) => [...new Set(l.map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20));
const ref = z.string().min(1).max(160);

const orgSchema = z.object({
  ref,
  kind: z.enum(ORG_KINDS),
  name: text(160).pipe(z.string().min(1)),
  type: opt(40),
  stage: opt(40),
  priority: z.enum(["hoch", "mittel", "niedrig"]).optional().default("mittel"),
  /** The priority was set by hand – the automatic fit for nalpia must not overwrite it */
  priorityManual: z.boolean().optional().default(false),
  website: opt(300),
  linkedin: opt(300),
  city: opt(80),
  country: opt(80),
  aumMio: mio,
  potentialMio: mio,
  ticketMinMio: mio,
  ticketMaxMio: mio,
  committedMio: mio,
  probability: z.number().int().min(0).max(100).nullable().optional(),
  focus: opt(500),
  /** Investor profile (optional – derived from the focus text when missing) */
  focusTags: z.array(z.string()).max(12).optional().default([]).transform((l) => l.filter((f) => FOCUS_IDS.includes(f)).slice(0, 8)),
  stageFocus: z.array(z.string()).max(8).optional().default([]).transform((l) => l.filter((f) => STAGE_IDS.includes(f)).slice(0, 5)),
  regionFocus: opt(160),
  priorOutcome: opt(40).transform((v) => (v in PRIOR_OUTCOMES ? v : "")),
  history: opt(2000),
  source: opt(160),
  tags,
  notes: opt(20000),
  nextStep: opt(300),
  nextDate: date,
  lastContactAt: ts,
  createdAt: ts,
  updatedAt: ts,
});

const contactSchema = z.object({
  ref,
  orgRef: ref.optional(),
  name: text(160).pipe(z.string().min(1)),
  email: z
    .string()
    .max(320)
    .optional()
    .default("")
    .transform((e) => e.trim().toLowerCase())
    .transform((e) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : "")),
  company: opt(160),
  position: opt(160),
  category: z.enum(CONTACT_CATEGORIES),
  stage: opt(40),
  phone: opt(60),
  linkedin: opt(300),
  tags,
  notes: opt(20000),
  nextStep: opt(300),
  nextDate: date,
  lastContactAt: ts,
  createdAt: ts,
  updatedAt: ts,
});

const activitySchema = z.object({
  ref,
  contactRef: ref,
  kind: z.enum(["notiz", "mail", "anruf", "meeting", "status"]),
  body: text(10000).pipe(z.string().min(1)),
  createdAt: z.number().int().min(0).max(4102444800000),
  /** Reference to the message in ownerEmail's Zoho mailbox (opens it in the intranet) */
  mail: z.object({ messageId: z.string().max(40), folderId: z.string().max(40), subject: text(300) }).optional(),
});

export const crmBundleSchema = z.object({
  format: z.enum(["nalpia-crm-bundle", "sintro-crm-bundle"]),
  version: z.literal(1),
  source: opt(200),
  exportedAt: ts,
  /** Who owns the records and whose mailbox the mail references point to */
  ownerEmail: z.string().max(254).optional(),
  round: z
    .object({ name: text(80).optional(), targetMio: mio, committedExtraMio: mio, preMoneyMio: mio })
    .optional(),
  orgs: z.array(orgSchema).max(20000).default([]),
  contacts: z.array(contactSchema).max(40000).default([]),
  activities: z.array(activitySchema).max(100000).default([]),
});

export type CrmBundle = z.infer<typeof crmBundleSchema>;

export interface ImportOptions {
  actorId: string | null;
  /** Owner if ownerEmail is missing from the bundle or unknown */
  fallbackOwnerId?: string | null;
  /** Overwrite already imported records with the CRM values */
  update?: boolean;
  /** Create tasks for the owner from open replies and next steps */
  tasks?: boolean;
  dryRun?: boolean;
  ip?: string;
}

interface Counts {
  created: number;
  linked: number;
  updated: number;
  unchanged: number;
}
export interface ImportResult {
  dryRun: boolean;
  owner: { id: string; name: string } | null;
  orgs: Counts;
  contacts: Counts;
  activities: { created: number; skipped: number };
  tasks: { created: number; skipped: number };
  /** Status ids (stable API values): set | unchanged | not provided */
  round: "gesetzt" | "unverändert" | "keine Angabe";
  warnings: string[];
}

const isBundleFormat = (f: unknown) => f === "nalpia-crm-bundle" || f === "sintro-crm-bundle";

export function parseCrmBundle(input: unknown): CrmBundle {
  // Unwrap wrapped files: JSON as text, { data: … }, [ … ]
  let raw = input;
  for (let i = 0; i < 4; i++) {
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw.replace(/^\uFEFF/, ""));
        continue;
      } catch {
        break;
      }
    }
    if (Array.isArray(raw) && raw.length === 1) {
      raw = raw[0];
      continue;
    }
    if (raw && typeof raw === "object" && !isBundleFormat((raw as Record<string, unknown>).format)) {
      const o = raw as Record<string, unknown>;
      const inner = Object.values(o).find((x) => (x && typeof x === "object" && isBundleFormat((x as Record<string, unknown>).format)) || typeof x === "string");
      if (inner !== undefined && Object.keys(o).length <= 3) {
        raw = inner;
        continue;
      }
    }
    break;
  }
  const r = crmBundleSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.join(".") ?? "";
    throw new HttpError(422, tr(`The file is not a valid CRM bundle${where ? ` (${where}: ${issue?.message})` : ""}.`, `Die Datei ist kein gültiges CRM-Paket${where ? ` (${where}: ${issue?.message})` : ""}.`), "invalid_bundle");
  }
  return r.data;
}

/** Only accept http(s) links with a real host name; everything else is discarded. */
export function safeUrl(raw: string): string {
  const u = raw.trim();
  if (!u || /\s/.test(u)) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:\/\//i.test(u)) return "";
  try {
    const v = /^https?:\/\//i.test(u) ? u.replace(/^http:/i, "https:") : `https://${u}`;
    if (!/^[^.]+(\.[^.]+)+$/.test(new URL(v).hostname)) return "";
    return v.slice(0, 300);
  } catch {
    return "";
  }
}
const orgType = (kind: OrgKind, t: string) => (t in ORG_TYPES[kind] ? t : "sonstige");
const orgStage = (kind: OrgKind, s: string) => (ORG_STAGES[kind].some((x) => x.id === s) ? s : "identifiziert");
const contactStage = (cat: keyof typeof STAGES, s: string) => (STAGES[cat].includes(s) ? s : STAGES[cat][0]!);
const normName = (s: string) => s.toLocaleLowerCase("en-GB").replace(/\s+/g, " ").trim();

class Rollback extends Error {}

export function importCrmBundle(db: DB, bundle: CrmBundle, opts: ImportOptions): ImportResult {
  const now = Date.now();
  const warnings: string[] = [];
  const res: ImportResult = {
    dryRun: !!opts.dryRun,
    owner: null,
    orgs: { created: 0, linked: 0, updated: 0, unchanged: 0 },
    contacts: { created: 0, linked: 0, updated: 0, unchanged: 0 },
    activities: { created: 0, skipped: 0 },
    tasks: { created: 0, skipped: 0 },
    round: "keine Angabe",
    warnings,
  };

  let owner: { id: string; name: string } | undefined;
  let mailOwnerId: string | null = null;
  if (bundle.ownerEmail) {
    owner = db.prepare("SELECT id, name FROM users WHERE email = ? AND status != 'disabled'").get(bundle.ownerEmail.trim()) as typeof owner;
    mailOwnerId = owner?.id ?? null;
    if (!owner) warnings.push(tr(`No active account for ${bundle.ownerEmail} – ownership goes to the person importing, mail references are not linked.`, `Kein aktives Konto für ${bundle.ownerEmail} – Zuständigkeit geht an die importierende Person, Mail-Verweise werden nicht verknüpft.`));
  }
  if (!owner && opts.fallbackOwnerId) owner = db.prepare("SELECT id, name FROM users WHERE id = ?").get(opts.fallbackOwnerId) as typeof owner;
  res.owner = owner ?? null;
  const ownerId = owner?.id ?? null;

  const run = db.transaction(() => {
    /* ---------- Organizations ---------- */
    const orgIdByRef = new Map<string, { id: string; kind: OrgKind; name: string }>();
    const byRef = db.prepare("SELECT id, kind, name FROM organizations WHERE external_ref = ?");
    const byName = db.prepare("SELECT * FROM organizations WHERE kind = ? AND external_ref IS NULL AND lower(trim(name)) = ? LIMIT 1");
    const insOrg = db.prepare(
      `INSERT INTO organizations (id, kind, name, type, stage, priority, priority_manual, owner_id, website, linkedin, city, country, aum_mio, potential_mio,
         ticket_min_mio, ticket_max_mio, committed_mio, probability, focus, focus_tags, stage_focus, region_focus, prior_outcome, history,
         source, tags, notes, next_step, next_date, last_contact_at, created_by, created_at, updated_at, external_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updOrg = db.prepare(
      `UPDATE organizations SET name = ?, type = ?, stage = ?, priority = CASE WHEN priority_manual THEN priority ELSE ? END, website = ?, linkedin = ?, city = ?, country = ?,
         aum_mio = ?, potential_mio = ?, ticket_min_mio = ?, ticket_max_mio = ?, committed_mio = ?, probability = ?, focus = ?, focus_tags = ?, stage_focus = ?,
         region_focus = ?, prior_outcome = ?, history = ?, source = ?,
         tags = ?, notes = ?, next_step = ?, next_date = ?, last_contact_at = MAX(COALESCE(last_contact_at, 0), COALESCE(?, 0)),
         owner_id = COALESCE(owner_id, ?), updated_at = ? WHERE id = ?`,
    );
    const touchedOrgIds: string[] = [];
    const seenOrgRefs = new Set<string>();

    for (const o of bundle.orgs) {
      if (seenOrgRefs.has(o.ref)) {
        warnings.push(tr(`Organization ${o.ref} appears twice in the bundle – only the first entry counts.`, `Institution ${o.ref} steht doppelt im Paket – nur der erste Eintrag zählt.`));
        continue;
      }
      seenOrgRefs.add(o.ref);
      const v = {
        type: orgType(o.kind, o.type),
        stage: orgStage(o.kind, o.stage),
        website: safeUrl(o.website),
        linkedin: safeUrl(o.linkedin),
        tags: JSON.stringify(o.tags),
        focusTags: JSON.stringify(o.focusTags.length ? o.focusTags : guessFocusTags(`${o.focus} ${o.tags.join(" ")}`)),
        stageFocus: JSON.stringify(o.stageFocus.length ? o.stageFocus : guessStageFocus(o.focus)),
      };
      const hit = byRef.get(o.ref) as { id: string; kind: OrgKind; name: string } | undefined;
      if (hit) {
        orgIdByRef.set(o.ref, hit);
        if (opts.update) {
          updOrg.run(
            o.name, v.type, v.stage, o.priority, v.website, v.linkedin, o.city, o.country, o.aumMio ?? null, o.potentialMio ?? null,
            o.ticketMinMio ?? null, o.ticketMaxMio ?? null, o.committedMio ?? null, o.probability ?? null, o.focus, v.focusTags, v.stageFocus,
            o.regionFocus, o.priorOutcome, o.history, o.source, v.tags, o.notes,
            o.nextStep, o.nextDate ?? null, o.lastContactAt ?? null, ownerId, now, hit.id,
          );
          touchedOrgIds.push(hit.id);
          res.orgs.updated++;
        } else res.orgs.unchanged++;
        continue;
      }
      const manual = byName.get(o.kind, normName(o.name)) as Record<string, unknown> | undefined;
      if (manual) {
        // Created manually: link and only fill in empty fields
        const fill = (col: string, val: unknown) => (manual[col] === "" || manual[col] === null || manual[col] === "[]" ? val : manual[col]);
        db.prepare(
          `UPDATE organizations SET external_ref = ?, website = ?, linkedin = ?, city = ?, country = ?, ticket_min_mio = ?, ticket_max_mio = ?,
             committed_mio = ?, focus = ?, focus_tags = ?, stage_focus = ?, region_focus = ?, prior_outcome = ?, history = ?, source = ?, tags = ?, notes = ?,
             next_step = ?, next_date = ?, owner_id = COALESCE(owner_id, ?),
             last_contact_at = MAX(COALESCE(last_contact_at, 0), COALESCE(?, 0)), updated_at = ? WHERE id = ?`,
        ).run(
          o.ref, fill("website", v.website), fill("linkedin", v.linkedin), fill("city", o.city), fill("country", o.country),
          fill("ticket_min_mio", o.ticketMinMio ?? null), fill("ticket_max_mio", o.ticketMaxMio ?? null), fill("committed_mio", o.committedMio ?? null),
          fill("focus", o.focus), fill("focus_tags", v.focusTags), fill("stage_focus", v.stageFocus), fill("region_focus", o.regionFocus),
          fill("prior_outcome", o.priorOutcome), fill("history", o.history), fill("source", o.source), fill("tags", v.tags), fill("notes", o.notes),
          fill("next_step", o.nextStep), fill("next_date", o.nextDate ?? null), ownerId, o.lastContactAt ?? null, now, manual.id,
        );
        touchedOrgIds.push(manual.id as string);
        orgIdByRef.set(o.ref, { id: manual.id as string, kind: o.kind, name: manual.name as string });
        res.orgs.linked++;
        continue;
      }
      const id = newId();
      insOrg.run(
        id, o.kind, o.name, v.type, v.stage, o.priority, o.priorityManual ? 1 : 0, ownerId, v.website, v.linkedin, o.city, o.country, o.aumMio ?? null, o.potentialMio ?? null,
        o.ticketMinMio ?? null, o.ticketMaxMio ?? null, o.committedMio ?? null, o.probability ?? null, o.focus, v.focusTags, v.stageFocus, o.regionFocus,
        o.priorOutcome, o.history, o.source, v.tags, o.notes,
        o.nextStep, o.nextDate ?? null, o.lastContactAt ?? null, opts.actorId, o.createdAt ?? now, o.updatedAt ?? o.createdAt ?? now, o.ref,
      );
      touchedOrgIds.push(id);
      orgIdByRef.set(o.ref, { id, kind: o.kind, name: o.name });
      res.orgs.created++;
    }

    /* ---------- Contacts ---------- */
    const contactIdByRef = new Map<string, string>();
    const cByRef = db.prepare("SELECT id FROM contacts WHERE external_ref = ?");
    const cByEmail = db.prepare("SELECT * FROM contacts WHERE email = ? AND email != '' AND external_ref IS NULL LIMIT 1");
    const orgByRefDb = db.prepare("SELECT id, kind, name FROM organizations WHERE external_ref = ?");
    const insC = db.prepare(
      `INSERT INTO contacts (id, name, email, company, position, category, stage, owner_id, phone, linkedin, tags, notes, next_step, next_date,
         last_contact_at, organization_id, created_by, created_at, updated_at, external_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updC = db.prepare(
      `UPDATE contacts SET name = ?, email = CASE WHEN ? != '' THEN ? ELSE email END, company = ?, position = ?, category = ?, stage = ?,
         phone = CASE WHEN ? != '' THEN ? ELSE phone END, linkedin = ?, tags = ?, notes = ?, next_step = ?, next_date = ?,
         last_contact_at = MAX(COALESCE(last_contact_at, 0), COALESCE(?, 0)), organization_id = COALESCE(?, organization_id),
         owner_id = COALESCE(owner_id, ?), updated_at = ? WHERE id = ?`,
    );
    const fillC = db.prepare(
      `UPDATE contacts SET email = CASE WHEN COALESCE(email, '') = '' THEN ? ELSE email END,
         linkedin = CASE WHEN COALESCE(linkedin, '') = '' THEN ? ELSE linkedin END,
         phone = CASE WHEN COALESCE(phone, '') = '' THEN ? ELSE phone END, updated_at = ?
       WHERE id = ? AND ((COALESCE(email, '') = '' AND ? != '') OR (COALESCE(linkedin, '') = '' AND ? != '') OR (COALESCE(phone, '') = '' AND ? != ''))`,
    );
    const seenC = new Set<string>();
    for (const ct of bundle.contacts) {
      if (seenC.has(ct.ref)) {
        warnings.push(tr(`Contact ${ct.ref} appears twice in the bundle – only the first entry counts.`, `Kontakt ${ct.ref} steht doppelt im Paket – nur der erste Eintrag zählt.`));
        continue;
      }
      seenC.add(ct.ref);
      let org = ct.orgRef ? orgIdByRef.get(ct.orgRef) : undefined;
      if (ct.orgRef && !org) {
        org = orgByRefDb.get(ct.orgRef) as typeof org;
        if (!org) warnings.push(tr(`${ct.name}: organization ${ct.orgRef} is missing from the bundle – contact imported without an organization.`, `${ct.name}: Institution ${ct.orgRef} fehlt im Paket – Kontakt ohne Zuordnung übernommen.`));
      }
      const stage = contactStage(ct.category, ct.stage);
      const company = ct.company || org?.name || "";
      const linkedin = safeUrl(ct.linkedin);
      const tagJson = JSON.stringify(ct.tags);
      const hit = cByRef.get(ct.ref) as { id: string } | undefined;
      if (hit) {
        contactIdByRef.set(ct.ref, hit.id);
        if (opts.update) {
          updC.run(
            ct.name, ct.email, ct.email, company, ct.position, ct.category, stage, ct.phone, ct.phone, linkedin, tagJson, ct.notes, ct.nextStep,
            ct.nextDate ?? null, ct.lastContactAt ?? null, org?.id ?? null, ownerId, now, hit.id,
          );
          res.contacts.updated++;
        } else {
          // Without "update": leave the contact alone, but fill in fields that are still empty (e.g. a newly found email)
          const r = fillC.run(ct.email, linkedin, ct.phone, now, hit.id, ct.email, linkedin, ct.phone);
          if (r.changes) res.contacts.updated++;
          else res.contacts.unchanged++;
        }
        continue;
      }
      const manual = ct.email ? (cByEmail.get(ct.email) as Record<string, unknown> | undefined) : undefined;
      if (manual) {
        const fill = (col: string, val: unknown) => (manual[col] === "" || manual[col] === null || manual[col] === "[]" ? val : manual[col]);
        db.prepare(
          `UPDATE contacts SET external_ref = ?, company = ?, position = ?, linkedin = ?, phone = ?, tags = ?, notes = ?, next_step = ?, next_date = ?,
             organization_id = COALESCE(organization_id, ?), owner_id = COALESCE(owner_id, ?),
             last_contact_at = MAX(COALESCE(last_contact_at, 0), COALESCE(?, 0)), updated_at = ? WHERE id = ?`,
        ).run(
          ct.ref, fill("company", company), fill("position", ct.position), fill("linkedin", linkedin), fill("phone", ct.phone), fill("tags", tagJson),
          fill("notes", ct.notes), fill("next_step", ct.nextStep), fill("next_date", ct.nextDate ?? null), org?.id ?? null, ownerId,
          ct.lastContactAt ?? null, now, manual.id,
        );
        contactIdByRef.set(ct.ref, manual.id as string);
        res.contacts.linked++;
        continue;
      }
      const id = newId();
      insC.run(
        id, ct.name, ct.email, company, ct.position, ct.category, stage, ownerId, ct.phone, linkedin, tagJson, ct.notes, ct.nextStep,
        ct.nextDate ?? null, ct.lastContactAt ?? null, org?.id ?? null, opts.actorId, ct.createdAt ?? now, ct.updatedAt ?? ct.createdAt ?? now, ct.ref,
      );
      contactIdByRef.set(ct.ref, id);
      res.contacts.created++;
    }

    /* ---------- Fit for nalpia (needs the contacts, hence after them) ---------- */
    for (const id of touchedOrgIds) refit(db, id);

    /* ---------- Activity ---------- */
    const aExists = db.prepare("SELECT 1 FROM contact_activities WHERE external_ref = ?");
    const insA = db.prepare(
      "INSERT INTO contact_activities (id, contact_id, user_id, kind, body, mail_ref, created_at, external_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const touch = db.prepare("UPDATE contacts SET last_contact_at = MAX(COALESCE(last_contact_at, 0), ?) WHERE id = ?");
    let missing = 0;
    for (const a of bundle.activities) {
      const cid = contactIdByRef.get(a.contactRef) ?? (cByRef.get(a.contactRef) as { id: string } | undefined)?.id;
      if (!cid) {
        missing++;
        res.activities.skipped++;
        continue;
      }
      if (aExists.get(a.ref)) {
        res.activities.skipped++;
        continue;
      }
      const mailRef = a.mail && mailOwnerId ? JSON.stringify({ ...a.mail, date: a.createdAt, ownerId: mailOwnerId }) : null;
      insA.run(newId(), cid, ownerId, a.kind, a.body, mailRef, a.createdAt, a.ref);
      if (a.kind === "mail" || a.kind === "anruf" || a.kind === "meeting") touch.run(a.createdAt, cid);
      res.activities.created++;
    }
    if (missing) warnings.push(tr(`Skipped ${missing} activit${missing === 1 ? "y" : "ies"} without a matching contact.`, `${missing} ${missing === 1 ? "Verlaufseintrag" : "Verlaufseinträge"} ohne passenden Kontakt übersprungen.`));

    /* ---------- Tasks from the CRM ---------- */
    if (opts.tasks) createTasks(db, bundle, orgIdByRef, contactIdByRef, ownerId, opts.actorId, now, res);

    /* ---------- Funding round ---------- */
    if (bundle.round) {
      const cur = getRound(db);
      const hasRound = getSetting<unknown>(db, "investor_round", null) !== null && cur.targetMio !== null;
      if (!hasRound || opts.update) {
        const r = bundle.round;
        setSetting(db, "investor_round", {
          ...defaultRound,
          ...cur,
          name: r.name || cur.name,
          targetMio: r.targetMio ?? cur.targetMio,
          committedExtraMio: r.committedExtraMio ?? cur.committedExtraMio,
          preMoneyMio: r.preMoneyMio ?? cur.preMoneyMio,
        });
        res.round = "gesetzt";
      } else res.round = "unverändert";
    }

    audit(db, {
      userId: opts.actorId,
      action: "crm.import",
      ip: opts.ip,
      meta: { source: bundle.source, update: !!opts.update, orgs: res.orgs, contacts: res.contacts, activities: res.activities, tasks: res.tasks },
    });
    if (opts.dryRun) throw new Rollback();
  });

  try {
    run();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return res;
}

const ROUND_LABEL: Record<ImportResult["round"], string> = { gesetzt: "set", unverändert: "unchanged", "keine Angabe": "not provided" };

/** Short summary for logs and the CLI */
export function describeImport(r: ImportResult) {
  const c = (x: Counts) => `${x.created} new, ${x.linked} linked, ${x.updated} updated, ${x.unchanged} unchanged`;
  return [
    `${r.dryRun ? "Dry run – nothing saved." : "Import complete."}`,
    `Organizations: ${c(r.orgs)}`,
    `Contacts: ${c(r.contacts)}`,
    `Activity: ${r.activities.created} new, ${r.activities.skipped} skipped`,
    `Tasks: ${r.tasks.created} new, ${r.tasks.skipped} already present`,
    `Funding round: ${ROUND_LABEL[r.round]}`,
    r.owner ? `Owner: ${r.owner.name}` : "Owner: nobody",
    ...r.warnings.map((w) => `Note: ${w}`),
  ].join("\n");
}


/** Passive steps ("wait for reply") and pure first-outreach lists do not become tasks (matches the German CRM data too) */
const PASSIVE_STEP = /warten|Erstansprache|\bwait|first outreach/i;

/**
 * Creates at most one task for every active organization in the bundle:
 *  - reply pending (last real email came from the other side) → "Reply to …", due today
 *  - otherwise a dated, active next step → that step on its date
 * Repeated imports create no duplicates (external_ref) and do not recreate completed tasks.
 * The external_ref markers (antwort/schritt) are stable ids and stay unchanged.
 */
function createTasks(
  db: DB,
  bundle: CrmBundle,
  orgIdByRef: Map<string, { id: string; kind: OrgKind; name: string }>,
  contactIdByRef: Map<string, string>,
  ownerId: string | null,
  actorId: string | null,
  now: number,
  res: ImportResult,
) {
  const today = todayISO("Europe/Berlin", new Date(now));
  const firstContact = new Map<string, { ref: string; name: string }>();
  const contactOrg = new Map<string, string>();
  for (const ct of bundle.contacts) {
    if (!ct.orgRef) continue;
    contactOrg.set(ct.ref, ct.orgRef);
    if (!firstContact.has(ct.orgRef)) firstContact.set(ct.orgRef, { ref: ct.ref, name: ct.name });
  }
  const lastIn = new Map<string, { at: number; body: string; contactRef: string }>();
  const lastOut = new Map<string, number>();
  for (const a of bundle.activities) {
    const org = contactOrg.get(a.contactRef);
    if (!org) continue;
    const dir = mailDirection(a.kind, a.body);
    if (dir === "in" && a.createdAt > (lastIn.get(org)?.at ?? 0)) lastIn.set(org, { at: a.createdAt, body: a.body, contactRef: a.contactRef });
    if (dir === "out") lastOut.set(org, Math.max(lastOut.get(org) ?? 0, a.createdAt));
  }
  const exists = db.prepare("SELECT 1 FROM tasks WHERE external_ref = ?");
  // At most one open CRM task per organization – even if a later export comes without activity
  const openForOrg = db.prepare("SELECT 1 FROM tasks WHERE organization_id = ? AND external_ref LIKE 'crm-task:%' AND status != 'erledigt' LIMIT 1");
  const orgState = db.prepare("SELECT stage, priority FROM organizations WHERE id = ?");
  const ins = db.prepare(
    `INSERT INTO tasks (id, title, description, assignee_id, created_by, due_date, priority, status, contact_id, organization_id, sort_order, created_at, updated_at, external_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'offen', ?, ?, ?, ?, ?, ?)`,
  );
  const closedOrWon = (kind: OrgKind, stage: string) => ORG_STAGES[kind].some((s) => s.id === stage && (s.closed || s.won));
  let order = 0;
  for (const o of bundle.orgs) {
    const org = orgIdByRef.get(o.ref);
    if (!org) continue;
    const st = orgState.get(org.id) as { stage: string; priority: string } | undefined;
    if (!st || closedOrWon(org.kind, st.stage)) continue;
    const reply = lastIn.get(o.ref);
    let ref: string;
    let title: string;
    let description: string;
    let due: string;
    let contactRef = firstContact.get(o.ref)?.ref;
    if (reply && reply.at > (lastOut.get(o.ref) ?? 0)) {
      const who = bundle.contacts.find((c) => c.ref === reply.contactRef)?.name;
      contactRef = reply.contactRef;
      ref = `crm-task:${o.ref}:antwort:${reply.at}`;
      title = tr(`${org.name}: reply to ${who && who !== org.name ? who : "their email"}`, `${org.name}: Antwort${who && who !== org.name ? ` von ${who}` : ""} beantworten`);
      // "Erhalten:" is the stored marker for incoming mail (see org-dashboard mailDirection)
      const subject = reply.body.replace(/^Erhalten:\s*/i, "").split("\n")[0]!.trim();
      description = tr(`Last email from the other side: “${subject.slice(0, 200)}”. Imported from the CRM bundle.`, `Letzte Mail der Gegenseite: „${subject.slice(0, 200)}“. Aus dem CRM-Paket übernommen.`);
      due = today;
    } else if (o.nextStep && o.nextDate && !PASSIVE_STEP.test(o.nextStep)) {
      ref = `crm-task:${o.ref}:schritt:${o.nextDate}`;
      title = `${org.name}: ${o.nextStep}`;
      description = tr("Next step imported from the CRM bundle.", "Nächster Schritt aus dem CRM-Paket übernommen.");
      due = o.nextDate;
    } else continue;
    if (exists.get(ref) || openForOrg.get(org.id)) {
      res.tasks.skipped++;
      continue;
    }
    const contactId = contactRef ? (contactIdByRef.get(contactRef) ?? null) : null;
    ins.run(newId(), title.slice(0, 200), description, ownerId, actorId, due, st.priority, contactId, org.id, order++, now, now, ref);
    res.tasks.created++;
  }
}
