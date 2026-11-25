# nalpia Intranet

Internes Web-Portal der nalpia GmbH (i. G.) – Fundraising-CRM mit KI-Agent, Partner-Pipeline, Aufgaben, Themen-Pipeline, Meilensteine, Postfach, Kalender und Team. Optimiert fürs Handy, voll nutzbar am Desktop, zweisprachig (Deutsch/Englisch).

Eigenständiges Projekt mit eigenem Repo, eigener Datenbank und eigenem Server – unabhängig vom SINTRO-Intranet, dessen Aufbau als Vorlage diente.

| Bereich | Was es kann |
|---|---|
| **Start** | Persönlicher Tagesüberblick: fällige Aufgaben, „Die nächsten vier Wochen“ als Zeitband, neue Beiträge, ungelesene Mails, Kontakte zum Nachfassen |
| **Investoren** | Business Angels, Pre-Seed/Seed-VCs, Syndikate, Corporate VCs, Family Offices, Accelerator – mit **Fit für nalpia** (0–100), Fokus-Tags (AI, Fintech, Wealthtech, B2B SaaS …), Phasenfokus, Region, Ticket, Vorgeschichte (z. B. aus der SINTRO-Runde) und Outreach-Status des Agenten. Pipeline-Board und Liste, Filter nach Status, Art, Fokus, Phase, Land/Region (Bay Area), Fit, Outreach, Vorgeschichte, Ticketgröße. Fortschritt der laufenden Runde (zugesagt, Term Sheets, gewichtete Pipeline, Ziel, Pre-Money) |
| **Agent** | Fundraising-Agent (Claude Opus 5.5): wählt Kandidaten, recherchiert den Investor, schreibt persönliche Erstmails im Stil von Denis, sendet aus dem verbundenen Postfach, fasst nach (5/9 Tage), liest Antworten, klassifiziert sie (Ja/Frage/Absage/OOO/Bounce) und entwirft Antworten. **Standard ist der Prüfmodus:** nichts geht ohne Klick raus. Optional Autopilot mit Sendefenster und Tageslimit. Details: [docs/AGENT.md](docs/AGENT.md) |
| **Partner** | Broker/Neobroker, Daten- und API-Anbieter, Börsen/Marktinfrastruktur, Regulatorik (Haftungsdach/Lizenz), Accelerator & Programme, Dienstleister – eigene Pipeline von *Identifiziert* bis *Aktiver Partner* |
| **Kontakte** | Alle Personen: Ansprechpartner von Investoren und Partnern, Nutzer/Kunden, Bewerber, Stakeholder – mit Status, Zuständigkeit, nächstem Schritt, Verlauf (Notiz, Anruf, Meeting, E-Mail) und verknüpften Aufgaben |
| **News / Aufgaben / Meilensteine** | Beiträge mit Kategorien, Reaktionen und Kommentaren; Aufgaben (meine/Team/Kanban mit Offen – In Arbeit – Wartet – Erledigt) mit Schnelleingabe (`@person #thema !hoch morgen`), Sammelaktionen, Checklisten, Verlauf und Verknüpfungen; Meilensteine mit Fortschritt |
| **Themen** | Interne und externe Themen als Pipeline (Eingang → Geplant → In Arbeit → Wartet → Erledigt) mit Gegenüber, Wiedervorlage, „wartet seit“, Fortschritt der Aufgaben und Updates |
| **Postfach / Kalender** | Das **eigene** Spacemail-Postfach jeder Person (IMAP/SMTP mit eigenem Postfach-Passwort, nur für sie sichtbar) mit KI-Antwortentwürfen, Zusammenfassungen, Ordner „Wichtig“ (nur CRM-Kontakte); Spacemail-Kalender über CalDAV |
| **Import/Export** | CRM-Paket aus dem SINTRO-CRM (`scripts/export-to-bundle.ts`), CSV-Import mit Vorschau, CSV-Export; alles wiederholbar ohne Dubletten |
| **Team / Verwaltung** | Organigramm, Profile, Zuständigkeiten; Einladen, Rollen, 2FA-Pflicht, Reset-Links, Audit-Protokoll |
| **Überall** | KI-Assistent je Seite, Suche und Befehle (Strg/⌘ + K), Benachrichtigungen, Hell/Dunkel, als App installierbar |

