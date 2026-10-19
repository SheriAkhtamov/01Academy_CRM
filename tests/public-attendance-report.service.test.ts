import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), roster: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => ({ query: mocks.query }));
vi.mock('../server/modules/academy/academy-route-support', () => ({ getLessonRoster: mocks.roster }));
import { loadPublicAttendanceReport } from '../server/services/public-attendance-report';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM academy_groups WHERE')) return [
      { id: 55, name: 'CYP-VC-GRP-26-0001 — Поток 1' }, { id: 56, name: 'Поток 2' }, { id: 57, name: 'Поток 3' },
    ];
    if (sql.includes('FROM academy_lessons lesson')) return [
      { id: 1, groupId: 55, scheduledAt: '2026-10-01T04:00:00Z' },
      { id: 2, groupId: 55, scheduledAt: '2026-10-02T04:00:00Z' },
      { id: 3, groupId: 56, scheduledAt: '2026-10-03T04:00:00Z' },
    ];
    if (sql.includes('FROM academy_attendance')) return [
      { lessonId: 1, studentId: 1, status: 'present' }, { lessonId: 1, studentId: 2, status: 'absent' },
      { lessonId: 2, studentId: 1, status: 'absent' }, { lessonId: 3, studentId: 1, status: 'present' },
      // A historical mark for somebody outside this lesson's roster is not counted.
      { lessonId: 2, studentId: 2, status: 'present' },
    ];
    if (sql.includes('lead.comment')) return [{ id: 1, comment: 'Организация: Bank\nprivate comment' }];
    return [];
  });
  mocks.roster.mockImplementation(async (group: number, date: string) => {
    const student = (id: number) => ({ id, studentName: `Student ${id}`, phone: 'secret phone', balance: 100 });
    if (group === 56) return [student(1), student(3)];
    return date.startsWith('2026-10-01') ? [student(1), student(2)] : [student(1)];
  });
});

it('counts actual historical rosters across streams, separates unmarked students, and deduplicates total students', async () => {
  const result = await loadPublicAttendanceReport([55, 56, 57], {});
  expect(result.totals).toEqual({ present: 2, absent: 2, unmarked: 1, lessonCount: 3, studentCount: 3 });
  expect(result.groups.map(({ id, name, lessonCount, present, absent, unmarked, students }) => ({ id, name, lessonCount, present, absent, unmarked, studentCount: students.length }))).toEqual([
    { id: 55, name: 'Поток 1', lessonCount: 2, present: 1, absent: 2, unmarked: 0, studentCount: 2 },
    { id: 56, name: 'Поток 2', lessonCount: 1, present: 1, absent: 0, unmarked: 1, studentCount: 2 },
    { id: 57, name: 'Поток 3', lessonCount: 0, present: 0, absent: 0, unmarked: 0, studentCount: 0 },
  ]);
  expect(result.groups[0].students[0]).toEqual({ id: 1, name: 'Student 1', organization: 'Bank', present: 1, absent: 1, unmarked: 0 });
  expect(result.groups[1].students[1]).toEqual({ id: 3, name: 'Student 3', organization: null, present: 0, absent: 0, unmarked: 1 });
  expect(mocks.roster).toHaveBeenCalledWith(55, '2026-10-02T04:00:00Z');
  expect(JSON.stringify(result)).not.toMatch(/secret phone|balance|private comment/);
});

it('scopes both queries to allowed active streams, excludes future/cancelled lessons, and uses inclusive Tashkent dates', async () => {
  await loadPublicAttendanceReport([55, 56], { from: '2026-10-01', to: '2026-10-19' });
  const groupQuery = mocks.query.mock.calls.find(([sql]) => sql.includes('FROM academy_groups WHERE'))!;
  expect(groupQuery[1]).toEqual([[55, 56]]);
  expect(groupQuery[0]).toContain('is_archived = false');
  const lessonQuery = mocks.query.mock.calls.find(([sql]) => sql.includes('FROM academy_lessons lesson'))!;
  expect(lessonQuery[1]).toEqual([[55, 56], '2026-10-01', '2026-10-19']);
  expect(lessonQuery[0]).toContain('academy_group.id = ANY($1::int[])');
  expect(lessonQuery[0]).toContain("lesson.status IN ('scheduled', 'conducted')");
  expect(lessonQuery[0]).toContain("lesson.scheduled_at <= (NOW() AT TIME ZONE 'UTC')");
  expect(lessonQuery[0]).toContain("AT TIME ZONE 'Asia/Tashkent'");
  expect(lessonQuery[0]).toContain("INTERVAL '1 day'");
});

it('returns zero counts and avoids roster and mark reads when no lesson has started', async () => {
  mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM academy_groups WHERE') ? [{ id: 55, name: 'Поток 1' }] : []);
  const result = await loadPublicAttendanceReport([55], {});
  expect(result.totals).toEqual({ present: 0, absent: 0, unmarked: 0, lessonCount: 0, studentCount: 0 });
  expect(result.groups[0].students).toEqual([]);
  expect(mocks.roster).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledTimes(2);
});
