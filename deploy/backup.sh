#!/usr/bin/env bash
# Tägliche Sicherung der Intranet-Datenbank (systemd-Timer nalpia-intranet-backup.timer).
# Nutzt den eingebauten, konsistenten Online-Backup-Befehl und kopiert nach /var/backups/nalpia-intranet (14 Tage).
set -euo pipefail
DIR="${BACKUP_DIR:-/var/backups/nalpia-intranet}"
mkdir -p "$DIR"; chmod 700 "$DIR"
docker exec nalpia-intranet node dist/server/cli.js backup
cp -n /var/lib/nalpia-intranet/backups/* "$DIR"/ 2>/dev/null || true
chmod 600 "$DIR"/* 2>/dev/null || true
find "$DIR" -type f -mtime +14 -delete
find /var/lib/nalpia-intranet/backups -type f -mtime +3 -delete 2>/dev/null || true
echo "[nalpia-intranet] Sicherung abgelegt in $DIR"
