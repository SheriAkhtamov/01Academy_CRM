import { describe, expect, it, vi } from 'vitest';
import { createSystemBoardTask, type SystemTaskSql } from '../server/modules/academy/system-board-tasks';

const runner = (responses: { assignee?: boolean; existing?: boolean; board?: boolean; administrator?: number | null } = {}) => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const run: SystemTaskSql = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('FROM users WHERE id')) return responses.assignee === false ? [] : [{ id: 7 }];
    if (sql.includes('FROM users account')) return responses.administrator === null ? [] : [{ id: responses.administrator ?? 2 }];
    if (sql.includes('SELECT task.id FROM board_tasks task')) return responses.existing ? [{ id: 3 }] : [];
    if (sql.includes('FROM boards')) return responses.board === false ? [] : [{ id: 1 }];
    if (sql.includes('INSERT INTO board_tasks')) {
      return [{ id: 55, title: params[1], description: params[2], status: 'todo', priority: 'normal', due_at: params[6] }];
    }
    return [];
  });
  return { run, calls };
};

describe('system cards on the shared task board', () => {
  it('files the card on behalf of the administration, with its activity and a Telegram notice', async () => {
    const { run, calls } = runner();
    const dueAt = new Date('2026-11-06T09:00:00.000Z');
    await expect(createSystemBoardTask(run, {
      title: '3 пропуска подряд: позвонить родителю (Pupil)', assigneeId: 7, leadId: 42, dueAt,
      source: 'student_absence', onceKey: 'student_absence:9',
    })).resolves.toEqual({ id: 55 });
    const insert = calls.find(({ sql }) => sql.includes('INSERT INTO board_tasks'))!;
    // An administrator authors the card, so a finished card can be accepted as usual.
    expect(insert.params).toEqual([1, '3 пропуска подряд: позвонить родителю (Pupil)', null, 2, 7, 42, dueAt]);
    expect(calls.find(({ sql }) => sql.includes('FROM users account'))?.sql).toContain(`module = 'administration'`);
    expect(insert.sql).toContain(`'todo', 'normal'`);
    const activity = calls.find(({ sql }) => sql.includes('INSERT INTO board_task_activity'))!;
    expect(activity.params[1]).toBeNull();
    expect(JSON.parse(String(activity.params[2]))).toEqual({ source: 'student_absence', onceKey: 'student_absence:9' });
    const notices = calls.filter(({ sql }) => sql.includes('INSERT INTO telegram_task_events'));
    expect(notices.map(({ params }) => params[0])).toEqual([7]);
    expect(JSON.parse(String(notices[0].params[2]))).toMatchObject({ kind: 'created', taskId: 55, recipientId: 7, actorId: 2 });
    expect(calls.some(({ sql }) => sql.includes('academy_tasks'))).toBe(false);
  });

  it('lets the assignee own the card when there is no active administrator', async () => {
    const { run, calls } = runner({ administrator: null });
    await expect(createSystemBoardTask(run, { title: 'Call', assigneeId: 7, source: 'student_absence' })).resolves.toEqual({ id: 55 });
    const insert = calls.find(({ sql }) => sql.includes('INSERT INTO board_tasks'))!;
    expect(insert.params.slice(3, 5)).toEqual([7, 7]);
    const notices = calls.filter(({ sql }) => sql.includes('INSERT INTO telegram_task_events'));
    expect(notices.map(({ params }) => params[0])).toEqual([7]);
  });

  it('records the employee who asked for the card as its author without notifying them', async () => {
    const { run, calls } = runner();
    await expect(createSystemBoardTask(run, { title: 'Call', assigneeId: 7, creatorId: 2, source: 'dashboard_teachers' }))
      .resolves.toEqual({ id: 55 });
    const insert = calls.find(({ sql }) => sql.includes('INSERT INTO board_tasks'))!;
    expect(insert.params.slice(3, 5)).toEqual([2, 7]);
    expect(calls.some(({ sql }) => sql.includes('FROM users account'))).toBe(false);
    const activity = calls.find(({ sql }) => sql.includes('INSERT INTO board_task_activity'))!;
    expect(activity.params[1]).toBe(2);
    const notices = calls.filter(({ sql }) => sql.includes('INSERT INTO telegram_task_events'));
    expect(notices.map(({ params }) => params[0])).toEqual([7]);
  });

  it.each([
    ['an archived or inactive employee', { assignee: false }],
    ['no active board', { board: false }],
  ])('creates nothing for %s', async (_label, responses) => {
    const { run, calls } = runner(responses);
    await expect(createSystemBoardTask(run, { title: 'Call', assigneeId: 7, source: 'dashboard_teachers' })).resolves.toBeNull();
    expect(calls.some(({ sql }) => sql.includes('INSERT'))).toBe(false);
  });

  it('does not duplicate an open card with the same key, ignoring cards archived with their employee', async () => {
    const { run, calls } = runner({ existing: true });
    await expect(createSystemBoardTask(run, {
      title: 'Renamed pupil', assigneeId: 7, leadId: 42, source: 'student_absence', onceKey: 'student_absence:9',
    })).resolves.toBeNull();
    const lookup = calls.find(({ sql }) => sql.includes('SELECT task.id FROM board_tasks task'))!;
    expect(lookup.sql).toContain(`task.status IN ('backlog', 'todo', 'in_progress')`);
    expect(lookup.sql).toContain('archived_employee.is_archived IS TRUE');
    expect(lookup.sql).toContain(`activity.meta->>'onceKey' = $1`);
    expect(lookup.params).toEqual(['student_absence:9']);
    expect(calls.some(({ sql }) => sql.includes('INSERT'))).toBe(false);
  });

  it('rejects a missing assignee before touching the database', async () => {
    const { run } = runner();
    await expect(createSystemBoardTask(run, { title: 'Call', assigneeId: null, source: 'dashboard_teachers' })).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
