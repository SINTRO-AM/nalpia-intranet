import { differenceInCalendarDays, format, isSameYear, isToday, isYesterday, parseISO } from "date-fns";
import { dfLocale, getLang, locale, tr } from "./i18n";

export function todayISO(d = new Date()) {
  return format(d, "yyyy-MM-dd");
}

export function addDays(iso: string, n: number) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

export type DueTone = "over" | "today" | "soon" | "later" | "none";

export function dueInfo(iso: string | null | undefined, done = false): { label: string; tone: DueTone; days: number | null } {
  if (!iso) return { label: tr("No date", "Ohne Datum"), tone: "none", days: null };
  const days = differenceInCalendarDays(parseISO(iso), new Date());
  const tone: DueTone = done ? "later" : days < 0 ? "over" : days === 0 ? "today" : days <= 3 ? "soon" : "later";
  let label: string;
  if (days === 0) label = tr("Today", "Heute");
  else if (days === 1) label = tr("Tomorrow", "Morgen");
  else if (days === -1) label = tr("Yesterday", "Gestern");
  else if (days < -1) label = done ? format(parseISO(iso), tr("d MMM", "d. MMM"), { locale: dfLocale() }) : tr(`${-days} days overdue`, `Seit ${-days} Tagen`);
  else if (days < 7) label = format(parseISO(iso), "EEEE", { locale: dfLocale() });
  else label = format(parseISO(iso), isSameYear(parseISO(iso), new Date()) ? tr("d MMM", "d. MMM") : tr("d MMM yyyy", "d. MMM yyyy"), { locale: dfLocale() });
  return { label, tone, days };
}

export function dateLong(iso: string | null | undefined) {
  if (!iso) return "–";
  return format(parseISO(iso), tr("EEEE, d MMMM yyyy", "EEEE, d. MMMM yyyy"), { locale: dfLocale() });
}

export function dateShort(iso: string | null | undefined) {
  if (!iso) return "–";
  return format(parseISO(iso), tr("d MMM yyyy", "d. MMM yyyy"), { locale: dfLocale() });
}

export function countdown(iso: string | null | undefined) {
  if (!iso) return "";
  const d = differenceInCalendarDays(parseISO(iso), new Date());
  if (d === 0) return tr("today", "heute");
  if (d === 1) return tr("tomorrow", "morgen");
  if (d > 1) return tr(`in ${d} days`, `in ${d} Tagen`);
  if (d === -1) return tr("due since yesterday", "seit gestern fällig");
  return tr(`overdue by ${-d} days`, `seit ${-d} Tagen fällig`);
}

export function relTime(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return tr("just now", "gerade eben");
  if (diff < 3600_000) return tr(`${Math.floor(diff / 60_000)} min ago`, `vor ${Math.floor(diff / 60_000)} Min.`);
  const d = new Date(ms);
  if (isToday(d)) return tr(`${Math.floor(diff / 3600_000)} h ago`, `vor ${Math.floor(diff / 3600_000)} Std.`);
  if (isYesterday(d)) return tr(`yesterday, ${format(d, "HH:mm")}`, `gestern, ${format(d, "HH:mm")}`);
  if (diff < 6 * 86400_000) return format(d, "EEEE, HH:mm", { locale: dfLocale() });
  return format(d, isSameYear(d, new Date()) ? tr("d MMM", "d. MMM") : tr("d MMM yyyy", "d. MMM yyyy"), { locale: dfLocale() });
}

export function mailTime(ms: number) {
  const d = new Date(ms);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return tr("Yesterday", "Gestern");
  if (Date.now() - ms < 6 * 86400_000)
    return getLang() === "de" ? format(d, "EEEEEE", { locale: dfLocale() }) + "." : format(d, "EEE", { locale: dfLocale() });
  return format(d, isSameYear(d, new Date()) ? tr("d MMM", "d. MMM") : tr("dd/MM/yy", "dd.MM.yy"), { locale: dfLocale() });
}

export function dateTime(ms: number) {
  return format(new Date(ms), tr("EEEE, d MMMM yyyy, HH:mm", "EEEE, d. MMMM yyyy, HH:mm"), { locale: dfLocale() });
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return tr("Good night", "Gute Nacht");
  if (h < 11) return tr("Good morning", "Guten Morgen");
  if (h < 18) return tr("Good afternoon", "Guten Tag");
  return tr("Good evening", "Guten Abend");
}

export function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0]![0] ?? "") + (p.length > 1 ? p[p.length - 1]![0] : "")).toUpperCase();
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

type Tone = { label: string; tone: string };
const toned = (en: string, de: string, tone: string): Tone => ({
  get label() {
    return tr(en, de);
  },
  tone,
});

