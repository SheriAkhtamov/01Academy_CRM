#!/usr/bin/env bash

set -Eeuo pipefail

umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/srv/backups/01academy-crm}"
ARCHIVE_DIR="${BACKUP_ROOT}/hourly"
INCOMING_DIR="${BACKUP_ROOT}/.incoming"
LOCK_FILE="${BACKUP_ROOT}/.pull.lock"
STATUS_FILE="${BACKUP_ROOT}/.last-success"
REMOTE_USER="${REMOTE_USER:-azamtim}"
REMOTE_PATH="${REMOTE_PATH:-/}"
REMOTE_SSH_PORT="${REMOTE_SSH_PORT:-22}"
SSH_KEY_PATH="${SSH_KEY_PATH:-/var/lib/crmbackup/.ssh/id_ed25519}"
SSH_KNOWN_HOSTS="${SSH_KNOWN_HOSTS:-/var/lib/crmbackup/.ssh/known_hosts}"
RETENTION_DAYS="${RETENTION_DAYS:-90}"
MAX_BACKUP_AGE_SECONDS="${MAX_BACKUP_AGE_SECONDS:-10800}"
MIN_FREE_KIB="${MIN_FREE_KIB:-5242880}"

: "${REMOTE_HOST:?REMOTE_HOST must be configured}"

validate_unsigned_integer() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "$name must be an unsigned integer" >&2
    exit 1
  fi
}

validate_unsigned_integer REMOTE_SSH_PORT "$REMOTE_SSH_PORT"
validate_unsigned_integer RETENTION_DAYS "$RETENTION_DAYS"
validate_unsigned_integer MAX_BACKUP_AGE_SECONDS "$MAX_BACKUP_AGE_SECONDS"
validate_unsigned_integer MIN_FREE_KIB "$MIN_FREE_KIB"

for required_command in df flock jq pg_restore rsync sha256sum ssh stat unzip; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $required_command" >&2
    exit 1
  fi
done

if [[ ! -r "$SSH_KEY_PATH" ]]; then
  echo "SSH private key is unavailable: $SSH_KEY_PATH" >&2
  exit 1
fi

if [[ ! -r "$SSH_KNOWN_HOSTS" ]]; then
  echo "Pinned SSH host key is unavailable: $SSH_KNOWN_HOSTS" >&2
  exit 1
fi

mkdir -p "$ARCHIVE_DIR" "$INCOMING_DIR"

if [[ "${BACKUP_PULL_LOCK_HELD:-0}" != "1" ]]; then
  export BACKUP_PULL_LOCK_HELD=1
  exec flock --exclusive --nonblock "$LOCK_FILE" "$0" "$@"
fi

available_kib="$(df -Pk "$BACKUP_ROOT" | awk 'NR == 2 {print $4}')"
validate_unsigned_integer available_kib "$available_kib"
if (( available_kib < MIN_FREE_KIB )); then
  echo "Insufficient free space in $BACKUP_ROOT: ${available_kib} KiB available" >&2
  exit 1
fi

