/**
 * Quick entry for tasks: one line of text becomes a task with owner, due date, priority and topic.
 *
 *   "Antrag an IBB schicken @carlo fr !hoch #fördermittel"
 *   → title "Antrag an IBB schicken", owner Carlo, due next Friday, priority high, topic "Fördermittel …"
 *
 * Recognised (German and English):
 *   @name        owner (first name, name or e-mail prefix; @ich / @me = yourself)
 *   #topic       topic (start of the title or any word in it)
 *   !hoch !h !1 !!   priority high · !mittel !m !2 · !niedrig !n !3 (also !high/!medium/!low)
 *   dates        heute, morgen, übermorgen, Montag … Sonntag (Mo. … So.), nächste Woche,
 *                in 3 Tagen, in 2 Wochen, Ende der Woche, Monatsende, 28.11., 28.11.2026, 2026-11-28
 *                (also today, tomorrow, mon … sun, next week, in 3 days, end of week …)
 *                A preceding "bis", "am", "ab", "by", "on" or "due" is taken along.
 *
 * Pure function without browser dependencies (tested in tests/quickadd.test.ts).
 */

export interface QuickUser {
  id: string;
  name: string;
  email?: string;
}
export interface QuickTopic {
  id: string;
  title: string;
  stage?: string;
}
export type QuickPriority = "hoch" | "mittel" | "niedrig";

export interface QuickToken<T> {
  /** The text as typed (to show it and to keep it as text on request) */
  text: string;
  value: T;
}

export interface QuickResult {
  title: string;
  assignee?: QuickToken<string>;
  due?: QuickToken<string>;
  priority?: QuickToken<QuickPriority>;
  topic?: QuickToken<string>;
  /** @name / #topic that matched nobody */
  unknown: string[];
}

export interface QuickContext {
  users: QuickUser[];
  topics: QuickTopic[];
  meId?: string;
  /** Today as YYYY-MM-DD (local) */
  today: string;
  /** Token texts (lowercase) the person wants to keep as plain text */
  ignore?: string[];
}

const L = "\\p{L}\\p{N}";
const B = `(?<![${L}])`; // word start
const E = `(?![${L}])`; // word end
const PREP = `(?:(?:bis|am|ab|by|on|due)\\s+)?`;

