import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rows, one } from '../server/modules/lms/infrastructure/postgres-base';

const fixture = vi.hoisted(() => ({ pool: null as unknown as Pool }));
vi.mock('../server/modules/academy/academy-core', () => ({
  query: (sql: string, params: unknown[] = []) => rows(fixture.pool, sql, params),
  queryOne: (sql: string, params: unknown[] = []) => one(fixture.pool, sql, params),
  SALES_MODULES: new Set(['sales', 'administration']), ensureModuleAccess: () => true,
  ensureLeadRowAccess: () => true, ensureLeadMutationAccess: () => true, parseId: Number,
}));
vi.mock('../server/modules/academy/academy-leads', () => ({ getLead: vi.fn() }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn() } }));
import { loadAuthorizedStudent } from '../server/modules/academy/student-profile-data';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `student_profile_access_${randomBytes(6).toString('hex')}`;
let admin: Pool;
const authorize = async () => {
  const req = { query: { context: 'teacher' }, params: { id: '1' }, user: { id: 7, modules: ['teacher'], module: 'teacher' } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  return { result: await loadAuthorizedStudent(req as never, res as never), res };
};

describe.skipIf(!databaseUrl)('Teacher profile and project access follows current assignment and activity', () => {
  beforeAll(async () => {
    if (!databaseUrl || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname))
      throw new Error('Local isolated PostgreSQL required');
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await fixture.pool.query(`CREATE TABLE users(id int PRIMARY KEY,full_name text);
      CREATE TABLE academy_teachers(id int PRIMARY KEY,user_id int,status text);
      CREATE TABLE academy_groups(id int PRIMARY KEY,teacher_id int);
      CREATE TABLE academy_student_group_enrollments(student_id int,group_id int,status text);
      CREATE TABLE academy_students(id int PRIMARY KEY,student_name text,contact_name text,manager_id int,lead_id int);
      INSERT INTO users VALUES(7,'Teacher'); INSERT INTO academy_teachers VALUES(11,7,'active');
      INSERT INTO academy_groups VALUES(1,11); INSERT INTO academy_student_group_enrollments VALUES(1,1,'active');
      INSERT INTO academy_students VALUES(1,'Student','Parent',NULL,NULL);`);
  });
  beforeEach(async () => {
    await fixture.pool.query("UPDATE academy_teachers SET status='active'; UPDATE academy_groups SET teacher_id=11; UPDATE academy_student_group_enrollments SET status='active'");
  });
  afterAll(async () => {
    if (fixture.pool) await fixture.pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  it('allows an active assigned teacher', async () => {
    const {result,res} = await authorize();
    expect(result).toMatchObject({teacherId:11,student:{id:1}});
    expect(res.status).not.toHaveBeenCalled();
  });
  it.each([
    ["inactive teacher", "UPDATE academy_teachers SET status='inactive'"],
    ["unrelated teacher", 'UPDATE academy_groups SET teacher_id=12'],
    ["withdrawn enrollment", "UPDATE academy_student_group_enrollments SET status='withdrawn'"],
  ])('denies an %s before returning private student data', async (_name, sql) => {
    await fixture.pool.query(sql);
    const {result,res} = await authorize();
    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