export const NEWS_CATEGORIES: Record<string, Tone> = {
  allgemein: toned("General", "Allgemein", "bg-surface2 text-muted"),
  fundraising: toned("Fundraising", "Fundraising", "bg-accent-soft text-accent-ink"),
  produkt: toned("Product", "Produkt", "bg-info-soft text-info"),
  vertrieb: toned("Sales", "Vertrieb", "bg-pos-soft text-pos"),
  regulatorik: toned("Regulatory", "Regulatorik", "bg-neg-soft text-neg"),
  team: toned("Team", "Team", "bg-surface2 text-brand"),
};

const cat = (en: [string, string], de: [string, string], tone: string) => ({
  get label() {
    return tr(en[0], de[0]);
  },
  get plural() {
    return tr(en[1], de[1]);
  },
  tone,
});

export const CONTACT_CATEGORIES: Record<string, { readonly label: string; readonly plural: string; tone: string }> = {
  investor: cat(["Investor", "Investors"], ["Investor", "Investoren"], "bg-info-soft text-info"),
  partner: cat(["Partner", "Partners"], ["Partner", "Partner"], "bg-accent-soft text-accent-ink"),
  kunde: cat(["User", "Users"], ["Nutzer", "Nutzer"], "bg-pos-soft text-pos"),
  bewerber: cat(["Applicant", "Applicants"], ["Bewerber", "Bewerber"], "bg-surface2 text-brand"),
  stakeholder: cat(["Stakeholder", "Stakeholders"], ["Stakeholder", "Stakeholder"], "bg-surface2 text-muted"),
  sonstige: cat(["Other", "Other"], ["Sonstige", "Sonstige"], "bg-surface2 text-muted"),
};

const prio = (en: string, de: string, dot: string) => ({
  get label() {
    return tr(en, de);
  },
  dot,
});

export const PRIORITY: Record<string, { readonly label: string; dot: string }> = {
  hoch: prio("High", "Hoch", "bg-neg"),
  mittel: prio("Medium", "Mittel", "bg-accent"),
  niedrig: prio("Low", "Niedrig", "bg-muted/50"),
};

export const TASK_STATUS: Record<string, string> = {
  get offen() {
    return tr("Open", "Offen");
  },
  get in_arbeit() {
    return tr("In progress", "In Arbeit");
  },
  get wartet() {
    return tr("Waiting", "Wartet");
  },
  get erledigt() {
    return tr("Done", "Erledigt");
  },
};

/** Pipeline stages of a topic, in board order */
export const TOPIC_STAGES = ["idee", "geplant", "in_arbeit", "wartet", "erledigt"] as const;
const stg = (en: string, de: string, tone: string, hintEn: string, hintDe: string, dot: string) => ({
  get label() {
    return tr(en, de);
  },
  get hint() {
    return tr(hintEn, hintDe);
  },
  tone,
  dot,
});
export const TOPIC_STAGE: Record<string, { readonly label: string; readonly hint: string; tone: string; dot: string }> = {
  idee: stg("Inbox", "Eingang", "bg-surface2 text-muted", "Ideas and new requests", "Ideen und neue Anfragen", "bg-muted/50"),
  geplant: stg("Planned", "Geplant", "bg-surface2 text-brand", "Decided, not started", "Entschieden, noch nicht begonnen", "bg-brand/60"),
  in_arbeit: stg("In progress", "In Arbeit", "bg-info-soft text-info", "We are working on it", "Wir arbeiten daran", "bg-info"),
  wartet: stg("Waiting", "Wartet", "bg-accent-soft text-accent-ink", "Ball is with someone else", "Ball liegt bei anderen", "bg-accent"),
  erledigt: stg("Done", "Erledigt", "bg-pos-soft text-pos", "Finished in the last 30 days", "Abgeschlossen (letzte 30 Tage)", "bg-pos"),
  verworfen: stg("Dropped", "Verworfen", "bg-surface2 text-muted", "Not pursued", "Nicht weiterverfolgt", "bg-muted/40"),
};

export const TOPIC_KIND: Record<string, Tone> = {
  intern: toned("Internal", "Intern", "bg-surface2 text-brand"),
  extern: toned("External", "Extern", "bg-info-soft text-info"),
};

/** Suggestions for the area of a topic (free text, these are only offered) */
export const TOPIC_AREAS = ["Förderung", "Fundraising", "Produkt", "Technik", "Infrastruktur", "Recht & Regulierung", "Partner", "Team", "Finanzen"];

/** Days since a timestamp (whole days, for "waiting for 5 days") */
export function daysSince(ms: number | null | undefined) {
  if (!ms) return null;
  return Math.max(0, differenceInCalendarDays(new Date(), new Date(ms)));
}

