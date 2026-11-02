#!/usr/bin/env bash
set -euo pipefail
umask 077
TUTOR_ROOT="${TUTOR_ROOT:-$(cd "$(dirname "$0")/.." && pwd -P)}"
TUTOR_BACKUP="$TUTOR_ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$TUTOR_BACKUP"
docker compose --project-directory "$TUTOR_ROOT" --env-file "$TUTOR_ROOT/.env" exec -T db pg_dump -U tutor -d tutor -Fc > "$TUTOR_BACKUP/database.dump"
tar -C "$TUTOR_ROOT/storage" -czf "$TUTOR_BACKUP/files.tar.gz" uploads
cp "$TUTOR_ROOT/.env" "$TUTOR_BACKUP/runtime.env"
readlink -f "$TUTOR_ROOT/current" > "$TUTOR_BACKUP/release.txt"
touch "$TUTOR_BACKUP/complete"
# Remove only completed backups made by this script, keeping at least the newest.
find "$TUTOR_ROOT/backups" -mindepth 2 -maxdepth 2 -name complete -mtime +14 -print0 | while IFS= read -r -d '' marker; do rm -rf -- "$(dirname "$marker")"; done
printf 'Backup saved: %s\n' "$TUTOR_BACKUP"
