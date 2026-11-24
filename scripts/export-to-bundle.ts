/**
 * Turns the compact SINTRO CRM export (JSONL, one investor contact per line) into a nalpia CRM bundle
 * that the intranet imports (Admin → Import, or `node dist/server/cli.js import-crm --file …`).
 *
 *   npx tsx scripts/export-to-bundle.ts <export-dir-or-files…> --out data/seed/investors-bundle.json
 *
 * One organization per firm, one contact per export line. nalpia starts every investor at
 * "identified" – what happened with SINTRO (contacted, replied, declined …) is kept as
 * `priorOutcome` + `history` and feeds the fit score. Allocators and "no fit" research notes
 * are imported too (filterable) but marked accordingly.
 *
 * Export record fields (short keys): id, n (name), f (firm), k (kind), r (role), e (email), es (email status),
 * li (linkedin), c (city), co (country), seg (segment), p (prio A/B/C), fit, st (SINTRO stage), bg (background),
 * fo (focus), re (region), sf (stage focus), tk (ticket), why (fit rationale), src, as (agent status),
 * sa (agent sent at, ms), w (website).
 */
import fs from "node:fs";
import path from "node:path";
import { guessFocusTags, guessStageFocus } from "../server/lib/nalpia-fit.js";
import { parseTicket } from "../server/routes/orgs.js";

interface Rec {
  id: string;
  n: string;
  f: string;
  k: string;
  r: string;
  e: string;
  es: string;
  li: string;
  c: string;
  co: string;
  seg: string;
  p: string;
  fit: string;
  st: string;
  bg: string;
  fo: string;
  re: string;
  sf: string;
  tk: string;
  why: string;
  src: string;
  as: string;
  sa: number | null;
  w: string;
}

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1]! : "data/seed/investors-bundle.json";
const inputs = args.filter((a, i) => a !== "--out" && i !== outIdx + 1);
if (!inputs.length) {
  console.error("Usage: tsx scripts/export-to-bundle.ts <dir|files…> [--out file.json]");
  process.exit(1);
}
const files = inputs.flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(p, f)) : [p]));
files.sort((a, b) => (Number(a.match(/(\d+)\.jsonl$/)?.[1] ?? 0) || 0) - (Number(b.match(/(\d+)\.jsonl$/)?.[1] ?? 0) || 0) || a.localeCompare(b));

const recs: Rec[] = [];
for (const f of files) for (const line of fs.readFileSync(f, "utf8").split("\n")) if (line.trim()) recs.push(JSON.parse(line) as Rec);

/* ---------- helpers ---------- */

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

/** Normalised firm key: same firm written slightly differently still lands in one organization */
const firmKey = (f: string) =>
  f
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(gmbh|ag|llc|inc|ltd|lp|llp|sarl|sas|bv|se|co|kg|ug|limited|partners|capital partners|management|ventures?|vc|fund|fonds|the)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const KIND_TYPE: Record<string, string> = { VC: "vc", Angel: "angel", CVC: "cvc", "Family Office": "family_office", Allokator: "allokator", Netzwerk: "netzwerk" };
function orgType(r: Rec, firm: string) {
  const h = `${firm} ${r.bg}`.toLowerCase();
  if (/accelerator|techstars|y combinator|\byc\b|plug and play|tenity|inkubator|incubator|antler|entrepreneur first|founders factory|startupbootcamp/.test(h) && r.k !== "Angel") return "accelerator";
  if (/\bhtgf\b|high-tech gr|\bibb\b|\bbmh\b|hessen kapital|\bkfw\b|\beif\b|förderbank|foerderbank|wibank|bayern kapital|nrw\.bank|\bbpi\b|british business bank|eic fund|landesbank|sparkasse/.test(h) && r.k !== "Angel") return "foerder";
  if (r.k === "Angel" && /syndi|network|netzwerk|angels club|business angels\b|angel club|angel group|\bban\b/.test(h)) return "syndikat";
  return KIND_TYPE[r.k] ?? "sonstige";
}

