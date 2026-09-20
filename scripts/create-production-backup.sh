#!/bin/sh

set -eu

umask 077

BACKUP_DIR="${BACKUP_DIR:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
POSTGRES_PASSWORD_FILE="${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}"
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-crm}"
PGUSER="${PGUSER:-crm}"
BACKUP_LOCK_WAIT_SECONDS="${BACKUP_LOCK_WAIT_SECONDS:-3600}"

case "$BACKUP_KEEP" in
  ''|*[!0-9]*)
    echo "BACKUP_KEEP must be a positive integer" >&2
    exit 1
    ;;
esac

if [ "$BACKUP_KEEP" -lt 1 ]; then
  echo "BACKUP_KEEP must be at least 1" >&2
  exit 1
fi

case "$BACKUP_LOCK_WAIT_SECONDS" in
  ''|*[!0-9]*)
    echo "BACKUP_LOCK_WAIT_SECONDS must be a positive integer" >&2
    exit 1
    ;;
esac

for required_command in pg_dump pg_restore zip unzip sha256sum; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $required_command" >&2
    exit 1
  fi
done

if [ ! -s "$POSTGRES_PASSWORD_FILE" ]; then
  echo "PostgreSQL password file is missing or empty" >&2
  exit 1
fi

if [ ! -d "$UPLOADS_DIR" ]; then
  echo "Uploads directory is missing: $UPLOADS_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

if [ ! -w "$BACKUP_DIR" ]; then
  echo "Backup directory is not writable: $BACKUP_DIR" >&2
  exit 1
fi

# A deployment check and the hourly scheduler can briefly coexist. Serialize
# them so two pg_dump/zip processes never compete for disk and database I/O.
if [ "${BACKUP_LOCK_HELD:-0}" != '1' ]; then
  if ! command -v flock >/dev/null 2>&1; then
    echo "Required command is unavailable: flock" >&2
    exit 1
  fi

  export BACKUP_LOCK_HELD=1
  exec flock \
    --exclusive \
    --wait "$BACKUP_LOCK_WAIT_SECONDS" \
    "${BACKUP_DIR}/.backup.lock" \
    "$0" "$@"
fi

created_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
archive_name="academy-crm-backup-${timestamp}.zip"
archive_path="${BACKUP_DIR}/${archive_name}"
partial_path="${BACKUP_DIR}/.${archive_name}.partial"
work_dir="$(mktemp -d "${BACKUP_DIR}/.academy-backup-work.XXXXXX")"
dump_path="${work_dir}/database.dump"
manifest_path="${work_dir}/manifest.json"
backup_completed=0

cleanup() {
  rm -rf "$work_dir"
  rm -f "$partial_path"
  if [ "$backup_completed" -ne 1 ]; then
    rm -f "$archive_path" "${archive_path}.sha256"
  fi
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

password="$(tr -d '\r\n' < "$POSTGRES_PASSWORD_FILE")"
if [ -z "$password" ]; then
  echo "PostgreSQL password file contains no usable password" >&2
  exit 1
fi

export PGPASSWORD="$password"

echo "[$created_at] Creating PostgreSQL dump"
pg_dump \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --format=custom \
  --compress=6 \
  --file="$dump_path"

unset PGPASSWORD password

# pg_restore must be able to read the archive before any backup is published.
pg_restore --list "$dump_path" >/dev/null

dump_sha256="$(sha256sum "$dump_path" | awk '{print $1}')"
dump_size_bytes="$(wc -c < "$dump_path" | tr -d '[:space:]')"
uploads_file_count="$(find "$UPLOADS_DIR" -type f | wc -l | tr -d '[:space:]')"
uploads_size_kib="$(du -sk "$UPLOADS_DIR" | awk '{print $1}')"

printf '%s\n' \
  '{' \
  '  "formatVersion": 1,' \
  "  \"createdAt\": \"${created_at}\"," \
  '  "database": {' \
  '    "file": "database.dump",' \
  '    "format": "postgresql-custom",' \
  "    \"sizeBytes\": ${dump_size_bytes}," \
  "    \"sha256\": \"${dump_sha256}\"" \
  '  },' \
  '  "uploads": {' \
  '    "directory": "uploads",' \
  "    \"fileCount\": ${uploads_file_count}," \
  "    \"sizeKiB\": ${uploads_size_kib}" \
  '  }' \
  '}' > "$manifest_path"

echo "[$created_at] Packaging database.dump and uploads/"
(
  cd "$work_dir"
  zip -q "$partial_path" database.dump manifest.json
)

uploads_parent="$(dirname "$UPLOADS_DIR")"
uploads_name="$(basename "$UPLOADS_DIR")"
(
  cd "$uploads_parent"
  # Store symbolic links as links instead of following them outside uploads/.
  zip -q -r -y "$partial_path" "$uploads_name"
)

# Verify the complete ZIP before publishing it under its final name.
unzip -tq "$partial_path" >/dev/null
mv "$partial_path" "$archive_path"

(
  cd "$BACKUP_DIR"
  sha256sum "$archive_name" > "${archive_name}.sha256"
)

# Names are timestamped in UTC, so reverse lexical order is newest first.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'academy-crm-backup-*.zip' \
  | sort -r \
  | awk -v keep="$BACKUP_KEEP" 'NR > keep' \
  | while IFS= read -r old_archive; do
      case "$old_archive" in
        "$BACKUP_DIR"/academy-crm-backup-*.zip)
          echo "Removing expired backup: $(basename "$old_archive")"
          rm -f "$old_archive" "${old_archive}.sha256"
          ;;
        *)
          echo "Refusing to remove unexpected path: $old_archive" >&2
          exit 1
          ;;
      esac
    done

success_tmp="${BACKUP_DIR}/.last-success.tmp"
printf '%s %s\n' "$created_at" "$archive_name" > "$success_tmp"
mv "$success_tmp" "${BACKUP_DIR}/.last-success"

archive_size_bytes="$(wc -c < "$archive_path" | tr -d '[:space:]')"
backup_completed=1
echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Backup completed: $archive_path (${archive_size_bytes} bytes)"
