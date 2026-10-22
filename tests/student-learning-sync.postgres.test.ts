import express from 'express';
import crypto from 'node:crypto';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const mocks = vi.hoisted(() => ({
  actor: { id: 1, module: 'administration', modules: ['administration'] } as any,
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
  createAuditLog: vi.fn(),
  createNotification: vi.fn(),
  runAutomations: vi.fn(),
  getWorkforcePolicy: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.connect,
  },
}));
vi.mock('../server/infrastructure/sales-kpi/sales-workflow-context', () => ({
  attachSalesWorkflow: async (actor: object) => ({
    ...actor,
    ...(mocks.actor.salesWorkflow ? { salesWorkflow: mocks.actor.salesWorkflow } : {}),
  }),
}));

vi.mock('../server/middleware/auth.middleware', () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.user = mocks.actor;
    next();
  },
}));

vi.mock('../server/storage', () => ({
  storage: {
    createAuditLog: mocks.createAuditLog,
    createNotification: mocks.createNotification,
  },
}));

vi.mock('../server/config', () => ({
  appConfig: {
    server: { appUrl: 'https://crm.test', environment: 'test' },
    session: { secret: 'website-token-test-session-secret' },
    integrations: {
      website: {
        webhookSecret: 'website-secret',
        allowedFormOrigins: ['https://01academy.pro', 'https://www.01academy.uz'],
        apiTokens: {
          '01academy.pro': { hash: '05f83beb894a79d6442dd4123f59fdeda75ce4e797c4754502ac44e0cdde2c7c', createdAt: '2026-09-23T00:00:00.000Z' },
          '01academy.uz': { hash: '15d86a1afbe54def91f3413be91921ebf3f7907b2dd83631bed6aa97c331501e', createdAt: '2026-09-23T00:00:00.000Z' },
        },
      },
      telegramTasks: {
        botToken: '12345:test-only-token-that-is-long-enough',
        webhookSecret: 'test-webhook-secret-that-is-long-enough',
        botUsername: 'ZeroOneAcademy_Taskbot',
      },
      metaAds: {
        marketingAccessToken: 'marketing-token',
        capiAccessToken: 'capi-token',
        leadAccessToken: 'lead-token',
        webhookAppSecret: 'app-secret',
        leadWebhookVerifyToken: 'verify-token',
        adAccountId: '123',
        datasetId: '456',
        pageId: '789',
      },
    },
  },
  validateConfig: vi.fn(),
}));
vi.mock('../server/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../server/services/workforce-policy', () => ({
  getWorkforcePolicy: mocks.getWorkforcePolicy,
  maskPhone: (value: string) => value,
}));
vi.mock('../server/services/automations', () => ({
  runAutomations: mocks.runAutomations,
}));


const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `student_learning_sync_${crypto.randomBytes(6).toString("hex")}`;
let admin: Pool;
let pool: Pool;
const createApp = async () => {
  const { registerAcademyLearningRoutes } = await import("../server/modules/academy/learning.router");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = mocks.actor; next(); });
  const router = express.Router();
  registerAcademyLearningRoutes(router);
  app.use("/api/academy", router);
  return app;
};
const mark = async (lessonId: number, status = "present") => request(await createApp())
  .post(`/api/academy/lessons/${lessonId}/attendance`)
  .send({ lessonStatus: "conducted", attendance: [{ studentId: 5, status }] });

