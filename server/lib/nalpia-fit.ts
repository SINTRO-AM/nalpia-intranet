/**
 * Fit of an investor for nalpia – a transparent points model instead of a black box.
 *
 * nalpia builds an AI-native agent for public-markets investing for retail investors (B2C fintech,
 * Berlin). The pre-seed round is raised from business angels and
 * pre-seed/seed funds. Who writes such a cheque? Early-stage investors with a fintech, AI or
 * consumer-software thesis, tickets between roughly €50k and €1m, and a mandate that covers
 * Germany/Europe (or, for US funds, global).
 *
 * Score 0–100:
 *   type fit (0–22) + thematic focus (0–30) + stage focus (0–20) + ticket (0–10)
 *   + geography (0–10) + reachability (0–5) + signals (±: research annotations, portfolio, history)
 * Priority: ≥ 70 high, 50–69 medium, < 50 low (a priority set by hand is never overwritten).
 * A generalist seed VC lands around 55 (medium); a pre-seed fintech/AI investor around 80 (high);
 * a Series-A-only or B2B-only fund around 50 or below.
 */
import type { DB } from "../db/index.js";
import { parseJson } from "../db/index.js";
import { tr } from "./i18n.js";

/** Type fit (0–22) per organization type of kind "investor" */
export const TYPE_FIT: Record<string, number> = {
  angel: 22,
  vc: 20,
  syndikat: 20,
  accelerator: 14,
  foerder: 14,
  family_office: 12,
  cvc: 10,
  sonstige: 6,
  netzwerk: 2,
  allokator: 0,
};

/** Thematic focus ids with their contribution (the best three count, capped at 30) */
export const FOCUS_FIT: Record<string, number> = {
  fintech: 12,
  wealthtech: 12,
  capital_markets: 8,
  ai: 8,
  consumer: 6,
  embedded_finance: 4,
  generalist: 3,
  b2b_saas: 2,
  data: 2,
  marketplaces: 2,
  software: 1,
  insurtech: 1,
  infrastructure: 0,
  web3: 0,
  deeptech: 0,
  climate: 0,
  health: 0,
};

/** Stage focus ids (0–20) */
export const STAGE_FIT: Record<string, number> = {
  pre_seed: 20,
  seed: 12,
  series_a: 4,
  series_b_plus: 0,
  growth: 0,
};

const fold = (s: string) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

/** Portfolio or thesis signals that point straight at nalpia's market (concrete companies and product categories only) */
const PORTFOLIO = /robinhood|trade republic|scalable capital|wealthfront|betterment|public\.com|robo-?advis|neobroker|neo-?broker|retail invest|privatanleger|getquin|finary|lemon\.markets|upvest|\bbux\b|nutmeg|moneyfarm|\bselma\b|finanzguru|trading app|investment app|investing app|\betoro\b|\bbitpanda\b|\bn26\b|\brevolut\b|\bmonzo\b|\bvise\b|\bstash\b|\bacorns\b|\bwebull\b|\bfreetrade\b|\blightyear\b|\bcomposer\b|\bstreetbeat\b|\bcoinbase\b/;
const DACH = new Set(["DE", "AT", "CH", "LI"]);
const EUROPE = new Set("GB IE FR BE NL LU ES PT IT MT SE NO DK FI IS EE LV LT PL CZ SK HU SI HR RO BG GR CY RS UA".split(" "));
const BAY_AREA = /san francisco|palo alto|menlo park|mountain view|berkeley|oakland|san mateo|redwood city|sunnyvale|san jose|cupertino|los altos|burlingame|sausalito|bay area|silicon valley/;

export interface FitInput {
  type: string;
  focusTags: string[];
  stageFocus: string[];
  regionFocus: string;
  ticketMinMio: number | null;
  ticketMaxMio: number | null;
  country: string;
  city: string;
  focus: string;
  notes: string;
  history: string;
  priorOutcome: string;
  tags: string[];
  hasEmail: boolean;
}

