import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pool: null as unknown as Pool, transaction: null as unknown as AsyncLocalStorage<PoolClient>, audit: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => {
  const query = async (sql: string, values: unknown[] = []) => {
    const result = await (mocks.transaction.getStore() ?? mocks.pool).query(sql, values);
    return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value,
    ])));
  };
  return { query, queryOne: async (sql: string, values: unknown[]) => (await query(sql, values))[0] ?? null,
    createAudit: mocks.audit, withTransaction: async (work: () => Promise<unknown>) => {
      const client = await mocks.pool.connect();
      try { await client.query('BEGIN'); const result = await mocks.transaction.run(client, work); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    } };
});
import { LessonStaffService } from '../server/modules/academy/lesson-staff';
import { actorContextFrom } from '../server/modules/leads/domain/actor-context';
const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `lesson_staff_${randomUUID().replace(/-/g, '')}`;
const main = actorContextFrom({ id: 7, modules: ['teacher'] });
const other = actorContextFrom({ id: 8, modules: ['teacher'] });
const adminActor = actorContextFrom({ id: 9, modules: ['administration'] });
const service = new LessonStaffService();

describe.skipIf(!databaseUrl)('lesson staff persistence and access', () => {
  let admin: Pool;
  beforeAll(async () => {
    if (!databaseUrl || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Local isolated PostgreSQL required');
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    mocks.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    mocks.transaction = new AsyncLocalStorage();
    await mocks.pool.query(`CREATE TABLE users(id integer PRIMARY KEY);
      CREATE TABLE academy_teachers(id integer PRIMARY KEY,user_id integer REFERENCES users(id),full_name text,status text DEFAULT 'active');
      CREATE TABLE academy_lessons(id integer PRIMARY KEY,teacher_id integer REFERENCES academy_teachers(id) ON DELETE SET NULL,status text DEFAULT 'scheduled');
      INSERT INTO users VALUES(7),(8),(9),(10),(11),(12);
      INSERT INTO academy_teachers VALUES(4,7,'Main teacher','active'),(5,10,'First assistant','active'),
        (6,11,'Inactive teacher','inactive'),(7,8,'Other teacher','active'),(8,12,'Second assistant','active');
      INSERT INTO academy_lessons(id,teacher_id) VALUES(17,4),(18,7);`);
    await mocks.pool.query(await readFile('migrations/0160_lesson_assistants.sql', 'utf8'));
  });
  beforeEach(async () => {
    mocks.audit.mockClear();
    await mocks.pool.query("TRUNCATE academy_lesson_assistants; UPDATE academy_lessons SET teacher_id=CASE id WHEN 17 THEN 4 ELSE 7 END,status='scheduled';");
  });
  afterAll(async () => {
    if (mocks.pool) await mocks.pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  it('shows the primary teacher and offers only active alternatives', async () => {
    expect(await service.get(main, 17)).toEqual({
      teacher: { id: 4, fullName: 'Main teacher' }, assistants: [],
      teachers: [{ id: 5, fullName: 'First assistant' }, { id: 7, fullName: 'Other teacher' }, { id: 8, fullName: 'Second assistant' }],
    });
  });
  it('persists repeated concurrent assignments once and keeps other assignments when removing one', async () => {
    await Promise.all(Array.from({ length: 6 }, () => service.add(main, 17, 5)));
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    await service.add(main, 17, 8);
    expect((await new LessonStaffService().get(main, 17)).assistants).toHaveLength(2);
    expect((await service.remove(main, 17, 5)).assistants).toEqual([{ id: 8, fullName: 'Second assistant' }]);
    await service.remove(main, 17, 5);
    expect(mocks.audit).toHaveBeenCalledTimes(3);
  });
  it('rejects another teacher and unrelated modules for reading and changing the lesson', async () => {
    for (const actor of [other, actorContextFrom({ id: 8, modules: ['teacher', 'sales'] }), actorContextFrom({ id: 10, modules: ['marketing'] })]) {
      await expect(service.get(actor, 17)).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.add(actor, 17, 5)).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.remove(actor, 17, 5)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect((await service.add(adminActor, 17, 5)).assistants).toHaveLength(1);
  });
  it('rejects primary, inactive and missing teachers and changes to cancelled lessons', async () => {
    await expect(service.add(main, 17, 4)).rejects.toMatchObject({ code: 'lessonAssistantIsTeacher' });
    for (const id of [6, 999]) await expect(service.add(main, 17, id)).rejects.toMatchObject({ code: 'lessonAssistantUnavailable' });
    await mocks.pool.query("UPDATE academy_lessons SET status='cancelled' WHERE id=17");
    await expect(service.add(main, 17, 5)).rejects.toMatchObject({ code: 'lessonStaffReadOnly' });
    expect((await service.get(main, 17)).teacher?.id).toBe(4);
  });
  it('enforces the unique role in the database when promoting an assistant to primary teacher', async () => {
    await expect(mocks.pool.query('INSERT INTO academy_lesson_assistants(lesson_id,teacher_id) VALUES(17,4)')).rejects.toMatchObject({ code: '23514' });
    await service.add(main, 17, 5);
    await mocks.pool.query('UPDATE academy_lessons SET teacher_id=5 WHERE id=17');
    const staff = await service.get(adminActor, 17);
    expect(staff.teacher?.id).toBe(5);
    expect(staff.assistants).toEqual([]);
    await expect(service.get(main, 17)).rejects.toMatchObject({ statusCode: 403 });
  });
});