## Schnell ausprobieren (Demo-Modus, ohne Postfach/Claude)

```bash
npm install
npm run build
DEMO_MODE=true APP_URL=http://localhost:8080 npm start
# → http://localhost:8080  Anmeldung: denis@nalpia.demo / nalpia-demo-2026
```

Im Demo-Modus gibt es fiktive Investoren und Partner, ein Demo-Postfach pro Person und Agent-Entwürfe aus Vorlagen (ohne Recherche).

## Produktivbetrieb

Ausführlich in **[docs/SETUP.md](docs/SETUP.md)**. Kurzfassung:

```bash
cp .env.example .env        # APP_URL, APP_SECRET, Claude, SMTP eintragen
docker compose up -d --build
docker compose exec intranet node dist/server/cli.js reset-link --email denis@nalpia.com   # Link für die erste Admin-Person
```

Investoren einspielen: Verwaltung → Import → CRM-Paket (`investors-bundle.json`) – oder per CLI `import-crm`. Die Datei mit den echten Kontakten liegt **nicht** im Repo (`data/` ist ausgeschlossen).

## Technik

- **Backend:** Node.js 22, [Hono](https://hono.dev), SQLite (better-sqlite3, WAL), Zod-Validierung
- **Frontend:** React 18, Vite, Tailwind CSS, TanStack Query, Radix UI, vaul (Bottom-Sheets), Sofia Sans
- **Postfach:** Spacemail über IMAP (imapflow), SMTP (nodemailer) und CalDAV (tsdav, ical.js); Postfach-Passwort je Person AES-256-GCM-verschlüsselt. Zoho Mail (OAuth) bleibt als Alternative wählbar
- **KI:** Anthropic Claude API – Agent `claude-opus-5-5`, Assistent `claude-opus-5-5`, Mail-Entwürfe `claude-sonnet-5-5`, Übersetzung `claude-haiku-5-5`; Recherche über das Web-Search-Tool der API
- **Betrieb:** ein Docker-Container + Caddy (automatisches HTTPS); Daten in einem Volume (`/data`)

```
server/            API, Auth, Datenbank, Postfach- und Claude-Anbindung
  agent/           Fundraising-Agent: Einstellungen, Kandidaten, Entwürfe, Versand, Posteingang, Scheduler
  ai/              Mail-Entwürfe, Assistent, Übersetzung
  auth/            Login, Sitzungen, Einladungen, 2FA
  lib/nalpia-fit.ts  Fit-Modell für Investoren
  mail/            IMAP/SMTP-Postfach (Spacemail), Zoho-OAuth (Alternative), Demo-Postfach
  calendar/        CalDAV-Kalender (Spacemail), Zoho-Kalender, Demo-Kalender
  routes/          News, Aufgaben, Themen, Meilensteine, Kontakte, Investoren/Partner, Team, Verwaltung
scripts/           export-to-bundle.ts (SINTRO-CRM-Export → CRM-Paket), research-to-bundle.ts (Recherche-Liste → CRM-Paket)
web/src/           Oberfläche (Seiten, Komponenten, Layout)
tests/             Integrationstests (node:test) inkl. simuliertem Zoho-Server, IMAP/SMTP/CalDAV gegen echte Testserver (optional) und Agent-Durchlauf
docs/              Einrichtung, Agent, Sicherheit, Kurzanleitung fürs Team
```

## Entwicklung

```bash
npm run dev          # API auf :8080 und Oberfläche auf :5173 (mit Proxy)
npm test             # Integrationstests
npm run typecheck
```

## Sicherheit in Kürze

Passwörter mit scrypt, Sitzungscookies HttpOnly/Secure/SameSite, CSRF-Schutz, Sperre nach 5 Fehlversuchen, erzwingbare Zwei-Faktor-Anmeldung, strenge Content-Security-Policy, E-Mails im Sandbox-iframe mit blockierten Tracking-Bildern, Audit-Protokoll ohne Mail-Inhalte. Der Agent sendet im Prüfmodus nie ohne Klick; im Autopilot nur im Sendefenster, bis zum Tageslimit und nie ohne belegten persönlichen Absatz. Details: **[docs/SICHERHEIT.md](docs/SICHERHEIT.md)**.
