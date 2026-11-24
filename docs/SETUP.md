# Einrichtung und Betrieb

Diese Anleitung bringt das Intranet unter `https://intranet.nalpia.com` online. Rechne mit rund einer Stunde. Das nalpia-Intranet ist vom SINTRO-Intranet unabhängig: eigener Container, eigene Datenbank, eigene Konfiguration.

## 0. Vorab klären: eigenes Spacemail-Postfach pro Person

Die Postfächer von nalpia liegen bei **Spacemail** (Spaceship). Jede Person verbindet im Intranet **ihr eigenes** Postfach (Domain `nalpia.com`) mit ihrem Postfach-Passwort – demselben wie fürs Webmail. Das Intranet prüft beim Verbinden, dass die Adresse zur Intranet-Adresse der Person passt, und testet das Passwort an IMAP und SMTP. Läuft eine Adresse nur als Weiterleitung oder Alias, muss im Spacemail Manager zuerst ein eigenes Postfach angelegt werden. IMAP/SMTP ist bei Spacemail standardmäßig eingeschaltet (Spacemail Manager → Postfach → „IMAP/POP3/SMTP“).

Der **Fundraising-Agent** sendet aus dem Postfach des eingestellten Postfach-Inhabers (Standard: Denis) – dieses Postfach muss verbunden sein, bevor der Agent senden kann.

## 1. Server

Empfehlung für eine kleine, DSGVO-freundliche Installation: eine VM in Deutschland, z. B. Hetzner Cloud CX22 (Falkenstein/Nürnberg), mit Ubuntu 24.04. Das Intranet kann auf demselben Hetzner-Server wie die nalpia-Website laufen (Caddy bindet weitere Sites ein, siehe Abschnitt 7) – aber in einem eigenen Container mit eigenem Volume.

```bash
# auf dem Server
apt update && apt install -y docker.io docker-compose-v2 git
ufw allow 22,80,443/tcp && ufw enable
```

DNS: einen **A-Record** `intranet.nalpia.com` → IP des Servers anlegen.

## 2. Code und Konfiguration

```bash
git clone https://github.com/SINTRO-AM/nalpia-intranet /opt/nalpia-intranet
cd /opt/nalpia-intranet
cp .env.example .env
openssl rand -base64 48                 # Ergebnis als APP_SECRET in .env eintragen
nano .env
```

Pflichtwerte in `.env`:

| Variable | Wert |
|---|---|
| `APP_URL` | `https://intranet.nalpia.com` |
| `INTRANET_DOMAIN` | `intranet.nalpia.com` |
| `APP_SECRET` | zufällig, mind. 32 Zeichen. **Nie ändern** (sonst müssen alle Postfächer neu verbunden und 2FA neu eingerichtet werden) |
| `BOOTSTRAP_ADMIN_EMAIL` / `_NAME` | erste Admin-Person, z. B. `denis@nalpia.com` / `Denis Keller` |
| `ALLOWED_EMAIL_DOMAINS` | `nalpia.com` (nur solche Adressen können eingeladen werden) |

## 3. Postfach und Kalender (Spacemail)

Auf dem Server ist nichts einzutragen: Die Standardwerte zeigen auf Spacemail.

| Dienst | Server | Port / Verschlüsselung |
|---|---|---|
| Posteingang (IMAP) | `mail.spacemail.com` | 993, SSL/TLS |
| Postausgang (SMTP) | `mail.spacemail.com` | 465, SSL/TLS |
| Kalender (CalDAV) | `https://caldav.spacemail.com` | HTTPS |

Benutzername ist jeweils die vollständige E-Mail-Adresse, Passwort das Postfach-Passwort. Jede Person verbindet sich selbst unter **Postfach** (oder Einstellungen → Postfach). Ändert jemand sein Passwort bei Spacemail, zeigt das Intranet „Neu verbinden“ – dort einfach das neue Passwort eingeben.

