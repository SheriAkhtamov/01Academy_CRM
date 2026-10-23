import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { expect, it } from 'vitest';

it('includes the reminder retry policy in the production Drizzle migration plan', () => {
  const source = readFileSync('migrations/0163_voice_reminder_retry_policy.sql', 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  const plan = readMigrationFiles({ migrationsFolder: 'migrations' });
  const index = plan.findIndex(migration => migration.hash === hash);
  expect(index).toBeGreaterThan(0);
  expect(plan[index].folderMillis).toBeGreaterThan(plan[index - 1].folderMillis);
});
