#!/usr/bin/env python3
"""CRM Pro — auto deploy/update to server."""

import subprocess
import os
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
SERVER_IP = "34.30.220.161"
SERVER_USER = "root"
SERVER_PASS = "Sheri2001"
SERVER_PROJECT_DIR = "/root/crm-pro"
REMOTE_PORT = 8011
APP_PORT = 5000

RSYNC_EXCLUDES = [
    "node_modules",
    ".git",
    "dist",
    "__pycache__",
    "*.pyc",
    ".DS_Store",
    "logs/*",
    "uploads/*",
]


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, text=True, **kwargs)


def ssh(cmd: str) -> str:
    result = run(
        [
            "sshpass", "-p", SERVER_PASS,
            "ssh", "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            f"{SERVER_USER}@{SERVER_IP}", cmd,
        ],
        capture_output=True,
    )
    return result.stdout


def rsync() -> None:
    exclude_args = []
    for e in RSYNC_EXCLUDES:
        exclude_args.extend(["--exclude", e])

    run([
        "rsync", "-avz", "--delete",
        *exclude_args,
        "-e", f"sshpass -p '{SERVER_PASS}' ssh -o StrictHostKeyChecking=no",
        f"{PROJECT_DIR}/",
        f"{SERVER_USER}@{SERVER_IP}:{SERVER_PROJECT_DIR}/",
    ])


def update_config() -> None:
    config_path = f"{SERVER_PROJECT_DIR}/config/app.config.json"
    ssh(f"sed -i 's|\"appUrl\":.*|\"appUrl\": \"http://{SERVER_IP}:{REMOTE_PORT}\"|' {config_path}")
    ssh(f"grep -q '\"environment\"' {config_path} && sed -i 's|\"environment\":.*|\"environment\": \"production\",|' {config_path} || true")


def restart_docker() -> None:
    ssh(f"cd {SERVER_PROJECT_DIR} && docker compose down && docker compose up -d --build")


def ensure_firewall() -> None:
    result = ssh(f"ufw status | grep {REMOTE_PORT}")
    if str(REMOTE_PORT) not in result:
        ssh(f"ufw allow {REMOTE_PORT}/tcp")
        print(f"  firewall: port {REMOTE_PORT} opened")


def check_health(max_retries: int = 10, delay: float = 2.0) -> bool:
    for i in range(max_retries):
        try:
            result = ssh(f"curl -s -o /dev/null -w '%{{http_code}}' http://localhost:{REMOTE_PORT}/")
            if "200" in result:
                print(f"  health: OK (200)")
                return True
        except Exception:
            pass
        time.sleep(delay)
    return False


def show_logs(tail: int = 15) -> None:
    print(f"\n--- container logs (last {tail}) ---")
    print(ssh(f"docker logs crm-pro --tail {tail}"))


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "full"

    if action == "full":
        print("[1/4] Syncing project files...")
        rsync()

        print("[2/4] Updating config...")
        update_config()

        print("[3/4] Rebuilding & restarting Docker...")
        restart_docker()

        print("[4/4] Ensuring firewall...")
        ensure_firewall()

        print("\nWaiting for container to start...")
        if check_health():
            show_logs()
            print(f"\nDeployed: http://{SERVER_IP}:{REMOTE_PORT}")
        else:
            print("\nHealth check FAILED")
            show_logs()
            sys.exit(1)

    elif action == "sync":
        print("Syncing files only (no rebuild)...")
        rsync()

    elif action == "restart":
        print("Restarting Docker...")
        restart_docker()
        check_health()

    elif action == "logs":
        show_logs(50)

    elif action == "status":
        out = ssh("docker ps --filter name=crm-pro --format '{{.Status}}'")
        print(f"crm-pro: {out.strip()}")
        check_health()

    else:
        print(f"Usage: python deploy.py [full|sync|restart|logs|status]")
        sys.exit(1)


if __name__ == "__main__":
    main()