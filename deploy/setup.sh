#!/usr/bin/env bash
# Einmalige Einrichtung von intranet.nalpia.com auf dem Hetzner-Server
# (neben SINTRO-Intranet, sintro.org, nalpia.com und app.nalpia.com – eigener Container, eigene Daten).
#
# Aufruf als root (holt das Repo bei Bedarf selbst):
#   curl -fsSL https://raw.githubusercontent.com/SINTRO-AM/nalpia-intranet/main/deploy/setup.sh | bash
# oder, wenn das Repo schon unter /opt/sites/nalpia-intranet liegt:
#   /opt/sites/nalpia-intranet/deploy/setup.sh
# Das Skript kann gefahrlos mehrfach laufen. Vorhandene Schlüssel und Daten bleiben erhalten.
set -euo pipefail

main() {
SITE_DIR=/opt/sites/nalpia-intranet
REPO_HTTPS=https://github.com/SINTRO-AM/nalpia-intranet.git
REPO_SSH=git@github.com:SINTRO-AM/nalpia-intranet.git
KEY=/root/.ssh/nalpia_intranet_deploy
INTRANET_DIR="${INTRANET_DIR:-/opt/sintro-intranet}"
ENV_DIR=/etc/nalpia-intranet
ENV_FILE=$ENV_DIR/intranet.env
DATA_DIR=/var/lib/nalpia-intranet
DOMAIN=intranet.nalpia.com
ADMIN_EMAIL="${ADMIN_EMAIL:-denis@nalpia.com}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mAbbruch: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Bitte als root ausführen (sudo -i)."
[[ -f "$INTRANET_DIR/docker-compose.yml" ]] || die "SINTRO-Intranet nicht unter $INTRANET_DIR gefunden (INTRANET_DIR=… setzen)."
grep -q '/srv/sites/' "$INTRANET_DIR/Caddyfile" || die "Der Intranet-Caddy bindet noch keine weiteren Sites ein."
docker compose version >/dev/null 2>&1 || die "docker compose fehlt."

step "1/6 Repo holen"
mkdir -p /opt/sites
if [[ ! -d "$SITE_DIR/.git" ]]; then
  if [[ -f "$KEY" ]]; then
    GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
      git clone --depth 1 --branch main "$REPO_SSH" "$SITE_DIR"
  else
    git clone --depth 1 --branch main "$REPO_HTTPS" "$SITE_DIR" \
      || die "Klonen fehlgeschlagen. Ist das Repo privat? Dann Deploy-Key anlegen (deploy/README.md, Schritt 2) und erneut starten."
  fi
fi
[[ -f "$KEY" ]] && git -C "$SITE_DIR" config core.sshCommand "ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  && git -C "$SITE_DIR" remote set-url origin "$REPO_SSH"
chmod +x "$SITE_DIR/deploy/"*.sh
echo "Stand: $(git -C "$SITE_DIR" log -1 --format='%h %s')"

step "2/6 Konfiguration und Geheimnisse ($ENV_FILE)"
caddy_id="$(docker compose -f "$INTRANET_DIR/docker-compose.yml" ps -q caddy | head -1)"
[[ -n "$caddy_id" ]] || die "Caddy-Container des SINTRO-Intranets läuft nicht."
net="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$caddy_id" | awk '{print $1}')"
mkdir -p "$ENV_DIR" "$DATA_DIR"
chmod 700 "$ENV_DIR"
chown 1000:1000 "$DATA_DIR"   # der Container läuft als Benutzer "node" (uid 1000)
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<ENV
# nalpia Intranet – erzeugt von deploy/setup.sh am $(date +%F). NICHT ins Repo kopieren.
# APP_SECRET nie ändern: sonst müssen alle Postfächer neu verbunden und 2FA neu eingerichtet werden.
NODE_ENV=production
APP_URL=https://$DOMAIN
APP_SECRET=$(openssl rand -base64 48 | tr -d '\n')
CADDY_NETWORK=$net
BOOTSTRAP_ADMIN_EMAIL=$ADMIN_EMAIL
BOOTSTRAP_ADMIN_NAME=Denis Keller
ALLOWED_EMAIL_DOMAINS=nalpia.com
SESSION_DAYS=14
DEMO_MODE=false

