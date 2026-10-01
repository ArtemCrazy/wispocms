#!/bin/sh
set -eu

PROJECT_DIR=/opt/wispo-cms
BACKUP_DIR=${WISPO_CUSTOMER_BACKUP_DIR:-/root/wispo-cms-backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SQL_TEMP="$BACKUP_DIR/.wispo-$STAMP.sql.tmp"
DB_TEMP="$BACKUP_DIR/.wispo-$STAMP.sql.gz.tmp"
MEDIA_TEMP="$BACKUP_DIR/.wispo-media-$STAMP.tar.gz.tmp"
DB_ARCHIVE="$BACKUP_DIR/wispo-$STAMP.sql.gz"
MEDIA_ARCHIVE="$BACKUP_DIR/wispo-media-$STAMP.tar.gz"

cleanup() {
  rm -f "$SQL_TEMP" "$DB_TEMP" "$MEDIA_TEMP"
}
trap cleanup EXIT HUP INT TERM

umask 077
mkdir -p "$BACKUP_DIR"
cd "$PROJECT_DIR"

docker compose --env-file deploy/.env.customer \
  -f deploy/compose.preview.yaml -f deploy/compose.customer.yaml \
  exec -T postgres sh -c \
  'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$SQL_TEMP"
test -s "$SQL_TEMP"
gzip -9 -c "$SQL_TEMP" > "$DB_TEMP"
gzip -t "$DB_TEMP"

docker compose --env-file deploy/.env.customer \
  -f deploy/compose.preview.yaml -f deploy/compose.customer.yaml \
  exec -T api tar -C /data/media -czf - . > "$MEDIA_TEMP"
test -s "$MEDIA_TEMP"
tar -tzf "$MEDIA_TEMP" >/dev/null

mv "$DB_TEMP" "$DB_ARCHIVE"
mv "$MEDIA_TEMP" "$MEDIA_ARCHIVE"
sha256sum "$DB_ARCHIVE" > "$DB_ARCHIVE.sha256"
sha256sum "$MEDIA_ARCHIVE" > "$MEDIA_ARCHIVE.sha256"
printf 'Customer backup created: %s and %s\n' "$DB_ARCHIVE" "$MEDIA_ARCHIVE"
