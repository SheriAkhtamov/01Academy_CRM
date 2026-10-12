import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }));
vi.mock('../server/modules/academy/academy-core', async (original) => {
  const query = async (sql: string, values: unknown[] = []) => {
    const result = await fixture.pool.query(sql, values);
    return result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value,
    ])));
  };
  return {
    ...await original<typeof import('../server/modules/academy/academy-core')>(),
    query, queryOne: async (sql: string, values: unknown[] = []) => (await query(sql, values))[0],
  };
});
import { registerGroupManagementRoutes } from '../server/modules/academy/group-management.router';
import { assertTeacherCanLeadGroupSchedule } from '../server/modules/academy/academy-scheduling';
import { prepareGroupMutation } from '../server/modules/academy/academy-route-support';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `group_teachers_${randomBytes(6).toString('hex')}`;
let admin: Pool;
const schedule = [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00', schoolId: 1 }];
const scheduleOptions = { courseId: 1, schoolId: 1, schedule, startDate: new Date('2030-07-15'), endDate: new Date('2030-07-22') };

describe.skipIf(!databaseUrl)('group teachers use active employee module assignments in PostgreSQL', () => {
  beforeAll(async () => {
    if (!databaseUrl || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
      throw new Error('Local isolated PostgreSQL required');
    }
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC` });
    await fixture.pool.query(`
      CREATE TABLE users(id integer PRIMARY KEY,full_name text,module text,is_active boolean,is_archived boolean);
      CREATE TABLE user_modules(user_id integer,module text);
      CREATE TABLE academy_teachers(id integer PRIMARY KEY,user_id integer,full_name text,status text,course_ids jsonb,school_ids jsonb,availability jsonb,schedule jsonb);
      CREATE TABLE academy_schools(id integer PRIMARY KEY,name text,is_active boolean);
      CREATE TABLE academy_rooms(id integer PRIMARY KEY,name text,school_id integer,is_active boolean);
      CREATE TABLE academy_courses(id integer PRIMARY KEY,name text,is_active boolean,lesson_count integer,lesson_duration_minutes integer,duration_days integer,frequency text);
      CREATE TABLE academy_groups(id integer PRIMARY KEY,name text,course_id integer,teacher_id integer,school_id integer,room_id integer,archived_by integer,status text,is_archived boolean,schedule jsonb,start_date timestamp,end_date timestamp,created_at timestamp DEFAULT now());
      CREATE TABLE academy_students(id integer PRIMARY KEY,lead_id integer,status text);
      CREATE TABLE academy_student_group_enrollments(student_id integer,group_id integer,status text);
      CREATE TABLE academy_leads(id integer PRIMARY KEY,is_archived boolean);
      CREATE TABLE academy_lead_group_reservations(group_id integer,lead_id integer);
      CREATE TABLE academy_lessons(id integer PRIMARY KEY,group_id integer,teacher_id integer,room_id integer,status text,scheduled_at timestamp,duration_minutes integer);
      CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY,teacher_id integer,room_id integer,status text,scheduled_at timestamp,duration_minutes integer);
    `);
  });
  beforeEach(async () => {
    await fixture.pool.query(`
      TRUNCATE users,user_modules,academy_teachers,academy_groups;
      INSERT INTO users VALUES
        (1,'Archived teacher','teacher',true,true),(2,'Sales only','sales',true,false),
        (3,'Disabled account','teacher',false,false),(5,'Primary teacher','teacher',true,false),
        (6,'Additional teacher','sales',true,false),(7,'Dismissed profile','teacher',true,false);
      INSERT INTO user_modules VALUES(6,'teacher');
      INSERT INTO academy_teachers(id,user_id,full_name,status,course_ids,school_ids,availability,schedule) VALUES
        (1,1,'Archived teacher','active','[1]','[1]','[]','[]'),
        (2,2,'Sales only','active','[1]','[1]','[]','[]'),
        (3,3,'Disabled account','active','[1]','[1]','[]','[]'),
        (4,null,'Unlinked legacy profile','active','[1]','[1]','[]','[]'),
        (5,5,'Primary teacher','active','[1]','[1]','[]','[]'),
        (6,6,'Additional teacher','active','[1]','[1]','[]','[]'),
        (7,7,'Dismissed profile','dismissed','[1]','[1]','[]','[]');
      UPDATE academy_teachers SET availability='[{"dayOfWeek":1,"startTime":"08:00","endTime":"18:00","schoolId":1}]';
      INSERT INTO academy_schools VALUES(1,'Cyberpark',true) ON CONFLICT DO NOTHING;
      INSERT INTO academy_rooms VALUES(1,'101',1,true) ON CONFLICT DO NOTHING;
      INSERT INTO academy_courses VALUES(1,'AI Kids',true,2,60,8,null) ON CONFLICT DO NOTHING;
      INSERT INTO academy_groups(id,name,course_id,teacher_id,school_id,room_id,status,is_archived,schedule)
        VALUES(10,'Historical group',1,1,1,1,'completed',true,'[]');
    `);
  });
  afterAll(async () => {
    await fixture.pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  });

  it('returns only eligible choices while preserving historical group teacher names', async () => {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 99, module: 'sales', modules: ['sales'] } as typeof req.user; next(); });
    const router = express.Router(); registerGroupManagementRoutes(router); app.use('/api/academy', router);
    const result = await request(app).get('/api/academy/group-configuration');
    expect(result.status).toBe(200);
    expect(result.body.teachers.map((teacher: { id: number }) => teacher.id)).toEqual([6, 5]);
    expect(result.body.groups[0]).toMatchObject({ teacherId: 1, teacherName: 'Archived teacher', name: 'Historical group' });
  });

  it('requires an explicit teacher even when eligible employees are available', async () => {
    await expect(prepareGroupMutation({ values: { ...scheduleOptions, roomId: 1, teacherId: null } })).rejects.toMatchObject({ message: 'teacherRequired', statusCode: 400 });
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions, teacherId: 5 })).resolves.toMatchObject({ id: 5 });
    await fixture.pool.query("UPDATE users SET module='sales' WHERE id=5; DELETE FROM user_modules WHERE user_id=6");
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions, teacherId: 5 })).rejects.toMatchObject({ message: 'teacherNotActive' });
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions, teacherId: 6 })).rejects.toMatchObject({ message: 'teacherNotActive' });
  });

  it.each([1, 2, 3, 4, 7])('rejects a new explicit ineligible teacher %s', async (teacherId) => {
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions, teacherId })).rejects.toMatchObject({ message: 'teacherNotActive' });
  });

  it('accepts additional Teacher module access and preserves a locked unchanged historical assignment', async () => {
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions, teacherId: 6 })).resolves.toMatchObject({ id: 6 });
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions, teacherId: 1, existingTeacherId: 1, excludeGroupId: 10 })).resolves.toMatchObject({ id: 1 });
  });

  it('rejects new ineligible assignment on completed groups while keeping the historical ID unchanged', async () => {
    const values = { ...scheduleOptions, roomId: 1, teacherId: 1, status: 'completed', maxStudents: 12, lessonCount: 2 };
    await expect(prepareGroupMutation({ values: { ...values } })).rejects.toMatchObject({ message: 'teacherNotActive' });
    const retained = { ...values };
    await expect(prepareGroupMutation({ values: retained, oldRow: { id: 10, ...values }, excludeGroupId: 10 })).resolves.toBeUndefined();
    expect(retained.teacherId).toBe(1);
  });
});