const PRIOR: Record<string, string> = { neu: "", kontaktiert: "kontaktiert", antwort: "antwort", absage: "absage", pausiert: "pausiert", call: "call", deck: "deck", committed: "committed" };
const PRIOR_RANK: Record<string, number> = { "": 0, kontaktiert: 1, pausiert: 2, absage: 3, antwort: 4, call: 5, deck: 6, committed: 7 };
const ST_LABEL: Record<string, string> = {
  neu: "nicht kontaktiert",
  kontaktiert: "kontaktiert, keine Antwort",
  antwort: "hat geantwortet",
  absage: "Absage",
  pausiert: "pausiert",
  call: "Call geführt",
  deck: "Deck erhalten",
  committed: "zugesagt",
};
const AGENT_LABEL: Record<string, string> = { gesendet: "Vorab-Mail gesendet", entwurf: "Entwurf offen", absage: "Absage", frage: "Rückfrage", verworfen: "verworfen", ja: "Ja", bounce: "unzustellbar", zurückgestellt: "zurückgestellt" };

const COUNTRY: Record<string, string> = { USA: "US", UK: "GB", Deutschland: "DE", Germany: "DE", Schweiz: "CH", Österreich: "AT", Frankreich: "FR", Spanien: "ES", Niederlande: "NL", Schweden: "SE", Dänemark: "DK", Norwegen: "NO", Finnland: "FI", Italien: "IT", Belgien: "BE", Irland: "IE", Portugal: "PT", Polen: "PL", Israel: "IL", Kanada: "CA", Singapur: "SG", Japan: "JP", Luxemburg: "LU", Estland: "EE" };
const country = (c: string) => {
  const v = (c || "").trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY[v] ?? v.slice(0, 80);
};

const validEmail = (e: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) ? e.trim().toLowerCase() : "");
const segmentTag = (seg: string) => seg.replace(/^\d+\s*[–-]\s*/, "").trim().slice(0, 40);
/** Fit label from the SINTRO research – kept as a tag so the old view stays searchable */
const sintroFit = (fit: string) => (fit ? `SINTRO-Fit: ${fit}` : "");

/* ---------- group by firm ---------- */

interface OrgAcc {
  ref: string;
  name: string;
  recs: Rec[];
}
/** Generic "firm" labels of individual angels – the organization is the person then */
const GENERIC_FIRM = /^(angel|business angel|privatinvestor|private investor|angel investor|investor|unabhängig|independent|privat|self|n\/a|-)$/i;
const orgs = new Map<string, OrgAcc>();
for (const r of recs) {
  const rawFirm = (r.f || "").trim();
  const firm = !rawFirm || GENERIC_FIRM.test(rawFirm) ? `${r.n}${r.k === "Angel" || !rawFirm ? " (Angel)" : ""}` : rawFirm;
  const key = firmKey(firm) || slug(firm);
  let acc = orgs.get(key);
  if (!acc) {
    acc = { ref: `crm:firm:${slug(firm)}`, name: firm.slice(0, 160), recs: [] };
    orgs.set(key, acc);
  }
  acc.recs.push(r);
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))];
const strongest = (xs: string[]) => xs.sort((a, b) => (PRIOR_RANK[b] ?? 0) - (PRIOR_RANK[a] ?? 0))[0] ?? "";

const bundle = {
  format: "nalpia-crm-bundle" as const,
  version: 1 as const,
  source: "SINTRO CRM (investor export, converted for nalpia)",
  exportedAt: Date.now(),
  round: { name: "Pre-Seed-Runde", targetMio: 0.5, preMoneyMio: 2.5 },
  orgs: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  activities: [] as Record<string, unknown>[],
};

