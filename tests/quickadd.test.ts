import { test } from "node:test";
import assert from "node:assert/strict";
import { activeToken, parseQuickAdd } from "../web/src/lib/quickadd.js";

// Wednesday, 25 November 2026
const ctx = {
  today: "2026-11-25",
  meId: "u-denis",
  users: [
    { id: "u-denis", name: "Denis Keller", email: "denis@nalpia.com" },
    { id: "u-carlo", name: "Carlo Elwinger", email: "carlo@nalpia.com" },
  ],
  topics: [
    { id: "t-exist", title: "EXIST-Gründungsstipendium", stage: "in_arbeit" },
    { id: "t-foerd", title: "Fördermittel Berlin & Hessen", stage: "geplant" },
    { id: "t-old", title: "Förderantrag 2025", stage: "erledigt" },
    { id: "t-arch", title: "Architektur 2.0", stage: "in_arbeit" },
  ],
};

test("Schnelleingabe: Person, Datum, Priorität und Thema aus einer Zeile", () => {
  const r = parseQuickAdd("Antrag an IBB schicken @carlo fr !hoch #förder", ctx);
  assert.equal(r.title, "Antrag an IBB schicken");
  assert.equal(r.assignee?.value, "u-carlo");
  assert.equal(r.due?.value, "2026-11-27");
  assert.equal(r.priority?.value, "hoch");
  assert.equal(r.topic?.value, "t-foerd", "Offene Themen vor abgeschlossenen");
  assert.deepEqual(r.unknown, []);
});

test("Schnelleingabe: Datumsangaben auf Deutsch und Englisch", () => {
  const d = (s: string) => parseQuickAdd(`X ${s}`, ctx).due?.value;
  assert.equal(d("heute"), "2026-11-25");
  assert.equal(d("morgen"), "2026-11-26");
  assert.equal(d("übermorgen"), "2026-11-27");
  assert.equal(d("bis Montag"), "2026-11-30");
  assert.equal(d("Mittwoch"), "2026-12-02", "Gleicher Wochentag heißt nächste Woche");
  assert.equal(d("am Do"), "2026-11-26");
  assert.equal(d("nächste Woche"), "2026-11-30");
  assert.equal(d("in 3 Tagen"), "2026-11-28");
  assert.equal(d("in 2 Wochen"), "2026-12-09");
  assert.equal(d("Ende der Woche"), "2026-11-27");
  assert.equal(d("Monatsende"), "2026-11-30");
  assert.equal(d("bis 5.12."), "2026-12-05");
  assert.equal(d("3.1."), "2027-01-03", "Vergangenes Datum ohne Jahr: nächstes Jahr");
  assert.equal(d("31.01.2027"), "2027-01-31");
  assert.equal(d("2027-02-26"), "2027-02-26");
  assert.equal(d("tomorrow"), "2026-11-26");
  assert.equal(d("next friday"), "2026-11-27");
  assert.equal(d("in 10 days"), "2026-12-05");
  assert.equal(d("31.02."), undefined, "Ungültiges Datum wird ignoriert");
});

test("Schnelleingabe: normale Wörter bleiben Text", () => {
  const r = parseQuickAdd("So machen wir das: Fr. Müller anrufen, Release 3.5 testen", ctx);
  assert.equal(r.due, undefined);
  assert.equal(r.title, "So machen wir das: Fr. Müller anrufen, Release 3.5 testen");
  const r2 = parseQuickAdd("Morgenroutine planen", ctx);
  assert.equal(r2.due, undefined, "Nur ganze Wörter");
  assert.equal(r2.title, "Morgenroutine planen");
});

test("Schnelleingabe: unbekannte Namen, @ich, ignorierte Angaben, Satzzeichen", () => {
  const r = parseQuickAdd("Deck senden @lisa #marketing", ctx);
  assert.deepEqual(r.unknown, ["@lisa", "#marketing"]);
  assert.equal(r.title, "Deck senden @lisa #marketing");
  assert.equal(parseQuickAdd("Review @ich", ctx).assignee?.value, "u-denis");
  assert.equal(parseQuickAdd("Review @Elwinger", ctx).assignee?.value, "u-carlo");
  const kept = parseQuickAdd("Meeting Freitag vorbereiten morgen", { ...ctx, ignore: ["freitag"] });
  assert.equal(kept.due?.value, "2026-11-26");
  assert.equal(kept.title, "Meeting Freitag vorbereiten");
  assert.equal(parseQuickAdd("Rückruf IBB, bis morgen", ctx).title, "Rückruf IBB");
  assert.equal(parseQuickAdd("Wichtig !! erledigen", ctx).priority?.value, "hoch");
  assert.equal(parseQuickAdd("Aufräumen !n", ctx).priority?.value, "niedrig");
  assert.equal(parseQuickAdd("Monorepo #arch", ctx).topic?.value, "t-arch");
  assert.equal(parseQuickAdd("Formulare #stipendium", ctx).topic?.value, "t-exist", "Auch Wortteile im Titel");
});

test("Schnelleingabe: aktives @/#-Wort für Vorschläge", () => {
  assert.deepEqual(activeToken("Antrag @ca", 10), { kind: "@", query: "ca", start: 7, end: 10 });
  assert.deepEqual(activeToken("Antrag #förd x", 12), { kind: "#", query: "förd", start: 7, end: 12 });
  assert.equal(activeToken("mail@example", 12), null, "E-Mail-Adressen sind kein @-Wort");
});
