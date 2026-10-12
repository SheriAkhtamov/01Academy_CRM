"""Behavioral checks for permanent monthly snapshots, without privileged paths."""

import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts/lib/offsite-monthly-backups.py"
SPEC = importlib.util.spec_from_file_location("monthly_backups", MODULE_PATH)
BACKUPS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKUPS)
TASHKENT = ZoneInfo("Asia/Tashkent")


class MonthlyBackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="academy-monthly-test-")
        root = Path(self.temporary.name)
        self.hourly = root / "hourly"
        self.monthly = root / "monthly"
        self.hourly.mkdir()
        self.monthly.mkdir()
        self.addCleanup(self.temporary.cleanup)

    def archive(self, timestamp, directory=None, content=b"verified backup"):
        directory = directory if directory is not None else self.hourly
        archive = directory / f"academy-crm-backup-{timestamp}.zip"
        archive.write_bytes(content)
        checksum = directory / (archive.name + ".sha256")
        checksum.write_text(f"{hashlib.sha256(content).hexdigest()}  {archive.name}\n")
        archive.chmod(0o640)
        checksum.chmod(0o640)
        return archive

    def preserve(self):
        return BACKUPS.preserve_monthly(self.hourly, self.monthly, TASHKENT, os.getuid(), os.getgid())

    def test_earliest_first_day_snapshot_uses_tashkent_calendar(self):
        self.archive("20260930T185959Z")  # September 30, 23:59:59 local.
        expected = self.archive("20260930T190000Z")  # October 1, 00:00 local.
        self.archive("20261001T185959Z")  # Still October 1 local.
        self.archive("20261001T190000Z")  # October 2 local.
        november = self.archive("20261031T190000Z")
        self.assertEqual(self.preserve(), [expected.name, november.name])
        self.assertEqual(len(list(self.monthly.glob("*.zip"))), 2)

    def test_no_snapshot_from_another_day_is_used_as_monthly(self):
        self.archive("20260920T180815Z")
        self.archive("20261002T005351Z")
        self.assertEqual(self.preserve(), [])
        self.assertEqual(list(self.monthly.iterdir()), [])

    def test_leap_year_and_year_boundary(self):
        february = self.archive("20240131T190000Z")
        march = self.archive("20240229T190000Z")
        january = self.archive("20241231T190000Z")
        self.assertEqual(self.preserve(), [february.name, march.name, january.name])

    def test_snapshot_is_permanent_after_hourly_source_is_removed(self):
        archive = self.archive("20260930T195351Z")
        content = archive.read_bytes()
        self.preserve()
        archive.unlink()
        Path(str(archive) + ".sha256").unlink()
        self.assertEqual(self.preserve(), [])
        stored = self.monthly / archive.name
        self.assertEqual(stored.read_bytes(), content)
        self.assertEqual(stored.stat().st_mode & 0o777, 0o640)
        self.assertEqual(stored.stat().st_uid, os.getuid())

    def test_repeat_run_never_replaces_accepted_snapshot(self):
        selected = self.archive("20261001T005351Z")
        self.preserve()
        stored = self.monthly / selected.name
        original_inode = stored.stat().st_ino
        self.archive("20260930T195351Z", content=b"delayed earlier snapshot")
        self.assertEqual(self.preserve(), [])
        self.assertEqual(stored.stat().st_ino, original_inode)
        self.assertEqual(len(list(self.monthly.glob("*.zip"))), 1)

    def test_corrupt_source_aborts_without_publishing(self):
        source = self.archive("20260930T195351Z")
        source.write_bytes(b"damaged archive")
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            self.preserve()
        self.assertEqual(list(self.monthly.iterdir()), [])
        self.assertTrue(source.exists())

    def test_corrupt_monthly_archive_aborts_before_hourly_rotation(self):
        source = self.archive("20260930T195351Z")
        self.preserve()
        (self.monthly / source.name).write_bytes(b"damaged permanent copy")
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            self.preserve()
        self.assertTrue(source.exists())

    def test_interrupted_pair_is_completed_without_changing_reservation(self):
        source = self.archive("20261001T005351Z")
        publish = BACKUPS.publish_file
        calls = []

        def interrupt_after_checksum(*args, **kwargs):
            calls.append(args[1])
            if len(calls) == 2:
                raise OSError("interrupted publication")
            return publish(*args, **kwargs)

        with patch.object(BACKUPS, "publish_file", side_effect=interrupt_after_checksum):
            with self.assertRaisesRegex(OSError, "interrupted publication"):
                self.preserve()
        checksum = self.monthly / (source.name + ".sha256")
        checksum_inode = checksum.stat().st_ino
        self.archive("20260930T195351Z", content=b"delayed earlier snapshot")
        self.assertEqual(self.preserve(), [source.name])
        self.assertEqual(checksum.stat().st_ino, checksum_inode)
        self.assertEqual(len(list(self.monthly.glob("*.zip"))), 1)

    def test_orphaned_monthly_checksum_without_source_fails_safely(self):
        source = self.archive("20260930T195351Z")
        checksum = self.monthly / (source.name + ".sha256")
        checksum.write_bytes(Path(str(source) + ".sha256").read_bytes())
        source.unlink()
        Path(str(source) + ".sha256").unlink()
        with self.assertRaisesRegex(ValueError, "Cannot finish interrupted"):
            self.preserve()

    def test_multiple_snapshots_for_one_month_are_rejected(self):
        self.archive("20260930T195351Z", self.monthly)
        self.archive("20261001T005351Z", self.monthly)
        with self.assertRaisesRegex(ValueError, "Multiple monthly backups"):
            self.preserve()

    def test_symlink_and_non_first_day_monthly_copy_are_rejected(self):
        source = self.archive("20260930T195351Z")
        link = self.monthly / source.name
        link.symlink_to(source)
        with self.assertRaisesRegex(ValueError, "Unsafe vault entry"):
            self.preserve()
        link.unlink()
        self.archive("20261002T005351Z", self.monthly)
        with self.assertRaisesRegex(ValueError, "not taken on the first day"):
            self.preserve()

    def test_publication_never_overwrites_and_cleans_staging_files(self):
        source = self.archive("20260930T195351Z")
        destination = self.monthly / source.name
        destination.write_bytes(b"existing permanent archive")
        with self.assertRaises(FileExistsError):
            BACKUPS.publish_file(source, destination, os.getuid(), os.getgid())
        self.assertEqual(destination.read_bytes(), b"existing permanent archive")
        self.assertEqual(list(self.monthly.glob(".monthly-stage-*")), [])

    def test_incorrect_staged_checksum_never_publishes_archive(self):
        source = self.archive("20260930T195351Z")
        destination = self.monthly / source.name
        with self.assertRaisesRegex(ValueError, "Staged monthly archive failed"):
            BACKUPS.publish_file(source, destination, os.getuid(), os.getgid(), "0" * 64)
        self.assertFalse(destination.exists())
        self.assertEqual(list(self.monthly.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
