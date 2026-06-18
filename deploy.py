#!/usr/bin/env python3
"""01 Academy CRM — auto deploy/update to the production server.

Reproduces the verified deploy procedure end to end, fully unattended.
Secrets are embedded intentionally — the project owner opted out of env vars.

Usage:
    python3 deploy.py            # full deploy (default)
    python3 deploy.py sync       # rsync files only, no rebuild
    python3 deploy.py restart    # rebuild + restart only
    python3 deploy.py logs       # show last 50 log lines
    python3 deploy.py status     # show container status + health

Requirements (local): rsync, sshpass.  Requirements (server): docker compose.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

# ─── Configuration (secrets embedded intentionally per owner's request) ────
PROJECT_DIR   = Path(__file__).resolve().parent
SERVER_IP     = "34.30.220.161"
SERVER_USER   = "root"
SERVER_PASS   = "Sheri2001"
SERVER_DIR    = "/root/crm-pro"
HOST_PORT     = 8011          # public port exposed on the server
APP_PORT      = 5001          # port the app listens on inside the container
DB_HOST       = "postgres"    # docker service name for postgres (NOT localhost)

HEALTH_RETRIES = 20
HEALTH_DELAY   = 3.0

# Files/dirs excluded from rsync.
#   config/  — holds production secrets on the server; the local file is a
#              dev config and MUST NEVER overwrite the server's.
RSYNC_EXCLUDES = [
    "node_modules", ".git", "dist", "__pycache__", "*.pyc", ".DS_Store",
    "logs/*", "config/*",
]

# sshpass reads the password from the SSHPASS env var (never on the CLI / ps).
SSH_BASE = [
    "sshpass", "-e", "ssh",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    f"{SERVER_USER}@{SERVER_IP}",
]


# ─── helpers ──────────────────────────────────────────────────────────────
def ssh_env():
    return {**os.environ, "SSHPASS": SERVER_PASS}


def run(cmd, capture=False):
    return subprocess.run(cmd, check=True, text=True,
                          env=ssh_env(), capture_output=capture)


def ssh(cmd):
    """Run a command on the server and return its stdout."""
    return run(SSH_BASE + [cmd], capture=True).stdout


def banner(step, total, msg):
    print(f"[{step}/{total}] {msg}")


# ─── steps ────────────────────────────────────────────────────────────────
def rsync_files():
    exclude_args = []
    for e in RSYNC_EXCLUDES:
        exclude_args += ["--exclude", e]
    run([
        "rsync", "-avz", "--delete", *exclude_args,
        "-e", "sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null",
        f"{PROJECT_DIR}/", f"{SERVER_USER}@{SERVER_IP}:{SERVER_DIR}/",
    ])


def ensure_config():
    """Make server config & compose production-ready (idempotent).

    rsync re-syncs the local docker-compose.yml (which targets dev), so the
    production values must be re-applied after every sync.
    """
    cfg   = f"{SERVER_DIR}/config/app.config.json"
    comp  = f"{SERVER_DIR}/docker-compose.yml"
    stamp = time.strftime("%Y%m%d-%H%M%S")

    # best-effort backups (don't fail if a file is missing on first deploy)
    ssh(f"if [ -f {cfg} ];  then cp -a {cfg}  {cfg}.bak.{stamp};  fi")
    ssh(f"if [ -f {comp} ]; then cp -a {comp} {comp}.bak.{stamp}; fi")

    # DB host must be the docker service name, not localhost
    ssh(f"sed -i 's|@localhost:5432|@{DB_HOST}:5432|g' {cfg}")
    # map HOST_PORT → the port the app actually listens on
    ssh(f"sed -i 's|\"{HOST_PORT}:5000\"|\"{HOST_PORT}:{APP_PORT}\"|g' {comp}")


def restart_docker():
    ssh(f"cd {SERVER_DIR} && docker compose down && docker compose up -d --build")


def ensure_firewall():
    """Open HOST_PORT in ufw if it's managed and the port is missing."""
    try:
        out = ssh(f"ufw status 2>/dev/null | grep -w {HOST_PORT} || true")
        if str(HOST_PORT) not in out:
            ssh(f"ufw allow {HOST_PORT}/tcp")
            print(f"  firewall: port {HOST_PORT} opened")
    except subprocess.CalledProcessError:
        pass  # ufw not installed/active — nothing to do


def check_health():
    cmd = f"curl -s -o /dev/null -w '%{{http_code}}' http://localhost:{HOST_PORT}/ || true"
    for i in range(HEALTH_RETRIES):
        if "200" in ssh(cmd):
            return True
        time.sleep(HEALTH_DELAY)
    return False


def show_logs(tail=20):
    print(f"\n--- container logs (last {tail}) ---")
    print(ssh(f"docker logs crm-pro --tail {tail} 2>&1"))


# ─── actions ──────────────────────────────────────────────────────────────
def deploy_full():
    banner(1, 5, "Syncing project files...")
    rsync_files()

    banner(2, 5, "Ensuring production config & port mapping...")
    ensure_config()

    banner(3, 5, "Rebuilding & restarting Docker...")
    restart_docker()

    banner(4, 5, "Ensuring firewall...")
    ensure_firewall()

    banner(5, 5, "Health check...")
    print("Waiting for container to start...")
    if check_health():
        print("\n✅ Deploy successful")
        show_logs()
        print(f"\n🔗 http://{SERVER_IP}:{HOST_PORT}")
    else:
        print("\n❌ Health check FAILED")
        show_logs(50)
        sys.exit(1)


def deploy_sync():
    print("Syncing files only (no rebuild)...")
    rsync_files()
    ensure_config()  # keep production values consistent
    print("Done.")


def deploy_restart():
    print("Restarting Docker...")
    restart_docker()
    if check_health():
        print("✅ OK")
    else:
        print("❌ Health check FAILED")
        show_logs(50)
        sys.exit(1)


ACTIONS = {
    "full":    deploy_full,
    "sync":    deploy_sync,
    "restart": deploy_restart,
    "logs":    lambda: show_logs(50),
    "status":  lambda: (print("crm-pro:", ssh("docker ps --filter name=crm-pro "
                                               "--format '{{.Status}}'").strip()),
                        print("healthy" if check_health() else "UNHEALTHY")),
}


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "full"
    fn = ACTIONS.get(action)
    if not fn:
        print(f"Usage: python3 {Path(__file__).name} "
              f"[{'|'.join(ACTIONS)}]")
        sys.exit(1)
    fn()


if __name__ == "__main__":
    main()