export const MILESTONE_STATUS: Record<string, Tone> = {
  geplant: toned("Planned", "Geplant", "bg-surface2 text-muted"),
  aktiv: toned("Active", "Aktiv", "bg-info-soft text-info"),
  erreicht: toned("Achieved", "Erreicht", "bg-pos-soft text-pos"),
  verschoben: toned("Postponed", "Verschoben", "bg-accent-soft text-accent-ink"),
};

/** Brand-matched avatar colors (background / text). */
export const AVATAR: Record<string, string> = {
  navy: "bg-[#05224B] text-white",
  gold: "bg-[#9A5F10] text-white",
  teal: "bg-[#0B6F76] text-white",
  plum: "bg-[#5B3D7A] text-white",
  rust: "bg-[#9A4A2E] text-white",
  slate: "bg-[#44546A] text-white",
  moss: "bg-[#3F6B3A] text-white",
  sky: "bg-[#1D5FD1] text-white",
};

/**
 * Amounts are stored in € millions.
 * English: 12.5 → "€12.5m", 0.15 → "€150k", 2400 → "€2.4bn".
 * German: 12,5 → "12,5 Mio. €", 0,15 → "150 Tsd. €", 2400 → "2,4 Mrd. €".
 */
export function money(mio: number | null | undefined, opts: { short?: boolean } = {}) {
  if (mio === null || mio === undefined || !Number.isFinite(mio)) return "–";
  const f = (v: number, d = 1) => v.toLocaleString(locale(), { maximumFractionDigits: d });
  if (getLang() === "de") {
    const eur = opts.short ? "" : " €";
    if (mio >= 1000) return `${f(mio / 1000, 1)} Mrd.${eur}`;
    if (mio >= 1) return `${f(mio, mio >= 100 ? 0 : 1)} Mio.${eur}`;
    if (mio > 0) return `${f(mio * 1000, 0)} Tsd.${eur}`;
    return opts.short ? "0" : "0 €";
  }
  const cur = opts.short ? "" : "€";
  if (mio >= 1000) return `${cur}${f(mio / 1000, 1)}bn`;
  if (mio >= 1) return `${cur}${f(mio, mio >= 100 ? 0 : 1)}m`;
  if (mio > 0) return `${cur}${f(mio * 1000, 0)}k`;
  return opts.short ? "0" : "€0";
}

/** Input "1.5" / "1,5" / "" → number or null (accepted in both languages) */
export function parseAmount(v: string): number | null {
  const s = v.trim().replace(/\s/g, "").replace(/€/g, "");
  if (!s) return null;
  let norm: string;
  if (s.includes(".") && s.includes(",")) {
    // both separators: the last one is the decimal mark ("1,234.5" / "1.234,5")
    norm = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else {
    // a lone comma or dot is read as a decimal mark
    norm = s.replace(",", ".");
  }
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const amountInput = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : getLang() === "de" ? String(v).replace(".", ",") : String(v);

export const ORG_KIND = {
  investor: {
    label: "Investor",
    get plural() {
      return tr("Investors", "Investoren");
    },
    path: "/investoren",
    noun: "Investor",
  },
  partner: {
    label: "Partner",
    get plural() {
      return tr("Partners", "Partner");
    },
    path: "/partner",
    noun: "Partner",
  },
} as const;

/** Link to an organization of any kind (falls back to investors for unknown kinds). */
export const orgHref = (kind: string | null | undefined, id: string) => `${ORG_KIND[kind as keyof typeof ORG_KIND]?.path ?? "/investoren"}/${id}`;

/** Fit for nalpia as a bucket with a colour */
export function fitBucket(score: number | null | undefined): { label: string; tone: string; bar: string } {
  if (score === null || score === undefined) return { label: "–", tone: "text-muted", bar: "bg-muted/40" };
  if (score >= 70) return { label: tr("High fit", "Hoher Fit"), tone: "text-pos", bar: "bg-pos" };
  if (score >= 50) return { label: tr("Medium fit", "Mittlerer Fit"), tone: "text-accent-ink", bar: "bg-accent" };
  return { label: tr("Low fit", "Niedriger Fit"), tone: "text-muted", bar: "bg-muted/50" };
}

/** Outreach status of the fundraising agent – tone for pills */
export const OUTREACH_TONE: Record<string, string> = {
  "": "bg-surface2 text-muted",
  draft: "bg-info-soft text-info",
  needs_note: "bg-neg-soft text-neg",
  approved: "bg-info-soft text-info",
  sent: "bg-accent-soft text-accent-ink",
  followup: "bg-accent-soft text-accent-ink",
  replied: "bg-pos-soft text-pos",
  declined: "bg-surface2 text-muted",
  bounced: "bg-neg-soft text-neg",
  paused: "bg-surface2 text-muted",
  discarded: "bg-surface2 text-muted",
  done: "bg-surface2 text-muted",
};