describe.skipIf(!databaseUrl)("student learning synchronization across CRM groups", () => {
  beforeAll(async () => {
    if (!databaseUrl || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl).hostname))
      throw new Error("Local isolated PostgreSQL required");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC` });
    mocks.poolQuery.mockImplementation((sql, values) => pool.query(sql, values));
    mocks.connect.mockImplementation(() => pool.connect());
    mocks.createAuditLog.mockResolvedValue(undefined);
    mocks.createNotification.mockResolvedValue(undefined);
    mocks.runAutomations.mockResolvedValue([]);
    mocks.getWorkforcePolicy.mockResolvedValue({ salesPhoneVisibility: "own_leads" });
    await pool.query(`
      CREATE TABLE users(id integer PRIMARY KEY,module text,is_active boolean,is_archived boolean);
      CREATE TABLE user_modules(user_id integer,module text);
      CREATE TABLE academy_leads(id integer PRIMARY KEY,comment text);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,action text,entity_type text,entity_id integer,old_values jsonb,new_values jsonb);
      CREATE TABLE academy_lesson_status_history(id serial PRIMARY KEY,lesson_id integer,from_status text,to_status text,changed_by integer);
      CREATE TABLE academy_students(id integer PRIMARY KEY,lead_id integer,group_id integer,manager_id integer,status text,student_name text,contact_name text,enrolled_at timestamptz,created_at timestamptz,updated_at timestamptz DEFAULT now(),attendance_percent integer,progress_percent integer,risk_flags jsonb);
      CREATE TABLE academy_courses(id integer PRIMARY KEY,lesson_count integer);
      CREATE TABLE academy_groups(id integer PRIMARY KEY,course_id integer,teacher_id integer,lesson_count integer,is_archived boolean DEFAULT false,name text DEFAULT 'Group');
      CREATE TABLE academy_teachers(id integer PRIMARY KEY,user_id integer,status text);
      CREATE TABLE academy_lessons(id integer PRIMARY KEY,group_id integer,teacher_id integer,lesson_number integer DEFAULT 1,status text,scheduled_at timestamptz,duration_minutes integer,updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_attendance(id serial PRIMARY KEY,lesson_id integer,student_id integer,status text,project_url text,note text,marked_by integer,updated_at timestamptz DEFAULT now(),UNIQUE(lesson_id,student_id));
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer,group_id integer,status text,enrolled_at timestamptz,ended_at timestamptz);
      CREATE TABLE academy_student_transfers(id serial PRIMARY KEY,student_id integer,from_group_id integer,to_group_id integer,created_at timestamptz);
      CREATE TABLE academy_student_status_history(id serial PRIMARY KEY,student_id integer,to_status text,created_at timestamptz);
      CREATE TABLE academy_tasks(id serial PRIMARY KEY,title text,description text,responsible_id integer,deadline_at timestamptz,entity_type text,entity_id integer,status text,completed_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    `);
  });
  beforeEach(async () => {
    mocks.createNotification.mockClear();
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [schema])).rows
      .map(row => `"${schema}"."${row.tablename}"`).join(",");
    await pool.query(`TRUNCATE ${tables} RESTART IDENTITY`);
    await pool.query(`
      INSERT INTO users VALUES(1,'administration',true,false),(2,'sales',false,false);
      INSERT INTO academy_students(id,group_id,manager_id,status,student_name,enrolled_at,created_at) VALUES(5,20,1,'studying','Learner',now()-interval '30 days',now()-interval '30 days');
      INSERT INTO academy_courses(id,lesson_count) VALUES(1,10);
      INSERT INTO academy_groups(id,course_id,teacher_id,lesson_count) VALUES(20,1,1,10),(30,1,2,10);
      INSERT INTO academy_student_group_enrollments(student_id,group_id,status,enrolled_at) VALUES(5,20,'active',now()-interval '30 days'),(5,30,'active',now()-interval '30 days');
      INSERT INTO academy_lessons(id,group_id,status,scheduled_at,duration_minutes) VALUES(21,20,'conducted',now()-interval '4 days',60),(22,20,'conducted',now()-interval '3 days',60),(23,20,'conducted',now()-interval '2 days',60),(10,30,'conducted',now()-interval '2 hours',60);
      INSERT INTO academy_attendance(lesson_id,student_id,status) VALUES(21,5,'absent'),(22,5,'absent'),(23,5,'absent');
      INSERT INTO academy_tasks(id,title,entity_type,entity_id,status) VALUES(70,'3 пропуска подряд: позвонить родителю','student',5,'new');
    `);
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  it("keeps the absence task open after attendance in another group and closes it after the actual streak is corrected", async () => {
    expect((await mark(10)).status).toBe(200);
    expect((await pool.query("SELECT status FROM academy_tasks WHERE id=70")).rows[0].status).toBe("new");
    expect((await mark(23)).status).toBe(200);
    expect((await pool.query("SELECT status FROM academy_tasks WHERE id=70")).rows[0].status).toBe("done");
  });
  it("creates one task for a secondary group's streak and preserves it through unrelated attendance", async () => {
    await pool.query(`DELETE FROM academy_tasks;
      UPDATE academy_attendance SET status='present';
      INSERT INTO academy_lessons(id,group_id,status,scheduled_at,duration_minutes) VALUES(31,30,'conducted',now()-interval '3 days',60),(32,30,'conducted',now()-interval '2 days',60);
      INSERT INTO academy_attendance(lesson_id,student_id,status) VALUES(31,5,'absent'),(32,5,'absent')`);
    expect((await mark(10, "absent")).status).toBe(200);
    expect((await mark(10, "absent")).status).toBe(200);
    expect((await mark(23)).status).toBe(200);
    expect((await pool.query("SELECT status,responsible_id FROM academy_tasks")).rows).toEqual([{ status: "new", responsible_id: 1 }]);
    expect(mocks.createNotification).toHaveBeenCalledOnce();
  });
  it("does not repeat a completed parent call after attendance in an unrelated group", async () => {
    await pool.query("UPDATE academy_tasks SET status='done' WHERE id=70");
    expect((await mark(10)).status).toBe(200);
    expect((await pool.query("SELECT id,status FROM academy_tasks ORDER BY id")).rows).toEqual([{ id: 70, status: "done" }]);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });
  it.each([19,23])("does not repeat a completed call after editing older or unchanged attendance (%s)", async lessonId => {
    await pool.query("UPDATE academy_tasks SET status='done',completed_at=now() WHERE id=70; INSERT INTO academy_lessons(id,group_id,status,scheduled_at,duration_minutes) VALUES(19,20,'conducted',now()-interval '10 days',60)");
    expect((await mark(lessonId, lessonId === 23 ? 'absent' : 'present')).status).toBe(200);
    expect((await pool.query("SELECT status FROM academy_tasks")).rows).toEqual([{status:'done'}]);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });
  it("creates one new call for a new absence after the previous call was completed", async () => {
    await pool.query("UPDATE academy_tasks SET status='done',completed_at=now() WHERE id=70; INSERT INTO academy_lessons(id,group_id,status,scheduled_at,duration_minutes) VALUES(24,20,'conducted',now()-interval '1 hour',60)");
    expect((await mark(24, 'absent')).status).toBe(200);
    expect((await mark(24, 'absent')).status).toBe(200);
    expect((await pool.query("SELECT status FROM academy_tasks ORDER BY id")).rows).toEqual([{status:'new'},{status:'done'}]);
    expect(mocks.createNotification).toHaveBeenCalledOnce();
  });
  it("synchronizes creation and closure of absence calls through the public journal", async () => {
    await pool.query("DELETE FROM academy_tasks; DELETE FROM academy_attendance WHERE lesson_id=23");
    const { publicAttendanceService } = await import('../server/services/public-attendance');
    await publicAttendanceService.mark(23,[20],{studentId:5,status:'absent',expectedRevision:null});
    expect((await pool.query('SELECT status FROM academy_tasks')).rows).toEqual([{status:'new'}]);
    const revision = (await pool.query("SELECT updated_at::text AS revision FROM academy_attendance WHERE lesson_id=23 AND student_id=5")).rows[0].revision;
    await publicAttendanceService.mark(23,[20],{studentId:5,status:'present',expectedRevision:revision});
    expect((await pool.query('SELECT status FROM academy_tasks')).rows).toEqual([{status:'done'}]);
    expect(mocks.createNotification).toHaveBeenCalledOnce();
  });
  it("creates one absence call from bulk marking and does not repeat it on a bulk retry", async () => {
    await pool.query("DELETE FROM academy_tasks; DELETE FROM academy_attendance WHERE lesson_id=23");
    const { publicAttendanceService } = await import('../server/services/public-attendance');
    await publicAttendanceService.markMany(23,[20],{studentIds:[5],status:'absent'});
    expect((await pool.query('SELECT status FROM academy_tasks')).rows).toEqual([{status:'new'}]);
    await pool.query("UPDATE academy_tasks SET status='done',completed_at=now()");
    await publicAttendanceService.markMany(23,[20],{studentIds:[5],status:'absent'});
    expect((await pool.query('SELECT status FROM academy_tasks')).rows).toEqual([{status:'done'}]);
    expect(mocks.createNotification).toHaveBeenCalledOnce();
  });
  it("reconciles absences in previously filled lessons when public marking completes them in order", async () => {
    await pool.query("DELETE FROM academy_tasks; DELETE FROM academy_attendance WHERE lesson_id=21; UPDATE academy_lessons SET status='scheduled' WHERE group_id=20");
    const { publicAttendanceService } = await import('../server/services/public-attendance');
    await publicAttendanceService.mark(21,[20],{studentId:5,status:'absent',expectedRevision:null});
    expect((await pool.query("SELECT status FROM academy_lessons WHERE group_id=20")).rows.every(row => row.status==='conducted')).toBe(true);
    expect((await pool.query('SELECT status FROM academy_tasks')).rows).toEqual([{status:'new'}]);
    expect(mocks.createNotification).toHaveBeenCalledOnce();
  });
  it.each([null,2])("assigns public absence calls to active leadership when the manager is unavailable (%s)", async managerId => {
    await pool.query("DELETE FROM academy_tasks; DELETE FROM academy_attendance WHERE lesson_id=23");
    await pool.query("UPDATE academy_students SET manager_id=$1 WHERE id=5",[managerId]);
    const { publicAttendanceService } = await import('../server/services/public-attendance');
    await publicAttendanceService.mark(23,[20],{studentId:5,status:'absent',expectedRevision:null});
    expect((await pool.query('SELECT responsible_id FROM academy_tasks')).rows).toEqual([{responsible_id:1}]);
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({userId:1}));
  });
  it("retains real historical marks in public reports without adding paused unmarked students or foreign groups", async () => {
    await pool.query("INSERT INTO academy_students(id,group_id,status,student_name,enrolled_at,created_at) VALUES(6,20,'paused','Other pupil',now()-interval '30 days',now()-interval '30 days'); INSERT INTO academy_student_group_enrollments(student_id,group_id,status,enrolled_at) VALUES(6,20,'active',now()-interval '30 days'); INSERT INTO academy_student_status_history(student_id,to_status,created_at) VALUES(5,'paused',now()-interval '20 days'),(6,'paused',now()-interval '20 days'); UPDATE academy_students SET status='paused' WHERE id=5; INSERT INTO academy_attendance(lesson_id,student_id,status) VALUES(10,6,'present')");
    const { publicAttendanceService } = await import('../server/services/public-attendance');
    const report = await publicAttendanceService.report([20],{});
    expect(report.totals).toMatchObject({studentCount:1,present:0,absent:3,unmarked:0});
    expect(report.groups[0].students).toEqual([{id:5,name:'Learner',organization:null,present:0,absent:3,unmarked:0}]);
  });
  it("uses each group's own marks in rosters and every active group in risk calculations", async () => {
    await pool.query(`UPDATE academy_attendance SET status='present';
      INSERT INTO academy_lessons(id,group_id,status,scheduled_at,duration_minutes) VALUES(31,30,'conducted',now()-interval '4 days',60),(32,30,'conducted',now()-interval '3 days',60),(33,30,'conducted',now()-interval '2 days',60);
      INSERT INTO academy_attendance(lesson_id,student_id,status) VALUES(10,5,'absent'),(31,5,'absent'),(32,5,'absent'),(33,5,'absent')`);
    const { recalculateStudentMetrics } = await import("../server/modules/academy/academy-leads");
    const { getLessonRoster } = await import("../server/modules/academy/academy-route-support");
    const { loadStudentLearningMetrics } = await import("../server/modules/academy/student-learning-metrics");
    await recalculateStudentMetrics(5);
    const student = (await pool.query("SELECT attendance_percent,progress_percent,risk_flags FROM academy_students WHERE id=5")).rows[0];
    expect(student.attendance_percent).toBe(43);
    expect(student.progress_percent).toBe(15);
    expect(student.risk_flags).toContain("attendance_below_70");
    expect((await getLessonRoster(20, new Date()))[0].attendancePercent).toBe(100);
    expect((await getLessonRoster(30, new Date()))[0].attendancePercent).toBe(0);
    const teacher = (await loadStudentLearningMetrics([5], 2)).get(5)!;
    expect(teacher.attendancePercent).toBe(0);
    expect(teacher.groups.map(group => group.groupId)).toEqual([30]);
    expect(teacher.groups[0]).not.toHaveProperty("globalPresent");
  });
  it("clears obsolete stored metrics when no active enrollment remains", async () => {
    await pool.query("UPDATE academy_student_group_enrollments SET status='withdrawn',ended_at=now()");
    const { recalculateStudentMetrics } = await import("../server/modules/academy/academy-leads");
    await recalculateStudentMetrics(5);
    expect((await pool.query("SELECT progress_percent,risk_flags FROM academy_students WHERE id=5")).rows[0]).toEqual({ progress_percent: 0, risk_flags: [] });
  });
});
