#!/usr/bin/env bash
# Holt den neuesten Stand von main, baut das Image und startet das nalpia-Intranet neu.
# Läuft automatisch alle 2 Minuten über den systemd-Timer nalpia-intranet-update.timer.
# Manuell:  sudo /opt/sites/nalpia-intranet/deploy/update.sh [--force]
#
# - Gebaut wird nur, wenn sich etwas geändert hat (oder mit --force).
# - Schlägt der Build fehl, läuft der alte Container weiter.
# - Eine fehlerhafte deploy/site.caddy wird vor dem Build erkannt und nicht übernommen;
#   SINTRO-Intranet, nalpia.com, app.nalpia.com und sintro.org sind nie betroffen.
set -euo pipefail

SITE_DIR="${SITE_DIR:-/opt/sites/nalpia-intranet}"
INTRANET_DIR="${INTRANET_DIR:-/opt/sintro-intranet}"
ENV_FILE="${ENV_FILE:-/etc/nalpia-intranet/intranet.env}"
BRANCH="${BRANCH:-main}"
FORCE="${1:-}"

log() { echo "[nalpia-intranet] $*"; }
caddy_exec() { docker compose -f "$INTRANET_DIR/docker-compose.yml" exec -T caddy "$@" </dev/null; }
compose() { docker compose -p nalpia-intranet --env-file "$ENV_FILE" -f "$SITE_DIR/deploy/docker-compose.yml" "$@"; }

exec 9>/run/nalpia-intranet-update.lock
flock -n 9 || { log "Läuft bereits, übersprungen"; exit 0; }

cd "$SITE_DIR"
git fetch --quiet --depth 1 origin "$BRANCH"
before="$(git rev-parse HEAD)"
after="$(git rev-parse FETCH_HEAD)"
running="$(docker inspect -f '{{.State.Running}}' nalpia-intranet 2>/dev/null || echo false)"

if [[ "$before" == "$after" && "$FORCE" != "--force" && "$running" == "true" ]]; then exit 0; fi
if [[ -f .deploy-blocked && "$(cat .deploy-blocked)" == "$after" && "$FORCE" != "--force" ]]; then exit 0; fi

changed="$(git diff --name-only "$before" "$after" 2>/dev/null || echo 'deploy/')"
git reset --hard --quiet "$after"
caddy_changed=0
if [[ "$FORCE" == "--force" ]] || grep -q '^deploy/site.caddy' <<<"$changed"; then caddy_changed=1; fi

if (( caddy_changed )) && ! caddy_exec caddy validate --config /etc/caddy/Caddyfile >/tmp/nalpia-intranet-validate.log 2>&1; then
  log "FEHLER: Caddy-Konfiguration aus ${after:0:7} ist ungültig – bleibe auf ${before:0:7}"
  tail -5 /tmp/nalpia-intranet-validate.log || true
  git reset --hard --quiet "$before"
  echo "$after" > .deploy-blocked
  exit 1
fi

log "Baue Stand ${after:0:7} ($(git log -1 --format=%s))"
if ! compose build --pull; then
  log "FEHLER: Build von ${after:0:7} fehlgeschlagen – die laufende Version bleibt aktiv"
  git reset --hard --quiet "$before"
  echo "$after" > .deploy-blocked
  exit 1
fi
# Until November 2026 the service was called "intranet" (a name the SINTRO intranet uses in the shared Caddy
# network). A container from that time is replaced, so the name can no longer be resolved to nalpia.
old_service="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' nalpia-intranet 2>/dev/null || true)"
if [[ -n "$old_service" && "$old_service" != "nalpia-intranet" ]]; then
  log "Ersetze alten Container (Dienstname \"$old_service\")"
  docker rm -f nalpia-intranet >/dev/null
fi
if ! compose up -d --remove-orphans; then
  log "FEHLER: Start von ${after:0:7} fehlgeschlagen (Logs: docker logs --tail 100 nalpia-intranet)"
  echo "$after" > .deploy-blocked
  exit 1
fi
rm -f .deploy-blocked
log "Stand ${after:0:7} läuft"

if (( caddy_changed )); then
  caddy_exec caddy reload --config /etc/caddy/Caddyfile
  log "Caddy neu geladen"
fi
docker image prune -f --filter "dangling=true" >/dev/null 2>&1 || true
git gc --quiet --prune=now 2>/dev/null || true
