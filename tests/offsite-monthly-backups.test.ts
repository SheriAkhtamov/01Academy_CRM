import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

describe('permanent monthly offsite backups', () => {
  it('preserves first-day snapshots and handles corruption and interrupted publication', () => {
    execFileSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_offsite_monthly_backups.py'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: 'pipe',
    });
  });
});