export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function iso(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function fromIso(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}
function plus(today: string, n: number) {
  const d = fromIso(today);
  d.setDate(d.getDate() + n);
  return iso(d);
}
/** Next occurrence of a weekday (0 = Sunday), never today – "Freitag" on a Friday means next week */
function nextWeekday(today: string, wd: number) {
  const cur = fromIso(today).getDay();
  let diff = (wd - cur + 7) % 7;
  if (diff === 0) diff = 7;
  return plus(today, diff);
}

const WEEKDAYS: [RegExp, number][] = [
  [/^(montag|monday|mon|mo\.)$/, 1],
  [/^(dienstag|tuesday|tue|tues|di\.)$/, 2],
  [/^(mittwoch|wednesday|wed|mi\.)$/, 3],
  [/^(donnerstag|thursday|thu|thurs|do\.)$/, 4],
  [/^(freitag|friday|fri|fr)$/, 5],
  [/^(samstag|saturday|sat|sa\.)$/, 6],
  [/^(sonntag|sunday|sun|so\.)$/, 0],
];
// Two-letter forms ("mo", "di" …) are ordinary words too ("do", "so") – only with "bis/am" before them.
const SHORT_WD: Record<string, number> = { mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 0 };

interface Match {
  start: number;
  end: number;
  kind: "due" | "priority" | "assignee" | "topic";
  value: string;
  text: string;
}

export function parseQuickAdd(input: string, ctx: QuickContext): QuickResult {
  const ignore = new Set((ctx.ignore ?? []).map((s) => s.toLowerCase()));
  const matches: Match[] = [];
  const unknown: string[] = [];
  const free = (s: number, e: number) => !matches.some((m) => s < m.end && e > m.start);
  const add = (m: Match) => {
    if (ignore.has(m.text.trim().toLowerCase())) return false;
    if (!free(m.start, m.end)) return false;
    if (matches.some((x) => x.kind === m.kind)) return false; // first one wins
    matches.push(m);
    return true;
  };
  const scan = (re: RegExp, fn: (m: RegExpExecArray) => { kind: Match["kind"]; value: string } | null) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input))) {
      const r = fn(m);
      if (r) add({ start: m.index, end: m.index + m[0].length, text: m[0], ...r });
      if (m[0].length === 0) re.lastIndex++;
    }
  };

  /* ---------- Priority ---------- */
  scan(new RegExp(`${B}!(hoch|high|h|1|dringend|urgent|mittel|medium|m|2|niedrig|low|n|3)${E}|(?<=^|\\s)!!!?(?=$|\\s)`, "giu"), (m) => {
    const w = (m[1] ?? "!!").toLowerCase();
    const value: QuickPriority = /^(hoch|high|h|1|dringend|urgent|!!)$/.test(w) || m[0].startsWith("!!") ? "hoch" : /^(mittel|medium|m|2)$/.test(w) ? "mittel" : "niedrig";
    return { kind: "priority", value };
  });

  /* ---------- Owner ---------- */
  scan(new RegExp(`(?<=^|\\s)@([${L}._-]+)`, "gu"), (m) => {
    const tok = normalize(m[1]!);
    if (["ich", "me", "mir", "mich"].includes(tok) && ctx.meId) return { kind: "assignee", value: ctx.meId };
    const hit =
      ctx.users.find((u) => normalize(u.name.split(" ")[0] ?? "").startsWith(tok)) ??
      ctx.users.find((u) => normalize(u.name).startsWith(tok)) ??
      ctx.users.find((u) => u.email && normalize(u.email.split("@")[0]!).startsWith(tok)) ??
      ctx.users.find((u) => normalize(u.name).includes(tok));
    if (!hit) {
      unknown.push(m[0]);
      return null;
    }
    return { kind: "assignee", value: hit.id };
  });

  /* ---------- Topic ---------- */
  scan(new RegExp(`(?<=^|\\s)#([${L}._&+-]+)`, "gu"), (m) => {
    const tok = normalize(m[1]!);
    if (!tok) return null;
    const open = (t: QuickTopic) => !t.stage || !["erledigt", "verworfen"].includes(t.stage);
    const ranked = [...ctx.topics].sort((a, b) => Number(open(b)) - Number(open(a)));
    const words = (t: QuickTopic) => t.title.split(/[\s/–-]+/).map(normalize);
    const hit =
      ranked.find((t) => normalize(t.title).startsWith(tok)) ?? ranked.find((t) => words(t).some((w) => w.startsWith(tok))) ?? ranked.find((t) => normalize(t.title).includes(tok));
    if (!hit) {
      unknown.push(m[0]);
      return null;
    }
    return { kind: "topic", value: hit.id };
  });

  /* ---------- Due date (longest phrases first) ---------- */
  const t = ctx.today;
  const due = (re: string, fn: (m: RegExpExecArray) => string | null) => scan(new RegExp(`${B}${PREP}(?:${re})${E}`, "giu"), (m) => {
    const v = fn(m);
    return v ? { kind: "due", value: v } : null;
  });
  due("in\\s+(\\d{1,3})\\s+(tagen|tage|tag|days|day|d|wochen|woche|weeks|week|w)", (m) => {
    const n = Number(m[1]);
    return plus(t, /^(w|woche|wochen|week|weeks)$/i.test(m[2]!) ? n * 7 : n);
  });
  due("(?:n(?:ä|ae)chste|next)\\s+woche|next\\s+week", () => nextWeekday(t, 1));
  due("ende\\s+(?:der|dieser)\\s+woche|end\\s+of\\s+(?:the\\s+)?week|eow", () => {
    const cur = fromIso(t).getDay();
    return cur === 5 ? t : nextWeekday(t, 5);
  });
  due("monatsende|ende\\s+des\\s+monats|end\\s+of\\s+(?:the\\s+)?month|eom", () => {
    const d = fromIso(t);
    return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  });
  due("(\\d{4})-(\\d{2})-(\\d{2})", (m) => validDate(+m[1]!, +m[2]!, +m[3]!));
  due("(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2,4})?", (m) => {
    const d = +m[1]!;
    const mo = +m[2]!;
    if (m[3]) return validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, d);
    const y = fromIso(t).getFullYear();
    const cand = validDate(y, mo, d);
    return cand && cand < t ? validDate(y + 1, mo, d) : cand;
  });
  due("(?:n(?:ä|ae)chsten?|kommenden?|next)\\s+([a-zäöü]+\\.?)", (m) => {
    const wd = WEEKDAYS.find(([re]) => re.test(m[1]!.toLowerCase()));
    return wd ? nextWeekday(t, wd[1]) : null;
  });
  due("(?:ü|ue)bermorgen|day\\s+after\\s+tomorrow", () => plus(t, 2));
  due("heute|today|tdy", () => t);
  due("morgen|tomorrow|tmrw?", () => plus(t, 1));
  // Two-letter weekday only after a preposition
  scan(new RegExp(`${B}(?:bis|am|ab)\\s+(mo|di|mi|do|fr|sa|so)\\.?${E}`, "giu"), (m) => ({ kind: "due", value: nextWeekday(t, SHORT_WD[m[1]!.toLowerCase()]!) }));
  // "fr" alone is clear enough; "Fr." is left alone (also short for "Frau")
  due("montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thurs|fri|sat|sun|fr(?!\\.)|mo\\.|di\\.|mi\\.|do\\.|sa\\.|so\\.", (m) => {
    const word = m[0].replace(/^(bis|am|ab|by|on|due)\s+/i, "").toLowerCase();
    const wd = WEEKDAYS.find(([re]) => re.test(word));
    return wd ? nextWeekday(t, wd[1]) : null;
  });

  /* ---------- Title ---------- */
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  let title = "";
  let pos = 0;
  for (const m of sorted) {
    title += input.slice(pos, m.start) + " ";
    pos = m.end;
  }
  title += input.slice(pos);
  title = title
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/(^|\s)(bis|am|ab|by|on|due)\s*$/i, "")
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "")
    .trim();

  const tok = <T,>(kind: Match["kind"]): QuickToken<T> | undefined => {
    const m = matches.find((x) => x.kind === kind);
    return m ? { text: m.text.trim(), value: m.value as T } : undefined;
  };
  return {
    title,
    assignee: tok<string>("assignee"),
    due: tok<string>("due"),
    priority: tok<QuickPriority>("priority"),
    topic: tok<string>("topic"),
    unknown,
  };
}

function validDate(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d, 12);
  if (dt.getMonth() !== m - 1) return null;
  return iso(dt);
}

/** The @ or # word the cursor is in (for suggestions while typing). */
export function activeToken(text: string, caret: number): { kind: "@" | "#"; query: string; start: number; end: number } | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)([@#])([\p{L}\p{N}._&+-]*)$/u.exec(before);
  if (!m) return null;
  const start = caret - m[2]!.length - 1;
  const rest = /^[\p{L}\p{N}._&+-]*/u.exec(text.slice(caret))![0];
  return { kind: m[1] as "@" | "#", query: m[2]!, start, end: caret + rest.length };
}
