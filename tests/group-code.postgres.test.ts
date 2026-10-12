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
import { allocateGroupName, getGroupCodeCatalogue, rememberDeletedGroupCode } from '../server/modules/academy/group-code';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `group_codes_${randomBytes(6).toString('hex')}`;
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
const create = (input: Record<string, unknown> = {}) => transaction(async (client) => {
  const values = { name: null as string | null, courseId: 1, schoolId: 1, maxStudents: 12 };
  await allocateGroupName(values, { nameSuffix: 'Morning', deliveryMode: 'offline', trainingType: 'GRP', ...input });
  await client.query('INSERT INTO academy_groups(name, course_id, school_id) VALUES($1,$2,$3)', [values.name, 1, 1]);
  return values.name;
});

describe.skipIf(!databaseUrl)('automatic group codes against PostgreSQL', () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    fixture.pool = new Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema},public` });
    await fixture.pool.query(`CREATE TABLE academy_groups(id serial PRIMARY KEY, name text NOT NULL, course_id int NOT NULL, school_id int NOT NULL, is_archived boolean DEFAULT false);
      CREATE TABLE academy_schools(id int PRIMARY KEY, code text NOT NULL);
      CREATE TABLE academy_courses(id int PRIMARY KEY, slug text NOT NULL);
      CREATE TABLE system_settings(key text PRIMARY KEY, value text, updated_at timestamp);
      CREATE TABLE audit_logs(entity_type text, old_values jsonb, new_values jsonb);`);
  });
  beforeEach(async () => {
    await fixture.pool.query(`TRUNCATE academy_groups, academy_schools, academy_courses, system_settings, audit_logs RESTART IDENTITY;
      INSERT INTO academy_schools VALUES(1,'cyberpark'),(2,'school-forward'),(3,'unapproved');
      INSERT INTO academy_courses VALUES(1,'ai-kids'),(2,'vibe-coding'),(3,'unapproved');
      INSERT INTO academy_groups(name,course_id,school_id,is_archived) VALUES
        ('CYP-AI-GRP-25-0040 — Earlier',1,1,true),('FWD-VC-GRP-26-0041',2,2,false),('ONL-AI-IND-26-0042',1,1,false);`);
  });
  afterAll(async () => {
    await fixture.pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });
  it('includes archived groups and preserves approved codes across branches, types and years', async () => {
    const catalogue = await getGroupCodeCatalogue(new Date('2026-12-31T20:30:00Z'));
    expect(catalogue).toEqual({ schoolCodes: { 1: 'CYP', 2: 'FWD' }, courseCodes: { 1: 'AI', 2: 'VC' }, nextNumber: 43, year: '27' });
    expect(await create()).toMatch(/^CYP-AI-GRP-\d{2}-0043 — Morning$/);
  });
  it('accounts for deleted group codes saved as both array and object audit records', async () => {
    await fixture.pool.query(`INSERT INTO audit_logs VALUES
      ('academy_group', '[{"name":"FWD-VC-GRP-25-0088"},{"name":"CYP-VC-GRP-23-0099"}]', null),
      ('academy_groups', null, '{"name":"ONL-AI-IND-24-0090"}');`);
    expect(await create()).toMatch(/-0100 — Morning$/);
  });
  it('keeps the high-water mark after the newest group is permanently deleted', async () => {
    expect(await create()).toMatch(/-0043 — Morning$/);
    await fixture.pool.query('DELETE FROM academy_groups WHERE name LIKE $1', ['%0043%']);
    expect(await create()).toMatch(/-0044 — Morning$/);
  });
  it('retains the last old code and its branch catalogue before any automatic group exists', async () => {
    await transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [7315001]);
      await rememberDeletedGroupCode({ name: 'FWD-VC-GRP-26-0041' });
      await client.query('DELETE FROM academy_groups');
    });
    const catalogue = await getGroupCodeCatalogue();
    expect(catalogue.nextNumber).toBe(43);
    expect(catalogue.schoolCodes[2]).toBe('FWD');
    expect(catalogue.courseCodes[2]).toBe('VC');
    expect(await create()).toMatch(/-0043 — Morning$/);
  });
  it('serializes simultaneous group creation into one global sequence', async () => {
    const names = await Promise.all(Array.from({ length: 12 }, (_, index) => create({ deliveryMode: index % 2 ? 'online' : 'offline' })));
    expect(new Set(names).size).toBe(12);
    expect(names.map((name) => Number(name!.match(/-(\d{4}) /)![1])).sort((a,b) => a-b)).toEqual(Array.from({ length: 12 }, (_, index) => index + 43));
    expect(names.filter((name) => name!.startsWith('ONL-'))).toHaveLength(6);
  });
  it('rolls back the counter when group creation fails', async () => {
    await expect(transaction(async () => {
      await allocateGroupName({ courseId: 1, schoolId: 1, maxStudents: 1 }, { deliveryMode: 'online', trainingType: 'IND', nameSuffix: '' });
      throw new Error('Failed to materialize lessons');
    })).rejects.toThrow('Failed to materialize lessons');
    expect(await create()).toMatch(/-0043 — Morning$/);
  });
  it('rejects unapproved codes and individual capacity before reserving a number', async () => {
    await expect(transaction(() => allocateGroupName({ courseId: 3, schoolId: 1, maxStudents: 12 }, {}))).rejects.toMatchObject({ message: 'groupCodeCourseMissing' });
    await expect(transaction(() => allocateGroupName({ courseId: 1, schoolId: 3, maxStudents: 12 }, {}))).rejects.toMatchObject({ message: 'groupCodeBranchMissing' });
    await expect(transaction(() => allocateGroupName({ courseId: 1, schoolId: 1, maxStudents: 2 }, { trainingType: 'IND' }))).rejects.toMatchObject({ message: 'groupIndividualCapacity' });
    expect((await fixture.pool.query('SELECT * FROM system_settings')).rowCount).toBe(0);
  });
});
