#!/usr/bin/env bash
set -euo pipefail

backup_root="${JLPT_BACKUP_DIR:-/var/backups/jlpt}"
database_url="${DATABASE_URL:?DATABASE_URL is required}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
day_of_week="$(date -u +%u)"

install -d -m 700 "$backup_root/daily" "$backup_root/weekly"
pg_dump --format=custom --no-owner --no-acl "$database_url" > "$backup_root/daily/jlpt-$stamp.dump"
find "$backup_root/daily" -type f -name 'jlpt-*.dump' -mtime +7 -delete

if [[ "$day_of_week" == "7" ]]; then
  cp "$backup_root/daily/jlpt-$stamp.dump" "$backup_root/weekly/jlpt-$stamp.dump"
  find "$backup_root/weekly" -type f -name 'jlpt-*.dump' -mtime +28 -delete
fi

pg_restore --list "$backup_root/daily/jlpt-$stamp.dump" >/dev/null
