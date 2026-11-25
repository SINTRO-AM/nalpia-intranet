/** Checklists in Markdown descriptions ("- [ ] step" / "- [x] step"). */

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\](?=\s|$)/;

export function checklistStats(md: string | null | undefined): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of (md ?? "").split("\n")) {
    const m = ITEM.exec(line);
    if (!m) continue;
    total++;
    if (m[1] !== " ") done++;
  }
  return { done, total };
}

/** Toggles the checkbox on the given (1-based) line; returns the text unchanged if there is none. */
export function toggleChecklistLine(md: string, line: number): string {
  const lines = md.split("\n");
  const cur = lines[line - 1];
  if (cur === undefined || !ITEM.test(cur)) return md;
  lines[line - 1] = cur.replace(/\[( |x|X)\]/, (_m, c: string) => (c === " " ? "[x]" : "[ ]"));
  return lines.join("\n");
}

/** Turns plain bullet points into checklist items (for "Make checklist"). */
export function bulletsToChecklist(md: string): string {
  return md
    .split("\n")
    .map((l) => (ITEM.test(l) ? l : l.replace(/^(\s*)([-*+])\s+(?!\[)/, "$1$2 [ ] ")))
    .join("\n");
}
