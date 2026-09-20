import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const createBackupScript = join(repositoryRoot, 'scripts', 'create-production-backup.sh');
const schedulerScript = join(repositoryRoot, 'scripts', 'run-backup-scheduler.sh');
const offsitePullScript = join(repositoryRoot, 'scripts', 'pull-offsite-backups.sh');
const offsiteFinalizeScript = join(
  repositoryRoot,
  'scripts',
  'finalize-offsite-backup-vault.sh',
);
const offsiteAuditScript = join(repositoryRoot, 'scripts', 'audit-offsite-backup-vault.sh');
const temporaryDirectories: string[] = [];

const createExecutable = (directory: string, name: string, source: string) => {
  const file = join(directory, name);
  writeFileSync(file, source, { mode: 0o755 });
  chmodSync(file, 0o755);
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('production backup infrastructure', () => {
  it('keeps the scripts syntactically valid and removes the legacy JSON backup', () => {
    execFileSync('/bin/sh', ['-n', createBackupScript]);
    execFileSync('/bin/sh', ['-n', schedulerScript]);
    execFileSync('/bin/bash', ['-n', offsitePullScript]);
    execFileSync('/bin/bash', ['-n', offsiteFinalizeScript]);
    execFileSync('/bin/bash', ['-n', offsiteAuditScript]);

    expect(existsSync(join(repositoryRoot, 'scripts', 'backup-database.mjs'))).toBe(false);
    expect(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')).not.toContain('db:backup');
  });

  it('keeps offsite copies pull-only and independently verified', () => {
    const script = readFileSync(offsitePullScript, 'utf8');
    const finalizer = readFileSync(offsiteFinalizeScript, 'utf8');
    const service = readFileSync(
      join(repositoryRoot, 'ops', 'systemd', '01academy-offsite-backup.service'),
      'utf8',
    );
    const timer = readFileSync(
      join(repositoryRoot, 'ops', 'systemd', '01academy-offsite-backup.timer'),
      'utf8',
    );
    const environment = readFileSync(
      join(repositoryRoot, 'ops', 'systemd', '01academy-offsite-backup.env'),
      'utf8',
    );
    const auditScript = readFileSync(offsiteAuditScript, 'utf8');
    const auditService = readFileSync(
      join(repositoryRoot, 'ops', 'systemd', '01academy-offsite-backup-audit.service'),
      'utf8',
    );
    const auditTimer = readFileSync(
      join(repositoryRoot, 'ops', 'systemd', '01academy-offsite-backup-audit.timer'),
      'utf8',
    );

    expect(script).toContain('rsync');
    expect(script).toContain('sha256sum');
    expect(script).toContain('unzip -tq');
    expect(script).toContain('pg_restore --list');
    expect(script).toContain('--no-links');
    expect(script).toContain('--size-only');
    expect(script).toContain('Refusing to replace an incomplete or unsafe sealed backup');
    expect(script).not.toContain('--delete');
    expect(script).not.toContain('Removing sealed backup');
    expect(finalizer).toContain('RETENTION_DAYS="${RETENTION_DAYS:-90}"');
    expect(finalizer).toContain('chown root:"$BACKUP_GROUP"');
    expect(finalizer).toContain('chmod 1770 "$ARCHIVE_DIR"');
    expect(finalizer).toContain('Removing sealed backup');
    expect(service).toContain('User=crmbackup');
    expect(service).toContain('ProtectSystem=strict');
    expect(service).toContain('LoadCredentialEncrypted=ssh_key:');
    expect(service).toContain('ExecStartPost=+');
    expect(service).toContain('IPAddressDeny=any');
    expect(timer).toContain('OnCalendar=*-*-* *:25:00');
    expect(environment).toContain('INCOMING_DIR=/var/lib/crmbackup/incoming');
    expect(environment).toContain('STATE_DIR=/var/lib/crmbackup/state');
    expect(environment).not.toContain('SSH_KEY_PATH');
    expect(auditScript).toContain('Read-only backup vault audit completed');
    expect(auditScript).toContain('pg_restore --list');
    expect(auditScript).not.toContain('rm -f -- "$expired_archive"');
    expect(auditService).toContain('PrivateNetwork=true');
    expect(auditService).toContain('ReadOnlyPaths=/opt/01academy-backup');
    expect(auditTimer).toContain('OnCalendar=*-*-* 02:10:00');
  });

  it('packages a verified dump and uploads, then retains exactly ten archives', () => {
    const root = mkdtempSync(join(tmpdir(), 'academy-backup-test-'));
    temporaryDirectories.push(root);

    const backupDirectory = join(root, 'backups');
    const uploadsDirectory = join(root, 'uploads');
    const fakeBinDirectory = join(root, 'bin');
    const passwordFile = join(root, 'postgres_password');
    mkdirSync(backupDirectory);
    mkdirSync(uploadsDirectory);
    mkdirSync(fakeBinDirectory);
    writeFileSync(join(uploadsDirectory, 'document.txt'), 'attachment');
    writeFileSync(passwordFile, 'test-password\n', { mode: 0o600 });

    createExecutable(fakeBinDirectory, 'pg_dump', `#!/bin/sh
set -eu
output=''
for argument in "$@"; do
  case "$argument" in
    --file=*) output="\${argument#--file=}" ;;
  esac
done
test -n "$output"
printf 'mock custom dump' > "$output"
`);
    createExecutable(fakeBinDirectory, 'pg_restore', `#!/bin/sh
set -eu
test "$1" = '--list'
test -s "$2"
`);
    createExecutable(fakeBinDirectory, 'sha256sum', `#!/bin/sh
set -eu
printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  %s\\n' "$1"
`);

    for (let index = 0; index < 12; index += 1) {
      const suffix = String(index).padStart(2, '0');
      const archive = join(backupDirectory, `academy-crm-backup-20000101T0000${suffix}Z.zip`);
      writeFileSync(archive, 'expired');
      writeFileSync(`${archive}.sha256`, 'expired checksum');
    }

    execFileSync('/bin/sh', [createBackupScript], {
      env: {
        ...process.env,
        PATH: `${fakeBinDirectory}:${process.env.PATH ?? ''}`,
        BACKUP_DIR: backupDirectory,
        UPLOADS_DIR: uploadsDirectory,
        BACKUP_KEEP: '10',
        BACKUP_LOCK_HELD: '1',
        POSTGRES_PASSWORD_FILE: passwordFile,
      },
      stdio: 'pipe',
    });

    const archives = readdirSync(backupDirectory)
      .filter((file) => /^academy-crm-backup-.*\.zip$/.test(file))
      .sort();
    expect(archives).toHaveLength(10);

    const newestArchive = join(backupDirectory, archives.at(-1)!);
    const entries = execFileSync('unzip', ['-Z1', newestArchive], { encoding: 'utf8' });
    expect(entries).toContain('database.dump');
    expect(entries).toContain('manifest.json');
    expect(entries).toContain('uploads/document.txt');
    expect(existsSync(`${newestArchive}.sha256`)).toBe(true);
    expect(readFileSync(join(backupDirectory, '.last-success'), 'utf8')).toContain(archives.at(-1)!);
    expect(readdirSync(backupDirectory).some((file) => file.endsWith('.partial'))).toBe(false);
    expect(readdirSync(backupDirectory).some((file) => file.startsWith('.academy-backup-work.'))).toBe(false);
  });

  it('keeps the Docker service read-only except for the backup directory', () => {
    const compose = readFileSync(join(repositoryRoot, 'docker-compose.yml'), 'utf8');
    const dockerfile = readFileSync(join(repositoryRoot, 'Dockerfile.db-archive'), 'utf8');

    expect(compose).toContain('BACKUP_INTERVAL_SECONDS=3600');
    expect(compose).toContain('BACKUP_KEEP=10');
    expect(compose).toContain('./uploads:/uploads:ro');
    expect(compose).toContain('user: "1000:${BACKUP_GID:-1000}"');
    expect(compose).toContain('read_only: true');
    expect(dockerfile).toContain('FROM postgres:17-alpine@sha256:');
  });
});
