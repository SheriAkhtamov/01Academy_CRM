#!/bin/sh

# Operator-only maintenance on a host with writable uploads. The scheduled
# backup container deliberately keeps its uploads mount read-only.
set -eu
umask 027

BACKUP_DIR="${BACKUP_DIR:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"
RETAINED_UPLOAD_KEEP_DAYS="${RETAINED_UPLOAD_KEEP_DAYS:-30}"
BACKUP_LOCK_WAIT_SECONDS="${BACKUP_LOCK_WAIT_SECONDS:-3600}"
script_directory="$(dirname "$0")"
default_backup_script="${script_directory}/create-production-backup.sh"
if [ ! -f "$default_backup_script" ]; then
  default_backup_script="${script_directory}/create-production-backup"
fi
CREATE_BACKUP_SCRIPT="${CREATE_BACKUP_SCRIPT:-$default_backup_script}"

case "$RETAINED_UPLOAD_KEEP_DAYS" in
  ''|*[!0-9]*) echo 'RETAINED_UPLOAD_KEEP_DAYS must be a positive integer' >&2; exit 1 ;;
esac
if [ "$RETAINED_UPLOAD_KEEP_DAYS" -lt 1 ]; then
  echo 'RETAINED_UPLOAD_KEEP_DAYS must be at least 1' >&2
  exit 1
fi
case "$BACKUP_LOCK_WAIT_SECONDS" in
  ''|*[!0-9]*) echo 'BACKUP_LOCK_WAIT_SECONDS must be a positive integer' >&2; exit 1 ;;
esac

if [ ! -d "$UPLOADS_DIR" ] || [ ! -f "$CREATE_BACKUP_SCRIPT" ]; then
  echo 'Uploads directory or backup script is missing' >&2
  exit 1
fi
mkdir -p "$BACKUP_DIR"

if [ "${RETAINED_PRUNE_LOCK_HELD:-0}" != '1' ]; then
  if ! command -v flock >/dev/null 2>&1; then
    echo 'Required command is unavailable: flock' >&2
    exit 1
  fi
  export RETAINED_PRUNE_LOCK_HELD=1
  exec flock --exclusive --wait "$BACKUP_LOCK_WAIT_SECONDS" \
    "${BACKUP_DIR}/.backup.lock" "$0" "$@"
fi

# The lock is held for both publication and pruning. Every older dump has
# completed, and this fresh dump's required bytes are already in its ZIP.
BACKUP_LOCK_HELD=1 /bin/sh "$CREATE_BACKUP_SCRIPT"

retained_directory="${UPLOADS_DIR}/.retained"
if [ -L "$retained_directory" ]; then
  echo 'Upload retention directory must not be a symbolic link' >&2
  exit 1
fi
if [ -d "$retained_directory" ]; then
  # Linking/unlinking a newly deleted file refreshes ctime, even when its original
  # mtime is years old. Never use mtime as the deletion-age clock.
  find "$retained_directory" -type f -ctime "+${RETAINED_UPLOAD_KEEP_DAYS}" -exec rm -f -- {} +
fi
