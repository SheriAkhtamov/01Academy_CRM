import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { disposableWorkflowDatabaseUrl, genericWorkflowMigrationIndex, workflowFixtureSql } from '../scripts/lib/disposable-workflow-database.mjs';

describe('disposable current-workflow verification', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('accepts an explicit local PostgreSQL test database at %s', (host) => {
    expect(disposableWorkflowDatabaseUrl(`postgresql://tester:placeholder-test-password@${host}:5432/crm_workflow_test`).hostname).toBe(host);
  });
  it.each([undefined, '', 'invalid', 'https://localhost/crm_test',
    'postgresql://tester:placeholder-sensitive-fixture@remote.example/crm_test', 'postgresql://tester:placeholder-sensitive-fixture@localhost/production',
    'postgresql://tester:placeholder-sensitive-fixture@localhost/crm_test?host=remote.example',
    'postgresql://tester:placeholder-sensitive-fixture@localhost/crm_test#fragment',
    'postgresql://tester:placeholder-sensitive-fixture@localhost/production/test'])('rejects an unsafe destination without exposing credentials (%s)', (value) => {
    expect(() => disposableWorkflowDatabaseUrl(value)).toThrow('Set DATABASE_URL');
    try { disposableWorkflowDatabaseUrl(value); } catch (error) { expect(error.message).not.toContain('placeholder-sensitive-fixture'); }
  });
  it('rejects the migration CLI before connecting when a live database URL is supplied', () => {
    const result = spawnSync(process.execPath, ['scripts/verify-sales-workflow-migration.mjs'], {
      env: { ...process.env, DATABASE_URL: 'postgresql://tester:placeholder-do-not-display@remote.example/production' },
      cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Set DATABASE_URL');
    expect(result.stderr).not.toContain('placeholder-do-not-display');
    expect(result.stderr).not.toContain('ENOTFOUND');
  });
  it('finds 0128 by its registered tag even when the journal order changes', () => {
    const entry = { tag: '0128_generic_funnel_stages_and_qualification' };
    expect(genericWorkflowMigrationIndex({ entries: [{ tag: '0000' }, entry, { tag: '0130' }] })).toBe(1);
    expect(genericWorkflowMigrationIndex({ entries: [entry] })).toBe(0);
    expect(() => genericWorkflowMigrationIndex({ entries: [] })).toThrow('Register migration 0128');
  });
  it('loads current SQL checks while preserving their transaction and rejecting migration replay commands', () => {
    for (const fixture of ['demo-pipeline-protection.sql', 'demo-lead-workflow.sql', 'sales-kpi-triggers.sql']) {
      const source = readFileSync(new URL(`./sql/${fixture}`, import.meta.url), 'utf8');
      const sql = workflowFixtureSql(source);
      expect(sql).toContain('BEGIN;');
      expect(sql).toContain('ROLLBACK;');
      expect(sql).toContain('academy_lead_funnel_qualifications');
      expect(sql).not.toMatch(/^\s*\\/m);
    }
    expect(() => workflowFixtureSql('\\ir ../../migrations/0115_demo_attendance_workflow.sql')).toThrow('unsupported psql command');
  });
});
