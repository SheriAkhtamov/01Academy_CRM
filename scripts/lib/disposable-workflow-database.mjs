import assert from 'node:assert/strict';

/** Check the destination before importing server code or creating a connection. */
export function disposableWorkflowDatabaseUrl(value) {
  let url;
  try { url = new URL(value ?? 'invalid:'); } catch { /* Report no credentials. */ }
  assert(url && ['postgres:', 'postgresql:'].includes(url.protocol)
    && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && /^\/[a-zA-Z0-9_]+_test$/.test(url.pathname)
    && !url.search && !url.hash,
  'Set DATABASE_URL to an explicitly configured disposable local PostgreSQL database ending in _test');
  return url;
}

export function genericWorkflowMigrationIndex(journal) {
  const index = journal.entries.findIndex((entry) => entry.tag === '0128_generic_funnel_stages_and_qualification');
  assert(index >= 0, 'Register migration 0128 before running the current workflow verifier');
  return index;
}

/** The shared SQL fixtures contain only these psql display/error options. */
export function workflowFixtureSql(source) {
  return source.split('\n').filter((line) => {
    if (!line.trimStart().startsWith('\\')) return true;
    assert(/^\s*\\(?:set ON_ERROR_STOP on|echo\b.*)$/.test(line),
      'Workflow fixture contains an unsupported psql command');
    return false;
  }).join('\n');
}