const seenOrgRefs = new Set<string>();
for (const acc of orgs.values()) {
  let ref = acc.ref;
  for (let i = 2; seenOrgRefs.has(ref); i++) ref = `${acc.ref}-${i}`;
  seenOrgRefs.add(ref);
  const rs = acc.recs;
  const first = rs[0]!;
  const priorOutcome = strongest(rs.map((r) => PRIOR[r.st] ?? ""));
  const stStates = uniq(rs.map((r) => ST_LABEL[r.st] ?? r.st));
  const agentStates = uniq(rs.map((r) => AGENT_LABEL[r.as] ?? r.as));
  const sentAt = rs.map((r) => r.sa ?? 0).reduce((a, b) => Math.max(a, b), 0) || null;
  const history = [
    `SINTRO: ${stStates.join(" / ")}`,
    agentStates.length ? `Agent-Kampagne: ${agentStates.join(" / ")}` : "",
    sentAt ? `letzte Mail ${new Date(sentAt).toISOString().slice(0, 10)}` : "",
    rs.length > 1 ? `${rs.length} Kontakte` : "",
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 2000);
  const focusText = uniq(rs.map((r) => r.fo)).join("; ").slice(0, 500);
  const whyText = uniq(rs.map((r) => r.why)).join(" | ");
  const bgText = uniq(rs.map((r) => r.bg)).join("\n");
  const [tMin, tMax] = parseTicket(uniq(rs.map((r) => r.tk)).find(Boolean) ?? "");
  const focusTags = guessFocusTags(focusText);
  const stageFocus = guessStageFocus(uniq(rs.map((r) => r.sf)).join(" "));
  const tags = uniq([
    ...rs.map((r) => segmentTag(r.seg)),
    ...rs.map((r) => sintroFit(r.fit)),
    /nalpia-top-fit/i.test(whyText) ? "nalpia-Top-Fit" : /nalpia-relevant/i.test(whyText) ? "nalpia-relevant" : /kein nalpia-fit|kein fit/i.test(whyText) ? "Kein nalpia-Fit" : "",
  ]).slice(0, 12);
  const notes = [
    bgText,
    whyText ? `\nFit-Einschätzung (Recherche): ${whyText}` : "",
    [uniq(rs.map((r) => r.tk)).length ? `Ticket: ${uniq(rs.map((r) => r.tk)).join(" / ")}` : "", uniq(rs.map((r) => r.sf)).length ? `Phase: ${uniq(rs.map((r) => r.sf)).join(" / ")}` : "", uniq(rs.map((r) => r.re)).length ? `Region: ${uniq(rs.map((r) => r.re)).join(" / ")}` : ""]
      .filter(Boolean)
      .join(" · "),
    `Quelle: ${uniq(rs.map((r) => r.src)).join(" / ") || "SINTRO CRM"} · SINTRO-Priorität: ${uniq(rs.map((r) => r.p)).join("/")}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 20000);
  bundle.orgs.push({
    ref,
    kind: "investor",
    name: acc.name,
    type: orgType(first, acc.name),
    stage: "identifiziert",
    priority: "mittel",
    website: uniq(rs.map((r) => r.w))[0] ?? "",
    linkedin: "",
    city: uniq(rs.map((r) => r.c))[0] ?? "",
    country: country(uniq(rs.map((r) => r.co))[0] ?? ""),
    ticketMinMio: tMin,
    ticketMaxMio: tMax,
    focus: focusText,
    focusTags,
    stageFocus,
    regionFocus: uniq(rs.map((r) => r.re)).join(", ").slice(0, 160),
    priorOutcome,
    history,
    source: (uniq(rs.map((r) => r.src))[0] ?? "SINTRO CRM").slice(0, 160),
    tags,
    notes,
    lastContactAt: sentAt,
  });
  for (const r of rs) {
    const email = validEmail(r.e);
    const cref = `crm:investors:${r.id}`;
    bundle.contacts.push({
      ref: cref,
      orgRef: ref,
      name: (r.n || acc.name).slice(0, 160),
      email,
      company: acc.name,
      position: (r.r || "").slice(0, 160),
      category: "investor",
      stage: "Recherche",
      linkedin: r.li || "",
      tags: uniq([r.st && r.st !== "neu" ? `SINTRO: ${ST_LABEL[r.st] ?? r.st}` : "", r.as ? `Agent: ${AGENT_LABEL[r.as] ?? r.as}` : "", r.es && r.es !== "ok" ? `E-Mail: ${r.es}` : ""]).slice(0, 8),
      notes: [r.bg !== bgText ? r.bg : "", r.why && r.why !== whyText ? `Fit: ${r.why}` : ""].filter(Boolean).join("\n").slice(0, 4000),
      lastContactAt: r.sa ?? null,
    });
    if (r.sa) {
      bundle.activities.push({
        ref: `crm:act:${r.id}:sintro-sent`,
        contactRef: cref,
        kind: "notiz",
        body: `SINTRO-Kampagne: Vorab-Mail gesendet (${new Date(r.sa).toISOString().slice(0, 10)})${r.as && r.as !== "gesendet" ? ` – Ergebnis: ${AGENT_LABEL[r.as] ?? r.as}` : ""}`,
        createdAt: r.sa,
      });
    }
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(bundle));
const withMail = bundle.contacts.filter((c) => c.email).length;
console.log(`${files.length} files → ${recs.length} records → ${bundle.orgs.length} organizations, ${bundle.contacts.length} contacts (${withMail} with e-mail), ${bundle.activities.length} activities`);
console.log(`Written: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
