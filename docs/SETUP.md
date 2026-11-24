# Einrichtung und Betrieb

Diese Anleitung bringt das Intranet unter `https://intranet.nalpia.com` online. Rechne mit rund einer Stunde, die Zoho-Postfächer der Mitarbeitenden nicht eingerechnet. Das nalpia-Intranet ist vom SINTRO-Intranet unabhängig: eigener Server oder eigener Container, eigene Datenbank, eigene Zoho-App.

## 0. Vorab klären: eigenes Zoho-Postfach pro Person

Jede Person verbindet im Intranet **ihr eigenes** Zoho-Postfach (Domain `nalpia.com`). Das Intranet prüft beim Verbinden, dass das Zoho-Postfach zur Intranet-Adresse der Person passt. Läuft eine Adresse nur als Alias auf einem anderen Postfach, muss in der Zoho-Mail-Administration (mailadmin.zoho.eu → Benutzer) zuerst ein eigenes Benutzerkonto mit Postfach angelegt werden.

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

## 3. Zoho-Mail-Anbindung (einmalig, ca. 5 Minuten)

1. Öffne die **Zoho API Console für das EU-Rechenzentrum**: https://api-console.zoho.eu (mit einem Admin-Konto der nalpia-Organisation anmelden).
2. **Add Client → Server-based Applications**.
3. Ausfüllen:
   - Client Name: `nalpia Intranet`
   - Homepage URL: `https://intranet.nalpia.com`
   - Authorized Redirect URIs: `https://intranet.nalpia.com/api/mail/oauth/callback`
4. **Create** → `Client ID` und `Client Secret` in `.env` eintragen (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`).
5. `ZOHO_ACCOUNTS_URL=https://accounts.zoho.eu` bleibt so (EU-Rechenzentrum).

Angefordert werden nur diese Berechtigungen: Konto lesen, Ordner lesen, Nachrichten lesen/senden/markieren, Kalender (`ZohoMail.accounts.READ`, `ZohoMail.folders.READ`, `ZohoMail.messages.ALL`, `ZohoCalendar.calendar.READ`, `ZohoCalendar.event.ALL`). Jede Person bestätigt den Zugriff selbst und kann ihn im Intranet (Einstellungen → Postfach → Trennen) oder unter accounts.zoho.eu → *Connected Apps* jederzeit widerrufen.

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

Für automatisch versendete Einladungen und „Passwort vergessen“: ein Postfach wie `intranet@nalpia.com` anlegen, in Zoho ein **App-Passwort** erzeugen (Mein Konto → Sicherheit → App-Passwörter) und eintragen:

```
SMTP_HOST=smtppro.zoho.eu
SMTP_PORT=465
SMTP_USER=intranet@nalpia.com
SMTP_PASS=<App-Passwort>
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

## Alternative ohne eigenen Server

Das Image läuft auf jeder Plattform mit Docker und einem persistenten Volume (z. B. Fly.io mit Region `fra`, Render mit Disk). Wichtig: genau **eine** Instanz (SQLite, Agent-Scheduler), Volume unter `/data`, `TRUST_PROXY=true` und `APP_URL` auf die öffentliche Adresse setzen.

## Fehlersuche

| Problem | Lösung |
|---|---|
| „Das Zoho-Postfach … gehört nicht zu deinem Intranet-Konto“ | Bei Zoho mit dem eigenen Postfach anmelden. Ggf. vorher bei accounts.zoho.eu abmelden. Bei Alias-Postfächern siehe Abschnitt 0 |
| „Zoho hat keinen dauerhaften Zugriff gewährt“ | Unter accounts.zoho.eu → Connected Apps „nalpia Intranet“ entfernen und neu verbinden |
| Redirect-Fehler bei Zoho | Redirect URI in der API Console muss exakt `APP_URL + /api/mail/oauth/callback` sein |
| Agent entwirft, sendet aber nicht | Postfach des Postfach-Inhabers verbinden (Agent-Seite zeigt den Hinweis); im Prüfmodus sendet nur der Klick; im Autopilot zählen Sendefenster und Tageslimit |
| Agent findet keine Kandidaten | Investoren brauchen Ansprechpartner mit E-Mail, Status *Identifiziert*, Fit ≥ Mindest-Fit und ein Zielland (Standard US) – siehe Agent → Kandidaten |
| Person gesperrt | Verwaltung → Personen → „Sperre aufheben“ oder CLI `unlock` |
| Handy verloren (2FA) | Wiederherstellungscode nutzen oder Admin setzt 2FA zurück |
