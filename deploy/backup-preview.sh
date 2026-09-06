#!/bin/sh

set -eu

PROJECT_DIR="/opt/wispo-cms"
COMPOSE_FILE="$PROJECT_DIR/deploy/compose.preview.yaml"
ENV_FILE="$PROJECT_DIR/deploy/.env.preview"
BACKUP_DIR="${WISPO_BACKUP_DIR:-/root/wispo-cms-backups/database}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SQL_TEMP="$BACKUP_DIR/.wispo-$STAMP.sql.tmp"
ARCHIVE_TEMP="$BACKUP_DIR/.wispo-$STAMP.sql.gz.tmp"
FINAL_ARCHIVE="$BACKUP_DIR/wispo-$STAMP.sql.gz"
CHECKSUM_TEMP="$BACKUP_DIR/.wispo-$STAMP.sha256.tmp"

cleanup() {
  rm -f "$SQL_TEMP" "$ARCHIVE_TEMP" "$CHECKSUM_TEMP"
}

trap cleanup EXIT HUP INT TERM
umask 077
mkdir -p "$BACKUP_DIR"

cd "$PROJECT_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$SQL_TEMP"

test -s "$SQL_TEMP"
gzip -9 -c "$SQL_TEMP" > "$ARCHIVE_TEMP"
gzip -t "$ARCHIVE_TEMP"
mv "$ARCHIVE_TEMP" "$FINAL_ARCHIVE"
sha256sum "$FINAL_ARCHIVE" > "$CHECKSUM_TEMP"
mv "$CHECKSUM_TEMP" "$FINAL_ARCHIVE.sha256"

printf 'Wispo database backup created: %s\n' "$FINAL_ARCHIVE"
