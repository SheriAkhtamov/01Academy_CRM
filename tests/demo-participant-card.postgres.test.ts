import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { one } from '../server/modules/lms/infrastructure/postgres-base';

const fixture = vi.hoisted(() => ({ pool: null as unknown as Pool }));
vi.mock('../server/modules/academy/academy-core', () => ({
  queryOne: (sql: string, args: unknown[]) => one(fixture.pool, sql, args),
}));
import { getDemoParticipantCard } from '../server/modules/academy/demo-participant-card';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `demo_card_${randomUUID().replace(/-/g, '')}`;
describe.skipIf(!url)('demo participant card relationship', () => {
  let admin: Pool;
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) throw new Error('Local isolated PostgreSQL required');
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await fixture.pool.query(`
      CREATE TABLE users(id int PRIMARY KEY,full_name text);
      CREATE TABLE academy_courses(id int PRIMARY KEY,name text);
      CREATE TABLE academy_schools(id int PRIMARY KEY,name text);
      CREATE TABLE academy_groups(id int PRIMARY KEY,name text);
      CREATE TABLE academy_lead_sources(id int PRIMARY KEY,name text);
      CREATE TABLE academy_lead_statuses(code text PRIMARY KEY,name text);
      CREATE TABLE academy_leads(id int PRIMARY KEY,contact_name text,phone text,manager_id int,status_code text,source_id int,course_id int,student_name text,goal text,urgency text,comment text);
      CREATE TABLE academy_students(id int PRIMARY KEY,lead_id int,student_name text,student_age int,contact_name text,phone text,manager_id int,course_id int,school_id int,group_id int);
      CREATE TABLE academy_demo_lessons(id int PRIMARY KEY);
      CREATE TABLE academy_demo_lesson_participants(id int PRIMARY KEY,demo_lesson_id int,student_id int);
      INSERT INTO users VALUES(18,'Другой менеджер');
      INSERT INTO academy_courses VALUES(1,'AI Kids'); INSERT INTO academy_schools VALUES(1,'Cyberpark');
      INSERT INTO academy_groups VALUES(1,'Group'); INSERT INTO academy_lead_sources VALUES(1,'Сайт');
      INSERT INTO academy_lead_statuses VALUES('demo_invited','Демо запланировано');
      INSERT INTO academy_leads VALUES(42,'Другой родитель','+998901234567',18,'demo_invited',1,1,'Fallback name','Учёба',NULL,'Комментарий');
      INSERT INTO academy_students VALUES(156,42,'Другой ученик',12,'Другой родитель',NULL,18,1,1,1),(157,NULL,'Без лида',10,'Родитель',NULL,18,1,1,NULL);
      INSERT INTO academy_demo_lessons VALUES(23),(24);
      INSERT INTO academy_demo_lesson_participants VALUES(78,23,156),(79,24,157);
    `);
  });
  afterAll(async () => {
    if (fixture.pool) await fixture.pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  it('returns names and contact data for the related foreign participant', async () => {
    expect(await getDemoParticipantCard(23, 78)).toMatchObject({ demoLessonId: 23, participantId: 78,
      lead: { id: 42, contactName: 'Другой родитель', managerName: 'Другой менеджер', phone: '+998901234567' },
      student: { id: 156, studentName: 'Другой ученик', courseName: 'AI Kids' } });
  });
  it('cannot use a participant from another demo, a student ID, or an unrelated demo ID', async () => {
    expect(await getDemoParticipantCard(24, 78)).toBeNull();
    expect(await getDemoParticipantCard(23, 156)).toBeNull();
    expect(await getDemoParticipantCard(999, 78)).toBeNull();
  });
  it('also opens a demo student without a linked lead', async () => {
    expect(await getDemoParticipantCard(24, 79)).toMatchObject({ lead: null, student: { id: 157, studentName: 'Без лида' } });
  });
});
