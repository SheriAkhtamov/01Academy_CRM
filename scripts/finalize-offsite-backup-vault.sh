#!/usr/bin/env bash

set -Eeuo pipefail

umask 027

BACKUP_ROOT="${BACKUP_ROOT:-/srv/backups/01academy-crm}"
ARCHIVE_DIR="${BACKUP_ROOT}/hourly"
RETENTION_DAYS="${RETENTION_DAYS:-90}"
BACKUP_GROUP="${BACKUP_GROUP:-crmbackup}"

if (( EUID != 0 )); then
  echo "The vault finalizer must run as root" >&2
  exit 1
fi

if [[ "$ARCHIVE_DIR" != "/srv/backups/01academy-crm/hourly" ]]; then
  echo "Refusing unexpected backup vault path: $ARCHIVE_DIR" >&2
  exit 1
fi

if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 1 )); then
  echo "RETENTION_DAYS must be a positive integer" >&2
  exit 1
fi

if ! getent group "$BACKUP_GROUP" >/dev/null; then
  echo "Backup service group does not exist: $BACKUP_GROUP" >&2
  exit 1
fi

if [[ -L "$ARCHIVE_DIR" || ! -d "$ARCHIVE_DIR" ]]; then
  echo "Backup vault is missing or is a symbolic link: $ARCHIVE_DIR" >&2
  exit 1
fi

chown root:"$BACKUP_GROUP" "$BACKUP_ROOT" "$ARCHIVE_DIR"
chmod 0750 "$BACKUP_ROOT"
# Group write lets the unprivileged fetcher publish a newly verified archive.
# The sticky bit prevents it from renaming or deleting root-owned history.
chmod 1770 "$ARCHIVE_DIR"

shopt -s nullglob
for stored_file in \
  "${ARCHIVE_DIR}"/academy-crm-backup-*.zip \
  "${ARCHIVE_DIR}"/academy-crm-backup-*.zip.sha256; do
  if [[ -L "$stored_file" || ! -f "$stored_file" ]]; then
    echo "Refusing non-regular vault entry: $stored_file" >&2
    exit 1
  fi

  owner="$(stat -c %U "$stored_file")"
  if [[ "$owner" != "root" && "$owner" != "crmbackup" ]]; then
    echo "Refusing vault entry with unexpected owner ${owner}: $stored_file" >&2
    exit 1
  fi
done

for archive in "${ARCHIVE_DIR}"/academy-crm-backup-*.zip; do
  checksum="${archive}.sha256"
  if [[ -L "$checksum" || ! -f "$checksum" ]]; then
    echo "Checksum is missing or unsafe for $(basename "$archive")" >&2
    exit 1
  fi
done

# Seal every accepted file against changes by the network-facing service user.
chown root:"$BACKUP_GROUP" \
  "${ARCHIVE_DIR}"/academy-crm-backup-*.zip \
  "${ARCHIVE_DIR}"/academy-crm-backup-*.zip.sha256
chmod 0640 \
  "${ARCHIVE_DIR}"/academy-crm-backup-*.zip \
  "${ARCHIVE_DIR}"/academy-crm-backup-*.zip.sha256

# Rotation is intentionally privileged and local-only. The fetcher cannot
# remove sealed archives even if its SSH key or process is compromised.
while IFS= read -r -d '' expired_archive; do
  case "$expired_archive" in
    "${ARCHIVE_DIR}"/academy-crm-backup-*.zip)
      echo "Removing sealed backup older than ${RETENTION_DAYS} days: $(basename "$expired_archive")"
      rm -f -- "$expired_archive" "${expired_archive}.sha256"
      ;;
    *)
      echo "Refusing to remove unexpected path: $expired_archive" >&2
      exit 1
      ;;
  esac
done < <(find "$ARCHIVE_DIR" -maxdepth 1 -type f -name 'academy-crm-backup-*.zip' -mtime "+${RETENTION_DAYS}" -print0)

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Backup vault ownership and retention finalized"