# Zoho Mail (API Console EU, Redirect URI: https://$DOMAIN/api/mail/oauth/callback)
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_ACCOUNTS_URL=https://accounts.zoho.eu
ZOHO_ENFORCE_EMAIL_MATCH=true

# Claude API – ohne Schlüssel laufen Agent und Assistent nur mit Vorlagen
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5
ASSISTANT_MODEL=claude-opus-5-5
TRANSLATE_MODEL=claude-haiku-5-5
AGENT_MODEL=claude-opus-5-5
AGENT_SCHEDULER=true
AGENT_TZ=Europe/Berlin

# System-E-Mails (optional)
SMTP_HOST=smtppro.zoho.eu
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM="nalpia Intranet <intranet@nalpia.com>"
ENV
  echo "Neu angelegt (APP_SECRET zufällig erzeugt)."
else
  sed -i "s/^CADDY_NETWORK=.*/CADDY_NETWORK=$net/" "$ENV_FILE"
  echo "Vorhanden, bleibt erhalten (Caddy-Netz: $net)."
fi
chmod 600 "$ENV_FILE"

step "3/6 Bauen und starten (beim ersten Mal einige Minuten)"
"$SITE_DIR/deploy/update.sh" --force

step "4/6 Auto-Update alle 2 Minuten und tägliche Sicherung einrichten"
cat > /etc/systemd/system/nalpia-intranet-update.service <<UNIT
[Unit]
Description=nalpia Intranet: neuen Stand aus GitHub holen, bauen, neu starten
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=SITE_DIR=$SITE_DIR INTRANET_DIR=$INTRANET_DIR ENV_FILE=$ENV_FILE BRANCH=main
ExecStart=$SITE_DIR/deploy/update.sh
UNIT
cat > /etc/systemd/system/nalpia-intranet-update.timer <<'UNIT'
[Unit]
Description=nalpia Intranet alle 2 Minuten aktualisieren

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/nalpia-intranet-backup.service <<UNIT
[Unit]
Description=nalpia Intranet: Datenbank sichern
After=docker.service

[Service]
Type=oneshot
ExecStart=$SITE_DIR/deploy/backup.sh
UNIT
cat > /etc/systemd/system/nalpia-intranet-backup.timer <<'UNIT'
[Unit]
Description=nalpia Intranet: tägliche Datenbanksicherung

[Timer]
OnCalendar=*-*-* 03:27
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now nalpia-intranet-update.timer nalpia-intranet-backup.timer >/dev/null

step "5/6 Prüfen"
for i in $(seq 1 40); do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' nalpia-intranet 2>/dev/null)" == "healthy" ]] && break
  sleep 3
done
echo "Container: $(docker inspect -f '{{.State.Health.Status}}' nalpia-intranet 2>/dev/null || echo fehlt)"
code="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" http://127.0.0.1/ || true)"

step "6/6 Link für die erste Anmeldung ($ADMIN_EMAIL)"
docker exec nalpia-intranet node dist/server/cli.js reset-link --email "$ADMIN_EMAIL" || \
  echo "(Noch kein Link – in einer Minute erneut: docker exec nalpia-intranet node dist/server/cli.js reset-link --email $ADMIN_EMAIL)"

cat <<TXT

$(printf '\033[32m')Fertig.$(printf '\033[0m') Caddy antwortet lokal für $DOMAIN (HTTP $code; 308 = Weiterleitung auf HTTPS ist korrekt).
Sobald der DNS-Eintrag "intranet → $(hostname -I | awk '{print $1}')" greift, holt Caddy das Zertifikat: https://$DOMAIN

Zoho, Claude-Schlüssel und SMTP:  nano $ENV_FILE   danach  $SITE_DIR/deploy/update.sh --force
Logs:       journalctl -u nalpia-intranet-update -n 50   ·   docker logs --tail 100 nalpia-intranet
Sicherung:  /var/backups/nalpia-intranet (täglich 03:27, 14 Tage)
TXT
}

main "$@"
