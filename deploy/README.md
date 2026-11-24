# intranet.nalpia.com auf dem Hetzner-Server

Gleiches Muster wie nalpia.com und app.nalpia.com: Der Caddy aus dem SINTRO-Intranet-Stack liefert aus und holt
das HTTPS-Zertifikat. Das nalpia-Intranet läuft daneben in einem **eigenen** Container mit eigener Datenbank
(`/var/lib/nalpia-intranet`) und eigener Konfiguration (`/etc/nalpia-intranet/intranet.env`) – vom SINTRO-Intranet
getrennt. Ein Timer holt alle 2 Minuten den neuesten Stand von `main`, baut auf dem Server und startet neu.

```
Push auf main ──► Server (alle 2 Min.): deploy/update.sh ──► docker compose build/up
                   nalpia-intranet (Port 8080) ◄── Caddy ◄── https://intranet.nalpia.com
```

## Einmalige Einrichtung

1. **DNS bei Spaceship:** A-Eintrag Host `intranet` → `62.238.62.17`.
2. **Auf dem Server als root:**
   ```bash
   curl -fsSL https://raw.githubusercontent.com/SINTRO-AM/nalpia-intranet/main/deploy/setup.sh | bash
   ```
   Das Skript klont das Repo nach `/opt/sites/nalpia-intranet`, erzeugt `APP_SECRET`, baut und startet, bindet
   `intranet.nalpia.com` in Caddy ein, richtet Auto-Update und tägliche Sicherung ein und gibt am Ende den Link
   für die erste Anmeldung (denis@nalpia.com) aus.

   Ist das Repo privat, vorher einen Deploy-Key anlegen und in GitHub unter *Settings → Deploy keys* (ohne
   Schreibrecht) eintragen, dann das Skript aus einer lokalen Kopie starten:
   ```bash
   ssh-keygen -t ed25519 -N "" -C "hetzner nalpia-intranet" -f /root/.ssh/nalpia_intranet_deploy && cat /root/.ssh/nalpia_intranet_deploy.pub
   ```
3. **Zoho, Claude, SMTP:** `nano /etc/nalpia-intranet/intranet.env`, dann `/opt/sites/nalpia-intranet/deploy/update.sh --force`.

## Im Alltag

- Ändern: nach `main` pushen, nach spätestens 2 Minuten läuft der neue Stand.
- Zustand: `curl https://intranet.nalpia.com/healthz`
- Logs: `journalctl -u nalpia-intranet-update -n 50` · `docker logs --tail 100 nalpia-intranet`
- Verwaltung: `docker exec nalpia-intranet node dist/server/cli.js list-users` (ebenso `reset-link`, `import-crm`, `agent-run` …)
- Sicherungen: täglich 03:27 nach `/var/backups/nalpia-intranet`, 14 Tage.
- Schlägt ein Build fehl, läuft die alte Version weiter (`.deploy-blocked`), bis ein neuer Commit kommt oder `update.sh --force` läuft.
