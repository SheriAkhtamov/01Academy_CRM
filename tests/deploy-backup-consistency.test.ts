import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it.each([
  { modern: false, failed: false },
  { modern: true, failed: false },
  { modern: false, failed: true },
])('coordinates the rollout snapshot without invalidating its flock: %j', ({ modern, failed }) => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const start = workflow.indexOf('          backup_started_at=');
  const end = workflow.indexOf('          docker compose up -d --no-build --remove-orphans', start);
  const segment = workflow.slice(start, end).replace(/^          /gm, '');
  const root = mkdtempSync(join(tmpdir(), 'academy-deploy-backup-'));
  try {
    mkdirSync(join(root, 'backups'));
    const lock = join(root, 'backups', '.backup.lock');
    writeFileSync(lock, 'Persistent backup lock');
    const inode = statSync(lock).ino;
    writeFileSync(join(root, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$*" in
  'exec crm-pro test -f '*) test "$TEST_MODERN" = '1' ;;
  'compose run '*) test "$TEST_FAIL_BACKUP" = '0' ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
    let exit = 0;
    try {
      execFileSync('/bin/bash', ['-e', '-c', segment], {
        cwd: root, env: { ...process.env, PATH: `${root}:${process.env.PATH}`, TEST_LOG: join(root, 'calls'),
          TEST_MODERN: modern ? '1' : '0', TEST_FAIL_BACKUP: failed ? '1' : '0' },
      });
    } catch (error) { exit = (error as { status: number }).status; }
    const calls = readFileSync(join(root, 'calls'), 'utf8').trim().split('\n');
    const snapshot = calls.findIndex((call) => call.startsWith('compose run '));
    const stopped = calls.indexOf('compose stop crm');
    expect(exit).toBe(failed ? 1 : 0);
    expect(statSync(lock).ino).toBe(inode);
    if (modern) expect(stopped).toBe(-1);
    else { expect(stopped).toBeGreaterThan(-1); expect(stopped).toBeLessThan(snapshot); }
    expect(calls.includes('start crm-pro')).toBe(failed && !modern);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
