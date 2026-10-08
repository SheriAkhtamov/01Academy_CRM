/** Run only against an empty, disposable local *_test database. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { disposableWorkflowDatabaseUrl } from './lib/disposable-workflow-database.mjs';

const url = disposableWorkflowDatabaseUrl(process.env.DATABASE_URL);
const folder = fileURLToPath(new URL('../migrations/', import.meta.url));
const journal = JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'));
const index = journal.entries.findIndex(entry => entry.tag === '0133_clean_imported_lead_comments');
assert(index > 0);
const migrations = readMigrationFiles({ migrationsFolder: folder });
assert.equal(migrations.length, journal.entries.length);
const client = new pg.Client({ connectionString: url.toString(), options: '-c timezone=UTC' });
const apply = async (items) => {
  await client.query('BEGIN');
  try {
    for (const migration of items) for (const sql of migration.sql) await client.query(sql);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
};
await client.connect();
try {
  assert.equal((await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count, 0);
  await apply(migrations.slice(0, index));
  await client.query(`UPDATE academy_company_settings SET auto_lead_distribution_enabled=false;
    INSERT INTO users(id,email,password,full_name,module) VALUES(90001,'comments@fixture.test','disabled-test-hash','Test manager','sales');
    INSERT INTO academy_sales_kpi_assignments(user_id,effective_month,role,created_at)
      VALUES(90001,to_char(now() AT TIME ZONE 'Asia/Tashkent','YYYY-MM'),'hunter',now()-interval '1 day');
    INSERT INTO academy_sales_funnel_users(user_id,funnel_id) SELECT 90001,id FROM academy_sales_funnels WHERE is_default;
    INSERT INTO academy_courses(id,name,slug,age_category) VALUES(90001,'Test course','comment-test','kids')`);
  await client.query("INSERT INTO academy_lead_sources(id,code,name) VALUES(90001,'comment_test','Test')");
  await client.query(`INSERT INTO academy_leads(id,contact_name,phone,source_id,funnel_id,status_code,manager_id,student_age,course_id)
    SELECT 90000+n,'Test parent '||n,'test-'||n,90001,f.id,f.initial_stage_code,90001,12,90001
    FROM academy_sales_funnels f CROSS JOIN generate_series(1,4) n WHERE f.is_default`);
  const header = '[Импорт Meta Instant Forms · Test form · #2040520209994113]';
  const original = `${header}\nДата заявки: 2026-09-30T03:54:06.000Z\nКампания: Test campaign\nID кампании: 123\nГруппа объявлений: Test audience\nID группы объявлений: 456\nОбъявление: Test ad\nID объявления: 789\nФорма: Test form\nID формы: 321\nПлатформа: ig\nОрганическая заявка: Нет\nОтветы формы:\n• full name: Test parent\n• phone number: +998900000000\n• из какого вы города?: Ташкент\n• сколько лет вашему ребёнку?: 10`;
  const expected = '• Имя: Test parent\n• Телефон: +998900000000\n• из какого вы города?: Ташкент\n• сколько лет вашему ребёнку?: 10';
  const second = '[Импорт Meta Lead Ads · Test sheet · #999]\nКампания: Second campaign\nВозраст ребёнка: 8\nЗаметка: Позвонить вечером\nКампания: эта строка является частью заметки\nОтветы формы:\n• Любимый предмет: Математика\nСогласия формы:\n• marketing consent: 1';
  const secondExpected = 'Возраст ребёнка: 8\nЗаметка: Позвонить вечером\nКампания: эта строка является частью заметки\n• Любимый предмет: Математика';
  const manual = 'Кампания: обсуждали с клиентом\nID формы: это обычная заметка сотрудника';
  const combined = `Перед заявкой: перезвонить\n\n${original}\n\n${second}\n\nЗаметка после заявки`;
  const combinedExpected = `Перед заявкой: перезвонить\n\n${expected}\n\n${secondExpected}\n\nЗаметка после заявки`;
  const metadataOnly = `${header}\nДата заявки: 2026-09-30T03:54:06.000Z\nКампания: Test\nID формы: 321`;
  for (const [id, body] of [[90001, original], [90002, combined], [90003, metadataOnly], [90004, manual]]) {
    await client.query('UPDATE academy_leads SET comment=$2 WHERE id=$1', [id, body]);
    await client.query(`INSERT INTO academy_lead_comments(id,lead_id,author_id,body,created_at) VALUES($1,$1,90001,$2,'2026-09-30 03:54:06')`, [id, body]);
  }
  await client.query("INSERT INTO academy_lead_comments(id,lead_id,body) VALUES(90005,90004,'')");
  await client.query(`INSERT INTO academy_lead_stage_history(lead_id,from_status_code,to_status_code,comment)
    SELECT 90001,NULL,status_code,'Импортирован из Meta Instant Forms' FROM academy_leads WHERE id=90001`);
  await client.query(`INSERT INTO academy_lead_stage_history(lead_id,from_status_code,to_status_code,comment)
    SELECT 90004,NULL,status_code,'Заметка сотрудника' FROM academy_leads WHERE id=90004`);
  await client.query("UPDATE academy_sales_kpi_leads SET crm_completed_at=NULL WHERE lead_id=90001");
  await client.query(`INSERT INTO academy_lead_import_records(provider,external_id,lead_id,outcome,payload)
    VALUES('meta_lead_ads_live','2040520209994113',90001,'created','{"campaignId":"123","answers":[{"name":"full_name","values":["Test parent"]}]}')`);
  const beforeImports = (await client.query('SELECT * FROM academy_lead_import_records ORDER BY id')).rows;
  const beforeLeadShape = (await client.query('SELECT id,contact_name,phone,source_id,manager_id,funnel_id,status_code,is_archived FROM academy_leads ORDER BY id')).rows;
  const beforeKpi = (await client.query('SELECT * FROM academy_sales_kpi_leads ORDER BY lead_id')).rows;
  const beforeActivity = (await client.query('SELECT * FROM academy_sales_kpi_activity ORDER BY id')).rows;
  await apply(migrations.slice(index));
  assert.deepEqual((await client.query('SELECT id,contact_name,phone,source_id,manager_id,funnel_id,status_code,is_archived FROM academy_leads ORDER BY id')).rows, beforeLeadShape);
  assert.deepEqual((await client.query('SELECT * FROM academy_sales_kpi_leads ORDER BY lead_id')).rows, beforeKpi);
  assert.deepEqual((await client.query('SELECT * FROM academy_sales_kpi_activity ORDER BY id')).rows, beforeActivity);
  assert.deepEqual((await client.query('SELECT * FROM academy_lead_import_records ORDER BY id')).rows, beforeImports);
  assert.deepEqual((await client.query('SELECT id,comment FROM academy_leads ORDER BY id')).rows,
    [{ id:90001, comment:expected }, { id:90002, comment:combinedExpected }, { id:90003, comment:null }, { id:90004, comment:manual }]);
  assert.deepEqual((await client.query('SELECT id,body FROM academy_lead_comments ORDER BY id')).rows,
    [{ id:90001, body:expected }, { id:90002, body:combinedExpected }, { id:90004, body:manual }, { id:90005, body:'' }]);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM academy_lead_comments WHERE created_at='2026-09-30 03:54:06'")).rows[0].count, 3);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM academy_lead_comments WHERE author_id=90001")).rows[0].count, 3);
  assert.deepEqual((await client.query('SELECT comment FROM academy_lead_stage_history WHERE comment IS NOT NULL')).rows, [{ comment:'Заметка сотрудника' }]);
  assert.equal((await client.query("SELECT tgenabled FROM pg_trigger WHERE tgname='academy_kpi_lead_capture'")).rows[0].tgenabled, 'O');
  assert.equal((await client.query("SELECT to_regprocedure('academy_clean_import_comment(text)') AS helper")).rows[0].helper, null);
  // Re-running the cleanup SQL is harmless, and never consumes another note.
  const snapshot = (await client.query('SELECT id,body FROM academy_lead_comments ORDER BY id')).rows;
  await apply(migrations.slice(index));
  assert.deepEqual((await client.query('SELECT id,body FROM academy_lead_comments ORDER BY id')).rows, snapshot);
  console.log(`PASS: all ${migrations.length} migrations; Meta metadata removed, answers/manual notes/authors/timestamps and KPI history preserved; multi-import blocks, empty generated comments and idempotence verified`);
} finally {
  await client.end();
}