export interface FitResult {
  score: number;
  reasons: string[];
}

export function fitScore(i: FitInput): FitResult {
  const reasons: string[] = [];
  let score = 0;

  const t = TYPE_FIT[i.type] ?? 8;
  score += t;
  reasons.push(`type:${i.type}`);

  const focus = i.focusTags
    .map((f) => [f, FOCUS_FIT[f] ?? 0] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const focusPts = Math.min(30, focus.reduce((a, [, p]) => a + p, 0));
  score += focusPts;
  for (const [f, p] of focus) if (p > 0) reasons.push(`focus:${f}`);
  if (!focus.length) reasons.push("focus:none");

  const stage = i.stageFocus.map((s) => STAGE_FIT[s] ?? 0);
  const stagePts = stage.length ? Math.max(...stage) : 6;
  score += stagePts;
  if (stage.length) reasons.push(`stage:${i.stageFocus.find((s) => (STAGE_FIT[s] ?? 0) === stagePts) ?? i.stageFocus[0]}`);
  else reasons.push("stage:unknown");

  const lo = i.ticketMinMio ?? i.ticketMaxMio;
  const hi = i.ticketMaxMio ?? i.ticketMinMio;
  if (lo === null || hi === null) {
    score += 3;
    reasons.push("ticket:unknown");
  } else if (lo <= 0.5 && hi >= 0.05) {
    score += 10;
    reasons.push("ticket:fit");
  } else if (lo <= 1) {
    score += 5;
    reasons.push("ticket:close");
  } else if (lo <= 3) {
    reasons.push("ticket:large");
  } else {
    score -= 5;
    reasons.push("ticket:too_large");
  }

  const c = i.country.toUpperCase();
  const rf = fold(i.regionFocus);
  if (DACH.has(c)) {
    score += 10;
    reasons.push("region:dach");
  } else if (EUROPE.has(c)) {
    score += 7;
    reasons.push("region:europe");
  } else if (c === "US" || c === "CA") {
    const global = /global|europ|international|ex-?us|non-?us|weltweit|dach|germany|deutschland/.test(rf);
    score += global ? 8 : 5;
    reasons.push(global ? "region:us_global" : "region:us");
    if (BAY_AREA.test(fold(i.city))) {
      score += 2;
      reasons.push("region:bay_area");
    }
  } else if (c) {
    score += /global|europ|international|germany|dach/.test(rf) ? 5 : 2;
    reasons.push("region:other");
  } else {
    score += 4;
    reasons.push("region:unknown");
  }

  if (i.hasEmail) {
    score += 5;
    reasons.push("reach:email");
  } else reasons.push("reach:none");

  const hay = fold(`${i.focus} ${i.notes} ${i.history} ${i.tags.join(" ")}`);
  if (PORTFOLIO.test(hay)) {
    score += 6;
    reasons.push("signal:portfolio");
  }
  if (/kein nalpia-fit|kein fit\b|no fit\b/.test(hay)) {
    score -= 30;
    reasons.push("signal:nofit");
  } else if (/catalyst-investor|portfolio-konflikt|portfolio conflict/.test(hay)) {
    // Backs a direct competitor (e.g. Catalyst) – usually conflicted, approach only via intro
    score -= 15;
    reasons.push("signal:conflict");
  } else if (/nalpia-top-fit/.test(hay)) {
    score += 10;
    reasons.push("signal:top");
  } else if (/nalpia-relevant/.test(hay)) {
    score += 5;
    reasons.push("signal:relevant");
  }
  switch (i.priorOutcome) {
    case "committed":
    case "deck":
    case "call":
      score += 12;
      reasons.push(`prior:${i.priorOutcome}`);
      break;
    case "antwort":
      score += 8;
      reasons.push("prior:antwort");
      break;
    case "absage":
      score -= 10;
      reasons.push("prior:absage");
      break;
    case "pausiert":
      score -= 3;
      reasons.push("prior:pausiert");
      break;
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

export const FIT_HIGH = 70;
export const FIT_MEDIUM = 50;
export const fitPriority = (score: number): "hoch" | "mittel" | "niedrig" => (score >= FIT_HIGH ? "hoch" : score >= FIT_MEDIUM ? "mittel" : "niedrig");

/** Human-readable label for a reason code (in the language of the request) */
export function fitReasonLabel(code: string, typeLabel: (t: string) => string): string {
  const [k, v = ""] = code.split(":") as [string, string?];
  switch (k) {
    case "type":
      return tr(`Investor type: ${typeLabel(v)}`, `Investorentyp: ${typeLabel(v)}`);
    case "focus":
      return v === "none" ? tr("No thematic focus recorded", "Kein thematischer Fokus hinterlegt") : tr(`Thematic focus: ${FOCUS_LABEL[v]?.[0] ?? v}`, `Thematischer Fokus: ${FOCUS_LABEL[v]?.[1] ?? v}`);
    case "stage":
      return v === "unknown" ? tr("Stage focus unknown", "Phasenfokus unbekannt") : tr(`Stage focus: ${STAGE_LABEL[v]?.[0] ?? v}`, `Phasenfokus: ${STAGE_LABEL[v]?.[1] ?? v}`);
    case "ticket":
      return (
        {
          fit: tr("Ticket size matches a pre-seed cheque", "Ticketgröße passt zu einem Pre-Seed-Ticket"),
          close: tr("Ticket size slightly above the round", "Ticketgröße etwas über der Runde"),
          large: tr("Ticket size rather large for pre-seed", "Ticketgröße eher groß für Pre-Seed"),
          too_large: tr("Ticket size far above the round", "Ticketgröße weit über der Runde"),
          unknown: tr("Ticket size unknown", "Ticketgröße unbekannt"),
        }[v] ?? code
      );
    case "region":
      return (
        {
          dach: tr("Based in the DACH region", "Sitz in der DACH-Region"),
          europe: tr("Based in Europe", "Sitz in Europa"),
          us_global: tr("US investor with a global or European mandate", "US-Investor mit globalem oder europäischem Mandat"),
          us: tr("US investor", "US-Investor"),
          bay_area: tr("San Francisco Bay Area (current outreach focus)", "San Francisco Bay Area (aktueller Outreach-Fokus)"),
          other: tr("Outside Europe and North America", "Außerhalb Europas und Nordamerikas"),
          unknown: tr("Country unknown", "Land unbekannt"),
        }[v] ?? code
      );
    case "reach":
      return v === "email" ? tr("Contact with e-mail address", "Ansprechpartner mit E-Mail-Adresse") : tr("No e-mail address yet", "Noch keine E-Mail-Adresse");
    case "signal":
      return (
        {
          portfolio: tr("Portfolio or thesis close to retail investing", "Portfolio oder These nah am Retail-Investing"),
          nofit: tr("Marked as no fit in research", "In der Recherche als „kein Fit“ markiert"),
          conflict: tr("Invested in a direct competitor (e.g. Catalyst) – likely conflicted", "In einen direkten Wettbewerber investiert (z. B. Catalyst) – vermutlich Konflikt"),
          top: tr("Marked as top fit for nalpia in research", "In der Recherche als nalpia-Top-Fit markiert"),
          relevant: tr("Marked as relevant for nalpia in research", "In der Recherche als nalpia-relevant markiert"),
        }[v] ?? code
      );
    case "prior":
      return (
        {
          committed: tr("Committed to SINTRO before – warm relationship", "Hat SINTRO bereits zugesagt – warme Beziehung"),
          deck: tr("Received the SINTRO deck – warm relationship", "Hat das SINTRO-Deck erhalten – warme Beziehung"),
          call: tr("Had a call with SINTRO – warm relationship", "Call mit SINTRO geführt – warme Beziehung"),
          antwort: tr("Replied to SINTRO – known contact", "Hat SINTRO geantwortet – bekannter Kontakt"),
          absage: tr("Declined SINTRO – approach with a new angle", "Hat SINTRO abgesagt – mit neuem Aufhänger ansprechen"),
          pausiert: tr("Paused with SINTRO", "Bei SINTRO pausiert"),
        }[v] ?? code
      );
    default:
      return code;
  }
}

/** Focus ids → [English, German] */
export const FOCUS_LABEL: Record<string, readonly [string, string]> = {
  ai: ["AI / machine learning", "KI / Machine Learning"],
  fintech: ["Fintech", "Fintech"],
  wealthtech: ["WealthTech / investing", "WealthTech / Investing"],
  capital_markets: ["Capital markets / trading", "Kapitalmarkt / Trading"],
  embedded_finance: ["Embedded finance / payments", "Embedded Finance / Payments"],
  insurtech: ["InsurTech", "InsurTech"],
  consumer: ["Consumer / B2C", "Consumer / B2C"],
  b2b_saas: ["B2B SaaS", "B2B-SaaS"],
  software: ["Software (general)", "Software (allgemein)"],
  data: ["Data / analytics", "Daten / Analytics"],
  infrastructure: ["Infrastructure / dev tools", "Infrastruktur / Dev-Tools"],
  marketplaces: ["Marketplaces / network effects", "Marktplätze / Netzwerkeffekte"],
  web3: ["Crypto / web3", "Krypto / Web3"],
  deeptech: ["Deep tech / hardware", "Deep Tech / Hardware"],
  climate: ["Climate / energy", "Klima / Energie"],
  health: ["Health / bio", "Health / Bio"],
  generalist: ["Generalist", "Generalist"],
};

/** Stage ids → [English, German] */
export const STAGE_LABEL: Record<string, readonly [string, string]> = {
  pre_seed: ["Pre-seed / angel", "Pre-Seed / Angel"],
  seed: ["Seed", "Seed"],
  series_a: ["Series A", "Series A"],
  series_b_plus: ["Series B and later", "Series B und später"],
  growth: ["Growth / late stage", "Growth / Late Stage"],
};

/** Derive focus ids from free text (focus field, notes, tags) – used by imports and "recalculate" */
export function guessFocusTags(text: string): string[] {
  const h = fold(text);
  const out = new Set<string>();
  const add = (re: RegExp, id: string) => re.test(h) && out.add(id);
  add(/\bki\b|\bai\b|artificial intelligence|machine learning|\bml\b|\bllms?\b|agentic|ai-native|ai native|generative|kuenstliche intelligenz|\bai-/, "ai");
  add(/fintech|financial services|financial technology|finanz(dienst|technolog|wesen|produkt)|banking|neobank|payments?|\blending\b|kredit|wealthtech|insurtech|capital markets?|kapitalmarkt/, "fintech");
  add(/wealth|robo-?advis|broker|trading|vermoegensverwalt|asset management|retail invest|privatanleger|neobroker|savings|sparen|investing app|investment app|anlage/, "wealthtech");
  add(/capital markets?|kapitalmarkt|trading|boerse|\bexchanges?\b|market infrastructure|\bquant/, "capital_markets");
  add(/embedded finance|payments?|zahlung|banking-as-a-service|\bbaas\b|open banking/, "embedded_finance");
  add(/insurtech|versicher|insurance/, "insurtech");
  add(/consumer|\bb2c\b|\bd2c\b|\bretail\b|endkunden|verbraucher|prosumer|mobile apps?/, "consumer");
  add(/\bb2b\b|\bsaas\b|enterprise|business software|vertical software/, "b2b_saas");
  add(/\bsoftware\b|digital products?|internet|\bapps?\b/, "software");
  add(/\bdata\b|\bdaten\b|analytics|big data/, "data");
  add(/infrastructure|infrastruktur|dev ?tools|developer tools|\bcloud\b|\bapis?\b/, "infrastructure");
  add(/marketplace|marktpl|network effect|netzwerkeffekt|platform business/, "marketplaces");
  add(/crypto|krypto|web3|blockchain|digital assets?|defi|token/, "web3");
  add(/deep ?tech|hardware|robot|quantum|semiconductor|space|industrial/, "deeptech");
  add(/climate|klima|clean ?tech|energy|energie|sustainab|nachhaltig|green/, "climate");
  add(/health|gesundheit|bio ?tech|medtech|life science|pharma/, "health");
  add(/generalist|sektoragnost|sector-?agnostic|all sectors|branchenuebergreifend|agnostic/, "generalist");
  return [...out].slice(0, 8);
}

/** Derive stage ids from free text ("Pre-Seed–Seed", "Series A+", "Seed–Growth") */
export function guessStageFocus(text: string): string[] {
  const h = fold(text);
  const out = new Set<string>();
  if (/pre-?seed|angel|first cheque|first check|idea stage|day one|day zero/.test(h)) out.add("pre_seed");
  if (/\bseed\b/.test(h)) out.add("seed");
  if (/series a|serie a|\ba-?runde|early stage|fruehphase|early-stage/.test(h)) out.add("series_a");
  if (/series b|series c|serie b|b\+|later stage|late stage|late-stage/.test(h)) out.add("series_b_plus");
  if (/growth|wachstum|scale-?up|expansion|buyout|private equity/.test(h)) out.add("growth");
  // "Seed–Growth" means the whole range: fill in the middle
  if (out.has("seed") && out.has("growth")) out.add("series_a");
  if (/all stages|alle phasen|stage-?agnostic|multi-?stage|early to growth/.test(h)) ["pre_seed", "seed", "series_a", "growth"].forEach((s) => out.add(s));
  return [...out];
}

interface OrgFitRow {
  id: string;
  type: string;
  focus_tags: string;
  stage_focus: string;
  region_focus: string;
  ticket_min_mio: number | null;
  ticket_max_mio: number | null;
  country: string;
  city: string;
  focus: string;
  notes: string;
  history: string;
  prior_outcome: string;
  tags: string;
  priority_manual: number;
  has_email: number;
}

/** Recalculate the fit (and the automatic priority) of all investors. */
export function rescoreInvestors(db: DB, opts: { fillFocus?: boolean } = {}): { orgs: number; hoch: number; mittel: number; niedrig: number } {
  const rows = db
    .prepare(
      `SELECT o.id, o.type, o.focus_tags, o.stage_focus, o.region_focus, o.ticket_min_mio, o.ticket_max_mio, o.country, o.city, o.focus, o.notes, o.history,
              o.prior_outcome, o.tags, o.priority_manual,
              EXISTS (SELECT 1 FROM contacts ct WHERE ct.organization_id = o.id AND ct.email != '') AS has_email
         FROM organizations o WHERE o.kind = 'investor'`,
    )
    .all() as OrgFitRow[];
  const upd = db.prepare("UPDATE organizations SET fit_score = ?, fit_reasons = ?, focus_tags = ?, stage_focus = ?, priority = CASE WHEN priority_manual THEN priority ELSE ? END WHERE id = ?");
  const counts = { orgs: 0, hoch: 0, mittel: 0, niedrig: 0 };
  const run = db.transaction(() => {
    for (const r of rows) {
      let focusTags = parseJson<string[]>(r.focus_tags, []);
      let stageFocus = parseJson<string[]>(r.stage_focus, []);
      if (opts.fillFocus) {
        if (!focusTags.length) focusTags = guessFocusTags(`${r.focus} ${r.tags}`);
        if (!stageFocus.length) stageFocus = guessStageFocus(r.focus);
      }
      const f = fitScore({
        type: r.type,
        focusTags,
        stageFocus,
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
      const prio = fitPriority(f.score);
      upd.run(f.score, JSON.stringify(f.reasons), JSON.stringify(focusTags), JSON.stringify(stageFocus), prio, r.id);
      counts.orgs++;
      counts[prio]++;
    }
  });
  run();
  return counts;
}
