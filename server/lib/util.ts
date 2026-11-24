import crypto from "node:crypto";
import { tr } from "./i18n.js";

export const newId = () => crypto.randomUUID();

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  euro: "€",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  copy: "©",
  reg: "®",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** Converts email HTML into readable plain text (for AI context and previews). */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/ /g, " ");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

/** Plain text (with paragraphs) into safe HTML for sending. */
export function textToHtml(text: string): string {
  const paras = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return paras
    .map((p) => `<div>${escapeHtml(p).replace(/\n/g, "<br>")}</div>`)
    .join("<div><br></div>");
}

export interface Address {
  name: string;
  email: string;
}

/** Parses address lists like `"Max" <max@x.de>, anna@y.de` (Zoho returns them HTML-escaped). */
export function parseAddresses(raw: string | undefined | null): Address[] {
  if (!raw || raw === "Not Provided") return [];
  const s = decodeEntities(raw);
  const out: Address[] = [];
  const re = /\s*(?:"?([^"<,]*?)"?\s*<([^>]+)>|([^,\s<>]+@[^,\s<>]+))\s*,?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index === re.lastIndex) re.lastIndex++;
    const email = (m[2] ?? m[3] ?? "").trim().toLowerCase();
    if (!email.includes("@")) continue;
    out.push({ name: (m[1] ?? "").trim(), email });
  }
  return out;
}

/** Today's date (YYYY-MM-DD) in the company time zone. */
export function todayISO(tz = "Europe/Berlin", at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return parts; // en-CA already returns YYYY-MM-DD
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1]![0] : "")).toUpperCase();
}

/**
 * Label table whose values are translated lazily (enumerable getters), so it can live at module
 * level, be indexed like a plain record and serialized with JSON in the language of the request.
 */
export function lazyLabels<K extends string>(pairs: Record<K, readonly [en: string, de: string]>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(pairs) as K[]) {
    const [en, de] = pairs[k];
    Object.defineProperty(out, k, { enumerable: true, get: () => tr(en, de) });
  }
  return out;
}
