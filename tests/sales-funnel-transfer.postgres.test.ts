import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool, audit: vi.fn(async () => {}) }));
vi.mock('../server/db', () => ({ pool: {
  query: (...args: Parameters<Pool['query']>) => fixture.pool.query(...args),
  connect: () => fixture.pool.connect(),
} }));
vi.mock('../server/storage', () => ({ storage: { createAuditLog: fixture.audit } }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { registerAcademyFunnelRoutes } from '../server/modules/academy/funnels.router';
import { createSalesKpiRouter } from '../server/modules/sales-kpi/http/kpi-router';
import { actorContextFrom } from '../server/modules/leads/domain/actor-context';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `funnel_transfer_${randomBytes(6).toString('hex')}`;
let admin: Pool;
let app: express.Express;
const path = '/api/academy/sales-kpi/leads/10/handoff';
const migration = readFileSync(new URL('../migrations/0128_generic_funnel_stages_and_qualification.sql', import.meta.url), 'utf8');
const migrationBlock = (prefix: string) => {
  const block = migration.split('--> statement-breakpoint').find(value => value.trimStart().startsWith(prefix));
  if (!block) throw new Error(`Missing current workflow migration block: ${prefix}`);
  return block;
};

describe.skipIf(!databaseUrl)('manual sales funnel transfer with PostgreSQL ownership guards', () => {
  beforeAll(async () => {
    if (!databaseUrl || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
      throw new Error('Isolated local PostgreSQL required');
    }
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC`, application_name: schema });
    await fixture.pool.query(`
      CREATE TABLE users(id integer PRIMARY KEY,full_name text,module text,is_active boolean DEFAULT true,is_archived boolean DEFAULT false);
      CREATE TABLE user_modules(user_id integer,module text);
      CREATE TABLE academy_sales_funnels(id integer PRIMARY KEY,name text,is_active boolean DEFAULT true,is_default boolean DEFAULT false,initial_stage_code text,workflow_role text,created_at timestamp DEFAULT now());
      CREATE TABLE academy_lead_statuses(id serial PRIMARY KEY,code text UNIQUE,name text,funnel_id integer,is_active boolean DEFAULT true,is_pipeline boolean DEFAULT true,sort_order integer DEFAULT 0);
      CREATE TABLE academy_sales_funnel_users(user_id integer REFERENCES users(id),funnel_id integer REFERENCES academy_sales_funnels(id),PRIMARY KEY(user_id,funnel_id));
      CREATE TABLE academy_integration_funnel_settings(provider text,funnel_id integer);
      CREATE TABLE academy_leads(id integer PRIMARY KEY,manager_id integer REFERENCES users(id),funnel_id integer REFERENCES academy_sales_funnels(id),status_code text,is_archived boolean DEFAULT false,first_viewed_at timestamp,first_viewed_by integer,updated_at timestamp DEFAULT now());
      CREATE TABLE academy_students(id integer PRIMARY KEY,lead_id integer,manager_id integer,updated_at timestamp);
      CREATE TABLE academy_tasks(id integer PRIMARY KEY,title text,entity_type text,entity_id integer,responsible_id integer,status text DEFAULT 'new',updated_at timestamp);
      CREATE TABLE board_tasks(id integer PRIMARY KEY,lead_id integer,assignee_id integer,status text DEFAULT 'new',updated_at timestamp);
      CREATE TABLE notifications(id integer PRIMARY KEY,user_id integer,related_entity_type text,related_entity_id integer,is_read boolean DEFAULT false);
      CREATE TABLE academy_lead_assignment_history(id serial PRIMARY KEY,lead_id integer,from_manager_id integer,to_manager_id integer,changed_by integer,comment text);
      CREATE TABLE academy_lead_stage_history(id serial PRIMARY KEY,lead_id integer,from_status_code text,to_status_code text,changed_by integer,comment text,from_funnel_id integer,to_funnel_id integer,from_status_name text,to_status_name text);
      CREATE TABLE academy_company_settings(id integer PRIMARY KEY,auto_lead_distribution_enabled boolean DEFAULT false,auto_lead_distribution_cursor bigint DEFAULT 0,updated_at timestamp);
      CREATE TABLE academy_sales_kpi_leads(lead_id integer PRIMARY KEY,hunter_id integer,closer_id integer,offer_at timestamp);
    `);
    for (const prefix of [
      'CREATE OR REPLACE FUNCTION protect_scoped_sales_stage',
      'CREATE OR REPLACE FUNCTION academy_auto_distribute_lead',
      'CREATE OR REPLACE FUNCTION academy_next_auto_lead_manager',
      'CREATE FUNCTION academy_snapshot_lead_stage_history',
    ]) await fixture.pool.query(migrationBlock(prefix));
    await fixture.pool.query(readFileSync(new URL('../migrations/0157_manual_sales_stage_movements.sql', import.meta.url), 'utf8'));
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const value = req.get('x-test-user') ?? '7';
      if (value === 'none') { res.status(401).json({ error: 'authenticationRequired' }); return; }
      const module = value === '1' ? 'administration' : value === '9' ? 'teacher' : 'sales';
      req.user = { id: Number(value), module, modules: [module] } as typeof req.user;
      req.actor = { ...actorContextFrom(req.user), salesWorkflow: { assignedFunnelIds: Number(value) === 8 ? [2] : [1] } };
      next();
    });
    const router = express.Router();
    registerAcademyFunnelRoutes(router);
    router.use(createSalesKpiRouter());
    app.use('/api/academy', router);
  });
  beforeEach(async () => {
    fixture.audit.mockClear();
    const tables = (await fixture.pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema])).rows.map(row => `"${schema}"."${row.tablename}"`).join(',');
    await fixture.pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    await fixture.pool.query(`
      INSERT INTO users(id,full_name,module) VALUES(1,'Administrator','administration'),(7,'Owner','sales'),(8,'Destination employee','sales'),(9,'Teacher','teacher');
      INSERT INTO academy_sales_funnels(id,name,is_default,initial_stage_code) VALUES(1,'Main',true,'intake_a'),(2,'Closer',false,'intake_b'),(3,'Inactive',false,'intake_c');
      UPDATE academy_sales_funnels SET is_active=false WHERE id=3;
      INSERT INTO academy_lead_statuses(code,name,funnel_id) VALUES('intake_a','Main intake',1),('intake_b','Closer intake',2),('intake_c','Inactive intake',3);
      INSERT INTO academy_lead_statuses(code,name,funnel_id,sort_order,is_active,is_pipeline) VALUES
        ('negotiation_b','Negotiation',2,10,true,true),('paid_b','Paid',2,20,true,true),('hidden_b','Hidden',2,30,false,true),('lost_b','Lost',2,40,true,false);
      INSERT INTO academy_sales_funnel_users VALUES(7,1),(8,2);
      INSERT INTO academy_company_settings(id) VALUES(1);
      INSERT INTO academy_leads(id,manager_id,funnel_id,status_code,first_viewed_at,first_viewed_by) VALUES(10,7,1,'intake_a',now(),7);
      INSERT INTO academy_sales_kpi_leads(lead_id,hunter_id) VALUES(10,7);
      INSERT INTO academy_students(id,lead_id,manager_id) VALUES(20,10,7),(21,10,7);
      INSERT INTO academy_tasks(id,title,entity_type,entity_id,responsible_id,status) VALUES(30,'Lead task','lead',10,7,'new'),(31,'Student task','student',20,7,'new'),(32,'Completed task','lead',10,7,'done');
      INSERT INTO board_tasks(id,lead_id,assignee_id,status) VALUES(40,10,7,'new'),(41,10,7,'done'),(42,10,7,'accepted');
      INSERT INTO notifications(id,user_id,related_entity_type,related_entity_id) VALUES(50,7,'lead',10),(51,7,'student',20),(52,7,'academy_task',30);
    `);
  });
  afterAll(async () => {
    await fixture.pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  const lead = async () => (await fixture.pool.query('SELECT * FROM academy_leads WHERE id=10')).rows[0];
  const transfer = () => request(app).post(path).send({ targetFunnelId: 2 });
  const waitForDatabaseLock = async (waitEvent: string) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const { rows: [state] } = await admin.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND lower(wait_event)=$2) AS waiting`, [schema, waitEvent]);
      if (state.waiting) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Transfer did not wait for ${waitEvent}`);
  };

  it('lists destinations and available stages outside assigned funnels without granting ordinary lead visibility', async () => {
    const options = await request(app).get('/api/academy/sales-funnels/transfer-options');
    expect(options.status).toBe(200);
    expect(options.body).toEqual([
      { id: 1, name: 'Main', initialStageCode: 'intake_a', stages: [{ code: 'intake_a', name: 'Main intake' }] },
      { id: 2, name: 'Closer', initialStageCode: 'intake_b', stages: [
        { code: 'intake_b', name: 'Closer intake' }, { code: 'negotiation_b', name: 'Negotiation' }, { code: 'paid_b', name: 'Paid' },
      ] },
    ]);
    const regular = await request(app).get('/api/academy/sales-funnels');
    expect(regular.status).toBe(200);
    expect(regular.body.map((funnel: { id: number }) => funnel.id)).toEqual([1]);
  });

  it.each(['none', '9'])('denies transfer destinations and handoff to unauthorized actor %s', async user => {
    expect((await request(app).get('/api/academy/sales-funnels/transfer-options').set('x-test-user', user)).status).toBe(user === 'none' ? 401 : 403);
    expect((await request(app).post(path).set('x-test-user', user).send({ targetFunnelId: 2 })).status).toBe(user === 'none' ? 401 : 403);
    expect((await lead()).funnel_id).toBe(1);
  });

  it('releases an owner outside the destination and synchronizes open work while preserving completed history', async () => {
    const result = await transfer();
    expect(result.status, result.text).toBe(200);
    expect(await lead()).toMatchObject({ funnel_id: 2, status_code: 'intake_b', manager_id: null, first_viewed_at: null, first_viewed_by: null });
    expect((await fixture.pool.query('SELECT manager_id FROM academy_students ORDER BY id')).rows).toEqual([{ manager_id: null }, { manager_id: null }]);
    expect((await fixture.pool.query('SELECT responsible_id FROM academy_tasks ORDER BY id')).rows).toEqual([{ responsible_id: null }, { responsible_id: null }, { responsible_id: 7 }]);
    expect((await fixture.pool.query('SELECT assignee_id FROM board_tasks ORDER BY id')).rows).toEqual([{ assignee_id: null }, { assignee_id: 7 }, { assignee_id: 7 }]);
    expect((await fixture.pool.query('SELECT from_manager_id,to_manager_id,changed_by FROM academy_lead_assignment_history')).rows).toEqual([{ from_manager_id: 7, to_manager_id: null, changed_by: 7 }]);
    expect((await fixture.pool.query('SELECT from_funnel_id,to_funnel_id,from_status_name,to_status_name FROM academy_lead_stage_history')).rows).toEqual([{ from_funnel_id: 1, to_funnel_id: 2, from_status_name: 'Main intake', to_status_name: 'Closer intake' }]);
    expect(fixture.audit).toHaveBeenCalledOnce();
    expect((await request(app).get('/api/academy/sales-kpi/leads/10')).status).toBe(403);
    const destination = await request(app).get('/api/academy/sales-kpi/leads/10').set('x-test-user', '8');
    expect(destination.status).toBe(200);
    expect(destination.body).toMatchObject({ hunter: { id: 7, name: 'Owner' }, closer: null, inCloserQueue: true, canClaim: true });
  });

  it('preserves the owner when explicitly assigned to both funnels', async () => {
    await fixture.pool.query('INSERT INTO academy_sales_funnel_users VALUES(7,2)');
    const result = await transfer();
    expect(result.status, result.text).toBe(200);
    expect(await lead()).toMatchObject({ funnel_id: 2, manager_id: 7 });
    expect((await fixture.pool.query('SELECT COUNT(*)::int AS count FROM academy_lead_assignment_history')).rows[0].count).toBe(0);
    expect((await fixture.pool.query('SELECT manager_id FROM academy_students LIMIT 1')).rows[0].manager_id).toBe(7);
  });

  it('allows any explicit active destination stage without attendance, payment or intake prerequisites', async () => {
    const result = await request(app).post(path).send({ targetFunnelId: 2, targetStageCode: 'paid_b' });
    expect(result.status, result.text).toBe(200);
    expect(await lead()).toMatchObject({ funnel_id: 2, status_code: 'paid_b', manager_id: null });
    expect((await fixture.pool.query('SELECT to_status_code FROM academy_lead_stage_history')).rows[0].to_status_code).toBe('paid_b');
  });

  it.each(['intake_a', 'hidden_b', 'lost_b', 'removed_b'])('rejects unavailable destination stage %s without moving the lead', async targetStageCode => {
    const result = await request(app).post(path).send({ targetFunnelId: 2, targetStageCode });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'salesFunnelStageUnavailable' });
    expect(await lead()).toMatchObject({ funnel_id: 1, status_code: 'intake_a', manager_id: 7 });
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it('keeps a manual default-intake transfer unassigned and available even when incoming distribution is enabled', async () => {
    await fixture.pool.query(`UPDATE academy_sales_funnels SET is_default=false WHERE id=1; UPDATE academy_sales_funnels SET is_default=true WHERE id=2; UPDATE academy_company_settings SET auto_lead_distribution_enabled=true`);
    const result = await transfer();
    expect(result.status, result.text).toBe(200);
    expect(await lead()).toMatchObject({ funnel_id: 2, manager_id: null });
    expect((await fixture.pool.query('SELECT manager_id FROM academy_students ORDER BY id')).rows).toEqual([{ manager_id: null }, { manager_id: null }]);
    expect((await fixture.pool.query('SELECT responsible_id FROM academy_tasks WHERE status<>\'done\' ORDER BY id')).rows).toEqual([{ responsible_id: null }, { responsible_id: null }]);
    expect((await fixture.pool.query('SELECT assignee_id FROM board_tasks WHERE status=\'new\'')).rows[0].assignee_id).toBe(null);
    expect((await fixture.pool.query('SELECT to_manager_id FROM academy_lead_assignment_history')).rows[0].to_manager_id).toBe(null);
    expect((await fixture.pool.query('SELECT auto_lead_distribution_cursor FROM academy_company_settings')).rows[0].auto_lead_distribution_cursor).toBe('0');
    const destination = await request(app).get('/api/academy/sales-kpi/leads/10').set('x-test-user', '8');
    expect(destination.status, destination.text).toBe(200);
    expect(destination.body).toMatchObject({ inCloserQueue: true, canClaim: true });
  });

  it('keeps peer-owned and archived leads unavailable to ordinary employees', async () => {
    expect((await request(app).post(path).set('x-test-user', '8').send({ targetFunnelId: 2 })).status).toBe(403);
    await fixture.pool.query('UPDATE academy_leads SET is_archived=true WHERE id=10');
    expect((await transfer()).status).toBe(403);
    expect((await lead()).funnel_id).toBe(1);
  });

  it('allows an unassigned source-funnel member to transfer without first claiming, while denying another funnel member', async () => {
    await fixture.pool.query('UPDATE academy_leads SET manager_id=NULL WHERE id=10');
    expect((await request(app).post(path).set('x-test-user', '8').send({ targetFunnelId: 2, targetStageCode: 'paid_b' })).status).toBe(403);
    const result = await request(app).post(path).send({ targetFunnelId: 2, targetStageCode: 'paid_b' });
    expect(result.status, result.text).toBe(200);
    expect(await lead()).toMatchObject({ funnel_id: 2, status_code: 'paid_b', manager_id: null });
  });

  it('distributes new incoming inserts while stage moves, restoration and ownership release never invoke distribution', async () => {
    await fixture.pool.query(`UPDATE academy_sales_funnels SET is_default=false WHERE id=1; UPDATE academy_sales_funnels SET is_default=true WHERE id=2; UPDATE academy_company_settings SET auto_lead_distribution_enabled=true`);
    await fixture.pool.query(`INSERT INTO academy_leads(id,funnel_id,status_code) VALUES(11,2,'intake_b'),(12,2,'paid_b')`);
    expect((await fixture.pool.query('SELECT manager_id FROM academy_leads WHERE id=11')).rows[0].manager_id).toBe(8);
    expect((await fixture.pool.query('SELECT manager_id FROM academy_leads WHERE id=12')).rows[0].manager_id).toBe(null);
    await fixture.pool.query(`UPDATE academy_leads SET manager_id=NULL WHERE id=11;
      UPDATE academy_leads SET status_code='intake_b' WHERE id=12;
      UPDATE academy_leads SET is_archived=true WHERE id=12;
      UPDATE academy_leads SET is_archived=false WHERE id=12;`);
    expect((await fixture.pool.query('SELECT manager_id FROM academy_leads WHERE id IN (11,12)')).rows).toEqual([{ manager_id: null }, { manager_id: null }]);
    expect((await fixture.pool.query('SELECT auto_lead_distribution_cursor FROM academy_company_settings')).rows[0].auto_lead_distribution_cursor).toBe('1');
  });

  it('lets administration transfer an unassigned lead without impersonating its owner', async () => {
    await fixture.pool.query('UPDATE academy_leads SET manager_id=NULL WHERE id=10');
    const result = await request(app).post(path).set('x-test-user', '1').send({ targetFunnelId: 2 });
    expect(result.status, result.text).toBe(200);
    expect(await lead()).toMatchObject({ funnel_id: 2, manager_id: null });
    expect((await fixture.pool.query('SELECT manager_id FROM academy_students ORDER BY id')).rows).toEqual([{ manager_id: null }, { manager_id: null }]);
  });

  it.each([{}, { targetFunnelId: 1 }, { targetFunnelId: 3 }, { targetFunnelId: 99 }])('rejects unavailable destination %j without changing ownership', async body => {
    expect((await request(app).post(path).send(body)).status).toBeGreaterThanOrEqual(400);
    expect(await lead()).toMatchObject({ funnel_id: 1, manager_id: 7 });
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it('rechecks a destination withdrawn while the manual request waited for configuration changes', async () => {
    const client = await fixture.pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('academy-sales-funnels'))`);
      await client.query('UPDATE academy_sales_funnels SET is_active=false WHERE id=2');
      pending = transfer().then(response => response);
      await waitForDatabaseLock('advisory');
      await client.query('COMMIT');
      const result = await pending;
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'salesFunnelRequired' });
      expect(await lead()).toMatchObject({ funnel_id: 1, manager_id: 7 });
      expect(fixture.audit).not.toHaveBeenCalled();
    } finally {
      await client.query('ROLLBACK');
      client.release();
      if (pending) await pending;
    }
  });

  it('rejects an explicitly selected stage deactivated while the transfer waited for its row lock', async () => {
    const client = await fixture.pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE academy_lead_statuses SET is_active=false WHERE code='paid_b'`);
      pending = request(app).post(path).send({ targetFunnelId: 2, targetStageCode: 'paid_b' }).then(response => response);
      await waitForDatabaseLock('transactionid');
      await client.query('COMMIT');
      const result = await pending;
      expect(result.status).toBe(409);
      expect(result.body).toEqual({ error: 'salesFunnelStageUnavailable' });
      expect(await lead()).toMatchObject({ funnel_id: 1, manager_id: 7 });
      expect(fixture.audit).not.toHaveBeenCalled();
    } finally {
      await client.query('ROLLBACK');
      client.release();
      if (pending) await pending;
    }
  });
});
