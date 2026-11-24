# Fundraising-Agent

Der Agent übernimmt die Investorenansprache für die Pre-Seed-Runde: Er wählt die passendsten Investoren aus dem CRM, recherchiert sie, schreibt persönliche Erstmails im Stil von Denis, versendet sie aus dem verbundenen Zoho-Postfach, fasst nach, liest die Antworten und hält im CRM alles nach. Seite: **Agent** in der Navigation.

## Zwei Modi

| | Prüfmodus (Standard) | Autopilot |
|---|---|---|
| Erstmails | werden entworfen und warten unter *Zu prüfen* – **ein Klick sendet** | gehen im Sendefenster automatisch raus, bis zum Tageslimit |
| Follow-ups | Entwurf unter *Antworten* → Klick | automatisch |
| Antworten auf klare Zu- oder Absagen | Entwurf → Klick | automatisch (abschaltbar: „eindeutige Ja/Nein-Antworten automatisch beantworten“) |
| Antworten auf Fragen und Einwände | Entwurf → Klick | **immer** Entwurf → Klick |
| Posteingang lesen, klassifizieren, CRM pflegen, Aufgaben anlegen | ja | ja |

Umschalten oben auf der Agent-Seite (Admins); der Wechsel in den Autopilot wird bestätigt. „Jetzt Entwürfe erzeugen“ und „Alles ausführen“ respektieren den Modus: Ein manueller Lauf überspringt nur das Sendefenster, nie den Prüfmodus und nie das Tageslimit.

## Was der Agent voraussetzt

1. **Postfach-Inhaber** (Einstellungen → „Postfach-Inhaber“): die Person, in deren Namen die Mails gehen – sie verbindet unter *Postfach* ihr Zoho-Konto. Ohne verbundenes Postfach entwirft der Agent, sendet aber nichts.
2. **`ANTHROPIC_API_KEY`** und `AGENT_MODEL` (Standard `claude-opus-5-5`). Ohne Schlüssel läuft der Demo-Modus: Entwürfe aus Vorlagen, keine Recherche.
3. **Investoren im CRM** mit E-Mail-Adresse eines Ansprechpartners, Status *Identifiziert* und ausreichendem Fit (siehe unten).

## Kandidatenauswahl

Der Agent nimmt Investoren, die

- Art Investor (keine Allokatoren oder Netzwerke), Status *Identifiziert*, noch ohne Outreach-Status,
- einen Ansprechpartner mit E-Mail haben,
- den **Mindest-Fit** erreichen (Standard 60 von 100),
- in einem der **Zielländer** liegen (Standard: nur US) und
- SINTRO **nicht abgesagt** haben (umschaltbar: „Auch Investoren ansprechen, die SINTRO abgesagt haben“ – dann mit neuem Aufhänger).

Reihenfolge: **Bay-Area-Städte zuerst** (San Francisco, Palo Alto, Menlo Park, Mountain View … – Liste in den Einstellungen), darin warme Kontakte (Antwort, Call, Deck, Zusage bei SINTRO) vor kalten, dann nach Fit. **Ein Ansprechpartner pro Firma**; bevorzugt eine Person mit Entscheiderrolle statt info@. Der Reiter *Kandidaten* zeigt, wer als Nächstes dran wäre und warum.

## Fit für nalpia (0–100)

Berechnet beim Import, bei jeder Änderung und über „Fit neu berechnen“ (Investoren → „…“ oder `cli rescore-investors`). Gründe stehen in der Detailansicht.

| Baustein | Punkte | Was zählt |
|---|---|---|
| Art | bis 22 | Pre-Seed/Seed-VC und Business Angel am besten, dann Syndikat, Accelerator, Corporate VC, Family Office; Allokatoren und Netzwerke 0 |
| Thematischer Fokus | bis 30 | beste drei Tags: AI, Fintech, Wealthtech, Capital Markets, Embedded Finance, Consumer, B2B SaaS, Software, Data … |
| Phasenfokus | bis 20 | Pre-Seed und Seed am besten, Series A noch ok, Growth 0 |
| Ticket | −5 bis 10 | passt zur Rundengröße (zu große Mindesttickets kosten Punkte) |
| Region | bis 10 (+2) | US und Europa; +2 für die Bay Area |
| Erreichbarkeit | 5 | Ansprechpartner mit direkter E-Mail |
| Signale | ± | „nalpia-Top-Fit“ +10, „nalpia-relevant“ +5, „kein Fit“ −30, Portfolio-Überschneidung +6, warme Vorgeschichte +8/+12, Absage −10, pausiert −3 |

Priorität: **hoch ab 70**, mittel ab 50. Eine von Hand gesetzte Priorität bleibt bei Neuberechnung und Import erhalten.

## Die Erstmail

Die Mail folgt einer festen Vorlage (Einstellungen → Vorlagen): persönlicher Einstieg `{personal}` → Produkt in zwei Sätzen → Rundenkontext → leichter CTA („yes“ → Deck). Der Agent schreibt **nur den persönlichen Absatz** (40–80 Wörter) – aus **einem belegten, aktuellen Detail** zu These, Portfolio oder einer öffentlichen Aussage des Investors. Dafür durchsucht das Modell Website und aktuelle Beiträge (Web-Search, abschaltbar).

