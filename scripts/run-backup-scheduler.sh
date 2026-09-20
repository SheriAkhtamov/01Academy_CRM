#!/bin/sh

set -eu

BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-3600}"
BACKUP_RETRY_SECONDS="${BACKUP_RETRY_SECONDS:-300}"

validate_positive_integer() {
  name="$1"
  value="$2"

  case "$value" in
    ''|*[!0-9]*)
      echo "$name must be a positive integer" >&2
      exit 1
      ;;
  esac

  if [ "$value" -lt 1 ]; then
    echo "$name must be at least 1" >&2
    exit 1
  fi
}

validate_positive_integer BACKUP_INTERVAL_SECONDS "$BACKUP_INTERVAL_SECONDS"
validate_positive_integer BACKUP_RETRY_SECONDS "$BACKUP_RETRY_SECONDS"

trap 'exit 0' INT TERM

echo "Backup scheduler started: interval=${BACKUP_INTERVAL_SECONDS}s, retry=${BACKUP_RETRY_SECONDS}s"

# Deployment creates and verifies one backup synchronously. On restarts, wait
# only for the unused portion of the hourly interval; if the last copy is
# already old, create a new one immediately.
if [ -f "${BACKUP_DIR:-/backups}/.last-success" ]; then
  now="$(date +%s)"
  last_success="$(stat -c %Y "${BACKUP_DIR:-/backups}/.last-success")"
  age="$((now - last_success))"

  if [ "$age" -ge 0 ] && [ "$age" -lt "$BACKUP_INTERVAL_SECONDS" ]; then
    initial_delay="$((BACKUP_INTERVAL_SECONDS - age))"
    echo "Recent backup found; next backup starts in ${initial_delay}s"
    sleep "$initial_delay" &
    sleep_pid="$!"
    wait "$sleep_pid" || exit 0
  fi
fi

while :; do
  started_at="$(date +%s)"

  if /usr/local/bin/create-production-backup; then
    finished_at="$(date +%s)"
    elapsed="$((finished_at - started_at))"

    if [ "$elapsed" -lt "$BACKUP_INTERVAL_SECONDS" ]; then
      delay="$((BACKUP_INTERVAL_SECONDS - elapsed))"
    else
      # Avoid a tight loop when a very large backup takes longer than an hour.
      delay=60
    fi
  else
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Backup failed; retrying in ${BACKUP_RETRY_SECONDS}s" >&2
    delay="$BACKUP_RETRY_SECONDS"
  fi

  sleep "$delay" &
  sleep_pid="$!"
  wait "$sleep_pid" || exit 0
done