run_dir="$(mktemp -d "${INCOMING_DIR}/pull.XXXXXX")"
dump_file="${run_dir}/.database.dump"
cleanup() {
  rm -rf "$run_dir"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

ssh_command="ssh -p ${REMOTE_SSH_PORT} -i ${SSH_KEY_PATH} -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${SSH_KNOWN_HOSTS} -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=3"

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Pulling new CRM backups"
rsync \
  --archive \
  --ignore-existing \
  --prune-empty-dirs \
  --timeout=180 \
  --chmod=F600,D700 \
  --compare-dest="$ARCHIVE_DIR" \
  --include='/academy-crm-backup-*.zip' \
  --include='/academy-crm-backup-*.zip.sha256' \
  --exclude='*' \
  -e "$ssh_command" \
  "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}" \
  "${run_dir}/"

shopt -s nullglob
imported_count=0

for staged_archive in "${run_dir}"/academy-crm-backup-*.zip; do
  archive_name="$(basename "$staged_archive")"
  staged_checksum="${staged_archive}.sha256"

  if [[ ! -f "$staged_checksum" ]]; then
    echo "Skipping archive whose checksum has not been published yet: $archive_name"
    continue
  fi

  expected_sha256="$(awk 'NF {print $1; exit}' "$staged_checksum")"
  if [[ ! "$expected_sha256" =~ ^[[:xdigit:]]{64}$ ]]; then
    echo "Invalid SHA-256 file for $archive_name" >&2
    exit 1
  fi

  actual_sha256="$(sha256sum "$staged_archive" | awk '{print $1}')"
  if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    echo "SHA-256 mismatch for $archive_name" >&2
    exit 1
  fi

  unzip -tq "$staged_archive" >/dev/null
  entries="$(unzip -Z1 "$staged_archive")"
  if ! grep -Fxq 'database.dump' <<<"$entries"; then
    echo "database.dump is missing from $archive_name" >&2
    exit 1
  fi
  if ! grep -Fxq 'manifest.json' <<<"$entries"; then
    echo "manifest.json is missing from $archive_name" >&2
    exit 1
  fi
  if ! grep -Eq '^uploads(/|$)' <<<"$entries"; then
    echo "uploads/ is missing from $archive_name" >&2
    exit 1
  fi

  manifest="$(unzip -p "$staged_archive" manifest.json)"
  if ! jq -e '
    .formatVersion == 1 and
    .database.file == "database.dump" and
    .database.format == "postgresql-custom" and
    (.database.sha256 | type == "string" and test("^[0-9a-fA-F]{64}$")) and
    .uploads.directory == "uploads"
  ' >/dev/null <<<"$manifest"; then
    echo "Invalid manifest.json in $archive_name" >&2
    exit 1
  fi

  unzip -p "$staged_archive" database.dump > "$dump_file"
  expected_dump_sha256="$(jq -r '.database.sha256' <<<"$manifest")"
  actual_dump_sha256="$(sha256sum "$dump_file" | awk '{print $1}')"
  if [[ "${actual_dump_sha256,,}" != "${expected_dump_sha256,,}" ]]; then
    echo "database.dump SHA-256 mismatch in $archive_name" >&2
    exit 1
  fi
  pg_restore --list "$dump_file" >/dev/null
  rm -f "$dump_file"

  mv -n "$staged_archive" "${ARCHIVE_DIR}/${archive_name}"
  mv -n "$staged_checksum" "${ARCHIVE_DIR}/${archive_name}.sha256"
  chmod 0600 "${ARCHIVE_DIR}/${archive_name}" "${ARCHIVE_DIR}/${archive_name}.sha256"
  imported_count=$((imported_count + 1))
  echo "Verified and stored: $archive_name"
done

while IFS= read -r -d '' expired_archive; do
  case "$expired_archive" in
    "${ARCHIVE_DIR}"/academy-crm-backup-*.zip)
      echo "Removing offsite backup older than ${RETENTION_DAYS} days: $(basename "$expired_archive")"
      rm -f "$expired_archive" "${expired_archive}.sha256"
      ;;
    *)
      echo "Refusing to remove unexpected path: $expired_archive" >&2
      exit 1
      ;;
  esac
done < <(find "$ARCHIVE_DIR" -maxdepth 1 -type f -name 'academy-crm-backup-*.zip' -mtime "+${RETENTION_DAYS}" -print0)

latest_archive="$(find "$ARCHIVE_DIR" -maxdepth 1 -type f -name 'academy-crm-backup-*.zip' -printf '%f\n' | sort | tail -n 1)"
if [[ -z "$latest_archive" ]]; then
  echo "No verified offsite backup is available" >&2
  exit 1
fi

latest_mtime="$(stat -c %Y "${ARCHIVE_DIR}/${latest_archive}")"
now_epoch="$(date +%s)"
latest_age="$((now_epoch - latest_mtime))"
if (( latest_age < 0 || latest_age > MAX_BACKUP_AGE_SECONDS )); then
  echo "Latest offsite backup is stale or has an invalid timestamp: ${latest_archive} (${latest_age}s old)" >&2
  exit 1
fi

status_tmp="${STATUS_FILE}.tmp"
printf '%s %s imported=%s\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  "$latest_archive" \
  "$imported_count" > "$status_tmp"
mv "$status_tmp" "$STATUS_FILE"
chmod 0600 "$STATUS_FILE"

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Offsite backup check completed: latest=${latest_archive}, imported=${imported_count}"
