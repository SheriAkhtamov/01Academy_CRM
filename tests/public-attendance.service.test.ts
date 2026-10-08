import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), roster: vi.fn(), metrics: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => ({ query: mocks.query, queryOne: mocks.queryOne, withTransaction: (fn: () => Promise<unknown>) => fn(), ACADEMY_SCHEDULING_ADVISORY_LOCK: 7315001 }));
vi.mock('../server/modules/academy/academy-route-support', () => ({ getLessonRoster: mocks.roster }));
vi.mock('../server/modules/academy/academy-leads', () => ({ recalculateStudentMetrics: mocks.metrics }));
import { publicAttendanceService } from '../server/services/public-attendance';
const lesson = { id: 455, groupId: 55, lessonNumber: 1, scheduledAt: new Date('2026-09-23T04:00:00Z'), durationMinutes: 120, status: 'conducted' };
const students = [{ id: 328, studentName: 'Adham Zokirov', contactName: 'Adham Zokirov', phone: 'private-phone', managerId: 6 }];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.roster.mockResolvedValue(students);
  mocks.queryOne.mockImplementation(async (sql: string) => sql.includes('SELECT lesson.*') ? lesson : undefined);
  mocks.query.mockImplementation(async (sql: string) => sql.includes('lead.comment') ? [{ id: 328, comment: 'Организация: Aloqabank' }] : []);
});
it('checks the exact group allowlist before reading or mutating a lesson', async () => {
  mocks.queryOne.mockResolvedValue(undefined);
  await expect(publicAttendanceService.loadRoster(999, [55, 56, 57])).rejects.toMatchObject({ code: 'publicAttendanceNotFound', status: 404 });
  expect(mocks.queryOne).toHaveBeenCalledWith(expect.stringContaining('academy_group.id = ANY($2::int[])'), [999, [55, 56, 57]]);
  expect(mocks.roster).not.toHaveBeenCalled();
});
it('returns only roster names, organizations, and attendance rather than contact or finance fields', async () => {
  const result = await publicAttendanceService.loadRoster(455, [55]);
  expect(result.students).toEqual([{ id: 328, name: 'Adham Zokirov', organization: 'Aloqabank', status: null, revision: null }]);
  expect(JSON.stringify(result)).not.toContain('private-phone');
});
it('rejects future lessons and students outside the historical roster without writes', async () => {
  mocks.queryOne.mockResolvedValueOnce({ ...lesson, scheduledAt: new Date(Date.now() + 86400000) });
  await expect(publicAttendanceService.mark(455, [55], { studentId: 328, status: 'present', expectedRevision: null })).rejects.toMatchObject({ code: 'publicAttendanceLessonNotStarted' });
  await expect(publicAttendanceService.mark(455, [55], { studentId: 999, status: 'present', expectedRevision: null })).rejects.toMatchObject({ code: 'publicAttendanceNotFound' });
  expect(mocks.query.mock.calls.some(([sql]) => /INSERT INTO academy_attendance|DELETE FROM academy_attendance/.test(sql))).toBe(false);
});
it('protects changed marks against stale edits and treats same-value retries as harmless', async () => {
  mocks.queryOne.mockImplementation(async (sql: string) => sql.includes('SELECT lesson.*') ? lesson : { id: 1, status: 'present', revision: 'new-revision' });
  await expect(publicAttendanceService.mark(455, [55], { studentId: 328, status: 'absent', expectedRevision: 'old-revision' })).rejects.toMatchObject({ code: 'publicAttendanceConflict' });
  await publicAttendanceService.mark(455, [55], { studentId: 328, status: 'present', expectedRevision: 'old-revision' });
  expect(mocks.query.mock.calls.some(([sql]) => /INSERT INTO academy_attendance|DELETE FROM academy_attendance/.test(sql))).toBe(false);
});
it('stores anonymous marks and a source-labelled audit event, preserving attendance notes on corrections', async () => {
  mocks.queryOne.mockImplementation(async (sql: string) => sql.includes('SELECT lesson.*') ? lesson : sql.includes('INSERT INTO academy_attendance') ? { id: 12, status: 'present' } : undefined);
  await publicAttendanceService.mark(455, [55], { studentId: 328, status: 'present', expectedRevision: null });
  const upsert = mocks.queryOne.mock.calls.find(([sql]) => sql.includes('INSERT INTO academy_attendance'))!;
  expect(upsert[0]).toContain('marked_by = NULL');
  expect(upsert[0]).not.toContain('note =');
  expect(upsert[0]).not.toContain('project_url =');
  expect(upsert[1]).toEqual([455, 328, 'present']);
  const audit = mocks.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'))!;
  expect(audit[1][0]).toBe('PUBLIC_ATTENDANCE_MARKED');
  expect(JSON.parse(audit[1][4])).toMatchObject({ source: 'public_attendance_page', studentId: 328 });
  expect(mocks.metrics).toHaveBeenCalledWith(328);
});
it('removes a confirmed old mark, retains the previous row in the audit, and recalculates metrics', async () => {
  const old = { id: 12, status: 'present', revision: 'previous', note: 'Keep this in history' };
  mocks.queryOne.mockImplementation(async (sql: string) => sql.includes('SELECT lesson.*') ? lesson : old);
  await publicAttendanceService.mark(455, [55], { studentId: 328, status: null, expectedRevision: 'previous', clearConfirmed: true });
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM academy_attendance'), [455, 328]);
  const audit = mocks.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'))!;
  expect(audit[1][0]).toBe('PUBLIC_ATTENDANCE_CLEARED');
  expect(JSON.parse(audit[1][3])).toEqual(old);
  expect(mocks.metrics).toHaveBeenCalledWith(328);
});

