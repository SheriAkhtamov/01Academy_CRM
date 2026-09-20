#!/usr/bin/env bash

set -Eeuo pipefail

umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/srv/backups/01academy-crm}"
ARCHIVE_DIR="${BACKUP_ROOT}/hourly"
STATE_DIR="${STATE_DIR:-/var/lib/crmbackup/state}"
STATUS_FILE="${STATE_DIR}/vault-audit.last-success"
MAX_BACKUP_AGE_SECONDS="${MAX_BACKUP_AGE_SECONDS:-10800}"

if [[ "$ARCHIVE_DIR" != "/srv/backups/01academy-crm/hourly" ]]; then
  echo "Refusing unexpected backup vault path: $ARCHIVE_DIR" >&2
  exit 1
fi

if [[ ! "$MAX_BACKUP_AGE_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "MAX_BACKUP_AGE_SECONDS must be an unsigned integer" >&2
  exit 1
fi

for required_command in jq pg_restore sha256sum stat unzip; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $required_command" >&2
    exit 1
  fi
done

if [[ -L "$ARCHIVE_DIR" || ! -d "$ARCHIVE_DIR" ]]; then
  echo "Backup vault is missing or is a symbolic link: $ARCHIVE_DIR" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
work_dir="$(mktemp -d "${STATE_DIR}/audit.XXXXXX")"
dump_file="${work_dir}/database.dump"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

unexpected_entry="$(find "$ARCHIVE_DIR" -mindepth 1 -maxdepth 1 \
  ! -type f -o -type f ! -name 'academy-crm-backup-*.zip' ! -name 'academy-crm-backup-*.zip.sha256' \
  | head -n 1)"
if [[ -n "$unexpected_entry" ]]; then
  echo "Unexpected or non-regular vault entry: $unexpected_entry" >&2
  exit 1
fi

shopt -s nullglob
archives=("${ARCHIVE_DIR}"/academy-crm-backup-*.zip)
if (( ${#archives[@]} == 0 )); then
  echo "No archive is available for the vault audit" >&2
  exit 1
fi

checked_count=0
for archive in "${archives[@]}"; do
  archive_name="$(basename "$archive")"
  checksum="${archive}.sha256"

  if [[ -L "$archive" || ! -f "$archive" || -L "$checksum" || ! -f "$checksum" ]]; then
    echo "Archive or checksum is missing or unsafe: $archive_name" >&2
    exit 1
  fi

  for stored_file in "$archive" "$checksum"; do
    owner="$(stat -c %U "$stored_file")"
    group="$(stat -c %G "$stored_file")"
    mode="$(stat -c %a "$stored_file")"
    if [[ "$owner" != "root" || "$group" != "crmbackup" || "$mode" != "640" ]]; then
      echo "Unsafe vault ownership or mode for $stored_file: ${mode} ${owner}:${group}" >&2
      exit 1
    fi
  done

  expected_sha256="$(awk 'NF {print $1; exit}' "$checksum")"
  if [[ ! "$expected_sha256" =~ ^[[:xdigit:]]{64}$ ]]; then
    echo "Invalid SHA-256 file for $archive_name" >&2
    exit 1
  fi

  actual_sha256="$(sha256sum "$archive" | awk '{print $1}')"
  if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    echo "SHA-256 mismatch for $archive_name" >&2
    exit 1
  fi

  unzip -tq "$archive" >/dev/null
  entries="$(unzip -Z1 "$archive")"
  if ! grep -Fxq 'database.dump' <<<"$entries" \
    || ! grep -Fxq 'manifest.json' <<<"$entries" \
    || ! grep -Eq '^uploads(/|$)' <<<"$entries"; then
    echo "Required content is missing from $archive_name" >&2
    exit 1
  fi

  manifest="$(unzip -p "$archive" manifest.json)"
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

  unzip -p "$archive" database.dump > "$dump_file"
  expected_dump_sha256="$(jq -r '.database.sha256' <<<"$manifest")"
  actual_dump_sha256="$(sha256sum "$dump_file" | awk '{print $1}')"
  if [[ "${actual_dump_sha256,,}" != "${expected_dump_sha256,,}" ]]; then
    echo "database.dump SHA-256 mismatch in $archive_name" >&2
    exit 1
  fi
  pg_restore --list "$dump_file" >/dev/null
  rm -f "$dump_file"
  checked_count=$((checked_count + 1))
done

latest_archive="${archives[-1]}"
latest_mtime="$(stat -c %Y "$latest_archive")"
now_epoch="$(date +%s)"
latest_age="$((now_epoch - latest_mtime))"
if (( latest_age < 0 || latest_age > MAX_BACKUP_AGE_SECONDS )); then
  echo "Latest sealed backup is stale or has an invalid timestamp: $(basename "$latest_archive") (${latest_age}s old)" >&2
  exit 1
fi

status_tmp="${STATUS_FILE}.tmp"
printf '%s checked=%s latest=%s\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  "$checked_count" \
  "$(basename "$latest_archive")" > "$status_tmp"
mv "$status_tmp" "$STATUS_FILE"
chmod 0600 "$STATUS_FILE"

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Read-only backup vault audit completed: checked=${checked_count}"
