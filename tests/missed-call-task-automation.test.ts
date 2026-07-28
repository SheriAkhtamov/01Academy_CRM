import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAcademyModuleSource } from './helpers/read-academy-module';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const academyRoutes = readAcademyModuleSource();
const telephonyRoutes = fs.readFileSync(
  path.join(repositoryRoot, 'server/routes/telephony.routes.ts'),
  'utf8',
);
const migration = fs.readFileSync(
  path.join(repositoryRoot, 'migrations/0065_create_missed_call_tasks.sql'),
  'utf8',
);
const journal = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'migrations/meta/_journal.json'),
  'utf8',
));

describe('missed call task automation', () => {
  it('does not create tasks when a lead changes pipeline stage', () => {
    expect(academyRoutes).not.toContain("createTask('Первый контакт по новой заявке'");
    expect(academyRoutes).not.toContain("createTask('Follow-up после демо'");
    expect(academyRoutes).not.toContain("createTask('Проверить ответ на предложение'");
    expect(academyRoutes).not.toContain("createTask('Напоминание: лид думает 3 дня'");
    expect(academyRoutes).not.toContain("createTask('Повторное напоминание: лид думает 7 дней'");
  });

  it('creates one urgent board task from an authoritative missed-call webhook', () => {
    expect(telephonyRoutes).toContain("'Перезвонить: пропущенный звонок'");
    expect(telephonyRoutes).toContain("NOW() + INTERVAL '15 minutes'");
    expect(telephonyRoutes).toContain("'backlog', 'urgent'");
    expect(telephonyRoutes).toContain("type: 'BOARD_TASK_CREATED'");
    expect(telephonyRoutes).toContain('missedCallTask = await ensureMissedCallTask');
  });

  it('links each call to at most one task and registers the migration', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "telephony_call_id"');
    expect(migration).toContain('REFERENCES "public"."telephony_calls"("id")');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "board_tasks_telephony_call_unique"');
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 65)?.tag)
      .toBe('0065_create_missed_call_tasks');
  });
});