it('keeps later lessons pending while a previous lesson has an incomplete roster', async () => {
  const previous = { ...lesson, id: 454, status: 'scheduled' };
  const target = { ...lesson, status: 'scheduled' };
  mocks.roster.mockResolvedValue([{ id: 328 }, { id: 329 }]);
  mocks.queryOne.mockImplementation(async (sql: string) => sql.includes('SELECT lesson.*') ? target : sql.includes('INSERT INTO academy_attendance') ? { id: 12, status: 'present' } : undefined);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("status = 'scheduled'")) return [previous, target];
    if (sql.includes('SELECT student_id FROM academy_attendance')) return [{ studentId: 328 }];
    return [];
  });
  await publicAttendanceService.mark(455, [55], { studentId: 328, status: 'present', expectedRevision: null });
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes('UPDATE academy_lessons'))).toBe(false);
});

it('completes consecutively filled lessons in order and recalculates every affected student', async () => {
  const first = { ...lesson, status: 'scheduled' };
  const next = { ...lesson, id: 456, status: 'scheduled' };
  mocks.roster.mockResolvedValue([{ id: 328 }, { id: 329 }]);
  mocks.queryOne.mockImplementation(async (sql: string) => sql.includes('SELECT lesson.*') ? first : sql.includes('INSERT INTO academy_attendance') ? { id: 12, status: 'present' } : undefined);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("status = 'scheduled'")) return [first, next];
    if (sql.includes('SELECT student_id FROM academy_attendance')) return [{ studentId: 328 }, { studentId: 329 }];
    return [];
  });
  await publicAttendanceService.mark(455, [55], { studentId: 328, status: 'present', expectedRevision: null });
  const completed = mocks.query.mock.calls.filter(([sql]) => sql.includes('UPDATE academy_lessons'));
  expect(completed.map(([, values]) => values[0])).toEqual([455, 456]);
  expect(mocks.metrics.mock.calls.map(([id]) => id)).toEqual([328, 329]);
});

