#!/usr/bin/env bash
set -euo pipefail

# Use the same persistent inode for manual and GitHub-triggered deployments.
lock_file="${ACADEMY_DEPLOY_LOCK_FILE:-$HOME/.01academy-crm-deploy.lock}"
lock_wait="${ACADEMY_DEPLOY_LOCK_WAIT_SECONDS:-120}"
if [[ ! "$lock_wait" =~ ^[0-9]+$ ]] || (( lock_wait > 3600 )); then
  printf '%s\n' 'Invalid deployment lock wait.' >&2
  exit 2
fi
if (( $# == 0 )); then
  printf '%s\n' 'Usage: lms-deploy-lock.sh command [arguments...]' >&2
  exit 2
fi
if ! command -v flock >/dev/null 2>&1; then
  printf '%s\n' 'The deployment host requires flock.' >&2
  exit 2
fi
umask 077
mkdir -p "$(dirname "$lock_file")"
exec flock --exclusive --wait "$lock_wait" "$lock_file" "$@"
