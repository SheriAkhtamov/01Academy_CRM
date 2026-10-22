import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rows } from "../server/modules/lms/infrastructure/postgres-base";
import { PostgresPortalResourceRepository } from "../server/modules/portal-resources/infrastructure/postgres-repository";
import { readPortalRevision } from "../server/infrastructure/portal-revision";
import type { PortalActorContext } from "../server/modules/portal-identity/domain/actor-context";

const fixture = vi.hoisted(() => ({ pool: null as unknown as Pool }));
vi.mock("../server/modules/academy/academy-core", () => ({
  query: (sql: string, params: unknown[]) => rows(fixture.pool, sql, params),
  queryOne: vi.fn(), SALES_MODULES: new Set(), ensureModuleAccess: vi.fn(),
  ensureLeadRowAccess: vi.fn(), ensureLeadMutationAccess: vi.fn(), parseId: vi.fn(),
}));
vi.mock("../server/modules/academy/academy-leads", () => ({ getLead: vi.fn() }));
import { loadStudentProfileData } from "../server/modules/academy/student-profile-data";
import { studentPaidAmountSelect, studentPaymentStatusSelect } from "../server/modules/academy/student-expected-payment";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `student_payment_sync_${randomBytes(6).toString("hex")}`;
let admin: Pool;
let repository: PostgresPortalResourceRepository;
const actor = (studentId: number): PortalActorContext => ({
  portalAccountId: studentId, studentId, linkId: studentId, sessionId: "test",
  kind: "self", studentClassification: "adult", permissions: ["finance.read"],
});
const revision = () => readPortalRevision(fixture.pool, [{ accountId: 1, studentIds: [1] }]);

