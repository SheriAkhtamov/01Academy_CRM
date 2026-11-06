import { randomBytes } from 'node:crypto';
import { Pool, defaults, types } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }));
vi.mock('../server/modules/academy/academy-core', () => {
  const snake = (value: string) => value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  const query = async (sql: string, values: unknown[] = []) => (await fixture.pool.query(sql, values)).rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value])));
  const encode = (value: unknown) => value && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value;
  return {
    ACADEMY_TIME_ZONE: 'Asia/Tashkent', query, queryOne: async (sql: string, values: unknown[]) => (await query(sql, values))[0],
    nullableText: (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null,
    updateRow: async (table: string, id: number, values: Record<string, unknown>) => (await query(`UPDATE ${table} SET ${Object.keys(values).map((key, index) => `${snake(key)}=$${index + 2}`).join(',')} WHERE id=$1 RETURNING *`, [id, ...Object.values(values).map(encode)]))[0],
    insertRow: async (table: string, values: Record<string, unknown>) => (await query(`INSERT INTO ${table}(${Object.keys(values).map(snake).join(',')}) VALUES(${Object.keys(values).map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`, Object.values(values).map(encode)))[0],
  };
});
import { reconcileGroupScheduleLessons } from '../server/modules/academy/group-lesson-schedule';

// Like server/db.ts: timestamps without a zone are UTC both ways, whatever the machine's zone.
types.setTypeParser(1114, (value: string) => new Date(`${value.replace(' ', 'T')}Z`));
defaults.parseInputDatesAsUTC = true;

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `group_lessons_${randomBytes(6).toString('hex')}`;
let admin: Pool;
// Fixed "now": Wednesday 2026-03-11 12:00 in Tashkent.
const now = new Date('2026-03-11T07:00:00Z');
const mondayWednesday = [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }, { dayOfWeek: 3, startTime: '10:00', endTime: '11:00' }];
const tuesdayThursday = [{ dayOfWeek: 2, startTime: '15:00', endTime: '16:00' }, { dayOfWeek: 4, startTime: '15:00', endTime: '16:00' }];
const base = {
  id: 1, courseId: 1, schoolId: 1, roomId: 1, teacherId: 1, status: 'in_progress', isArchived: false,
  schedule: mondayWednesday, startDate: new Date('2026-03-02T00:00:00Z'), lessonCount: 6, lessonDurationMinutes: 60,
  selectedCourseLessonIds: null,
};
const prepare = vi.fn(async () => {});
const weekday = (value: Date) => new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tashkent', weekday: 'short' }).format(value);
const lessons = async () => (await fixture.pool.query('SELECT * FROM academy_lessons ORDER BY scheduled_at, id')).rows;

