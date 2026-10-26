import { randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { Pool, defaults, types } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ pool: null as unknown as Pool }));
vi.mock('../server/db', () => ({ pool: {
  query: (...args: Parameters<Pool['query']>) => fixture.pool.query(...args), connect: () => fixture.pool.connect(),
} }));
import { buildSalesDashboardMetrics } from '../server/modules/academy/sales-dashboard-metrics';
import { buildSalesDemoStudents } from '../server/modules/academy/sales-demo-students';
import { LegacyLeadQualificationRepository } from '../server/modules/leads/infrastructure/qualification-repository';
import { createLeadQualificationService } from '../server/modules/leads/application/qualification-service';
import { createLeadQualificationRouter } from '../server/modules/leads/http/qualification.router';
import { actorContextFrom } from '../server/modules/leads/domain/actor-context';
import { SALES_REPORT_METRICS } from '../shared/contracts/sales-report';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `sales_report_${randomBytes(6).toString('hex')}`;
const originalUtcInput = defaults.parseInputDatesAsUTC;
const originalTimestampParser = types.getTypeParser(1114);
let admin: Pool;
let app: express.Express;
const range = { from: '2025-08-01', to: '2025-08-31', start: new Date('2025-07-31T19:00:00Z'), end: new Date('2025-08-31T19:00:00Z') };
const report = async (manager: number | null = null, funnel: number | null = null) => {
  const result = await buildSalesDashboardMetrics({ userId: 1, module: 'administration' }, range, manager, funnel);
  expect(result.daily).toHaveLength(31);
  for (const metric of SALES_REPORT_METRICS) {
    expect(result.daily.reduce((sum, day) => sum + day[metric], 0), metric).toBe(result[metric]);
  }
  for (const metric of ['processedLeads', 'reachedLeads', 'qualifiedLeads', 'closedLeads'] as const) {
    expect(result[metric], metric).toBeLessThanOrEqual(result.reportLeads);
  }
  expect(result.newLeads).toBeLessThanOrEqual(result.reportLeads);
  expect(result.reachedLeads).toBeLessThanOrEqual(result.processedLeads);
  const contact = result.contactBreakdown;
  expect(contact.firstAttempt + contact.secondAttempt + contact.thirdAttempt + contact.laterAttempt + contact.incomingFirst).toBe(result.reachedLeads);
  expect(result.reachedLeads + contact.attemptedUnreached + contact.notAttempted).toBe(result.reportLeads);
  expect(contact.reachedArchived + contact.reachedQualifiedInWork + contact.reachedUnqualifiedInWork).toBe(result.reachedLeads);
  expect(result.closedReasons.reduce((sum, reason) => sum + reason.count, 0)).toBe(result.closedLeads);
  return result;
};
const qualify = { funnelId: 1, locationFits: true, ageFits: true, budgetFits: true };
const path = '/leads/1/qualification';