describe.skipIf(!databaseUrl)("student finance consistency across CRM and the portal", () => {
  beforeAll(async () => {
    if (!databaseUrl || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl).hostname))
      throw new Error("Local isolated PostgreSQL required");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC` });
    repository = new PostgresPortalResourceRepository(fixture.pool);
    await fixture.pool.query(`
      CREATE TABLE academy_students(id integer PRIMARY KEY,lead_id integer,next_payment_at timestamptz,status text DEFAULT 'studying');
      CREATE TABLE academy_courses(id integer PRIMARY KEY,name text,lesson_count integer);
      CREATE TABLE academy_schools(id integer PRIMARY KEY,name text);
      CREATE TABLE academy_teachers(id integer PRIMARY KEY,full_name text,user_id integer);
      CREATE TABLE academy_groups(id integer PRIMARY KEY,name text,course_id integer,school_id integer,teacher_id integer,lesson_count integer,is_archived boolean DEFAULT false,status text DEFAULT 'open');
      CREATE TABLE academy_student_group_enrollments(id integer PRIMARY KEY,student_id integer,group_id integer,status text DEFAULT 'active',is_primary boolean DEFAULT true,enrolled_at timestamptz,ended_at timestamptz);
      CREATE TABLE academy_lessons(id integer PRIMARY KEY,group_id integer,topic text,scheduled_at timestamptz,status text);
      CREATE TABLE academy_attendance(id integer PRIMARY KEY,lesson_id integer,student_id integer,status text,note text);
      CREATE TABLE academy_student_status_history(id integer PRIMARY KEY,student_id integer,to_status text,created_at timestamptz);
      CREATE TABLE academy_portfolio_projects(id integer PRIMARY KEY,student_id integer,title text,url text,file_url text,created_at timestamptz);
      CREATE TABLE academy_payments(id integer PRIMARY KEY,student_id integer,lead_id integer,amount_uzs bigint,status text,type text,method text,period text,paid_at timestamptz,due_at timestamptz,paid_until timestamptz,created_at timestamptz DEFAULT now(),comment text);
      CREATE TABLE academy_payment_student_allocations(payment_id integer,student_id integer,amount_uzs bigint,PRIMARY KEY(payment_id,student_id));
      CREATE TABLE lms_learning_events(id integer,student_id integer);
      CREATE TABLE lms_resource_audit(id integer,student_id integer);
      CREATE TABLE portal_notifications(id integer,account_id integer);
      CREATE TABLE lms_files(id integer,owner_account_id integer,run_id integer,checked_at timestamptz);
      CREATE TABLE lms_group_runs(id integer PRIMARY KEY,group_id integer,status text);
    `);
  });
  beforeEach(async () => {
    const names = (await fixture.pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [schema])).rows
      .map((row) => `"${schema}"."${row.tablename}"`).join(",");
    await fixture.pool.query(`TRUNCATE ${names}`);
    await fixture.pool.query("INSERT INTO academy_students(id,lead_id) VALUES(1,10),(2,10),(3,20)");
  });
  afterAll(async () => {
    if (fixture.pool) await fixture.pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it("shows the same allocated, direct, overdue and refunded amounts in all student read models", async () => {
    await fixture.pool.query(`INSERT INTO academy_payments(id,student_id,lead_id,amount_uzs,status,due_at,paid_until) VALUES
      (1,NULL,10,100000,'paid',NULL,now()+interval '30 days'),
      (2,1,10,50000,'paid',NULL,now()+interval '30 days'),
      (3,2,10,30000,'pending',now()-interval '1 day',NULL),
      (4,2,10,10000,'refunded',NULL,NULL);
      INSERT INTO academy_payment_student_allocations VALUES(1,1,40000),(1,2,60000)`);
    for (const studentId of [1, 2, 3]) {
      const profile = await loadStudentProfileData(studentId);
      const portal = await repository.payments(actor(studentId));
      expect(portal.state).toBe("ready");
      expect(profile.summary).toMatchObject({ paid: portal.summary!.paidUzs, remaining: portal.summary!.dueUzs, refunded: portal.summary!.refundedUzs });
      const list = await fixture.pool.query(`SELECT ${studentPaidAmountSelect("student")} FROM academy_students student WHERE student.id=$1`, [studentId]);
      expect(list.rows[0].paid_amount_uzs).toBe(profile.summary.paid);
      expect(profile.payments.find((payment) => payment.id === 1)?.paidUntil).toBe(portal.items.find((payment) => payment.id === 1)?.paidUntil);
    }
    expect((await loadStudentProfileData(1)).summary.paid).toBe(90000);
    expect((await loadStudentProfileData(2)).summary).toMatchObject({ paid: 60000, remaining: 30000, refunded: 10000 });
    expect((await loadStudentProfileData(2)).payments.find((payment) => payment.id === 3)?.status).toBe("overdue");
  });
  it("replaces a direct attribution with allocations and follows subsequent redistribution", async () => {
    await fixture.pool.query(`INSERT INTO academy_payments(id,student_id,lead_id,amount_uzs,status) VALUES(1,1,10,100000,'paid');
      INSERT INTO academy_payment_student_allocations VALUES(1,1,40000),(1,2,60000)`);
    expect((await loadStudentProfileData(1)).summary.paid).toBe(40000);
    expect((await loadStudentProfileData(2)).summary.paid).toBe(60000);
    await fixture.pool.query("UPDATE academy_payment_student_allocations SET amount_uzs=100000-amount_uzs WHERE payment_id=1");
    expect((await loadStudentProfileData(1)).summary.paid).toBe(60000);
    expect((await repository.payments(actor(1))).summary!.paidUzs).toBe(60000);
    expect((await loadStudentProfileData(2)).summary.paid).toBe(40000);
    const list = await fixture.pool.query(`SELECT ${studentPaymentStatusSelect("student")} FROM academy_students student WHERE student.id=2`);
    expect(list.rows[0].payment_status).toBe('paid');
  });
  it("does not attribute an unallocated family payment to either child", async () => {
    await fixture.pool.query("INSERT INTO academy_payments(id,lead_id,amount_uzs,status) VALUES(1,10,100000,'paid')");
    for (const studentId of [1, 2]) {
      expect((await loadStudentProfileData(studentId)).payments).toEqual([]);
      expect(await repository.payments(actor(studentId))).toMatchObject({ state: "needs_review", summary: null, items: [] });
    }
  });
  it("detects payments, confirmations, allocation changes and deletion made by another process", async () => {
    let previous = await revision();
    for (const sql of [
      "INSERT INTO academy_payments(id,student_id,lead_id,amount_uzs,status) VALUES(1,1,10,100000,'pending')",
      "UPDATE academy_payments SET status='paid',paid_at=now() WHERE id=1",
      "INSERT INTO academy_payment_student_allocations VALUES(1,1,40000),(1,2,60000)",
      "UPDATE academy_payment_student_allocations SET amount_uzs=100000-amount_uzs WHERE payment_id=1",
      "DELETE FROM academy_payment_student_allocations WHERE payment_id=1",
      "DELETE FROM academy_payments WHERE id=1",
    ]) {
      await fixture.pool.query(sql);
      const current = await revision();
      expect(current).not.toBe(previous);
      expect(await revision()).toBe(current);
      previous = current;
    }
    await fixture.pool.query("INSERT INTO academy_payments(id,student_id,lead_id,amount_uzs,status) VALUES(2,3,20,100000,'paid')");
    expect(await revision()).toBe(previous);
  });
  it("detects status, timetable, archive and attendance changes made outside the learner API", async () => {
    await fixture.pool.query(`INSERT INTO academy_groups(id) VALUES(1);
      INSERT INTO academy_student_group_enrollments(id,student_id,group_id,enrolled_at) VALUES(1,1,1,now()-interval '1 day');
      INSERT INTO lms_group_runs(id,group_id,status) VALUES(1,1,'active')`);
    let previous = await revision();
    for (const sql of [
      "UPDATE academy_students SET status='paused' WHERE id=1",
      "INSERT INTO academy_lessons(id,group_id,topic,scheduled_at,status) VALUES(1,1,'Lesson',now(),'scheduled')",
      "UPDATE academy_lessons SET scheduled_at=scheduled_at+interval '1 day' WHERE id=1",
      "UPDATE academy_groups SET is_archived=true WHERE id=1",
      "INSERT INTO academy_attendance(id,lesson_id,student_id,status) VALUES(1,1,1,'present')",
      "UPDATE lms_group_runs SET status='completed' WHERE id=1",
    ]) {
      await fixture.pool.query(sql);
      const current = await revision();
      expect(current).not.toBe(previous);
      previous = current;
    }
  });
  it("counts historical marks during a pause in both attendance and course progress", async () => {
    await fixture.pool.query(`INSERT INTO academy_courses(id,name,lesson_count) VALUES(1,'Course',10);
      INSERT INTO academy_groups(id,name,course_id,lesson_count) VALUES(1,'Group',1,10);
      INSERT INTO academy_student_group_enrollments(id,student_id,group_id,enrolled_at) VALUES(1,1,1,now()-interval '30 days');
      INSERT INTO academy_student_status_history(id,student_id,to_status,created_at) VALUES(1,1,'paused',now()-interval '2 days');
      UPDATE academy_students SET status='paused' WHERE id=1;
      INSERT INTO academy_lessons(id,group_id,topic,scheduled_at,status) VALUES(1,1,'Actually attended',now()-interval '1 day','conducted');
      INSERT INTO academy_attendance(id,lesson_id,student_id,status) VALUES(1,1,1,'present')`);
    const profile=await loadStudentProfileData(1);
    expect(profile.attendance).toHaveLength(1);
    expect(profile.summary.attended).toBe(1);
    expect(profile.groups[0].attendedLessons).toBe(1);
    expect(profile.summary.completedLessons).toBe(1);
  });
});
