import assert from 'node:assert/strict';
import pg from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';

const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
assert(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('_test'),
  'Use an explicitly configured empty disposable local *_test database');
const client = new pg.Client({ connectionString: url.toString(), options: '-c timezone=UTC' });
await client.connect();
try {
  assert.equal((await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count, 0);
  const migrations = readMigrationFiles({ migrationsFolder: './migrations' });
  await client.query('BEGIN');
  for (const migration of migrations.slice(0, 107)) for (const sql of migration.sql) await client.query(sql);
  await client.query('COMMIT');
  await client.query(`INSERT INTO users(id,email,password,full_name,module) VALUES
    (1,'hunter@migration.test','test-only','Hunter','sales'),
    (2,'closer@migration.test','test-only','Closer','sales');
    INSERT INTO academy_sales_kpi_assignments(user_id,effective_month,role)
    VALUES (1,to_char(now(),'YYYY-MM'),'hunter'),(2,to_char(now(),'YYYY-MM'),'closer');
    INSERT INTO academy_lead_sources(id,code,name) VALUES (1,'test','Test');
    INSERT INTO academy_lead_statuses(code,name,color,sort_order) VALUES
    ('new_request','New','#666666',0),('offer','Offer','#666666',60),('paid','Paid','#666666',100);
    INSERT INTO academy_sales_funnels(id,name) VALUES (99,'B2B fixture');
    INSERT INTO academy_leads(id,contact_name,source_id,funnel_id,manager_id,status_code,is_archived)
    SELECT id,'Test lead',1,(SELECT id FROM academy_sales_funnels WHERE is_default),manager_id,status_code,archived
    FROM (VALUES (1,1,'new_request',false),(2,1,'demo_attended',false),(3,1,'offer',false),
      (4,1,'paid',false),(5,2,'demo_attended',false),(6,1,'demo_attended',true)) AS fixture(id,manager_id,status_code,archived);
    INSERT INTO academy_leads(id,contact_name,source_id,funnel_id,manager_id,status_code)
      VALUES (7,'B2B lead',1,99,1,'demo_attended');
    INSERT INTO academy_students(id,contact_name,lead_id,manager_id,referral_code)
      VALUES (1,'Test student',2,1,'TEST-MIGRATION');
    INSERT INTO academy_tasks(id,title,responsible_id,entity_type,entity_id)
      VALUES (1,'Test task',1,'lead',2);`);
  const before = (await client.query('SELECT * FROM academy_sales_kpi_leads ORDER BY lead_id')).rows;
  await client.query('BEGIN');
  for (const sql of migrations[107].sql) await client.query(sql);
  await client.query('COMMIT');
  const leads = (await client.query(`SELECT lead.id, lead.manager_id, funnel.workflow_role, lead.is_archived
    FROM academy_leads lead JOIN academy_sales_funnels funnel ON funnel.id = lead.funnel_id ORDER BY lead.id`)).rows;
  assert.deepEqual(leads.map((lead) => [lead.id, lead.manager_id, lead.workflow_role]), [
    [1,1,'hunter'], [2,null,'closer'], [3,1,'closer'], [4,1,'closer'], [5,2,'closer'], [6,1,'closer'], [7,1,null],
  ]);
  assert.equal(leads[5].is_archived, true);
  assert.deepEqual((await client.query('SELECT * FROM academy_sales_kpi_leads ORDER BY lead_id')).rows, before,
    'historical attribution must remain unchanged during migration');
  assert.equal((await client.query('SELECT manager_id FROM academy_students WHERE id=1')).rows[0].manager_id, null);
  assert.equal((await client.query('SELECT responsible_id FROM academy_tasks WHERE id=1')).rows[0].responsible_id, null);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM academy_lead_funnel_handoffs')).rows[0].count, 1);
  console.log('PASS: populated migration preserves later-stage/archived/B2B ownership and existing KPI, releases only initial demo queue');
} finally {
  await client.end();
}