Ein anderer Anbieter: `MAIL_IMAP_HOST`, `MAIL_IMAP_PORT`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_CALDAV_URL` und `MAIL_PROVIDER_NAME` in der Konfiguration setzen. Zoho Mail per OAuth bleibt möglich (`MAIL_PROVIDER=zoho` plus `ZOHO_CLIENT_ID`/`ZOHO_CLIENT_SECRET`).

## 4. Claude API

1. https://console.anthropic.com → **API Keys** → neuen Schlüssel erstellen (eigener Workspace „nalpia Intranet“ empfohlen, mit Ausgabenlimit).
2. In `.env`: `ANTHROPIC_API_KEY=…`.
3. Modelle:
   - `AGENT_MODEL` (Standard `claude-opus-5-5`) – Fundraising-Agent: Recherche mit Web-Search, Erstmail-Entwürfe, Follow-ups, Antwort-Klassifizierung. Hier lohnt das stärkste Modell: jeder Entwurf ist eine Investor-Mail in Denis' Namen.
   - `ASSISTANT_MODEL` (Standard `claude-opus-5-5`) – persönlicher Assistent (Chatfenster), `ASSISTANT_HOURLY_LIMIT` Nachrichten pro Person und Stunde (Standard 60).
   - `ANTHROPIC_MODEL` (Standard `claude-sonnet-5-5`) – KI-Entwürfe und Zusammenfassungen im Postfach, `AI_HOURLY_LIMIT` (Standard 40).
   - `TRANSLATE_MODEL` (Standard `claude-haiku-5-5`) – Übersetzung von Inhalten in die Oberflächensprache, gecacht in der Datenbank, `TRANSLATE_HOURLY_LIMIT` (Standard 300).
4. Agent-Scheduler: `AGENT_SCHEDULER=true` (Standard) lässt den Agenten im Serverprozess laufen; `AGENT_TZ` (Standard `Europe/Berlin`) bestimmt, wann „ein neuer Tag“ für Tagesstapel und Limits beginnt. Modus, Sendefenster, Zielländer und Vorlagen pflegt ihr unter **Agent → Einstellungen** – siehe [AGENT.md](AGENT.md).

Ohne Schlüssel funktioniert alles andere; der Agent entwirft dann aus Vorlagen ohne Recherche, die KI-Knöpfe im Postfach sind ausgeblendet.

## 5. System-E-Mails (optional)

Für automatisch versendete Einladungen und „Passwort vergessen“: im Spacemail Manager ein Postfach wie `intranet@nalpia.com` anlegen und eintragen:

```
SMTP_HOST=mail.spacemail.com
SMTP_PORT=465
SMTP_USER=intranet@nalpia.com
SMTP_PASS=<Passwort dieses Postfachs>
SMTP_FROM="nalpia Intranet <intranet@nalpia.com>"
```

Ohne SMTP zeigt die Verwaltung die Einladungs- und Reset-Links zum Kopieren an. Mit SMTP gehen Reset-Links für aktive Konten ausschließlich per E-Mail an die betroffene Person.

## 6. Starten

```bash
docker compose up -d --build
docker compose logs -f intranet
```

Beim ersten Start wird die erste Admin-Person angelegt. Den Link zum Passwort-Festlegen (7 Tage gültig) bekommst du so:

- **Mit SMTP:** per E-Mail an `BOOTSTRAP_ADMIN_EMAIL`.
- **Ohne SMTP:** einmalig über die Kommandozeile – aus Sicherheitsgründen steht er nicht in den Logs:
  ```bash
  docker compose exec intranet node dist/server/cli.js reset-link --email denis@nalpia.com
  ```

Link öffnen, Passwort festlegen, fertig. Caddy holt das HTTPS-Zertifikat automatisch.

Danach in dieser Reihenfolge:
1. **Einstellungen → Sicherheit:** Zwei-Faktor-Anmeldung einrichten. Ohne eigene 2FA kann eine Admin-Person keine Passwörter oder 2FA anderer zurücksetzen, keine Rollen ändern und keinen CRM-Import ausführen.
2. **Verwaltung → Sicherheit:** „2FA für alle verpflichtend“ einschalten (empfohlen).
3. **Verwaltung → Import → „nalpia-Team anlegen“** legt Denis und Carlo als eingeladene Konten mit Organigramm an (ohne Links zu verschicken); alternativ **Personen einladen**. Externe (Advisor) danach unter Team → Bearbeiten eintragen.
4. **Verwaltung → Import → „nalpia-Neuigkeiten anlegen“** füllt die News mit Startbeiträgen (Intranet, Produkt, Runde, Partner, Team).
5. **Investoren einspielen** (Abschnitt 8).
6. **Postfach verbinden** (Denis) und **Agent → Einstellungen** prüfen: Postfach-Inhaber, Deck-Link, Buchungslink, Zielländer. Standard ist der Prüfmodus.
7. **Investoren → „Ziel ändern“:** Rundenname, Zielvolumen und Pre-Money-Bewertung eintragen – der Agent liest die Zahlen von dort.

## 7. Betrieb

**Backups** (Datenbank im laufenden Betrieb konsistent sichern), z. B. täglich per Cron auf dem Server:

```bash
# /etc/cron.d/nalpia-intranet
15 3 * * * root cd /opt/nalpia-intranet && docker compose exec -T intranet node dist/server/cli.js backup && \
  docker compose cp intranet:/data/backups /var/backups/nalpia-intranet
