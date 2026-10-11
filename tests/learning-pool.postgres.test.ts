import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareLearningReads } from '../server/infrastructure/learning-pool';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const enabled = Boolean(url);
describe.skipIf(!enabled)('Prepared learning plans against PostgreSQL', () => {
  const schema = `learning_plan_${randomUUID().replace(/-/g, '')}`;
  let pool: Pool;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(target.hostname) || !/test/.test(target.pathname)) throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
    pool = prepareLearningReads(new Pool({ connectionString: url, max: 1 }));
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE ${schema}.links(id integer PRIMARY KEY, student_id integer NOT NULL, active boolean NOT NULL)`);
    await pool.query(`INSERT INTO ${schema}.links VALUES(1,101,true),(2,202,true)`);
  });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); } });
  it('rechecks current revocation and exact subject while sharing one prepared plan', async () => {
    const sql = `SELECT student_id FROM ${schema}.links WHERE id=$1 AND active /* ${'actor scoped authorization '.repeat(15)} */`;
    expect((await pool.query(sql, [1])).rows).toEqual([{ student_id: 101 }]);
    expect((await pool.query(sql, [2])).rows).toEqual([{ student_id: 202 }]);
    await pool.query(`UPDATE ${schema}.links SET active=false WHERE id=1`);
    expect((await pool.query(sql, [1])).rows).toEqual([]);
    expect((await pool.query(sql, [2])).rows).toEqual([{ student_id: 202 }]);
    const plans = await pool.query('SELECT name,statement FROM pg_prepared_statements WHERE statement=$1', [sql]);
    expect(plans.rows).toHaveLength(1); expect(plans.rows[0].name).toMatch(/^academy_lms_/);
    expect(Buffer.byteLength(plans.rows[0].name,'utf8')).toBeLessThanOrEqual(63);
  });
});
