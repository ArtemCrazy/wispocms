#!/bin/sh

set -eu

PROJECT_DIR="/opt/wispo-cms"
COMPOSE_FILE="$PROJECT_DIR/deploy/compose.preview.yaml"
ENV_FILE="$PROJECT_DIR/deploy/.env.preview"
BACKUP_DIR="${WISPO_MEDIA_BACKUP_DIR:-/root/wispo-cms-backups/media}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_TEMP="$BACKUP_DIR/.wispo-media-$STAMP.tar.gz.tmp"
FINAL_ARCHIVE="$BACKUP_DIR/wispo-media-$STAMP.tar.gz"
CHECKSUM_TEMP="$BACKUP_DIR/.wispo-media-$STAMP.sha256.tmp"
MANIFEST_TEMP="$BACKUP_DIR/.wispo-media-$STAMP.manifest.tmp"

cleanup() {
  rm -f "$ARCHIVE_TEMP" "$CHECKSUM_TEMP" "$MANIFEST_TEMP"
}

trap cleanup EXIT HUP INT TERM
umask 077
mkdir -p "$BACKUP_DIR"

cd "$PROJECT_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api \
  sh -c 'tar -C /data/media -czf - .' > "$ARCHIVE_TEMP"

test -s "$ARCHIVE_TEMP"
gzip -t "$ARCHIVE_TEMP"
tar -tzf "$ARCHIVE_TEMP" >/dev/null
mv "$ARCHIVE_TEMP" "$FINAL_ARCHIVE"
sha256sum "$FINAL_ARCHIVE" > "$CHECKSUM_TEMP"

{
  printf 'created_utc=%s\n' "$STAMP"
  printf 'source=/data/media\n'
  printf 'files='
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api \
    sh -c "find /data/media -type f | wc -l" | tr -d ' \r'
  printf 'archive_bytes=%s\n' "$(wc -c < "$FINAL_ARCHIVE" | tr -d ' ')"
} > "$MANIFEST_TEMP"

mv "$CHECKSUM_TEMP" "$FINAL_ARCHIVE.sha256"
mv "$MANIFEST_TEMP" "$FINAL_ARCHIVE.manifest"

printf 'Wispo media backup created: %s\n' "$FINAL_ARCHIVE"
