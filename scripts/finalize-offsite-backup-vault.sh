#!/usr/bin/env bash

set -Eeuo pipefail

umask 027

BACKUP_ROOT="${BACKUP_ROOT:-/srv/backups/01academy-crm}"
ARCHIVE_DIR="${BACKUP_ROOT}/hourly"
MONTHLY_DIR="${BACKUP_ROOT}/monthly"
LOCK_FILE="${BACKUP_ROOT}/.vault.lock"
RETENTION_DAYS="${RETENTION_DAYS:-90}"
BACKUP_GROUP="${BACKUP_GROUP:-crmbackup}"
MONTHLY_BACKUP_TIME_ZONE="${MONTHLY_BACKUP_TIME_ZONE:-Asia/Tashkent}"
MONTHLY_RETENTION_SCRIPT="/opt/01academy-backup/bin/offsite-monthly-backups.py"

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

if [[ -L "$MONTHLY_DIR" || ( -e "$MONTHLY_DIR" && ! -d "$MONTHLY_DIR" ) ]]; then
  echo "Monthly vault is unsafe: $MONTHLY_DIR" >&2
  exit 1
fi

if [[ -L "$LOCK_FILE" || ! -f "$LOCK_FILE" ]]; then
  echo "Backup vault lock is missing or unsafe: $LOCK_FILE" >&2
  exit 1
fi
exec 9<"$LOCK_FILE"
flock --exclusive 9

mkdir -p "$MONTHLY_DIR"
chown root:"$BACKUP_GROUP" "$MONTHLY_DIR"
chmod 0750 "$MONTHLY_DIR"

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

# Preserve all available first-day snapshots before removing expired hourly
# archives. Any publication failure aborts rotation and keeps the sources.
python3 "$MONTHLY_RETENTION_SCRIPT" \
  --hourly-dir "$ARCHIVE_DIR" \
  --monthly-dir "$MONTHLY_DIR" \
  --time-zone "$MONTHLY_BACKUP_TIME_ZONE" \
  --group "$BACKUP_GROUP"

# Rotation is intentionally privileged and local-only. The fetcher cannot
# remove sealed archives even if its SSH key or process is compromised.
# Use an exact cutoff: find -mtime +N rounds down and retains an extra day.
now_epoch="$(date +%s)"
retention_cutoff_epoch="$((now_epoch - RETENTION_DAYS * 86400))"

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
done < <(find "$ARCHIVE_DIR" -maxdepth 1 -type f -name 'academy-crm-backup-*.zip' ! -newermt "@${retention_cutoff_epoch}" -print0)

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Backup vault ownership and retention finalized"