```

Die Backups zusätzlich verschlüsselt außer Haus kopieren (z. B. Hetzner Storage Box). Mail-Inhalte liegen nicht in der Datenbank – Agent-Entwürfe, gesendete Erstmails und klassifizierte Antworten schon.

**Updates:**

```bash
git pull && docker compose up -d --build
```

Datenbank-Migrationen laufen beim Start automatisch.

Hat sich der `Caddyfile` geändert, Caddy danach einmal neu erstellen:

```bash
docker compose up -d --force-recreate caddy
```

**Weitere Websites auf demselben Server:** Caddy bindet zusätzlich jede `deploy/site.caddy` unter `/opt/sites/<name>/` ein (read-only unter `/srv/sites` im Container). Container einer solchen Site hängen im gemeinsamen Netz `nalpia-web`. Ohne weitere Sites ändert sich nichts.

**Verwaltungsbefehle** (im Container):

```bash
docker compose exec intranet node dist/server/cli.js list-users
docker compose exec intranet node dist/server/cli.js reset-link --email name@nalpia.com
docker compose exec intranet node dist/server/cli.js unlock --email name@nalpia.com
docker compose exec intranet node dist/server/cli.js create-admin --email denis@nalpia.com --name "Denis Keller"
docker compose exec intranet node dist/server/cli.js seed-team            # Organigramm/Kernteam (--update setzt Struktur zurück)
docker compose exec intranet node dist/server/cli.js seed-news            # Startbeiträge (--dry-run nur Vorschau)
docker compose exec intranet node dist/server/cli.js rescore-investors    # Fit für nalpia neu berechnen (--fill-focus ergänzt leere Fokus-Tags)
docker compose exec intranet node dist/server/cli.js agent-run --kind all # Agent einmal laufen lassen (Posteingang, Follow-ups, Entwürfe; Versand nur im Autopilot)
docker compose exec intranet node dist/server/cli.js verify-audit
```

## 8. Investoren aus dem SINTRO-CRM übernehmen

Die Investoren liegen **nicht im Repo** (persönliche Daten). Das CRM-Paket `investors-bundle.json` (1.702 Firmen, 2.017 Ansprechpartner, Vorgeschichte aus der SINTRO-Runde) erzeugt ihr aus dem SINTRO-CRM-Export:

```bash
npx tsx scripts/export-to-bundle.ts <export-ordner-oder-dateien> --out data/seed/investors-bundle.json
```

Neu recherchierte Investoren (ohne SINTRO-Vorgeschichte) pflegt ihr als Liste `data/seed/research-<batch>.json` (Firma, Ort, Website, Fokus, Phase, Ticket, Quelle, ggf. veröffentlichte Pitch-Adresse) und wandelt sie um:

```bash
npx tsx scripts/research-to-bundle.ts data/seed/research-2026-11.json --out data/seed/research-bundle.json
```

Beide Pakete lassen sich nacheinander oder zusammengeführt importieren; Referenzen verhindern Dubletten. Fehlende E-Mail-Adressen (Tag „E-Mail: fehlt“) ergänzt ihr in der Kontaktkarte oder per Anreicherungsdienst – der Agent schreibt nur Ansprechpartner mit Adresse an.

Einspielen im Browser: **Verwaltung → Import → Investoren importieren (CRM-Paket)** – Vorschau, dann „Importieren“ (Passwort + 2FA). Oder auf dem Server:

```bash
docker compose cp investors-bundle.json intranet:/data/investors-bundle.json
docker compose exec intranet node dist/server/cli.js import-crm --file /data/investors-bundle.json --owner denis@nalpia.com --dry-run
docker compose exec intranet node dist/server/cli.js import-crm --file /data/investors-bundle.json --owner denis@nalpia.com
```

Wiederholtes Importieren legt nichts doppelt an; Status, Zuständigkeit, Notizen und von Hand gesetzte Prioritäten bleiben erhalten (mit `--update` überschreibt das Paket). Der Import berechnet den Fit für nalpia mit.

**Geplante Aufgaben im Paket:** Ein CRM-Paket kann zusätzlich eine Liste `tasks` enthalten – z. B. Startaufgaben fürs Team oder eine Outreach-Welle mit einer Aufgabe je Investor:

```json
"tasks": [
  { "ref": "start:exist-antrag", "title": "EXIST-Antrag einreichen", "assigneeEmail": "name@nalpia.com",
    "dueDate": "2027-01-31", "priority": "hoch", "description": "…", "orgRef": "crm:firm:…" }
]
```

Zugewiesen wird per E-Mail an ein bestehendes Konto (auch eingeladen, noch nicht aktiviert). Der Schalter „Aufgaben aus dem CRM anlegen“ ist dafür nicht nötig – er betrifft nur Aufgaben aus der CRM-Vorgeschichte. Gibt es das Konto nicht, entsteht die Aufgabe ohne Zuständigkeit und die Vorschau zeigt einen Hinweis – also vorher alle Personen anlegen. `orgRef` (oder `orgName`) verknüpft die Aufgabe mit einer Firma. Wiederholtes Importieren legt nichts doppelt an (Referenz `plan:<ref>`); mit `--update` bzw. dem Schalter „Bereits importierte Datensätze überschreiben“ werden offene Aufgaben überschrieben, erledigte bleiben unangetastet. Jede Person erhält eine Benachrichtigung mit der Zahl ihrer neuen Aufgaben.

## Alternative ohne eigenen Server

Das Image läuft auf jeder Plattform mit Docker und einem persistenten Volume (z. B. Fly.io mit Region `fra`, Render mit Disk). Wichtig: genau **eine** Instanz (SQLite, Agent-Scheduler), Volume unter `/data`, `TRUST_PROXY=true` und `APP_URL` auf die öffentliche Adresse setzen.

## Fehlersuche

| Problem | Lösung |
|---|---|
| „Spacemail hat die Anmeldung abgelehnt“ | Passwort im Spacemail-Webmail prüfen; im Spacemail Manager nachsehen, ob IMAP/SMTP für das Postfach eingeschaltet ist |
| „Du kannst nur dein eigenes Postfach verbinden“ | Die Intranet-Adresse muss der Spacemail-Adresse entsprechen (z. B. `denis@nalpia.com`); bei Alias-Adressen siehe Abschnitt 0 |
| „Zu viele Versuche“ | 15 Minuten warten (höchstens 6 Verbindungsversuche pro Person) |
| Agent entwirft, sendet aber nicht | Postfach des Postfach-Inhabers verbinden (Agent-Seite zeigt den Hinweis); im Prüfmodus sendet nur der Klick; im Autopilot zählen Sendefenster und Tageslimit |
| Agent findet keine Kandidaten | Investoren brauchen Ansprechpartner mit E-Mail, Status *Identifiziert*, Fit ≥ Mindest-Fit und ein Zielland (Standard US) – siehe Agent → Kandidaten |
| Person gesperrt | Verwaltung → Personen → „Sperre aufheben“ oder CLI `unlock` |
| Handy verloren (2FA) | Wiederherstellungscode nutzen oder Admin setzt 2FA zurück |
