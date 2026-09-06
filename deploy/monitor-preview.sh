#!/bin/sh

set -u

PUBLIC_URL="${WISPO_PUBLIC_URL:-https://wispo-cms.45.12.74.66.nip.io}"
PUBLIC_HOST="${WISPO_PUBLIC_HOST:-wispo-cms.45.12.74.66.nip.io}"
DISK_PATH="${WISPO_DISK_PATH:-/var/lib/docker}"
DISK_LIMIT_PERCENT="${WISPO_DISK_LIMIT_PERCENT:-85}"
BACKUP_MAX_AGE_MINUTES="${WISPO_BACKUP_MAX_AGE_MINUTES:-1800}"
DATABASE_BACKUP_DIR="${WISPO_BACKUP_DIR:-/root/wispo-cms-backups/database}"
MEDIA_BACKUP_DIR="${WISPO_MEDIA_BACKUP_DIR:-/root/wispo-cms-backups/media}"
TLS_MIN_SECONDS="${WISPO_TLS_MIN_SECONDS:-1209600}"
SYSLOG_ENABLED="${WISPO_MONITOR_SYSLOG:-true}"
NOW_EPOCH="$(date +%s)"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FAILURES=0

fail() {
  FAILURES=$((FAILURES + 1))
  printf 'FAIL %s\n' "$1" >&2
}

check_container() {
  name="$1"
  state="$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || true)"

  if [ "$state" != "running" ]; then
    fail "container=$name state=${state:-missing}"
  elif [ "$health" != "healthy" ]; then
    fail "container=$name health=${health:-missing}"
  fi
}

check_backup() {
  directory="$1"
  pattern="$2"
  require_manifest="$3"

  if [ ! -d "$directory" ]; then
    fail "backup_directory=$directory state=missing"
    return
  fi

  latest="$(find "$directory" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' 2>/dev/null | sort -nr | sed -n '1s/^[^ ]* //p')"
  if [ -z "$latest" ]; then
    fail "backup_directory=$directory archive=missing"
    return
  fi

  modified="$(stat -c %Y "$latest" 2>/dev/null || printf '0')"
  age_minutes=$(( (NOW_EPOCH - modified) / 60 ))
  if [ "$age_minutes" -gt "$BACKUP_MAX_AGE_MINUTES" ]; then
    fail "backup=$latest age_minutes=$age_minutes limit_minutes=$BACKUP_MAX_AGE_MINUTES"
  fi

  if [ ! -s "$latest.sha256" ]; then
    fail "backup=$latest checksum=missing"
  fi

  if [ "$require_manifest" = "yes" ] && [ ! -s "$latest.manifest" ]; then
    fail "backup=$latest manifest=missing"
  fi
}

check_container wispo-cms-preview-postgres-1
check_container wispo-cms-preview-api-1
check_container wispo-cms-preview-web-1

health_body="$(curl --connect-timeout 5 --max-time 15 --fail --silent --show-error "$PUBLIC_URL/api/health" 2>/dev/null || true)"
if ! printf '%s' "$health_body" | grep -q '"status":"ok"'; then
  fail "endpoint=$PUBLIC_URL/api/health response=invalid"
fi

if ! curl --connect-timeout 5 --max-time 15 --fail --silent --output /dev/null "$PUBLIC_URL/"; then
  fail "endpoint=$PUBLIC_URL/ response=unavailable"
fi

if ! curl --connect-timeout 5 --max-time 15 --fail --silent --output /dev/null "$PUBLIC_URL/preview/wispo-media"; then
  fail "endpoint=$PUBLIC_URL/preview/wispo-media response=unavailable"
fi

if ! printf '\n' | openssl s_client -servername "$PUBLIC_HOST" -connect "$PUBLIC_HOST:443" 2>/dev/null | openssl x509 -checkend "$TLS_MIN_SECONDS" -noout >/dev/null 2>&1; then
  fail "tls_host=$PUBLIC_HOST validity=less_than_${TLS_MIN_SECONDS}_seconds"
fi

disk_percent="$(df -P "$DISK_PATH" 2>/dev/null | awk 'NR == 2 {gsub("%", "", $5); print $5}')"
case "$disk_percent" in
  ''|*[!0-9]*) fail "disk_path=$DISK_PATH usage=unknown" ;;
  *)
    if [ "$disk_percent" -ge "$DISK_LIMIT_PERCENT" ]; then
      fail "disk_path=$DISK_PATH usage_percent=$disk_percent limit_percent=$DISK_LIMIT_PERCENT"
    fi
    ;;
esac

check_backup "$DATABASE_BACKUP_DIR" 'wispo-*.sql.gz' no
check_backup "$MEDIA_BACKUP_DIR" 'wispo-media-*.tar.gz' yes

if [ "$FAILURES" -gt 0 ]; then
  summary="Wispo CMS monitor failed at $STAMP: failures=$FAILURES"
  if [ "$SYSLOG_ENABLED" = "true" ]; then
    logger -p daemon.err -t wispo-cms-monitor -- "$summary" 2>/dev/null || true
  fi
  printf '%s\n' "$summary" >&2
  exit 1
fi

printf 'OK %s containers=3 endpoints=3 tls=valid disk_percent=%s backups=fresh\n' "$STAMP" "$disk_percent"