describe.skipIf(!url)('factual sales report on PostgreSQL', () => {
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Local isolated PostgreSQL required');
    // Match server/db.ts, which is mocked to keep this suite on its isolated pool.
    defaults.parseInputDatesAsUTC = true;
    types.setTypeParser(1114, value => new Date(`${value.replace(' ', 'T')}Z`));
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.pool = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC` });
    await fixture.pool.query(`
      CREATE TABLE academy_leads(id int PRIMARY KEY,manager_id int,funnel_id int,contact_name text,student_name text,phone text,created_at timestamp,updated_at timestamp,status_code text,is_archived boolean DEFAULT false,archived_at timestamp,archive_reason text);
      CREATE TABLE academy_students(id int PRIMARY KEY,lead_id int,manager_id int,student_name text,contact_name text,phone text);
      CREATE TABLE telephony_calls(id serial PRIMARY KEY,lead_id int,contact_type text,contact_id int,started_at timestamp,direction text,talk_seconds int,metadata jsonb);
      CREATE TABLE academy_communications(id serial PRIMARY KEY,lead_id int,student_id int,created_at timestamp,created_by int);
      CREATE TABLE academy_lead_comments(id serial PRIMARY KEY,lead_id int,created_at timestamp,author_id int);
      CREATE TABLE academy_demo_lessons(id int PRIMARY KEY,scheduled_at timestamp,status text,duration_minutes int,format text,course_id int DEFAULT 1,school_id int DEFAULT 1,room_id int,teacher_id int DEFAULT 1);
      CREATE TABLE academy_demo_lesson_participants(id serial PRIMARY KEY,demo_lesson_id int,student_id int,status text,created_at timestamp);
      CREATE TABLE academy_payments(id serial PRIMARY KEY,student_id int,paid_at timestamp,status text,amount_uzs int);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,user_id int,action text,entity_type text,entity_id int,new_values jsonb,old_values jsonb,created_at timestamp DEFAULT timezone('UTC',now()));
      CREATE TABLE academy_lead_stage_history(id serial PRIMARY KEY,lead_id int,to_funnel_id int,to_status_code text,to_status_name text,entered_at timestamp);
      CREATE TABLE academy_lead_statuses(code text PRIMARY KEY,funnel_id int,name text);
      CREATE TABLE academy_courses(id int PRIMARY KEY,name text);
      CREATE TABLE academy_schools(id int PRIMARY KEY,name text);
      CREATE TABLE academy_rooms(id int PRIMARY KEY,name text);
      CREATE TABLE academy_teachers(id int PRIMARY KEY,full_name text,user_id int);
      CREATE TABLE users(id int PRIMARY KEY,full_name text);
      INSERT INTO academy_courses VALUES(1,'Course'); INSERT INTO academy_schools VALUES(1,'School');
      INSERT INTO academy_teachers VALUES(1,'Teacher',1); INSERT INTO users VALUES(7,'Alice'),(8,'Bob');
    `);
    app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: Number(req.get('x-user') ?? 7), module: 'sales', modules: ['sales'] } as typeof req.user;
      next();
    });
    app.use(createLeadQualificationRouter(createLeadQualificationService(new LegacyLeadQualificationRepository())));
  });
  beforeEach(async () => {
    await fixture.pool.query(`TRUNCATE academy_leads,academy_students,telephony_calls,academy_communications,academy_lead_comments,academy_demo_lessons,academy_demo_lesson_participants,academy_payments,audit_logs,academy_lead_stage_history,academy_lead_statuses RESTART IDENTITY;
      INSERT INTO academy_leads(id,manager_id,funnel_id,created_at,status_code) VALUES
        (1,7,1,'2025-08-01','intake'),(2,7,1,'2025-07-01','paid'),(3,8,1,'2025-08-01','ordinary'),(4,7,2,'2025-08-01','intake');
      INSERT INTO academy_students(id,lead_id,manager_id,student_name) VALUES(10,1,7,'Child A'),(11,1,7,'Child B'),(12,2,7,'Child C'),(13,3,8,'Child D'),(14,4,7,'Child E');
    `);
  });
  afterAll(async () => {
    await fixture.pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    defaults.parseInputDatesAsUTC = originalUtcInput;
    types.setTypeParser(1114, originalTimestampParser);
  });

  it('counts new leads across sources and ignores all stage-only changes and generic updates', async () => {
    await fixture.pool.query("UPDATE academy_leads SET status_code='paid',updated_at='2025-08-12'");
    expect(await report()).toMatchObject({ newLeads: 3, processedLeads: 0, reachedLeads: 0, qualifiedLeads: 0, demoBookings: 0, demoAttendees: 0, successfulStudents: 0, closedLeads: 0, closedReasons: [] });
    expect((await report(7, 1)).newLeads).toBe(1);
    expect((await report(null, 2)).newLeads).toBe(1);
  });
  it('includes older leads with activity but ignores unaudited imported comments', async () => {
    await fixture.pool.query(`INSERT INTO telephony_calls(lead_id,started_at,direction,talk_seconds) VALUES
      (1,'2025-08-01','outgoing',1),(1,'2025-08-02','incoming',25),(1,'2025-08-03','outgoing',0),(2,'2025-08-04','incoming',0);
      INSERT INTO academy_communications(lead_id,created_at,created_by) VALUES(2,'2025-08-05',NULL);`);
    expect(await report()).toMatchObject({ reachedLeads: 1, processedLeads: 1 });
    await fixture.pool.query(`INSERT INTO academy_lead_comments(lead_id,created_at,author_id) VALUES(1,'2025-08-04',7),(2,'2025-08-05',7),(2,'2025-08-06',7)`);
    expect(await report()).toMatchObject({ reachedLeads: 1, processedLeads: 1, reportLeads: 4 });
    await fixture.pool.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,created_at) VALUES(7,'ADD_ACADEMY_LEAD_COMMENT','academy_lead',2,'2025-08-05')`);
    expect(await report()).toMatchObject({ reachedLeads: 1, processedLeads: 2 });
  });
  it('counts attending siblings separately, deduplicates visits, excludes cancellations, no-shows and future attendance', async () => {
    await fixture.pool.query(`INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES
      (1,'2025-08-10','completed'),(2,'2025-08-11','completed'),(3,'2025-08-12','cancelled'),(4,'2099-08-15','scheduled');
      INSERT INTO academy_demo_lesson_participants(demo_lesson_id,student_id,status,created_at) VALUES
      (1,10,'attended','2025-08-01'),(1,11,'attended','2025-08-01'),(2,10,'attended','2025-08-02'),
      (1,12,'no_show','2025-08-03'),(3,13,'attended','2025-08-04'),(4,14,'attended','2025-08-05'),(2,13,'cancelled','2025-08-05');`);
    expect(await report()).toMatchObject({ demoBookings: 4, demoAttendees: 2, processedLeads: 3 });
    expect(await report(7, 1)).toMatchObject({ demoBookings: 3, demoAttendees: 2, processedLeads: 2 });
    expect(await report(8, 1)).toMatchObject({ demoBookings: 0, demoAttendees: 0 });
    const students = await buildSalesDemoStudents({ userId: 1, module: 'administration' }, range, 7, 1);
    expect(students.map(student => student.studentId).sort()).toEqual([10, 11]);
    expect(students.find(student => student.studentId === 10)?.visits).toHaveLength(2);
  });
  it('counts payments in the period for old and new leads, excluding repeats and invalid payments', async () => {
    await fixture.pool.query(`INSERT INTO academy_payments(student_id,paid_at,status,amount_uzs) VALUES
      (10,'2025-08-10','paid',100),(10,'2025-09-10','paid',100),
      (11,'2025-09-10','paid',100),(11,'2025-09-20','paid',100),
      (12,'2025-08-10','refunded',100),(13,'2025-08-10','pending',100),
      (14,'2025-08-10','paid',100),(12,'2025-08-11','paid',0),
      (12,'2025-08-12','paid',100),(12,'2025-08-13','paid',100),
      (12,'2025-09-11','paid',100),(13,'2099-09-11','paid',100);`);
    const result = await report();
    expect(result).toMatchObject({ successfulStudents: 3 });
    expect(result.daily[9].successfulStudents).toBe(2);
    expect(result.daily[11].successfulStudents).toBe(1);
    expect(result.daily[12].successfulStudents).toBe(0);
    expect((await report(7, 1)).successfulStudents).toBe(2);
    expect((await report(7, 2)).successfulStudents).toBe(1);
  });
  it('uses inclusive academy start and exclusive next-day end', async () => {
    await fixture.pool.query("UPDATE academy_leads SET created_at='2025-07-01'");
    await fixture.pool.query("UPDATE academy_leads SET created_at=$1 WHERE id=1", [range.start]);
    await fixture.pool.query("UPDATE academy_leads SET created_at=$1 WHERE id=2", [range.end]);
    expect((await report()).newLeads).toBe(1);
  });
  it('keeps all later events out of an earlier reporting period', async () => {
    await fixture.pool.query(`UPDATE academy_leads SET created_at='2025-08-01 18:59:59' WHERE id=1;
      UPDATE academy_leads SET created_at='2025-08-01 19:00:00' WHERE id=3;
      UPDATE academy_leads SET created_at='2025-08-31 18:59:59' WHERE id=4;
      INSERT INTO academy_leads(id,manager_id,funnel_id,created_at) VALUES(5,7,1,'2025-08-31 19:00:00');
      INSERT INTO telephony_calls(lead_id,started_at,direction,talk_seconds) VALUES
      (1,'2025-09-01','outgoing',3),(1,'2025-09-02','incoming',4),
      (3,'2025-09-05','outgoing',2),(4,'2025-09-05','outgoing',2),(5,'2025-09-05','outgoing',2);
      INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES
      (1,'2025-09-10 19:00:00','completed'),(2,'2025-09-11 19:00:00','completed');
      INSERT INTO academy_demo_lesson_participants(demo_lesson_id,student_id,status,created_at) VALUES
      (1,10,'attended','2025-09-02'),(1,11,'attended','2025-09-02'),(2,10,'attended','2025-09-03');`);
    const result = await report();
    expect(result.newLeads).toBe(3);
    expect(result).toMatchObject({ demoBookings: 0, demoAttendees: 0 });
    expect(result.daily[0]).toMatchObject({ newLeads: 1, reachedLeads: 0, processedLeads: 0, demoBookings: 0, demoAttendees: 0 });
    expect(result.daily[1]).toMatchObject({ newLeads: 1, reachedLeads: 0, processedLeads: 0 });
    expect(result.daily[30]).toMatchObject({ reachedLeads: 0, processedLeads: 0 });
    const students = await buildSalesDemoStudents({ userId: 1, module: 'administration' }, range, 7, 1);
    expect(students).toEqual([]);
    const september = { from: '2025-09-01', to: '2025-09-30', start: new Date('2025-08-31T19:00:00Z'), end: new Date('2025-09-30T19:00:00Z') };
    const nextReport = await buildSalesDashboardMetrics({ userId: 1, module: 'administration' }, september, 7, 1);
    expect(nextReport).toMatchObject({ demoBookings: 2, demoAttendees: 2 });
    expect(nextReport.daily[1].demoBookings).toBe(2);
    expect(nextReport.daily[10].demoAttendees).toBe(2);
    const nextStudents = await buildSalesDemoStudents({ userId: 1, module: 'administration' }, september, 7, 1);
    expect(nextStudents.map(student => student.studentId).sort()).toEqual([10, 11]);
    expect(nextStudents.find(student => student.studentId === 10)?.visits).toHaveLength(2);
  });
  it('counts the latest current closure by its date, including older leads and excluding restored leads', async () => {
    await fixture.pool.query(`INSERT INTO audit_logs(action,entity_type,entity_id,new_values,created_at) VALUES
      ('ARCHIVE_ACADEMY_LEAD','academy_lead',1,'[{"archiveReason":"no_budget"}]','2025-08-01'),
      ('BULK_ARCHIVE_ACADEMY_LEAD','academy_lead',1,'[{"archiveReason":"not_interested"}]','2025-08-02');
      UPDATE academy_leads SET is_archived=true,archive_reason='no_budget',archived_at='2025-08-03' WHERE id=2;
      UPDATE academy_leads SET is_archived=true,archive_reason='not_interested',archived_at='2025-09-03' WHERE id=3;`);
    expect(await report()).toMatchObject({ closedLeads: 1, processedLeads: 2, closedReasons: [{ reason: 'no_budget', count: 1 }] });
    expect((await report()).daily[0].processedLeads).toBe(1);
    expect((await report()).daily[2].processedLeads).toBe(1);
    expect((await report(7)).closedLeads).toBe(1);
    await fixture.pool.query('UPDATE academy_leads SET is_archived=false WHERE id=2');
    expect((await report()).closedLeads).toBe(0);
    await fixture.pool.query("UPDATE academy_leads SET is_archived=true,archive_reason='' WHERE id=1");
    expect((await report()).closedReasons).toEqual([{ reason: 'not_interested', count: 1 }]);
  });
  it('partitions the cohort by first successful outgoing attempt, incoming contact and unreached leads', async () => {
    await fixture.pool.query(`UPDATE academy_leads SET created_at='2025-07-01';
      INSERT INTO academy_leads(id,manager_id,funnel_id,created_at)
      SELECT id,7,1,'2025-08-03 08:00:00'::timestamp FROM generate_series(20,28) id;
      INSERT INTO telephony_calls(lead_id,started_at,direction,talk_seconds) VALUES
      (20,'2025-08-01','outgoing',1),(20,'2025-08-02','outgoing',20),(20,'2025-08-03','incoming',5),
      (21,'2025-08-01','outgoing',0),(21,'2025-08-01','outgoing',2),
      (22,'2025-08-01','incoming',0),(22,'2025-08-02','outgoing',0),
      (22,'2025-08-03','outgoing',0),(22,'2025-08-04','outgoing',3),
      (23,'2025-08-01','outgoing',0),(23,'2025-08-02','outgoing',0),
      (23,'2025-08-03','outgoing',0),(23,'2025-08-04','outgoing',4),
      (24,'2025-08-03 07:59:00','incoming',6),
      (25,'2025-08-01','outgoing',0),(25,'2025-08-02','outgoing',0),(25,'2025-08-03','incoming',7),
      (26,'2025-08-01','outgoing',0),(26,'2025-08-02','outgoing',0),
      (27,'2025-08-01','incoming',0),(27,'2099-09-02','outgoing',8),
      (1,'2025-09-01','outgoing',20);
      UPDATE academy_leads SET is_archived=true,archive_reason='no_budget',archived_at='2025-08-20' WHERE id IN (20,26);
      INSERT INTO audit_logs(action,entity_type,entity_id,new_values,created_at) VALUES
      ('QUALIFY_ACADEMY_LEAD_BY_CRITERIA','academy_lead',20,'[{"funnelId":1}]','2025-08-05'),
      ('QUALIFY_ACADEMY_LEAD_BY_CRITERIA','academy_lead',21,'[{"funnelId":1}]','2025-08-05');`);
    expect(await report(7, 1)).toMatchObject({
      newLeads: 9, reachedLeads: 6, processedLeads: 7, qualifiedLeads: 2, closedLeads: 2,
      contactBreakdown: {
        firstAttempt: 1, secondAttempt: 1, thirdAttempt: 1, laterAttempt: 1, incomingFirst: 2,
        attemptedUnreached: 1, notAttempted: 2,
        reachedArchived: 1, reachedQualifiedInWork: 1, reachedUnqualifiedInWork: 4,
      },
    });
    expect((await report(8, 1)).newLeads).toBe(0);
    expect((await report(7, 2)).newLeads).toBe(0);
  });
  it('joins calls through child contacts but counts the parent lead only once', async () => {
    await fixture.pool.query(`INSERT INTO academy_students(id,lead_id,manager_id) VALUES(99,NULL,7);
      INSERT INTO telephony_calls(contact_type,contact_id,started_at,direction,talk_seconds) VALUES
      ('student',10,'2025-08-01','outgoing',3),('student',11,'2025-08-02','outgoing',4),
      ('student',99,'2025-08-01','outgoing',3),('lead',3,'2025-08-01','outgoing',3);`);
    expect(await report()).toMatchObject({ newLeads: 3, reachedLeads: 2 });
    expect(await report(7, 1)).toMatchObject({ newLeads: 1, reachedLeads: 1, contactBreakdown: { firstAttempt: 1 } });
  });
  it('includes old leads in attendance while preserving manager, funnel and linked-lead scope', async () => {
    await fixture.pool.query(`INSERT INTO academy_students(id,lead_id,manager_id) VALUES(99,NULL,7);
      INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES(1,'2025-08-10','completed');
      INSERT INTO academy_demo_lesson_participants(demo_lesson_id,student_id,status,created_at) VALUES
      (1,10,'attended','2025-08-01'),(1,12,'attended','2025-07-01'),
      (1,13,'attended','2025-08-01'),(1,99,'attended','2025-08-01');`);
    expect(await report(7, 1)).toMatchObject({ newLeads: 1, processedLeads: 2, demoBookings: 1, demoAttendees: 2 });
    const students = await buildSalesDemoStudents({ userId: 1, module: 'administration' }, range, 7, 1);
    expect(students.map(student => student.studentId).sort()).toEqual([10, 12]);
    expect((await report(7, 2)).demoAttendees).toBe(0);
    const ownReport = await buildSalesDashboardMetrics({ userId: 7, module: 'sales' }, range, 8, 1);
    expect(ownReport.demoAttendees).toBe(2);
    const ownStudents = await buildSalesDemoStudents({ userId: 7, module: 'sales' }, range, 8, 1);
    expect(ownStudents.map(student => student.studentId).sort()).toEqual([10, 12]);
  });
  it('counts all 17 attending students even when only nine leads arrived in the period', async () => {
    await fixture.pool.query(`INSERT INTO academy_leads(id,manager_id,funnel_id,created_at)
      SELECT id,7,1,CASE WHEN id < 109 THEN '2025-08-01'::timestamp ELSE '2025-07-01'::timestamp END
      FROM generate_series(100,116) id;
      INSERT INTO academy_students(id,lead_id,manager_id,student_name)
      SELECT id,id,7,'Student ' || id FROM generate_series(100,116) id;
      INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES
      (1,'2025-08-10','completed'),(2,'2025-08-11','scheduled');
      INSERT INTO academy_demo_lesson_participants(demo_lesson_id,student_id,status,created_at)
      SELECT 1,id,'attended','2025-08-05'::timestamp FROM generate_series(100,116) id;
      INSERT INTO academy_demo_lesson_participants(demo_lesson_id,student_id,status,created_at)
      VALUES(2,100,'attended','2025-08-06');`);
    const result = await report(7, 1);
    expect(result).toMatchObject({ demoBookings: 17, demoAttendees: 17, processedLeads: 17 });
    expect(result.daily[0].demoAttendees).toBe(0);
    expect(result.daily[9].demoAttendees).toBe(17);
    expect(result.daily[10].demoAttendees).toBe(0);
    const students = await buildSalesDemoStudents({ userId: 1, module: 'administration' }, range, 7, 1);
    expect(students).toHaveLength(result.demoAttendees);
    expect(students.find(student => student.studentId === 100)?.visits).toHaveLength(2);
  });
  it('uses academy date boundaries independently for bookings, visits and payments', async () => {
    await fixture.pool.query(`UPDATE academy_leads SET created_at='2025-07-01';
      INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES
      (1,'2025-07-31 18:59:59','completed'),(2,'2025-07-31 19:00:00','completed'),
      (3,'2025-08-31 18:59:59','completed'),(4,'2025-08-31 19:00:00','completed');
      INSERT INTO academy_demo_lesson_participants(demo_lesson_id,student_id,status,created_at) VALUES
      (1,10,'attended','2025-07-31 18:59:59'),(2,10,'attended','2025-07-31 19:00:00'),
      (3,11,'attended','2025-08-31 18:59:59'),(4,12,'attended','2025-08-31 19:00:00');
      INSERT INTO academy_payments(student_id,paid_at,status,amount_uzs) VALUES
      (10,'2025-07-31 18:59:59','paid',100),(10,'2025-07-31 19:00:00','paid',100),
      (11,'2025-08-31 18:59:59','paid',100),(12,'2025-08-31 19:00:00','paid',100);`);
    const result = await report(7, 1);
    expect(result).toMatchObject({ newLeads: 0, processedLeads: 1, demoBookings: 2, demoAttendees: 2, successfulStudents: 1 });
    for (const metric of ['demoBookings', 'demoAttendees'] as const) {
      expect(result.daily[0][metric]).toBe(1);
      expect(result.daily[30][metric]).toBe(1);
    }
    const students = await buildSalesDemoStudents({ userId: 1, module: 'administration' }, range, 7, 1);
    expect(students.map(student => student.studentId).sort()).toEqual([10, 11]);
    expect(students.flatMap(student => student.visits.map(visit => visit.demoId)).sort()).toEqual([2, 3]);
  });
  it('excludes later and future qualifications from an earlier reporting period', async () => {
    await fixture.pool.query(`INSERT INTO audit_logs(action,entity_type,entity_id,new_values,created_at) VALUES
      ('QUALIFY_ACADEMY_LEAD_BY_CRITERIA','academy_lead',1,'[{"funnelId":1}]','2025-09-05'),
      ('REVOKE_ACADEMY_LEAD_QUALIFICATION','academy_lead',1,'[{"funnelId":1}]','2099-09-05'),
      ('QUALIFY_ACADEMY_LEAD_BY_CRITERIA','academy_lead',3,'[{"funnelId":1}]','2099-09-05');`);
    expect(await report()).toMatchObject({ newLeads: 3, processedLeads: 0, qualifiedLeads: 0 });
    expect((await report(8)).qualifiedLeads).toBe(0);
  });
  it('does not mark imported lead descriptions as processed, but counts audited comments and manual stage changes', async () => {
    await fixture.pool.query(`INSERT INTO academy_leads(id,manager_id,funnel_id,created_at)
      SELECT id,7,1,'2025-08-16'::timestamp FROM generate_series(100,149) id;
      INSERT INTO academy_lead_comments(lead_id,author_id,created_at)
      SELECT id,1,'2025-08-16'::timestamp FROM generate_series(100,149) id;
      INSERT INTO audit_logs(user_id,action,entity_type,entity_id,new_values,old_values,created_at) VALUES
      (1,'CREATE_ACADEMY_LEAD','academy_lead',100,'[{"comment":"School address"}]',NULL,'2025-08-16'),
      (7,'UPDATE_ACADEMY_LEAD','academy_lead',101,'[{"phone":"123"}]','[{"phone":"456"}]','2025-08-17');`);
    expect(await report(7, 1)).toMatchObject({ newLeads: 51, reportLeads: 51, processedLeads: 0 });
    await fixture.pool.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,new_values,old_values,created_at) VALUES
      (7,'ADD_ACADEMY_LEAD_COMMENT','academy_lead',100,'[{"commentId":1}]',NULL,'2025-08-18'),
      (1,'UPDATE_ACADEMY_LEAD','academy_lead',101,'[{"comment":"Called parent"}]','[{"comment":"School address"}]','2025-08-19'),
      (7,'UPDATE_ACADEMY_LEAD','academy_lead',2,'[{"statusCode":"waiting"}]','[{"statusCode":"intake"}]','2025-08-20'),
      (7,'ADD_ACADEMY_LEAD_COMMENT','academy_lead',3,'[{"commentId":2}]',NULL,'2025-08-20');`);
    const result = await report(7, 1);
    expect(result).toMatchObject({ newLeads: 51, reportLeads: 52, processedLeads: 3 });
    expect(result.daily[17].processedLeads).toBe(1);
    expect(result.daily[18].processedLeads).toBe(1);
    expect(result.daily[19].processedLeads).toBe(1);
  });
  it('counts older leads and actual attempts within the period, excluding synthetic resolutions and earlier calls', async () => {
    await fixture.pool.query(`INSERT INTO telephony_calls(lead_id,started_at,direction,talk_seconds,metadata) VALUES
      (2,'2025-07-20','outgoing',50,NULL),
      (2,'2025-08-01','outgoing',0,'{"actualDialPerformed":false}'),
      (2,'2025-08-02','outgoing',0,NULL),(2,'2025-08-03','outgoing',40,NULL),
      (1,'2025-08-01','outgoing',0,'{"actualDialPerformed":false}'),
      (3,'2025-08-02','outgoing',70,NULL),(4,'2025-08-02','outgoing',80,NULL);`);
    const result = await report(7, 1);
    expect(result).toMatchObject({ newLeads: 1, reportLeads: 2, processedLeads: 1, reachedLeads: 1,
      contactBreakdown: { firstAttempt: 0, secondAttempt: 1, thirdAttempt: 0, laterAttempt: 0, attemptedUnreached: 0, notAttempted: 1 } });
    expect(result.daily[1].processedLeads).toBe(1);
    expect(result.daily[2].reachedLeads).toBe(1);
    const own = await buildSalesDashboardMetrics({ userId: 7, module: 'sales' }, range, 8, 1);
    expect(own.reachedLeads).toBe(1);
  });
  it('recognizes qualification-stage entries without treating every exit from intake as qualification', async () => {
    await fixture.pool.query(`INSERT INTO academy_lead_stage_history(lead_id,to_funnel_id,to_status_code,to_status_name,entered_at) VALUES
      (1,1,'first_contact','Responsible assigned','2025-08-04'),
      (2,1,'qualified','Квалификация пройдена','2025-08-10'),
      (2,1,'qualified','Квалификация пройдена','2025-08-11'),
      (3,1,'custom_qualified','Квалификация пройдена','2025-08-12'),
      (4,2,'qualified_f2_s3','Renamed qualification','2025-08-13'),
      (1,2,'qualified_f2_s3','Квалификация пройдена','2025-08-14');
      INSERT INTO telephony_calls(lead_id,started_at,direction,talk_seconds) VALUES(2,'2025-08-15','outgoing',20);`);
    const result = await report(7, 1);
    expect(result).toMatchObject({ qualifiedLeads: 1, processedLeads: 1, reachedLeads: 1,
      contactBreakdown: { reachedQualifiedInWork: 1, reachedUnqualifiedInWork: 0 } });
    expect(result.daily[9].qualifiedLeads).toBe(1);
    expect(result.daily[10].qualifiedLeads).toBe(0);
    expect((await report()).qualifiedLeads).toBe(3);
  });
  it('keeps earlier qualification in reached states without inventing qualification activity this month', async () => {
    await fixture.pool.query(`INSERT INTO academy_lead_stage_history(lead_id,to_funnel_id,to_status_code,to_status_name,entered_at)
      VALUES(2,1,'qualified','Квалификация пройдена','2025-07-20');
      UPDATE academy_leads SET status_code='qualified' WHERE id=1;
      INSERT INTO telephony_calls(lead_id,started_at,direction,talk_seconds) VALUES
      (1,'2025-08-10','outgoing',20),(2,'2025-08-10','outgoing',30);`);
    expect(await report(7, 1)).toMatchObject({ qualifiedLeads: 0, reachedLeads: 2,
      contactBreakdown: { reachedQualifiedInWork: 2 } });
  });
  it('lets an explicit correction revoke a stage qualification and a later qualification restore it', async () => {
    await fixture.pool.query(`INSERT INTO academy_lead_stage_history(lead_id,to_funnel_id,to_status_code,to_status_name,entered_at)
      VALUES(2,1,'qualified','Квалификация пройдена','2025-08-10');
      UPDATE academy_leads SET status_code='qualified' WHERE id=2;
      INSERT INTO audit_logs(user_id,action,entity_type,entity_id,new_values,created_at)
      VALUES(7,'REVOKE_ACADEMY_LEAD_QUALIFICATION','academy_lead',2,'[{"funnelId":1}]','2025-08-11');
      INSERT INTO telephony_calls(lead_id,started_at,direction,talk_seconds) VALUES(2,'2025-08-12','outgoing',20);`);
    expect(await report(7, 1)).toMatchObject({ qualifiedLeads: 0, contactBreakdown: { reachedQualifiedInWork: 0 } });
    await fixture.pool.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,new_values,created_at)
      VALUES(7,'QUALIFY_ACADEMY_LEAD_BY_CRITERIA','academy_lead',2,'[{"funnelId":1}]','2025-08-13');`);
    const result = await report(7, 1);
    expect(result).toMatchObject({ qualifiedLeads: 1, contactBreakdown: { reachedQualifiedInWork: 1 } });
    expect(result.daily[9].qualifiedLeads).toBe(0);
    expect(result.daily[12].qualifiedLeads).toBe(1);
  });
  it('counts first positive payments as sales and recurring payments only as activity', async () => {
    await fixture.pool.query(`INSERT INTO academy_payments(student_id,paid_at,status,amount_uzs) VALUES
      (12,'2025-07-20','paid',100),(12,'2025-08-18','paid',100),
      (10,'2025-07-20','pending',100),(10,'2025-08-15','paid',20),(10,'2025-08-18','paid',80),
      (11,'2025-07-20','refunded',100),(11,'2025-08-18','paid',100),
      (13,'2025-08-18','paid',100),(14,'2025-08-18','paid',100);`);
    const result = await report(7, 1);
    expect(result).toMatchObject({ successfulStudents: 2, processedLeads: 2 });
    expect(result.daily[14].successfulStudents).toBe(1);
    expect(result.daily[17].successfulStudents).toBe(1);
  });
  it('includes old closed leads by archive date and combines exact reason aliases', async () => {
    await fixture.pool.query(`UPDATE academy_leads SET created_at='2025-07-01',is_archived=true,
      archived_at='2025-08-10',archive_reason='дубль' WHERE id=1;
      UPDATE academy_leads SET is_archived=true,archived_at='2025-08-11',archive_reason='duplicate_or_invalid' WHERE id=2;
      UPDATE academy_leads SET is_archived=true,archived_at='2025-07-20',archive_reason='no_budget' WHERE id=4;`);
    expect(await report(7)).toMatchObject({ newLeads: 1, reportLeads: 3, closedLeads: 2, processedLeads: 2,
      closedReasons: [{ reason: 'duplicate_or_invalid', count: 2 }] });
  });
  it('excludes future facts even when the selected reporting range is in the future', async () => {
    await fixture.pool.query(`INSERT INTO telephony_calls(lead_id,started_at,direction,talk_seconds)
      VALUES(2,'2099-08-10','outgoing',30);
      INSERT INTO academy_payments(student_id,paid_at,status,amount_uzs) VALUES(12,'2099-08-10','paid',100);
      INSERT INTO academy_lead_stage_history(lead_id,to_funnel_id,to_status_code,entered_at)
      VALUES(2,1,'qualified','2099-08-10');
      INSERT INTO audit_logs(user_id,action,entity_type,entity_id,created_at)
      VALUES(7,'ADD_ACADEMY_LEAD_COMMENT','academy_lead',2,'2099-08-10');
      UPDATE academy_leads SET is_archived=true,archived_at='2099-08-10' WHERE id=2;`);
    const future = { from: '2099-08-01', to: '2099-08-31', start: new Date('2099-07-31T19:00:00Z'), end: new Date('2099-08-31T19:00:00Z') };
    const result = await buildSalesDashboardMetrics({ userId: 1, module: 'administration' }, future, 7, 1);
    expect(result).toMatchObject({ newLeads: 0, reportLeads: 0, processedLeads: 0, reachedLeads: 0,
      qualifiedLeads: 0, successfulStudents: 0, closedLeads: 0 });
    expect(result.daily.every(day => SALES_REPORT_METRICS.every(metric => day[metric] === 0))).toBe(true);
  });
  it('validates all three criteria and requires ownership and the unchanged funnel', async () => {
    expect((await request(app).post(path).send({ ...qualify, budgetFits: false })).status).toBe(400);
    expect((await request(app).post(path).set('x-user','8').send(qualify)).status).toBe(403);
    expect((await request(app).post(path).send({ ...qualify, funnelId: 2 })).status).toBe(409);
    expect((await request(app).get(path).set('x-user','8')).status).toBe(403);
    expect((await request(app).get(path)).body).toEqual({ funnelId: 1, qualifiedAt: null, qualifiedBy: null });
  });
  it('records explicit qualification once under concurrent submissions, supports correction, and never moves stages', async () => {
    const responses = await Promise.all([request(app).post(path).send(qualify), request(app).post(path).send(qualify)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect((await fixture.pool.query('SELECT * FROM audit_logs')).rows).toHaveLength(1);
    expect((await fixture.pool.query('SELECT status_code FROM academy_leads WHERE id=1')).rows[0].status_code).toBe('intake');
    await fixture.pool.query("UPDATE audit_logs SET created_at='2025-08-12'");
    expect((await report(7, 1)).qualifiedLeads).toBe(1);
    expect((await request(app).delete(path).send({ funnelId: 1, qualifiedAt: (await request(app).get(path)).body.qualifiedAt })).body.qualifiedAt).toBeNull();
    expect((await report(7, 1)).qualifiedLeads).toBe(0);
    expect((await request(app).get(path)).body.qualifiedAt).toBeNull();
  });
  it('rejects qualification for archived leads', async () => {
    await fixture.pool.query('UPDATE academy_leads SET is_archived=true WHERE id=1');
    expect((await request(app).post(path).send(qualify)).status).toBe(409);
  });
});