Qualitätsregeln aus dem Playbook: keine Jahre alten Referenzen, keine Datumsstempel, die alt wirken, keine Schmeichelei, keine erfundene Traktion, abwechselnde Überleitungen, Selbstcheck ≥ 8/10. **Findet der Agent kein belegtes Detail, wird der Entwurf als „persönlicher Absatz fehlt“ markiert und nicht gesendet** – auch nicht im Autopilot. Dann ergänzt ihr den Absatz von Hand oder lasst neu entwerfen („Neuer Entwurf“, optional mit Anweisung).

Rundengröße und Bewertung liest der Agent aus *Investoren → Runde* („Ziel ändern“) und nennt sie nur, wenn der Investor fragt. Deck- und Buchungslink stehen in den Einstellungen.

Sprache: Englisch; Deutsch nur bei DACH-Investoren, die erkennbar Deutsch schreiben.

## Nach dem Senden

- CRM: Investor → *Kontaktiert*, Outreach-Status *gesendet*, Verlaufseintrag mit der Mail, Datum des letzten Kontakts.
- **Follow-ups** nach 5 und 9 Tagen (einstellbar): 2–3 Sätze mit einem neuen Gedanken, nie „just checking in“. Danach ruht der Kontakt.
- **Posteingang** alle 15 Minuten: Antworten werden erkannt, klassifiziert (Ja / Frage / Absage / Abwesenheit / unzustellbar / Sonstiges) und zusammengefasst. Bei *Ja* oder *Frage* wandert der Investor nach *Erstgespräch*, bei *Absage* nach *Abgesagt*, bei *unzustellbar* entsteht eine Aufgabe „E-Mail-Adresse prüfen“. Jede Antwort erzeugt eine Aufgabe und eine Benachrichtigung für die zuständige Person; die Antwort selbst liegt als Entwurf unter *Antworten*.
- Reiter *Laufend*: alle offenen Threads mit Status, Wartezeit und nächster Aktion; *Protokoll*: jeder Lauf mit Ergebnis.

## Tagesrhythmus (Scheduler)

Läuft im Serverprozess (`AGENT_SCHEDULER=true`), Zeitzone `AGENT_TZ` (Standard Europe/Berlin):

- alle 15 Minuten Posteingang,
- einmal täglich ab der **Entwurfsstunde** (Standard 7 Uhr) Follow-ups und ein neuer Stapel von **20 Entwürfen** (einstellbar – lieber wenige gute als viele),
- Autopilot: Versand nur im **Sendefenster** (Standard 08:30–17:30 America/Los_Angeles, nur werktags) und bis zum **Tageslimit** (Standard 20), höchstens alle 10 Minuten ein Durchlauf. Die Zahl offener Threads ist zusätzlich gedeckelt („maximal offene Threads“).

Manuell: „Jetzt Entwürfe erzeugen“, „Alles ausführen“ oder `node dist/server/cli.js agent-run --kind drafts|inbox|followups|send|all`.

## Eigene Entwürfe

Aus der Detailansicht eines Investors (Karte *Fundraising-Agent* → „Erstmail entwerfen“) lässt sich für einen bestimmten Investor sofort ein Entwurf erzeugen – unabhängig von Ländern, Mindest-Fit und Tagesstapel. Der Reiter *Kandidaten* zeigt die Reihenfolge des nächsten Stapels mit Fit und Gründen. Jeder Entwurf lässt sich vor dem Senden bearbeiten (Betreff, Text, persönlicher Absatz) oder verwerfen (der Investor geht zurück in die Kandidatenliste).

## Playbook und Schreibstil

Einstellungen → *Playbook* (Positionierung, belegte Fakten, Einwände, Regeln für Erstmail, Follow-ups und Antworten) und *Schreibstil* (Grundton, Satzbau, Floskeln, die Denis nie benutzt). Beides geht als System-Prompt in jede Generierung. „Nicht nennen“-Punkte (Broker-Partner, Förderanträge, Nutzerzahlen) gelten für alle Texte. Änderungen wirken ab dem nächsten Entwurf; „Vorlagentexte wiederherstellen“ holt Vorlagen, Playbook und Stil der Auslieferung zurück (gespeichert erst mit „Einstellungen speichern“).

## Sicherheit

- Gesendet wird ausschließlich über das Postfach der Absenderperson (ihr OAuth-Token); der Agent hat keinen eigenen Mailzugang.
- Eingehende Mails sind für das Modell Daten, keine Anweisungen; Prompt-Injection kann höchstens einen Entwurf beeinflussen, der im Prüfmodus ohnehin wartet. Im Autopilot gehen nur Vorlagen-Antworten (Ja/Absage) automatisch raus.
- Jeder Versand steht im Audit-Protokoll (Empfängerdomain, kein Inhalt); Entwürfe, Antworten und Läufe liegen in der Datenbank und sind Teil der Backups.
