#!/usr/bin/env python3
"""Preserve one verified first-day backup per local calendar month.

The privileged vault finalizer holds .vault.lock throughout this operation
and the following hourly rotation. Published monthly archives are never replaced.
"""

import argparse
from datetime import datetime, timezone
import grp
import hashlib
import os
from pathlib import Path
import re
import stat
import tempfile
from zoneinfo import ZoneInfo


ARCHIVE_PATTERN = re.compile(r"academy-crm-backup-(\d{8}T\d{6}Z)\.zip")
CHECKSUM_PATTERN = re.compile(r"[0-9a-fA-F]{64}")
STAGING_PREFIX = ".monthly-stage-"


def local_snapshot_date(name, time_zone):
    match = ARCHIVE_PATTERN.fullmatch(name)
    if not match:
        raise ValueError(f"Invalid backup name: {name}")
    timestamp = datetime.strptime(match[1], "%Y%m%dT%H%M%SZ")
    return timestamp.replace(tzinfo=timezone.utc).astimezone(time_zone)


def read_vault(directory, time_zone, monthly=False):
    archives = {}
    checksums = set()
    for entry in sorted(directory.iterdir()):
        if entry.is_symlink() or not entry.is_file():
            raise ValueError(f"Unsafe vault entry: {entry}")
        if entry.name.startswith(STAGING_PREFIX):
            # Only the root finalizer writes this directory. Interrupted staging
            # is disposable and is cleaned while holding the exclusive vault lock.
            if not monthly:
                raise ValueError(f"Unexpected staging file: {entry}")
            entry.unlink()
            continue
        name = entry.name.removesuffix(".sha256")
        snapshot = local_snapshot_date(name, time_zone)
        if monthly and snapshot.day != 1:
            raise ValueError(f"Monthly backup was not taken on the first day: {entry}")
        if entry.name.endswith(".sha256"):
            checksums.add(name)
        else:
            archives[name] = entry
    for name in archives:
        if name not in checksums:
            raise ValueError(f"Checksum is missing: {directory / name}")
    if not monthly and checksums - archives.keys():
        raise ValueError(f"Archive is missing in {directory}")
    return archives, checksums


def first_day_candidates(archives, time_zone):
    candidates = {}
    for name in sorted(archives):
        snapshot = local_snapshot_date(name, time_zone)
        if snapshot.day == 1:
            candidates.setdefault(snapshot.strftime("%Y-%m"), name)
    return candidates


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verified_checksum(archive, checksum):
    fields = checksum.read_text(encoding="utf-8").split()
    if not fields or not CHECKSUM_PATTERN.fullmatch(fields[0]):
        raise ValueError(f"Invalid SHA-256 file: {checksum}")
    expected = fields[0].lower()
    if file_sha256(archive) != expected:
        raise ValueError(f"SHA-256 mismatch: {archive}")
    return expected


def publish_file(source, destination, owner_uid, owner_gid, expected_sha256=None):
    fd, temporary_name = tempfile.mkstemp(prefix=STAGING_PREFIX, dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as target, source.open("rb") as source_file:
            for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
                target.write(chunk)
            target.flush()
            os.fchown(target.fileno(), owner_uid, owner_gid)
            os.fchmod(target.fileno(), 0o640)
            os.fsync(target.fileno())
        if expected_sha256 is not None and file_sha256(temporary) != expected_sha256:
            raise ValueError(f"Staged monthly archive failed verification: {source}")
        # Atomic publication with no replacement, even after an interrupted run.
        os.link(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def preserve_monthly(hourly_dir, monthly_dir, time_zone, owner_uid, owner_gid):
    hourly, _ = read_vault(hourly_dir, time_zone)
    monthly, checksums = read_vault(monthly_dir, time_zone, monthly=True)
    reserved = {}
    for name in sorted(checksums):
        month = local_snapshot_date(name, time_zone).strftime("%Y-%m")
        if month in reserved:
            raise ValueError(f"Multiple monthly backups for {month}")
        reserved[month] = name
        if name in monthly:
            # Recheck permanent history before pruning its hourly sources.
            verified_checksum(monthly[name], monthly_dir / (name + ".sha256"))

    candidates = first_day_candidates(hourly, time_zone)
    # A checksum is published first. If interrupted between the two files, keep
    # the same reservation and finish the pair before any hourly copy is pruned.
    for month, name in reserved.items():
        if name not in monthly:
            if name not in hourly:
                raise ValueError(f"Cannot finish interrupted monthly backup: {name}")
            candidates[month] = name

    stored = []
    for month, name in sorted(candidates.items()):
        if month in reserved and reserved[month] in monthly:
            continue
        archive = hourly[name]
        checksum = Path(str(archive) + ".sha256")
        expected = verified_checksum(archive, checksum)
        monthly_checksum = monthly_dir / (name + ".sha256")
        if monthly_checksum.exists():
            # Never replace even the checksum of an interrupted publication.
            if monthly_checksum.read_bytes() != checksum.read_bytes():
                raise ValueError(f"Monthly checksum differs: {monthly_checksum}")
        else:
            publish_file(checksum, monthly_checksum, owner_uid, owner_gid)
        monthly_archive = monthly_dir / name
        publish_file(archive, monthly_archive, owner_uid, owner_gid, expected)
        directory_fd = os.open(monthly_dir, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        stored.append(name)
        print(f"Preserved monthly backup permanently: month={month}, archive={name}", flush=True)
    return stored


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hourly-dir", type=Path, required=True)
    parser.add_argument("--monthly-dir", type=Path, required=True)
    parser.add_argument("--time-zone", default="Asia/Tashkent")
    parser.add_argument("--group", default="crmbackup")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Monthly retention must run as root")
    if args.hourly_dir != Path("/srv/backups/01academy-crm/hourly") or args.monthly_dir != Path("/srv/backups/01academy-crm/monthly"):
        parser.error("Refusing unexpected backup vault paths")
    for directory in (args.hourly_dir, args.monthly_dir):
        if directory.is_symlink() or not stat.S_ISDIR(directory.stat().st_mode):
            parser.error(f"Unsafe vault directory: {directory}")
    preserve_monthly(args.hourly_dir, args.monthly_dir, ZoneInfo(args.time_zone), 0, grp.getgrnam(args.group).gr_gid)


if __name__ == "__main__":
    main()
