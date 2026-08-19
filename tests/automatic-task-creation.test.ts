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
const journal = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'migrations/meta/_journal.json'),
  'utf8',
));

// The task board is planned work: a task appears because a person put it there.
// Two automations used to write to it behind everyone's back — lead pipeline
// stages and missed incoming calls — and both are gone.
describe('automatic task creation', () => {
  it('does not create tasks when a lead changes pipeline stage', () => {
    expect(academyRoutes).not.toContain("createTask('Первый контакт по новой заявке'");
    expect(academyRoutes).not.toContain("createTask('Follow-up после демо'");
    expect(academyRoutes).not.toContain("createTask('Проверить ответ на предложение'");
    expect(academyRoutes).not.toContain("createTask('Напоминание: лид думает 3 дня'");
    expect(academyRoutes).not.toContain("createTask('Повторное напоминание: лид думает 7 дней'");
  });

  it('does not create a task when the provider reports a missed call', () => {
    expect(telephonyRoutes).not.toContain('ensureMissedCallTask');
    expect(telephonyRoutes).not.toContain("'Перезвонить: пропущенный звонок'");
    expect(telephonyRoutes).not.toContain('INSERT INTO board_tasks');
    expect(telephonyRoutes).not.toContain('BOARD_TASK_CREATED');
  });

  it('still tells the sales team about a missed call through the call journal', () => {
    const notifications = fs.readFileSync(
      path.join(repositoryRoot, 'server/services/telephony-notifications.ts'),
      'utf8',
    );
    const sidebar = fs.readFileSync(
      path.join(repositoryRoot, 'client/src/components/Sidebar.tsx'),
      'utf8',
    );
    expect(notifications).toContain('MISSED_INCOMING_CALL_SQL');
    expect(notifications).toContain('getMissedCallUnreadSummary');
    expect(sidebar).toContain('missedCallUnreadQueryOptions');
    expect(sidebar).toContain('badgeCount: missedCallCount');
  });

  // Migration 0065 has run on live databases, so the column it added stays in
  // place and keeps its history; nothing writes to it any more.
  it('keeps the applied missed-call migration registered', () => {
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 65)?.tag)
      .toBe('0065_create_missed_call_tasks');
  });
});