describe.skipIf(!databaseUrl)('timetable edits reach only unmarked future lessons', () => {
  beforeAll(async () => {
    if (!databaseUrl || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Isolated local PostgreSQL required');
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC` });
    await fixture.pool.query(`
      CREATE TABLE academy_courses(id integer PRIMARY KEY,program jsonb);
      CREATE TABLE academy_groups(id integer PRIMARY KEY,end_date timestamp,updated_at timestamp);
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer,course_id integer,school_id integer,room_id integer,teacher_id integer,lesson_number integer,topic text,materials text,material_file_ids jsonb DEFAULT '[]',scheduled_at timestamp,duration_minutes integer,status text,updated_at timestamp,UNIQUE(group_id,lesson_number));
      CREATE TABLE academy_attendance(id serial PRIMARY KEY,lesson_id integer);
      CREATE TABLE academy_lesson_status_history(lesson_id integer,from_status text,to_status text,changed_by integer,comment text);
      CREATE TABLE academy_lesson_reschedules(lesson_id integer,previous_scheduled_at timestamp,next_scheduled_at timestamp,reason text,changed_by integer);
      CREATE TABLE lms_group_runs(id integer PRIMARY KEY,group_id integer);
      CREATE TABLE lms_lesson_bindings(id integer PRIMARY KEY,run_id integer,lesson_id integer,unit_id integer);
      CREATE TABLE lms_materials(id integer PRIMARY KEY,run_id integer,unit_id integer,state text,created_by integer);
      CREATE TABLE lms_material_publications(material_id integer);
      CREATE TABLE lms_assignments(run_id integer,unit_id integer);
      CREATE TABLE lms_quizzes(run_id integer,unit_id integer);
    `);
  });
  beforeEach(async () => {
    prepare.mockClear();
    await fixture.pool.query('TRUNCATE academy_courses,academy_groups,academy_lessons,academy_attendance,academy_lesson_status_history,academy_lesson_reschedules,lms_group_runs,lms_lesson_bindings,lms_materials,lms_material_publications,lms_assignments,lms_quizzes RESTART IDENTITY');
    await fixture.pool.query(`INSERT INTO academy_courses VALUES(1,'[]'); INSERT INTO academy_groups(id) VALUES(1)`);
    // Mon/Wed 10:00 Tashkent from 2 March: two conducted, one marked but open, three ahead.
    await fixture.pool.query(`INSERT INTO academy_lessons(group_id,course_id,school_id,room_id,teacher_id,lesson_number,topic,scheduled_at,duration_minutes,status) VALUES
      (1,1,1,1,1,1,'one','2026-03-02 05:00',60,'conducted'),
      (1,1,1,1,1,2,'two','2026-03-04 05:00',60,'conducted'),
      (1,1,1,1,1,3,'three','2026-03-09 05:00',60,'scheduled'),
      (1,1,1,1,1,4,'four','2026-03-11 05:00',60,'scheduled'),
      (1,1,1,1,1,5,'five','2026-03-16 05:00',60,'scheduled'),
      (1,1,1,1,2,6,'six','2026-03-18 05:00',60,'scheduled')`);
    await fixture.pool.query('INSERT INTO academy_attendance(lesson_id) VALUES(3)');
  });
  afterAll(async () => { await fixture.pool?.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });

  it('moves the future unmarked lessons to the new timetable and keeps the history', async () => {
    await reconcileGroupScheduleLessons({ ...base, schedule: tuesdayThursday }, base, prepare, 42, now);
    const rows = await lessons();
    expect(rows.slice(0, 4).map((row) => [row.id, row.scheduled_at.toISOString()])).toEqual([
      [1, '2026-03-02T05:00:00.000Z'], [2, '2026-03-04T05:00:00.000Z'], [3, '2026-03-09T05:00:00.000Z'], [4, '2026-03-11T05:00:00.000Z'],
    ]);
    expect(rows.slice(4).map((row) => [row.id, weekday(row.scheduled_at)])).toEqual([[5, 'Thu'], [6, 'Tue']]);
    expect(rows[4].scheduled_at.toISOString()).toBe('2026-03-12T10:00:00.000Z');
    expect((await fixture.pool.query('SELECT lesson_id,reason,changed_by FROM academy_lesson_reschedules ORDER BY lesson_id')).rows)
      .toEqual([5, 6].map((lesson_id) => ({ lesson_id, reason: 'Изменение расписания группы', changed_by: 42 })));
    expect((await fixture.pool.query('SELECT end_date FROM academy_groups')).rows[0].end_date.toISOString()).toBe('2026-03-17T00:00:00.000Z');
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('gives future lessons the new teacher and room but keeps a substitute and the past', async () => {
    await reconcileGroupScheduleLessons({ ...base, teacherId: 3, roomId: 4 }, base, prepare, 42, now);
    expect((await lessons()).map((row) => [row.id, row.teacher_id, row.room_id])).toEqual([
      [1, 1, 1], [2, 1, 1], [3, 1, 1], [4, 1, 1], [5, 3, 4], [6, 2, 4],
    ]);
    expect((await fixture.pool.query('SELECT * FROM academy_lesson_reschedules')).rowCount).toBe(0);
  });

  it('leaves a one-off reschedule in place when only the lesson length changes', async () => {
    await fixture.pool.query(`UPDATE academy_lessons SET scheduled_at='2026-03-17 05:00' WHERE id=5`);
    await reconcileGroupScheduleLessons({ ...base, lessonDurationMinutes: 90 }, base, prepare, 42, now);
    expect((await lessons()).find((row) => row.id === 5)?.scheduled_at.toISOString()).toBe('2026-03-17T05:00:00.000Z');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('adds lessons after the last one and cancels the latest future ones', async () => {
    await reconcileGroupScheduleLessons({ ...base, lessonCount: 8 }, base, prepare, 42, now);
    let rows = await lessons();
    expect(rows.filter((row) => row.status !== 'cancelled')).toHaveLength(8);
    expect(rows.slice(-2).map((row) => [row.lesson_number, row.scheduled_at.toISOString(), row.teacher_id, row.topic])).toEqual([
      [7, '2026-03-23T05:00:00.000Z', 1, 'Занятие 7'], [8, '2026-03-25T05:00:00.000Z', 1, 'Занятие 8'],
    ]);
    await reconcileGroupScheduleLessons({ ...base, lessonCount: 5 }, { ...base, lessonCount: 8 }, prepare, 42, now);
    rows = await lessons();
    expect(rows.filter((row) => row.status !== 'cancelled').map((row) => row.lesson_number)).toEqual([1, 2, 3, 4, 5]);
    expect((await fixture.pool.query('SELECT lesson_id,to_status FROM academy_lesson_status_history ORDER BY lesson_id')).rows)
      .toEqual([6, 7, 8].map((lesson_id) => ({ lesson_id, to_status: 'cancelled' })));
  });

  it('never cancels a lesson that carries learning content and ignores a count that was never set', async () => {
    await fixture.pool.query(`INSERT INTO lms_group_runs VALUES(1,1); INSERT INTO lms_lesson_bindings VALUES(1,1,6,9); INSERT INTO lms_assignments VALUES(1,9)`);
    await expect(reconcileGroupScheduleLessons({ ...base, lessonCount: 5 }, base, prepare, 42, now))
      .rejects.toMatchObject({ message: 'groupCourseLessonsHistoryLocked', statusCode: 409 });
    expect((await lessons()).every((row) => row.status !== 'cancelled')).toBe(true);
    await reconcileGroupScheduleLessons({ ...base, lessonCount: 10 }, { ...base, lessonCount: 0 }, prepare, 42, now);
    expect(await lessons()).toHaveLength(6);
  });

  it('gives a frozen group the new teacher now and leaves its times to the restore', async () => {
    const frozen = { ...base, status: 'frozen' };
    await reconcileGroupScheduleLessons({ ...frozen, teacherId: 3, schedule: tuesdayThursday, lessonCount: 9 }, frozen, prepare, 42, now);
    expect((await lessons()).map((row) => [row.id, row.teacher_id, row.scheduled_at.toISOString()])).toEqual([
      [1, 1, '2026-03-02T05:00:00.000Z'], [2, 1, '2026-03-04T05:00:00.000Z'], [3, 1, '2026-03-09T05:00:00.000Z'],
      [4, 3, '2026-03-11T05:00:00.000Z'], [5, 3, '2026-03-16T05:00:00.000Z'], [6, 2, '2026-03-18T05:00:00.000Z'],
    ]);
    expect(prepare).not.toHaveBeenCalled();
    // Restoring in the same save: the new teacher is set before the lessons are re-slotted.
    await reconcileGroupScheduleLessons({ ...base, teacherId: 5 }, { ...frozen, teacherId: 3 }, prepare, 42, now);
    expect((await lessons()).filter((row) => row.status === 'scheduled').map((row) => row.teacher_id)).toEqual([1, 5, 5, 2]);
  });
});
