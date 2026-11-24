/**
 * "Important": inbox emails whose sender is in the CRM – investors, partners, users
 * and stakeholders. Matched by a contact's exact address or an organization's domain
 * (website or its contacts' email addresses). Freemail domains and our own domain
 * only count on an exact address match.
 */
import type { DB } from "../db/index.js";
import type { MailSummary } from "./types.js";

export type ImportanceKind = "investor" | "partner" | "kunde" | "stakeholder";

export interface ImportanceMatch {
  kind: ImportanceKind;
  /** Organization or contact, e.g. "Alpha Ventures" */
  label: string;
  /** How it was matched: exact address or domain only */
  via: "kontakt" | "domain";
  orgId: string | null;
  contactId: string | null;
}

const IMPORTANT_CATEGORIES = ["investor", "partner", "kunde", "stakeholder"] as const;

const FREEMAIL = new Set(
  "gmail.com googlemail.com outlook.com outlook.de hotmail.com hotmail.de live.com live.de msn.com yahoo.com yahoo.de ymail.com icloud.com me.com mac.com aol.com aol.de gmx.de gmx.net gmx.at gmx.ch web.de t-online.de freenet.de posteo.de mailbox.org proton.me protonmail.com protonmail.ch zoho.com zohomail.eu mail.com email.de arcor.de bluewin.ch hispeed.ch".split(
    " ",
  ),
);

const domainOf = (email: string) => email.toLowerCase().split("@")[1]?.trim() ?? "";
/** "https://www.alpha.vc/team" → "alpha.vc" */
export function websiteDomain(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export class ImportanceIndex {
  private byEmail = new Map<string, ImportanceMatch>();
  private byDomain = new Map<string, ImportanceMatch>();

  constructor(db: DB, ownDomains: string[]) {
    const own = new Set(ownDomains.map((d) => d.toLowerCase()));
    const contacts = db
      .prepare(
        `SELECT c.id, c.name, c.email, c.category, c.organization_id, o.name AS org_name, o.kind AS org_kind
         FROM contacts c LEFT JOIN organizations o ON o.id = c.organization_id
         WHERE c.email != '' AND (c.category IN (${IMPORTANT_CATEGORIES.map(() => "?").join(",")}) OR o.id IS NOT NULL)`,
      )
      .all(...IMPORTANT_CATEGORIES) as { id: string; name: string; email: string; category: string; organization_id: string | null; org_name: string | null; org_kind: ImportanceKind | null }[];
    for (const c of contacts) {
      const kind = (c.org_kind ?? c.category) as ImportanceKind;
      if (!IMPORTANT_CATEGORIES.includes(kind as (typeof IMPORTANT_CATEGORIES)[number])) continue;
      const m: ImportanceMatch = { kind, label: c.org_name ?? c.name, via: "kontakt", orgId: c.organization_id, contactId: c.id };
      this.byEmail.set(c.email.toLowerCase(), m);
      const d = domainOf(c.email);
      if (d && !FREEMAIL.has(d) && !own.has(d) && !this.byDomain.has(d)) this.byDomain.set(d, { ...m, via: "domain", contactId: null, label: c.org_name ?? c.name });
    }
    const orgs = db.prepare(`SELECT id, name, kind, website FROM organizations WHERE website != ''`).all() as { id: string; name: string; kind: ImportanceKind; website: string }[];
    for (const o of orgs) {
      const d = websiteDomain(o.website);
      if (d && !FREEMAIL.has(d) && !own.has(d)) this.byDomain.set(d, { kind: o.kind, label: o.name, via: "domain", orgId: o.id, contactId: null });
    }
  }

  match(email: string): ImportanceMatch | null {
    const e = email.toLowerCase();
    const exact = this.byEmail.get(e);
    if (exact) return exact;
    const d = domainOf(e);
    if (!d) return null;
    // Subdomains too: mail.alpha.vc → alpha.vc
    const parts = d.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const hit = this.byDomain.get(parts.slice(i).join("."));
      if (hit) return hit;
    }
    return null;
  }
}

/** Marks important emails and filters out automated messages */
export function pickImportant(items: MailSummary[], index: ImportanceIndex) {
  const out: (MailSummary & { importance: ImportanceMatch })[] = [];
  for (const m of items) {
    if (/^(mailer-daemon|postmaster|no-?reply|noreply|notifications?)@/i.test(m.from.email)) continue;
    const hit = index.match(m.from.email);
    if (hit) out.push({ ...m, importance: hit });
  }
  return out;
}
