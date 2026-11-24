/** Small, robust CSV parser (Excel-compatible: ; , or tab, quotes, line breaks inside fields). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ";": 0, ",": 0, "\t": 0 } as Record<string, number>;
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]!++;
  }
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0) > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0] : ";";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

/**
 * CSV for Excel (semicolon, UTF-8 with BOM). Values starting with = + - @ are defused
 * so Excel does not execute them as formulas (CSV injection).
 */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}

/** Normalize a column name: "E-Mail-Adresse" → "emailadresse". */
export function normHeader(h: string) {
  return h
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Read an amount in €m: "2,5" → 2.5 · "500k"/"500 Tsd." → 0.5 · "1,2 Mrd" → 1200 · "250.000" → 0.25.
 * Plain numbers count as €m unless they are obviously euro amounts (≥ 10,000).
 */
export function parseMio(raw: string): number | null {
  const s = raw.toLowerCase().replace(/€|eur|euro|chf|usd|\$/g, "").trim();
  if (!s) return null;
  let mult = 1;
  let explicit = false;
  if (/(mrd|bn|milliard|billion)/.test(s)) {
    mult = 1000;
    explicit = true;
  } else if (/(mio|mn|million|\bm\b|m$)/.test(s)) {
    explicit = true;
  } else if (/(tsd|tausend|\bk\b|k$)/.test(s)) {
    mult = 0.001;
    explicit = true;
  }
  let num = s.replace(/[^0-9.,-]/g, "");
  if (!num) return null;
  if (num.includes(",") && num.includes(".")) {
    // 1.234,5 (de) or 1,234.5 (en)
    num = num.lastIndexOf(",") > num.lastIndexOf(".") ? num.replace(/\./g, "").replace(",", ".") : num.replace(/,/g, "");
  } else if (num.includes(",")) {
    num = /,\d{3}$/.test(num) && !explicit ? num.replace(/,/g, "") : num.replace(",", ".");
  } else if (/\.\d{3}$/.test(num) && !explicit) {
    num = num.replace(/\./g, "");
  }
  const v = Number(num);
  if (!Number.isFinite(v) || v < 0) return null;
  if (!explicit && v >= 10_000) return Math.round((v / 1_000_000) * 1000) / 1000;
  return Math.round(v * mult * 1000) / 1000;
}
