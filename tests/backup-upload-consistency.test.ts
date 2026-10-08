import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const backupScript = join(root, 'scripts', 'create-production-backup.sh');
const pruneScript = join(root, 'scripts', 'prune-retained-uploads.sh');
const directories: string[] = [];
function executable(directory: string, name: string, source: string) {
  const target = join(directory, name);
  writeFileSync(target, `#!/bin/sh\nset -eu\n${source}\n`);
  chmodSync(target, 0o755);
}
function fixture(dumpAction = '') {
  const directory = mkdtempSync(join(tmpdir(), 'academy-backup-consistency-'));
  directories.push(directory);
  const backups = join(directory, 'backups');
  const uploads = join(directory, 'media'); // restore paths are always uploads/.
  const bin = join(directory, 'bin');
  for (const folder of [backups, uploads, bin]) mkdirSync(folder);
  mkdirSync(join(uploads, 'board'));
  writeFileSync(join(uploads, 'board', 'original.pdf'), 'referenced before the dump');
  const password = join(directory, 'password');
  writeFileSync(password, 'fixture-only');
  executable(bin, 'pg_dump', `output=''
for argument in "$@"; do
  case "$argument" in --file=*) output="\${argument#--file=}" ;; esac
done
printf 'uploads/board/original.pdf\\n' > "$output"
${dumpAction}`);
  executable(bin, 'pg_restore', 'test "$1" = --list; test -s "$2"');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`,
    BACKUP_DIR: backups, UPLOADS_DIR: uploads, POSTGRES_PASSWORD_FILE: password, BACKUP_LOCK_HELD: '1' };
  return { directory, backups, uploads, bin, env };
}
function archive(backups: string) {
  const names = readdirSync(backups).filter(name => name.endsWith('.zip'));
  expect(names).toHaveLength(1);
  return join(backups, names[0]);
}
const contents = (zip: string, entry: string) => execFileSync('unzip', ['-p', zip, entry], { encoding: 'utf8' });
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('database/files backup consistency', () => {
  it('includes files deleted after the dump snapshot, including files created during dumping', () => {
    const state = fixture(`
mkdir -p "$UPLOADS_DIR/.retained/board"
ln "$UPLOADS_DIR/board/original.pdf" "$UPLOADS_DIR/.retained/board/original.pdf"
rm "$UPLOADS_DIR/board/original.pdf"
printf 'created before its database row snapshot' > "$UPLOADS_DIR/board/new.pdf"
printf 'uploads/board/new.pdf\\n' >> "$output"
ln "$UPLOADS_DIR/board/new.pdf" "$UPLOADS_DIR/.retained/board/new.pdf"
rm "$UPLOADS_DIR/board/new.pdf"
mkdir -p "$UPLOADS_DIR/.retention-work"
printf 'partial uncommitted copy' > "$UPLOADS_DIR/.retention-work/partial"`);
    execFileSync('/bin/sh', [backupScript], { env: state.env, stdio: 'pipe' });
    const zip = archive(state.backups);
    const references = contents(zip, 'database.dump').trim().split('\n');
    expect(references).toEqual(['uploads/board/original.pdf', 'uploads/board/new.pdf']);
    expect(contents(zip, references[0])).toBe('referenced before the dump');
    expect(contents(zip, references[1])).toBe('created before its database row snapshot');
    const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
    expect(entries).not.toContain('.retained');
    expect(entries).not.toContain('.retention-work');
    const manifest = JSON.parse(contents(zip, 'manifest.json'));
    expect(manifest.uploads.fileCount).toBe(2);
    const inventory = contents(zip, 'uploads.sha256');
    expect(manifest.uploads.checksumsSha256).toBe(createHash('sha256').update(inventory).digest('hex'));
    for (const reference of references) {
      expect(inventory).toContain(`${createHash('sha256').update(contents(zip, reference)).digest('hex')}  ${reference}`);
    }
    const restored = join(state.directory, 'restored');
    execFileSync('unzip', ['-q', zip, '-d', restored]);
    execFileSync('sha256sum', ['-c', 'uploads.sha256'], { cwd: restored });
  });

  it('packages the captured files when live uploads change during ZIP creation', () => {
    const state = fixture();
    const realZip = execFileSync('/bin/sh', ['-c', 'command -v zip'], { encoding: 'utf8' }).trim();
    executable(state.bin, 'zip', `
printf 'changed live data' > "$UPLOADS_DIR/board/original.pdf"
printf 'unrelated later upload' > "$UPLOADS_DIR/board/later.pdf"
exec "$REAL_ZIP" "$@"`);
    execFileSync('/bin/sh', [backupScript], { env: { ...state.env, REAL_ZIP: realZip }, stdio: 'pipe' });
    const zip = archive(state.backups);
    expect(contents(zip, 'uploads/board/original.pdf')).toBe('referenced before the dump');
    expect(readFileSync(join(state.uploads, 'board', 'original.pdf'), 'utf8')).toBe('changed live data');
    expect(JSON.parse(contents(zip, 'manifest.json')).uploads.fileCount).toBe(1);
    expect(execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })).not.toContain('later.pdf');
  });

  it('merges a deletion that occurs while the canonical directory is being captured', () => {
    const state = fixture();
    const realCopy = execFileSync('/bin/sh', ['-c', 'command -v cp'], { encoding: 'utf8' }).trim();
    executable(state.bin, 'cp', `
if [ -f "$UPLOADS_DIR/board/original.pdf" ]; then
  mkdir -p "$UPLOADS_DIR/.retained/board"
  ln "$UPLOADS_DIR/board/original.pdf" "$UPLOADS_DIR/.retained/board/original.pdf"
  rm "$UPLOADS_DIR/board/original.pdf"
fi
exec "$REAL_COPY" "$@"`);
    execFileSync('/bin/sh', [backupScript], { env: { ...state.env, REAL_COPY: realCopy }, stdio: 'pipe' });
    expect(contents(archive(state.backups), 'uploads/board/original.pdf')).toBe('referenced before the dump');
  });

  it('preserves a canonical file when merging its retained counterpart', () => {
    const state = fixture();
    mkdirSync(join(state.uploads, '.retained', 'board'), { recursive: true });
    writeFileSync(join(state.uploads, '.retained', 'board', 'original.pdf'), 'a retained counterpart');
    execFileSync('/bin/sh', [backupScript], { env: state.env, stdio: 'pipe' });
    expect(contents(archive(state.backups), 'uploads/board/original.pdf')).toBe('referenced before the dump');
  });

  it('does not publish an archive or success marker when capture or hashing fails', () => {
    for (const failingCommand of ['cp', 'sha256sum']) {
      const state = fixture();
      executable(state.bin, failingCommand, 'exit 1');
      const result = spawnSync('/bin/sh', [backupScript], { env: state.env, stdio: 'pipe' });
      expect(result.status).not.toBe(0);
      expect(readdirSync(state.backups)).toEqual([]);
      expect(existsSync(join(state.backups, '.last-success'))).toBe(false);
    }
  });
});

describe('operator retention maintenance', () => {
  it('has valid shell syntax and keeps fresh deletions with an old original mtime', () => {
    execFileSync('/bin/sh', ['-n', pruneScript]);
    const state = fixture();
    const retained = join(state.uploads, '.retained', 'board', 'old-document.pdf');
    mkdirSync(join(state.uploads, '.retained', 'board'), { recursive: true });
    writeFileSync(retained, 'deleted just now');
    utimesSync(retained, new Date('2000-01-01'), new Date('2000-01-01'));
    execFileSync('/bin/sh', [pruneScript], {
      env: { ...state.env, RETAINED_PRUNE_LOCK_HELD: '1', CREATE_BACKUP_SCRIPT: backupScript }, stdio: 'pipe',
    });
    expect(readFileSync(retained, 'utf8')).toBe('deleted just now');
    expect(contents(archive(state.backups), 'uploads/board/old-document.pdf')).toBe('deleted just now');
  });

  it('never reaches garbage collection if the fresh verified backup fails', () => {
    const state = fixture();
    const failing = join(state.bin, 'failed-backup');
    executable(state.bin, 'failed-backup', 'exit 1');
    executable(state.bin, 'find', 'printf invoked > "$BACKUP_DIR/gc-called"');
    const result = spawnSync('/bin/sh', [pruneScript], {
      env: { ...state.env, RETAINED_PRUNE_LOCK_HELD: '1', CREATE_BACKUP_SCRIPT: failing }, stdio: 'pipe',
    });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(state.backups, 'gc-called'))).toBe(false);
  });

  it('takes the backup lock before its fresh backup and keeps it through ctime pruning', () => {
    const state = fixture();
    mkdirSync(join(state.uploads, '.retained'));
    executable(state.bin, 'flock', `
test "$1" = --exclusive
test "$2" = --wait
test "$4" = "$BACKUP_DIR/.backup.lock"
shift 4
export TEST_LOCK_ACTIVE=1
exec "$@"`);
    executable(state.bin, 'checked-backup', `
test "$TEST_LOCK_ACTIVE" = 1
test "$BACKUP_LOCK_HELD" = 1
printf backup > "$BACKUP_DIR/operations"`);
    executable(state.bin, 'find', `
test "$TEST_LOCK_ACTIVE" = 1
test "$1" = "$UPLOADS_DIR/.retained"
test "$4" = -ctime
test "$5" = +30
printf ':prune' >> "$BACKUP_DIR/operations"`);
    execFileSync('/bin/sh', [pruneScript], {
      env: { ...state.env, CREATE_BACKUP_SCRIPT: join(state.bin, 'checked-backup') }, stdio: 'pipe',
    });
    expect(readFileSync(join(state.backups, 'operations'), 'utf8')).toBe('backup:prune');
  });
});
