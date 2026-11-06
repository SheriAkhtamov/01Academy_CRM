import { randomBytes } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  pool: null as unknown as Pool,
  context: null as unknown as import('node:async_hooks').AsyncLocalStorage<PoolClient>,
}));
vi.mock('../server/modules/academy/academy-core', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  fixture.context = new AsyncLocalStorage<PoolClient>();
  const query = async (sql: string, params: unknown[] = []) => {
    const result = await (fixture.context.getStore() ?? fixture.pool).query(sql, params);
    return result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value])));
  };
  return { ACADEMY_TIME_ZONE: 'Asia/Tashkent', ACADEMY_SCHEDULING_ADVISORY_LOCK: 7315001,
    transactionContext: fixture.context, query,
    queryOne: async (sql: string, params: unknown[] = []) => (await query(sql, params))[0] };
});
import { allocateGroupName, getGroupCodeCatalogue } from '../server/modules/academy/group-code';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
let admin: Pool;
async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await fixture.pool.connect();
  await client.query('BEGIN');
  try {
    const result = await fixture.context.run(client, () => work(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}
const create = (input: Record<string, unknown> = {}, values: Record<string, unknown> = {}) => transaction(async (client) => {
  const row: Record<string, unknown> = { name: null as string | null, courseId: 1, schoolId: 1, maxStudents: 12, ...values };
  await allocateGroupName(row, { nameSuffix: 'Morning', deliveryMode: 'offline', trainingType: 'GRP', ...input });
  await client.query('INSERT INTO academy_groups(name, course_id, school_id) VALUES($1,$2,$3)', [row.name, row.courseId, row.schoolId ?? null]);
  return row.name as string;
});
const numberOf = (name: string) => Number(name.match(/-(\d{4,})(?: |$)/)![1]);

describe.skipIf(!databaseUrl)('automatic group codes against PostgreSQL', () => {
  const schema = `group_codes_${randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    if (!databaseUrl || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
      throw new Error('Local isolated PostgreSQL required');
    }
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    fixture.pool = new Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema},public` });
    await fixture.pool.query(`CREATE TABLE academy_groups(id serial PRIMARY KEY, name text NOT NULL, course_id int NOT NULL, school_id int);
      CREATE TABLE academy_schools(id int PRIMARY KEY, short_code varchar(10) UNIQUE);
      CREATE TABLE academy_courses(id int PRIMARY KEY, short_code varchar(10) UNIQUE);
      CREATE TABLE audit_logs(id serial PRIMARY KEY, action text, entity_type text, new_values jsonb);
      CREATE SEQUENCE academy_group_code_seq AS integer MINVALUE 1;`);
  });
  beforeEach(async () => {
    await fixture.pool.query(`TRUNCATE academy_groups, academy_schools, academy_courses, audit_logs RESTART IDENTITY;
      INSERT INTO academy_schools VALUES(1,'CYP'),(2,'FWD'),(3,NULL);
      INSERT INTO academy_courses VALUES(1,'AI'),(2,'VC'),(3,NULL);
      INSERT INTO academy_groups(name,course_id,school_id) VALUES
        ('CYP-AI-GRP-25-0040 — Earlier',1,1),('FWD-VC-GRP-26-0041',2,2),('ONL-AI-IND-26-0042',1,NULL);
      SELECT setval('academy_group_code_seq', 42, true);`);
  });
  afterAll(async () => {
    await fixture.pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });

  it('takes branch and course codes from their records and previews the next number without taking it', async () => {
    const catalogue = await getGroupCodeCatalogue(new Date('2026-12-31T20:30:00Z'));
    expect(catalogue).toEqual({ schoolCodes: { 1: 'CYP', 2: 'FWD' }, courseCodes: { 1: 'AI', 2: 'VC' }, nextNumber: 43, year: '27' });
    expect((await getGroupCodeCatalogue()).nextNumber).toBe(43);
    expect(await create()).toMatch(/^CYP-AI-GRP-\d{2}-0043 — Morning$/);
    expect((await getGroupCodeCatalogue()).nextNumber).toBe(44);
  });

  it('names online groups ONL without a branch code', async () => {
    expect(await create({ deliveryMode: 'online', nameSuffix: '' }, { schoolId: null, courseId: 2 })).toMatch(/^ONL-VC-GRP-\d{2}-0043$/);
    expect(await create({ deliveryMode: 'online', trainingType: 'IND' }, { schoolId: 3, maxStudents: 1 })).toMatch(/^ONL-AI-IND-\d{2}-0044 — Morning$/);
  });

  it('never hands out a number twice, even after a deletion or a failed creation', async () => {
    expect(numberOf(await create())).toBe(43);
    await fixture.pool.query("DELETE FROM academy_groups WHERE name LIKE '%-0043%'");
    expect(numberOf(await create())).toBe(44);
    await expect(transaction(async () => {
      await allocateGroupName({ courseId: 1, schoolId: 1, maxStudents: 12 }, { deliveryMode: 'offline' });
      throw new Error('Failed to materialize lessons');
    })).rejects.toThrow('Failed to materialize lessons');
    expect(numberOf(await create())).toBe(46);
    expect((await fixture.pool.query('SELECT * FROM audit_logs')).rowCount).toBe(0);
  });

  it('continues after a higher number typed into a group name', async () => {
    await fixture.pool.query("INSERT INTO academy_groups(name,course_id,school_id) VALUES ('FWD-VC-GRP-26-0100 — Imported',2,2)");
    expect((await getGroupCodeCatalogue()).nextNumber).toBe(101);
    expect(numberOf(await create())).toBe(101);
    expect(numberOf(await create())).toBe(102);
  });

  it('serializes simultaneous group creation into one global sequence', async () => {
    const names = await Promise.all(Array.from({ length: 12 }, (_, index) => create({ deliveryMode: index % 2 ? 'online' : 'offline' })));
    expect(new Set(names).size).toBe(12);
    expect(names.map(numberOf).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, index) => index + 43));
    expect(names.filter((name) => name.startsWith('ONL-'))).toHaveLength(6);
  });

  it('rejects missing codes and individual capacity before taking a number', async () => {
    await expect(transaction(() => allocateGroupName({ courseId: 3, schoolId: 1, maxStudents: 12 }, {}))).rejects.toMatchObject({ message: 'groupCodeCourseMissing' });
    await expect(transaction(() => allocateGroupName({ courseId: 1, schoolId: 3, maxStudents: 12 }, {}))).rejects.toMatchObject({ message: 'groupCodeBranchMissing' });
    await expect(transaction(() => allocateGroupName({ courseId: 1, schoolId: 1, maxStudents: 2 }, { trainingType: 'IND' }))).rejects.toMatchObject({ message: 'groupIndividualCapacity' });
    expect((await getGroupCodeCatalogue()).nextNumber).toBe(43);
  });
});
