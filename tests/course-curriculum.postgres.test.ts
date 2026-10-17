import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }));
vi.mock('../server/modules/academy/academy-core', () => {
  const snake = (value: string) => value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  const query = async (sql: string, values: unknown[] = []) => (await fixture.pool.query(sql, values)).rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value])));
  const encode = (value: unknown) => value && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value;
  return {
    ACADEMY_TIME_ZONE: 'Asia/Tashkent', query, queryOne: async (sql: string, values: unknown[]) => (await query(sql, values))[0],
    updateRow: async (table: string, id: number, values: Record<string, unknown>) => (await query(`UPDATE ${table} SET ${Object.keys(values).map((key, index) => `${snake(key)}=$${index + 2}`).join(',')} WHERE id=$1 RETURNING *`, [id, ...Object.values(values).map(encode)]))[0],
    insertRow: async (table: string, values: Record<string, unknown>) => (await query(`INSERT INTO ${table}(${Object.keys(values).map(snake).join(',')}) VALUES(${Object.keys(values).map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`, Object.values(values).map(encode)))[0],
  };
});
import { assertCourseCurriculumUpdateAllowed, reconcileGroupCourseLessons } from '../server/modules/academy/course-curriculum';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `course_curriculum_${randomBytes(6).toString('hex')}`;
let admin: Pool;
const program = { version: 1, blocks: [{ id: 'block', title: 'Block', lessons: ['one', 'two', 'three'].map(id => ({ id, title: id, materials: [] })) }] };
const previous = { id: 1, courseId: 1, selectedCourseLessonIds: ['one', 'two'], status: 'open' };
const group = { ...previous, selectedCourseLessonIds: ['one', 'three'], teacherId: 1, roomId: 1, schoolId: 1, lessonDurationMinutes: 60, schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] };
const prepare = vi.fn(async () => {});

describe.skipIf(!databaseUrl)('curriculum reconciliation in isolated PostgreSQL', () => {
  beforeAll(async () => {
    if (!databaseUrl || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Isolated local PostgreSQL required');
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC` });
    await fixture.pool.query(`
      CREATE TABLE academy_courses(id integer PRIMARY KEY,program jsonb);
      CREATE TABLE academy_groups(id integer PRIMARY KEY,course_id integer,selected_course_lesson_ids jsonb,end_date timestamp,updated_at timestamp);
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer,course_id integer,school_id integer,room_id integer,teacher_id integer,lesson_number integer,course_lesson_id text,topic text,materials text,material_file_ids jsonb DEFAULT '[]',scheduled_at timestamp,duration_minutes integer,status text,updated_at timestamp,UNIQUE(group_id,lesson_number));
      CREATE TABLE academy_attendance(id serial PRIMARY KEY,lesson_id integer);
      CREATE TABLE academy_lesson_status_history(lesson_id integer,from_status text,to_status text,changed_by integer,comment text);
      CREATE TABLE academy_lesson_reschedules(lesson_id integer,previous_scheduled_at timestamp,next_scheduled_at timestamp,reason text,changed_by integer);
      CREATE TABLE lms_group_runs(id integer PRIMARY KEY,group_id integer,course_version_id integer);
      CREATE TABLE lms_course_versions(id integer PRIMARY KEY,program jsonb);
      CREATE TABLE lms_lesson_bindings(id integer PRIMARY KEY,run_id integer,lesson_id integer,unit_id integer);
      CREATE TABLE lms_materials(id integer PRIMARY KEY,run_id integer,unit_id integer,state text,created_by integer);
      CREATE TABLE lms_material_publications(material_id integer);
      CREATE TABLE lms_assignments(run_id integer,unit_id integer);
      CREATE TABLE lms_quizzes(run_id integer,unit_id integer);
    `);
  });
  beforeEach(async () => {
    prepare.mockClear();
    await fixture.pool.query('TRUNCATE academy_courses,academy_groups,academy_lessons,academy_attendance,academy_lesson_status_history,academy_lesson_reschedules,lms_group_runs,lms_course_versions,lms_lesson_bindings,lms_materials,lms_material_publications,lms_assignments,lms_quizzes RESTART IDENTITY');
    await fixture.pool.query('INSERT INTO academy_courses VALUES(1,$1)', [JSON.stringify(program)]);
    await fixture.pool.query(`INSERT INTO academy_groups(id,course_id,selected_course_lesson_ids) VALUES(1,1,'["one","two"]')`);
    await fixture.pool.query(`INSERT INTO academy_lessons(group_id,lesson_number,course_lesson_id,topic,scheduled_at,duration_minutes,status) VALUES(1,1,'one','one','2099-01-05 05:00',60,'scheduled'),(1,2,'two','two','2099-01-12 05:00',60,'scheduled')`);
  });
  afterAll(async () => { await fixture.pool?.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });

  it('keeps row identities, cancels removed lessons, and fills the selected subset in order', async () => {
    await reconcileGroupCourseLessons(group, previous, prepare, 42);
    const lessons = (await fixture.pool.query('SELECT id,course_lesson_id,status,lesson_number FROM academy_lessons ORDER BY lesson_number')).rows;
    expect(lessons).toEqual([
      { id: 1, course_lesson_id: 'one', status: 'scheduled', lesson_number: 1 },
      { id: 2, course_lesson_id: 'two', status: 'cancelled', lesson_number: 2 },
      { id: 3, course_lesson_id: 'three', status: 'scheduled', lesson_number: 3 },
    ]);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect((await fixture.pool.query('SELECT lesson_id,to_status,changed_by FROM academy_lesson_status_history')).rows).toEqual([{ lesson_id: 2, to_status: 'cancelled', changed_by: 42 }]);
  });
  it('protects attendance and already started lessons from removal', async () => {
    await fixture.pool.query('INSERT INTO academy_attendance(lesson_id) VALUES(2)');
    await expect(reconcileGroupCourseLessons(group, previous, prepare)).rejects.toThrow('groupCourseLessonsHistoryLocked');
    expect((await fixture.pool.query("SELECT COUNT(*)::int AS count FROM academy_lessons WHERE status='scheduled'")).rows[0].count).toBe(2);
  });
  it('protects published material history before any timetable mutation', async () => {
    await fixture.pool.query(`INSERT INTO lms_group_runs VALUES(1,1,1); INSERT INTO lms_lesson_bindings VALUES(1,1,2,2); INSERT INTO lms_materials VALUES(1,1,2,'published',NULL); INSERT INTO lms_material_publications VALUES(1)`);
    await expect(reconcileGroupCourseLessons(group, previous, prepare)).rejects.toThrow('groupCourseLessonsHistoryLocked');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('does not remove selected course references when the course editor deletes a lesson', async () => {
    await expect(assertCourseCurriculumUpdateAllowed(1, { ...program, blocks: [{ ...program.blocks[0], lessons: [program.blocks[0].lessons[0]] }] })).rejects.toThrow('courseLessonsInUse');
    await expect(assertCourseCurriculumUpdateAllowed(1, program)).resolves.toBeUndefined();
  });
});