it('marks the rest of a lesson in one write without touching students who already have a mark', async () => {
  mocks.roster.mockResolvedValue([{ id: 328 }, { id: 329 }, { id: 330 }]);
  mocks.query.mockImplementation(async (sql: string) => sql.includes('INSERT INTO academy_attendance')
    ? [{ id: 21, studentId: 328, status: 'present' }, { id: 22, studentId: 330, status: 'present' }] : []);
  await publicAttendanceService.markMany(455, [55], { studentIds: [328, 329, 330], status: 'present' });
  const insert = mocks.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO academy_attendance'))!;
  expect(insert[0]).toContain('ON CONFLICT (lesson_id, student_id) DO NOTHING');
  expect(insert[0]).not.toContain('DO UPDATE');
  expect(insert[1]).toEqual([455, [328, 329, 330], 'present']);
  const audits = mocks.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO audit_logs'));
  expect(audits.map(([, values]) => values[0])).toEqual(['PUBLIC_ATTENDANCE_MARKED', 'PUBLIC_ATTENDANCE_MARKED']);
  expect(audits.map(([, values]) => JSON.parse(values[4]))).toEqual([
    { lessonId: 455, studentId: 328, status: 'present', source: 'public_attendance_page' },
    { lessonId: 455, studentId: 330, status: 'present', source: 'public_attendance_page' },
  ]);
  expect(mocks.metrics.mock.calls.map(([id]) => id)).toEqual([328, 330]);
});

it('rejects marking the rest of a future lesson or of students outside its roster without writes', async () => {
  mocks.queryOne.mockResolvedValueOnce({ ...lesson, scheduledAt: new Date(Date.now() + 86400000) });
  await expect(publicAttendanceService.markMany(455, [55], { studentIds: [328], status: 'present' })).rejects.toMatchObject({ code: 'publicAttendanceLessonNotStarted', status: 409 });
  await expect(publicAttendanceService.markMany(455, [55], { studentIds: [328, 999], status: 'absent' })).rejects.toMatchObject({ code: 'publicAttendanceNotFound', status: 404 });
  expect(mocks.query.mock.calls.some(([sql]) => /INSERT INTO academy_attendance|INSERT INTO audit_logs/.test(sql))).toBe(false);
  expect(mocks.metrics).not.toHaveBeenCalled();
});

it('reports which lessons are fully marked, including a started lesson still waiting for an earlier one', async () => {
  const day = 86400000;
  const row = (id: number, offsetDays: number, status: string) => ({
    id, groupId: 55, lessonNumber: id, scheduledAt: new Date(Date.now() + offsetDays * day), durationMinutes: 120, status,
  });
  const rows = [row(1, -21, 'conducted'), row(2, -14, 'scheduled'), row(3, -7, 'scheduled'), row(4, 7, 'scheduled')];
  mocks.roster.mockResolvedValue([{ id: 328 }, { id: 329 }]);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM academy_groups WHERE')) return [{ id: 55, name: 'Stream' }];
    if (sql.includes('SELECT lesson.*')) return rows;
    if (sql.includes('FROM academy_attendance')) return [{ lessonId: 2, studentId: 328 }, { lessonId: 2, studentId: 329 }, { lessonId: 3, studentId: 328 }];
    return [];
  });
  const [group] = await publicAttendanceService.listGroups([55]);
  // Conducted → done; every student marked but still "scheduled" → done; partly marked and not started → not.
  expect(group.lessons.map((lesson) => [lesson.id, lesson.fullyMarked])).toEqual([[1, true], [2, true], [3, false], [4, false]]);
  const markQueries = mocks.query.mock.calls.filter(([sql]) => sql.includes('FROM academy_attendance'));
  expect(markQueries).toHaveLength(1);
  expect(markQueries[0][1]).toEqual([[2, 3]]);
  expect(mocks.roster).toHaveBeenCalledTimes(2);
});

it('says whether the roster it returns is fully marked', async () => {
  mocks.roster.mockResolvedValue([{ id: 328, studentName: 'Adham Zokirov' }, { id: 329, studentName: 'Albert Aliyev' }]);
  mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM academy_attendance') ? [{ studentId: 328, status: 'present', revision: 'r' }] : []);
  expect((await publicAttendanceService.loadRoster(455, [55])).lesson.fullyMarked).toBe(false);
  mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM academy_attendance')
    ? [{ studentId: 328, status: 'present', revision: 'r' }, { studentId: 329, status: 'absent', revision: 'r' }] : []);
  expect((await publicAttendanceService.loadRoster(455, [55])).lesson.fullyMarked).toBe(true);
});
