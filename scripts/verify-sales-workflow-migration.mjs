/** Applies all registered migrations only to an explicitly selected EMPTY local *_test database. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { disposableWorkflowDatabaseUrl, genericWorkflowMigrationIndex, workflowFixtureSql } from './lib/disposable-workflow-database.mjs';

const url = disposableWorkflowDatabaseUrl(process.env.DATABASE_URL);
const migrationFolder = fileURLToPath(new URL('../migrations/', import.meta.url));
const journal = JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'));
const genericIndex = genericWorkflowMigrationIndex(journal);
const migrations = readMigrationFiles({ migrationsFolder: migrationFolder });
assert.equal(migrations.length, journal.entries.length, 'Every registered migration must be available');
const client = new pg.Client({ connectionString: url.toString(), options: '-c timezone=UTC', connectionTimeoutMillis: 2000 });
const apply = async (items) => {
  await client.query('BEGIN');
  try {
    for (const migration of items) for (const sql of migration.sql) await client.query(sql);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
};
await client.connect();
try {
  assert.equal((await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count, 0,
    'The migration verifier requires an empty disposable database');
  await apply(migrations.slice(0, genericIndex));
  await client.query(`UPDATE academy_company_settings SET auto_lead_distribution_enabled = false;
    INSERT INTO users(id,email,password,full_name,module) VALUES
      (90001,'hunter@migration.test','disabled-test-hash','Hunter','sales'),
      (90002,'closer@migration.test','disabled-test-hash','Closer','sales'),
      (90003,'multi-module@migration.test','disabled-test-hash','Multi-module','marketing');
    INSERT INTO user_modules(user_id,module) VALUES (90003,'sales');
    INSERT INTO academy_sales_kpi_assignments(user_id,effective_month,role,created_at)
      VALUES (90001,to_char(now() AT TIME ZONE 'Asia/Tashkent','YYYY-MM'),'hunter',now()-interval '1 day'),
        (90002,to_char(now() AT TIME ZONE 'Asia/Tashkent','YYYY-MM'),'closer',now()-interval '1 day');
    INSERT INTO academy_lead_sources(id,code,name) VALUES (90001,'migration_test','Test');
    INSERT INTO academy_courses(id,name,slug,age_category) VALUES(90001,'Test course','migration-test','kids');
    INSERT INTO academy_lead_statuses(code,name,color,sort_order,is_pipeline,is_system) VALUES
      ('new_request','Existing intake label','#123456',0,true,true),
      ('first_contact','Existing contact label','#234567',10,true,true),
      ('qualified','Existing custom qualification label','#345678',20,true,true),
      ('paid','Existing payment label','#456789',100,true,true),
      ('not_now','Existing inactive label','#567890',110,false,true)
      ON CONFLICT(code) DO NOTHING;
    INSERT INTO academy_sales_funnels(id,name) VALUES(90001,'Custom populated funnel'),(90002,'Empty custom funnel');
    INSERT INTO academy_sales_funnel_users(user_id,funnel_id)
      SELECT 90001,id FROM academy_sales_funnels WHERE workflow_role='hunter' OR id=90001;
    INSERT INTO academy_sales_funnel_users(user_id,funnel_id)
      SELECT 90002,id FROM academy_sales_funnels WHERE workflow_role='closer';
    INSERT INTO academy_sales_funnel_users(user_id,funnel_id)
      SELECT 90003,id FROM academy_sales_funnels WHERE workflow_role IN ('hunter','closer');
    UPDATE academy_integration_funnel_settings SET funnel_id=90001 WHERE provider='website';
    INSERT INTO academy_leads(id,contact_name,phone,source_id,funnel_id,manager_id,status_code,is_archived,student_age,course_id)
      SELECT 90000+n,'Test lead '||n,'migration-'||n,90001,
        CASE WHEN n IN(3,4) THEN (SELECT id FROM academy_sales_funnels WHERE workflow_role='closer')
          WHEN n=5 THEN 90001 ELSE (SELECT id FROM academy_sales_funnels WHERE is_default) END,
        CASE WHEN n IN(3,4) THEN 90002 ELSE 90001 END,
        CASE n WHEN 1 THEN 'new_request' WHEN 2 THEN 'first_contact' WHEN 3 THEN 'demo_attended'
          WHEN 4 THEN 'paid' WHEN 5 THEN 'paid' ELSE 'qualified' END,
        n=6,12,90001 FROM generate_series(1,6) n;
    INSERT INTO academy_students(id,contact_name,lead_id,manager_id,referral_code)
      VALUES(90001,'Test student',90002,90001,'TEST-GENERIC-MIGRATION');
    INSERT INTO academy_tasks(id,title,responsible_id,entity_type,entity_id)
      VALUES(90001,'Test task',90001,'lead',90002);`);
  const beforeLeads = (await client.query(`SELECT lead.id,lead.manager_id,lead.funnel_id,lead.is_archived,stage.name AS stage_name
    FROM academy_leads lead JOIN academy_lead_statuses stage ON stage.code=lead.status_code ORDER BY lead.id`)).rows;
  const beforeKpi = (await client.query('SELECT * FROM academy_sales_kpi_leads ORDER BY lead_id')).rows;
  const beforeMemberships = (await client.query('SELECT user_id,funnel_id FROM academy_sales_funnel_users ORDER BY user_id,funnel_id')).rows;
  const beforeIntakeSettings = (await client.query('SELECT provider,funnel_id FROM academy_integration_funnel_settings ORDER BY provider')).rows;
  // Apply 0128 and every later registered migration. No hard-coded latest index.
  await apply(migrations.slice(genericIndex));
  assert.deepEqual((await client.query(`SELECT lead.id,lead.manager_id,lead.funnel_id,lead.is_archived,stage.name AS stage_name
    FROM academy_leads lead JOIN academy_lead_statuses stage ON stage.code=lead.status_code AND stage.funnel_id=lead.funnel_id ORDER BY lead.id`)).rows,
  beforeLeads, 'Conversion preserves each lead owner, funnel, archive flag and visible stage name');
  assert.deepEqual((await client.query('SELECT * FROM academy_sales_kpi_leads ORDER BY lead_id')).rows, beforeKpi,
    'Existing historical KPI facts remain unchanged');
  assert.deepEqual((await client.query('SELECT user_id,funnel_id FROM academy_sales_funnel_users ORDER BY user_id,funnel_id')).rows, beforeMemberships,
    'Employee-selected memberships, including both funnels and extra sales access, remain unchanged');
  assert.deepEqual((await client.query('SELECT provider,funnel_id FROM academy_integration_funnel_settings ORDER BY provider')).rows, beforeIntakeSettings,
    'Incoming-source funnel selections remain unchanged');
  assert.equal((await client.query(`SELECT count(*)::int AS count FROM academy_sales_funnels funnel
    LEFT JOIN academy_lead_statuses stage ON stage.code=funnel.initial_stage_code
    WHERE stage.id IS NULL OR stage.funnel_id<>funnel.id OR NOT stage.is_active OR NOT stage.is_pipeline OR stage.sort_order<>0`)).rows[0].count, 0,
  'All funnels have an explicit active first stage, including the previously empty funnel');
  assert.equal((await client.query('SELECT count(*)::int AS count FROM academy_lead_statuses WHERE funnel_id IS NULL OR is_system')).rows[0].count, 0);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM academy_lead_funnel_qualifications')).rows[0].count, 0,
    'Legacy profile completion or old stage codes cannot fabricate manual qualification');
  assert.equal((await client.query('SELECT manager_id FROM academy_students WHERE id=90001')).rows[0].manager_id, 90001);
  assert.equal((await client.query('SELECT responsible_id FROM academy_tasks WHERE id=90001')).rows[0].responsible_id, 90001);
  for (const fixture of ['demo-pipeline-protection.sql', 'demo-lead-workflow.sql']) {
    await client.query(workflowFixtureSql(await readFile(new URL(`../tests/sql/${fixture}`, import.meta.url), 'utf8')));
  }
  console.log('PASS: all current migrations; populated conversion preserves labels, ownership, KPI and intake settings; generic-stage SQL assertions');
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
}
