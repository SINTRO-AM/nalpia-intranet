/**
 * Turns a research list (JSON, see data/seed/research-*.json) into a nalpia CRM bundle.
 *
 *   npx tsx scripts/research-to-bundle.ts data/seed/research-2026-11.json --out data/seed/research-bundle.json
 *
 * Research entries are investors that are not in the SINTRO CRM yet. Every entry becomes an
 * organization (stage "identifiziert", no prior outcome) and – when a person is named – one contact.
 * Only public facts belong here (website, city, focus, stage, ticket, a published pitch address);
 * e-mails that are not published stay empty and can be enriched later (e.g. with icypeas).
 */
import fs from "node:fs";
import { guessFocusTags, guessStageFocus } from "../server/lib/nalpia-fit.js";

interface Entry {
  name: string;
  type: "vc" | "angel" | "syndikat" | "cvc" | "family_office" | "accelerator";
  city: string;
  country: string;
  website?: string;
  linkedin?: string;
  focus: string;
  focusTags?: string[];
  stageFocus?: string[];
  regionFocus?: string;
  ticketMinMio?: number | null;
  ticketMaxMio?: number | null;
  priority?: "hoch" | "mittel" | "niedrig";
  notes?: string;
  source: string;
  tags?: string[];
  contact?: { name: string; position?: string; email?: string; linkedin?: string };
}

const args = process.argv.slice(2);
const files: string[] = [];
let out = "data/seed/research-bundle.json";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") out = args[++i]!;
  else files.push(args[i]!);
}
if (!files.length) {
  console.error("usage: research-to-bundle.ts <research.json…> --out <bundle.json>");
  process.exit(1);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const orgs: Record<string, unknown>[] = [];
const contacts: Record<string, unknown>[] = [];
const now = Date.now();
for (const file of files) {
  const list = JSON.parse(fs.readFileSync(file, "utf8")) as { batch: string; entries: Entry[] };
  for (const e of list.entries) {
    const ref = `research:${slug(e.name)}`;
    const focusTags = e.focusTags?.length ? e.focusTags : guessFocusTags(e.focus);
    const stageFocus = e.stageFocus?.length ? e.stageFocus : guessStageFocus(e.focus);
    orgs.push({
      ref,
      kind: "investor",
      name: e.name,
      type: e.type,
      stage: "identifiziert",
      priority: e.priority ?? "mittel",
      priorityManual: false,
      website: e.website ?? "",
      linkedin: e.linkedin ?? "",
      city: e.city,
      country: e.country,
      ticketMinMio: e.ticketMinMio ?? null,
      ticketMaxMio: e.ticketMaxMio ?? null,
      focus: e.focus,
      focusTags,
      stageFocus,
      regionFocus: e.regionFocus ?? "",
      priorOutcome: "",
      history: "",
      source: e.source.slice(0, 160),
      tags: [`nalpia-Recherche ${list.batch}`, ...(e.tags ?? [])],
      notes: [e.notes ?? "", `Quelle: ${e.source}`].filter(Boolean).join("\n\n"),
      createdAt: now,
      updatedAt: now,
    });
    if (e.contact) {
      contacts.push({
        ref: `${ref}:${slug(e.contact.name)}`,
        orgRef: ref,
        name: e.contact.name,
        email: e.contact.email ?? "",
        company: e.name,
        position: e.contact.position ?? "",
        category: "investor",
        stage: "Recherche",
        linkedin: e.contact.linkedin ?? "",
        tags: e.contact.email ? ["E-Mail: veröffentlicht"] : ["E-Mail: fehlt"],
        notes: "",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

const bundle = {
  format: "nalpia-crm-bundle",
  version: 1,
  source: `nalpia investor research (${files.join(", ")})`,
  exportedAt: now,
  orgs,
  contacts,
  activities: [],
};
fs.writeFileSync(out, JSON.stringify(bundle, null, 1));
console.log(`${orgs.length} organizations, ${contacts.length} contacts (${contacts.filter((c) => c.email).length} with e-mail) → ${out}`);
