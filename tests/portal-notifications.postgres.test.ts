import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PortalIdentityService } from "../server/modules/portal-identity/application/identity-service";
import { createPostgresPortalRepository } from "../server/modules/portal-identity/infrastructure/postgres-repository";
import { createPortalCrypto } from "../server/modules/portal-identity/infrastructure/crypto";
import {
  PortalNotificationWorker,
} from "../server/modules/portal-resources/infrastructure/notification-worker";
import type { PortalNotificationPreferencesDto } from "@shared/contracts/portal-resources";
import { isolatePortalWorkerFixture } from './portal-worker-fixture-pool';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `lms_notifications_it_${randomBytes(8).toString("hex")}`;
const DAY = 24 * 60 * 60 * 1000,
  HOUR = 60 * 60 * 1000;
const INITIAL = new Date("2026-10-12T05:00:00Z").getTime();
let admin: Pool,
  pool: Pool,
  identity: PortalIdentityService,
  now: number,
  allowedGroups: number[];
const preferences: PortalNotificationPreferencesDto = {
  categories: {
    learning: { inApp: true, },
    schedule: { inApp: true, },
    feedback: { inApp: true, },
    finance: { inApp: true, },
    family: { inApp: true, },
    security: { inApp: true, },
  },
  weeklySummary: false,
};
const worker = (
  overrides: Partial<
    ConstructorParameters<typeof PortalNotificationWorker>[0]
  > = {},
) =>
  new PortalNotificationWorker({
    pool,
    enabled: true,
    now: () => now,
    rolloutStartedAt: new Date(INITIAL - 7 * DAY),
    enabledForGroup: async (groupId) => allowedGroups.includes(groupId),
    authorizeLink: (accountId, linkId, permission) =>
      identity.resolveAccountActor(accountId, linkId, permission),
    staffCopy: (code, params) => ({
      title: code,
      message: String(params.title ?? ""),
    }),
    ...overrides,
  });
async function event(
  type: string,
  objectId: number,
  options: {
    studentId?: number;
    runId?: number;
    occurredAt?: number;
    data?: Record<string, unknown>;
    eventKey?: string;
  } = {},
) {
  return (
    await pool.query(
      "INSERT INTO lms_learning_events(student_id,run_id,type,object_id,event_key,data,occurred_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id",
      [
        options.studentId ?? 1,
        options.runId ?? 1,
        type,
        objectId,
        options.eventKey ?? randomUUID(),
        JSON.stringify(options.data ?? {}),
        new Date(options.occurredAt ?? now),
      ],
    )
  ).rows[0].id;
}
async function material(
  publishAt = now - 60_000,
  studentId = 1,
  runId = 1,
  enrollmentId = 1,
) {
  const record = (
    await pool.query(
      "INSERT INTO lms_materials(run_id,state,created_by) VALUES($1,'published',1) RETURNING id",
      [runId],
    )
  ).rows[0];
  const version = (
    await pool.query(
      "INSERT INTO lms_material_versions(material_id,version,title,body,category,created_by) VALUES($1,1,'Lesson material','Content','lesson',1) RETURNING id",
      [record.id],
    )
  ).rows[0];
  const publication = (
    await pool.query(
      "INSERT INTO lms_material_publications(material_id,material_version_id,enrollment_id,publish_at) VALUES($1,$2,$3,$4) RETURNING id",
      [record.id, version.id, enrollmentId, new Date(publishAt)],
    )
  ).rows[0];
  await event("material_published", Number(publication.id), {
    studentId,
    runId,
    eventKey: `material-published:${publication.id}`,
  });
  return Number(publication.id);
}
async function publishedReport() {
  return Number((await pool.query("INSERT INTO lms_reports(student_id,run_id,period_from,period_to,version,metrics,comment,next_steps,published_by,published_at) VALUES(1,1,$1,$2,1,'{}','Progress','Continue',1,$2) RETURNING id", [new Date(now-7*DAY),new Date(now)])).rows[0].id);
}
async function assignment(dueAt: number, opensAt = now - HOUR) {
  const record = (
    await pool.query(
      "INSERT INTO lms_assignments(run_id,created_by) VALUES(1,1) RETURNING id",
    )
  ).rows[0];
  const version = (
    await pool.query(
      "INSERT INTO lms_assignment_versions(assignment_id,version,title,body,required,allowed_answers,grading_mode) VALUES($1,1,'Practice','Answer',true,'[\"text\"]','acceptance') RETURNING id",
      [record.id],
    )
  ).rows[0];
  const recipient = (
    await pool.query(
      "INSERT INTO lms_assignment_recipients(assignment_id,assignment_version_id,enrollment_id,student_id,opens_at,due_at) VALUES($1,$2,1,1,$3,$4) RETURNING id",
      [record.id, version.id, new Date(opensAt), new Date(dueAt)],
    )
  ).rows[0];
  return { id: Number(recipient.id), versionId: Number(version.id) };
}
async function notifications(code: string) {
  return (
    await pool.query<{
      account_id: string;
      link_id: string | null;
      params: Record<string, unknown>;
      href: string | null;
    }>(
      "SELECT account_id,link_id,params,href FROM portal_notifications WHERE code=$1 ORDER BY account_id",
      [code],
    )
  ).rows;
}
async function putPreferences(
  accountId: number,
  values: PortalNotificationPreferencesDto = preferences,
) {
  await pool.query(
    "INSERT INTO portal_notification_preferences(account_id,categories,weekly_summary) VALUES($1,$2::jsonb,$3) ON CONFLICT(account_id) DO UPDATE SET categories=EXCLUDED.categories,weekly_summary=EXCLUDED.weekly_summary",
    [accountId, JSON.stringify(values.categories), values.weeklySummary],
  );
}

describe.skipIf(!databaseUrl)(
  "LMS notification worker isolated PostgreSQL delivery",
  () => {
    beforeAll(async () => {
      if (!databaseUrl) return;
      if (
        !["127.0.0.1", "localhost", "::1", "[::1]"].includes(
          new URL(databaseUrl).hostname,
        )
      )
        throw new Error(
          "Notification integration tests require local PostgreSQL",
        );
      admin = new Pool({ connectionString: databaseUrl });
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema} -c timezone=UTC`,
        max: 12,
      });
      isolatePortalWorkerFixture(pool, schema);
      await pool.query(`CREATE TABLE users(id serial PRIMARY KEY,full_name text NOT NULL,module text NOT NULL DEFAULT 'teacher',is_active boolean NOT NULL DEFAULT true,is_archived boolean NOT NULL DEFAULT false);
      CREATE TABLE user_modules(user_id integer REFERENCES users(id),module text NOT NULL);
      CREATE TABLE notifications(id serial PRIMARY KEY,user_id integer REFERENCES users(id),type text,title text,message text,related_entity_type text,related_entity_id integer,is_read boolean DEFAULT false,created_at timestamptz DEFAULT now());
      CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text NOT NULL,manager_id integer REFERENCES users(id));
      CREATE TABLE academy_courses(id serial PRIMARY KEY,name text NOT NULL);CREATE TABLE academy_teachers(id serial PRIMARY KEY,user_id integer REFERENCES users(id),full_name text,status text DEFAULT 'active');
      CREATE TABLE academy_groups(id serial PRIMARY KEY,name text NOT NULL,course_id integer REFERENCES academy_courses(id),teacher_id integer REFERENCES academy_teachers(id));
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer REFERENCES academy_students(id),group_id integer REFERENCES academy_groups(id),status text DEFAULT 'active',enrolled_at timestamptz,ended_at timestamptz);
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer REFERENCES academy_groups(id),topic text,scheduled_at timestamptz,status text,duration_minutes integer DEFAULT 120);
      CREATE TABLE academy_lesson_reschedules(id serial PRIMARY KEY,lesson_id integer REFERENCES academy_lessons(id),previous_scheduled_at timestamptz,next_scheduled_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE academy_lesson_status_history(id serial PRIMARY KEY,lesson_id integer REFERENCES academy_lessons(id),from_status text,to_status text,created_at timestamptz DEFAULT now());
      CREATE TABLE academy_attendance(id serial PRIMARY KEY,lesson_id integer REFERENCES academy_lessons(id),student_id integer REFERENCES academy_students(id),status text,updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_payments(id serial PRIMARY KEY,student_id integer REFERENCES academy_students(id),group_id integer REFERENCES academy_groups(id),amount_uzs integer NOT NULL,status text,due_at timestamptz);
      CREATE TABLE academy_portfolio_projects(id serial PRIMARY KEY,student_id integer REFERENCES academy_students(id),title text);`);
      for (const name of [
        "0134_portal_identity",
        "0135_lms_learning",
        "0136_portal_resources",
      ])
        await pool.query(
          readFileSync(
            new URL(`../migrations/${name}.sql`, import.meta.url),
            "utf8",
          ),
        );
      identity = new PortalIdentityService(
        createPostgresPortalRepository(pool),
        createPortalCrypto(randomBytes(32).toString("base64")),
        {
          appUrl: "https://academy.example",
          allowInvitations: true,
          now: () => now,
        },
      );
    });
    beforeEach(async () => {
      now = INITIAL;
      allowedGroups = [1];
      const tables = (
        await pool.query(
          "SELECT tablename FROM pg_tables WHERE schemaname=$1",
          [schema],
        )
      ).rows
        .map((row) => `"${schema}"."${row.tablename}"`)
        .join(",");
      await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
      await pool.query(`INSERT INTO users(full_name,module) VALUES('Teacher','teacher'),('Coordinator','administration'),('Other teacher','teacher');
      INSERT INTO academy_students(student_name,contact_name,manager_id) VALUES('Child','Child',2),('Other adult','Other adult',2);INSERT INTO academy_courses(name) VALUES('Course');INSERT INTO academy_teachers(user_id,full_name) VALUES(1,'Teacher'),(3,'Other teacher');INSERT INTO academy_groups(name,course_id,teacher_id) VALUES('Pilot group',1,1),('Other group',1,2);
      INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(1,1,'2026-09-01T00:00:00Z'),(2,2,'2026-09-01T00:00:00Z');
      INSERT INTO lms_course_versions(course_id,version,state,created_by) VALUES(1,1,'published',1);INSERT INTO lms_group_runs(group_id,course_version_id) VALUES(1,1),(2,1);
      INSERT INTO portal_accounts(login,full_name,email,email_verified_at,locale,status,password_hash) VALUES('child.login','Child','child@example.com','2026-10-01T00:00:00Z','en','active','hash'),('parent.login','Parent','parent@example.com','2026-10-01T00:00:00Z','ru','active','hash'),('other.parent','Other parent','other@example.com','2026-10-01T00:00:00Z','en','active','hash'),('other.student','Other student','student2@example.com','2026-10-01T00:00:00Z','en','active','hash');
      INSERT INTO portal_student_identity(student_id,classification,verified_at,verified_by,verification_method) VALUES(1,'minor','2026-10-01T00:00:00Z',2,'in_person'),(2,'adult','2026-10-01T00:00:00Z',2,'in_person');
      INSERT INTO portal_student_links(account_id,student_id,kind,relationship,permissions,status,verified_at,verified_by) VALUES(1,1,'self',NULL,'["learning.read","attendance.read","feedback.read","communication.create"]','active','2026-10-01T00:00:00Z',2),(2,1,'representative','parent','["learning.read","attendance.read","feedback.read","communication.create","finance.read"]','active','2026-10-01T00:00:00Z',2),(3,1,'representative','parent','["learning.read","attendance.read","feedback.read","communication.create"]','active','2026-10-01T00:00:00Z',2),(4,2,'self',NULL,'["learning.read","attendance.read","feedback.read","communication.create","finance.read"]','active','2026-10-01T00:00:00Z',2);`);
      for (const account of [1, 2, 3, 4]) await putPreferences(account);
    });
    afterAll(async () => {
      if (pool) await pool.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });
    it("does not queue reminders for assignments outside the enrollment period", async () => {
      await assignment(now + DAY, now - HOUR);
      await pool.query("UPDATE academy_student_group_enrollments SET status='withdrawn',ended_at=$1 WHERE id=1", [new Date(now - 2 * HOUR)]);
      await worker().runOnce();
      expect(await notifications("portalNoticeAssignmentDue")).toHaveLength(0);
      expect(await notifications("portalNoticeAssignmentAssigned")).toHaveLength(0);
    });
    it("cancels already queued reminders when a transfer makes a scheduled assignment unavailable", async () => {
      await assignment(now + 2 * DAY, now + HOUR);
      await worker().runOnce();
      const queued = await pool.query("SELECT id FROM lms_resource_outbox WHERE code='portalNoticeAssignmentDue' AND state='pending'");
      expect(queued.rows).toHaveLength(3);
      await pool.query("UPDATE academy_student_group_enrollments SET status='withdrawn',ended_at=$1 WHERE id=1", [new Date(now + HOUR / 2)]);
      now += DAY;
      await worker().runOnce();
      expect(await notifications("portalNoticeAssignmentDue")).toHaveLength(0);
      expect((await pool.query("SELECT state FROM lms_resource_outbox WHERE id=ANY($1::bigint[])", [queued.rows.map(row => row.id)])).rows.every(row => row.state === "cancelled")).toBe(true);
    });
    it("deduplicates scheduled publication and learning event sources across processes and repeated polls", async () => {
      await material();
      await Promise.all([worker().runOnce(), worker().runOnce()]);
      await worker().runOnce();
      expect(
        (await notifications("portalNoticeMaterialPublished")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([1, 2, 3]);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM notifications WHERE title='lmsNoticePublished'",
          )
        ).rows[0].count,
      ).toBe(1);
    });
    it("delivers a current private reply in one publishing pass despite a large irrelevant and imported event backlog", async () => {
      const thread = (await pool.query("INSERT INTO lms_threads(student_id,run_id,title,audience,author_account_id,status,assigned_user_id) VALUES(1,1,'Current private question','representative_teacher',2,'answered',1) RETURNING id")).rows[0];
      const comment = (await pool.query("INSERT INTO lms_comments(student_id,run_id,thread_id,staff_user_id,audience,body) VALUES(1,1,$1,1,'representative_teacher','Current answer') RETURNING id", [thread.id])).rows[0];
      await pool.query(`INSERT INTO lms_learning_events(student_id,run_id,type,object_id,event_key,data,occurred_at)
        SELECT 1,1,CASE WHEN number<=4500 THEN 'material_read' ELSE 'thread_answered' END,$1,'backlog:'||number,
          CASE WHEN number<=4500 THEN '{}'::jsonb ELSE '{"imported":true}'::jsonb END,$2
        FROM generate_series(1,9000) number`, [comment.id, new Date(now - 1000)]);
      const currentId = await event("thread_answered", Number(comment.id), { eventKey: "current-private-reply" });
      const startedAt = Date.now();
      const result = await worker({ }).runOnce();
      expect(Date.now() - startedAt).toBeLessThan(60_000);
      expect(result).toMatchObject({ delivered: 1, cancelled: 0 });
      const replies = await notifications("portalNoticeThreadAnswered");
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ account_id: "2", link_id: "2", href: `/parent-module/help?thread=${thread.id}&linkId=2` });
      expect((await pool.query("SELECT count(*)::int AS count FROM lms_notification_sources WHERE source_key=$1", [`learning:${currentId}`])).rows[0].count).toBe(1);
      await Promise.all([worker({ }).runOnce(), worker({ }).runOnce()]);
      expect(await notifications("portalNoticeThreadAnswered")).toHaveLength(1);
      expect((await pool.query("SELECT count(*)::int AS count FROM lms_learning_events WHERE event_key LIKE 'backlog:%'")).rows[0].count).toBe(9000);
    });
    it("uses current consent and never gives an adult representative unconsented learning data", async () => {
      await pool.query(
        "UPDATE portal_student_identity SET classification='adult' WHERE student_id=1",
      );
      await material();
      await worker().runOnce();
      expect(
        (await notifications("portalNoticeMaterialPublished")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([1]);
    });
    it("rechecks directly queued finance replies against their author, link and staff message", async () => {
      const question = (await pool.query("INSERT INTO portal_finance_questions(student_id,account_id,link_id,subject,request_key,request_hash,status) VALUES(1,2,2,'Payment question','request',repeat('a',64),'answered') RETURNING id")).rows[0];
      const reply = (await pool.query("INSERT INTO portal_finance_question_messages(question_id,user_id,body,request_key) VALUES($1,1,'Answer','reply') RETURNING id", [question.id])).rows[0];
      await pool.query(`INSERT INTO lms_resource_outbox(account_id,link_id,category,code,params,href,event_key,required_permission,channel,deliver_after) VALUES
        (2,2,'finance','portalNoticeThreadAnswered',$1::jsonb,'/learn/payments','valid-finance-reply','finance.read','in_app',$3),
        (2,2,'finance','portalNoticeThreadAnswered',$2::jsonb,'/learn/payments','wrong-question','finance.read','in_app',$3),
        (1,1,'finance','portalNoticeThreadAnswered',$1::jsonb,'/learn/payments','minor-without-school-finance','finance.read','in_app',$3)`,
        [JSON.stringify({ sourceType: "finance_question_answered", questionId: question.id, messageId: reply.id }), JSON.stringify({ sourceType: "finance_question_answered", questionId: 9999, messageId: reply.id }), new Date(now)]);
      const result = await worker({ }).runOnce();
      expect(result).toMatchObject({ delivered: 1, cancelled: 2 });
      expect((await notifications("portalNoticeThreadAnswered")).map((row) => Number(row.account_id))).toEqual([2]);
    });
    it("delivers parent private replies only to the author and hides staff private comments", async () => {
      const thread = (
        await pool.query(
          "INSERT INTO lms_threads(student_id,run_id,title,audience,author_account_id,status,assigned_user_id) VALUES(1,1,'Private question','representative_teacher',2,'answered',1) RETURNING id",
        )
      ).rows[0];
      const comment = (
        await pool.query(
          "INSERT INTO lms_comments(student_id,run_id,thread_id,staff_user_id,audience,body) VALUES(1,1,$1,1,'representative_teacher','Reply') RETURNING id",
          [thread.id],
        )
      ).rows[0];
      await event("thread_answered", Number(comment.id), {
        data: {
          threadId: Number(thread.id),
          accountId: 2,
          audience: "representative_teacher",
        },
      });
      const hidden = (
        await pool.query(
          "INSERT INTO lms_comments(student_id,run_id,thread_id,staff_user_id,audience,body) VALUES(1,1,$1,1,'staff','Private staff note') RETURNING id",
          [thread.id],
        )
      ).rows[0];
      await event("thread_answered", Number(hidden.id), {
        data: { threadId: Number(thread.id), accountId: 2, audience: "staff" },
      });
      await worker().runOnce();
      expect(
        (await notifications("portalNoticeThreadAnswered")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([2]);
      expect((await notifications("portalNoticeThreadAnswered"))[0].href)
        .toBe(`/parent-module/help?thread=${thread.id}&linkId=2`);
    });
    it("sends in-app immediately, defers ordinary email through quiet hours and rechecks revoked links", async () => {
      now = new Date("2026-10-12T18:00:00Z").getTime();
      await event("report_published", await publishedReport());
      await worker().runOnce();
      expect(await notifications("portalNoticeReportPublished")).toHaveLength(
        3,
      );
      await pool.query(
        "UPDATE portal_student_links SET status='revoked' WHERE id=2",
      );
      now = new Date("2026-10-13T03:00:00Z").getTime();
      await worker().runOnce();
    });
    it("cancels obsolete assignment reminders after a due date moves or a submission is accepted", async () => {
      now = new Date("2026-10-12T18:00:00Z").getTime();
      const recipient = await assignment(now + DAY);
      await worker().runOnce();
      expect(await notifications("portalNoticeAssignmentDue")).toHaveLength(3);
      await pool.query(
        "UPDATE lms_assignment_recipients SET due_at=$2,version=version+1 WHERE id=$1",
        [recipient.id, new Date(now + 3 * DAY)],
      );
      now = new Date("2026-10-13T03:00:00Z").getTime();
      await worker().runOnce();
      await pool.query(
        "UPDATE lms_assignment_recipients SET status='accepted' WHERE id=$1",
        [recipient.id],
      );
      now += 3 * DAY;
      await worker().runOnce();
    });
    it("limits financial reminders to confirmed financial access and cancels them after payment", async () => {
      now = new Date("2026-10-12T18:00:00Z").getTime();
      const payment = (
        await pool.query(
          "INSERT INTO academy_payments(student_id,group_id,amount_uzs,status,due_at) VALUES(1,1,500000,'pending',$1) RETURNING id",
          [new Date(now + 3 * DAY)],
        )
      ).rows[0];
      await worker().runOnce();
      expect(
        (await notifications("portalNoticePaymentDue")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([2]);
      await pool.query(
        "UPDATE academy_payments SET status='paid' WHERE id=$1",
        [payment.id],
      );
      now = new Date("2026-10-13T03:00:00Z").getTime();
      await worker().runOnce();
    });
    it("excludes old imports and disabled pilot groups", async () => {
      await event("report_published", 1, { occurredAt: INITIAL - 10 * DAY });
      await material(now - 60_000, 2, 2, 2);
      await worker().runOnce();
      expect(await notifications("portalNoticeReportPublished")).toHaveLength(
        0,
      );
      expect(await notifications("portalNoticeMaterialPublished")).toHaveLength(
        0,
      );
    });
    it("sends urgent changes to an imminent lesson during quiet hours and includes attendance-only parents", async () => {
      now = new Date("2026-10-12T18:00:00Z").getTime();
      await pool.query(
        "UPDATE portal_student_links SET permissions='[\"attendance.read\"]' WHERE id=2",
      );
      const lesson = (
        await pool.query(
          "INSERT INTO academy_lessons(group_id,topic,scheduled_at,status) VALUES(1,'Drawing',$1,'scheduled') RETURNING id",
          [new Date(now + 2 * HOUR)],
        )
      ).rows[0];
      await pool.query(
        "INSERT INTO academy_lesson_reschedules(lesson_id,previous_scheduled_at,next_scheduled_at,created_at) VALUES($1,$2,$3,$4)",
        [
          lesson.id,
          new Date(now + HOUR),
          new Date(now + 2 * HOUR),
          new Date(now),
        ],
      );
      await worker().runOnce();
      expect(
        (await notifications("portalNoticeLessonRescheduled")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([1, 2, 3]);
    });
    it("notifies a new absence once and prevents corrected attendance from sending a queued email", async () => {
      now = new Date("2026-10-12T18:00:00Z").getTime();
      const lesson = (
        await pool.query(
          "INSERT INTO academy_lessons(group_id,topic,scheduled_at,status) VALUES(1,'Drawing',$1,'conducted') RETURNING id",
          [new Date(now - HOUR)],
        )
      ).rows[0];
      await pool.query(
        "INSERT INTO academy_attendance(lesson_id,student_id,status,updated_at) VALUES($1,1,'absent',$2)",
        [lesson.id, new Date(now)],
      );
      await worker().runOnce();
      await worker().runOnce();
      expect(await notifications("portalNoticeAttendanceAbsent")).toHaveLength(
        3,
      );
      await pool.query(
        "UPDATE academy_attendance SET status='present',updated_at=$2 WHERE lesson_id=$1",
        [lesson.id, new Date(now + MINUTE)],
      );
      now = new Date("2026-10-13T03:00:00Z").getTime();
      await worker().runOnce();
    });
    it("offers opt-in weekly family summaries while keeping another parent out of the recipient list", async () => {
      await putPreferences(2, { ...preferences, weeklySummary: true });
      await event("report_published", 1);
      await pool.query(
        "INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(1,2,'2026-09-01T00:00:00Z')",
      );
      await event("report_published", 2, { runId: 2 });
      await worker().runOnce();
      expect(
        (await notifications("portalNoticeWeeklySummary")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([2]);
      expect(
        (await notifications("portalNoticeWeeklySummary"))[0].params,
      ).toMatchObject({ children: 1, updates: 1 });
      await worker().runOnce();
    });
    it("publishes assignment reviews, quiz results, reports, achievements, announcements and completion notices", async () => {
      const recipient = await assignment(now + DAY);
      await pool.query(
        "UPDATE portal_student_links SET permissions='[\"feedback.read\"]' WHERE id=2",
      );
      const submission = (
        await pool.query(
          "INSERT INTO lms_submissions(recipient_id,assignment_version_id,account_id,attempt_number,text,links,file_ids,idempotency_key,late) VALUES($1,$2,1,1,'Answer','[]','[]','first',false) RETURNING id",
          [recipient.id, recipient.versionId],
        )
      ).rows[0];
      const review = (
        await pool.query(
          "INSERT INTO lms_reviews(submission_id,decision,comment,reviewer_id) VALUES($1,'accepted','Good',1) RETURNING id",
          [submission.id],
        )
      ).rows[0];
      await event("assignment_accepted", Number(review.id), {
        data: { submissionId: Number(submission.id) },
      });
      await pool.query("UPDATE lms_assignment_recipients SET status='accepted' WHERE id=$1",[recipient.id]);
      await worker().runOnce();
      const revision = (
        await pool.query(
          "INSERT INTO lms_reviews(submission_id,decision,comment,reviewer_id) VALUES($1,'revision_required','Revise',1) RETURNING id",
          [submission.id],
        )
      ).rows[0];
      await event("assignment_revision_required", Number(revision.id), {
        data: { submissionId: Number(submission.id) },
      });
      await pool.query("UPDATE lms_assignment_recipients SET status='revision_required' WHERE id=$1",[recipient.id]);
      const quiz = (
        await pool.query(
          "INSERT INTO lms_quizzes(run_id,created_by) VALUES(1,1) RETURNING id",
        )
      ).rows[0];
      const quizVersion = (
        await pool.query(
          "INSERT INTO lms_quiz_versions(quiz_id,version,title,required,questions,pass_percent,max_attempts,disclosure) VALUES($1,1,'Control',true,'[{\"id\":\"q1\"}]',60,2,'practice') RETURNING id",
          [quiz.id],
        )
      ).rows[0];
      const quizRecipient = (
        await pool.query(
          "INSERT INTO lms_quiz_recipients(quiz_id,quiz_version_id,enrollment_id,student_id,opens_at) VALUES($1,$2,1,1,$3) RETURNING id",
          [quiz.id, quizVersion.id, new Date(now - HOUR)],
        )
      ).rows[0];
      const attempt = (
        await pool.query(
          "INSERT INTO lms_quiz_attempts(recipient_id,quiz_version_id,account_id,attempt_number,state,questions) VALUES($1,$2,1,1,'finished','[]') RETURNING id",
          [quizRecipient.id, quizVersion.id],
        )
      ).rows[0];
      await event("quiz_finished", Number(attempt.id));
      const achievement = (
        await pool.query(
          "INSERT INTO lms_achievements(student_id,run_id,rule,event_key,title,reason,awarded_at) VALUES(1,1,'first-project',$1,'Project complete','Finished own work',$2) RETURNING id",
          [randomUUID(), new Date(now)],
        )
      ).rows[0];
      await event("achievement_awarded", Number(achievement.id));
      await worker().runOnce();
      await pool.query("UPDATE lms_achievements SET revoked_at=$2 WHERE id=$1",[achievement.id,new Date(now)]);
      await event("achievement_revoked", Number(achievement.id));
      const report = (
        await pool.query(
          "INSERT INTO lms_reports(student_id,run_id,period_from,period_to,version,metrics,comment,next_steps,published_by,published_at) VALUES(1,1,$1,$2,1,'{}','Progress','Continue',1,$2) RETURNING id",
          [new Date(now - 7 * DAY), new Date(now)],
        )
      ).rows[0];
      await event("report_published", Number(report.id));
      const completion = (
        await pool.query(
          "INSERT INTO lms_course_completions(student_id,run_id,completed_by,completed_at) VALUES(1,1,1,$1) RETURNING id",
          [new Date(now)],
        )
      ).rows[0];
      await event("course_completed", Number(completion.id));
      await worker().runOnce();
      await pool.query("UPDATE lms_course_completions SET reopened_at=$2 WHERE id=$1",[completion.id,new Date(now)]);
      await event("course_reopened", Number(completion.id));
      await pool.query(
        "INSERT INTO lms_announcements(run_id,title,body,audience,publish_at,created_by) VALUES(1,'Event','Details','representatives',$1,1)",
        [new Date(now - MINUTE)],
      );
      await worker().runOnce();
      for (const notificationCode of [
        "portalNoticeAssignmentAccepted",
        "portalNoticeAssignmentRevision",
        "portalNoticeQuizFinished",
        "portalNoticeReportPublished",
        "portalNoticeAchievementAwarded",
        "portalNoticeAchievementRevoked",
        "portalNoticeCourseCompleted",
        "portalNoticeCourseReopened",
      ])
        expect(await notifications(notificationCode)).toHaveLength(3);
      expect(
        (await notifications("portalNoticeQuizPublished")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([1, 3]);
      expect(
        (await notifications("portalNoticeAnnouncement")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([3]);
      expect(
        (
          await pool.query(
            "SELECT href FROM portal_notifications WHERE account_id=2 AND code='portalNoticeAssignmentAccepted'",
          )
        ).rows[0].href,
      ).toBe(`/parent-module/feedback?review=${review.id}&linkId=2`);
    });
    it("sends overdue notices once, cancels cancelled lesson notices correctly and bypasses quiet hours for account security", async () => {
      const recipient = await assignment(now - 25 * HOUR, now - 26 * HOUR);
      await pool.query(
        "INSERT INTO academy_payments(student_id,group_id,amount_uzs,status,due_at) VALUES(1,1,500000,'overdue',$1)",
        [new Date(now - 25 * HOUR)],
      );
      const lesson = (
        await pool.query(
          "INSERT INTO academy_lessons(group_id,topic,scheduled_at,status) VALUES(1,'Cancelled class',$1,'cancelled') RETURNING id",
          [new Date(now + HOUR)],
        )
      ).rows[0];
      await pool.query(
        "INSERT INTO academy_lesson_status_history(lesson_id,from_status,to_status,created_at) VALUES($1,'scheduled','cancelled',$2)",
        [lesson.id, new Date(now)],
      );
      await worker().runOnce();
      await worker().runOnce();
      expect(await notifications("portalNoticeAssignmentOverdue")).toHaveLength(
        3,
      );
      expect(
        (await notifications("portalNoticePaymentOverdue")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([2]);
      expect(await notifications("portalNoticeLessonCancelled")).toHaveLength(
        3,
      );
      now = new Date("2026-10-12T18:00:00Z").getTime();
      await pool.query(
        "INSERT INTO portal_access_audit(actor_kind,account_id,action,details,created_at) VALUES('portal',2,'PASSWORD_CHANGED','{}',$1)",
        [new Date(now)],
      );
      await pool.query(
        "INSERT INTO portal_access_audit(actor_kind,staff_id,student_id,action,details,created_at) VALUES('staff',2,1,'ACCOUNT_SUSPENDED','{\"subjectAccountId\":2}',$1)",
        [new Date(now)],
      );
      await pool.query(
        "UPDATE portal_accounts SET status='suspended' WHERE id=2",
      );
      await worker().runOnce();
      expect(
        (await notifications("portalNoticePasswordChanged")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([2]);
      expect(
        (await notifications("portalNoticeAccessChanged")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([2]);
      expect(recipient.id).toBeGreaterThan(0);
    });
    it("targets private assignment feedback to one representative even when another has matching rights", async () => {
      const recipient = await assignment(now + DAY);
      const comment = (
        await pool.query(
          "INSERT INTO lms_comments(student_id,run_id,recipient_id,staff_user_id,audience,audience_account_id,body) VALUES(1,1,$1,1,'representative_teacher',2,'Private reply') RETURNING id",
          [recipient.id],
        )
      ).rows[0];
      await event("assignment_feedback", Number(comment.id), {
        data: {
          recipientId: recipient.id,
          audience: "representative_teacher",
          accountId: 2,
        },
      });
      await worker().runOnce();
      expect(
        (await notifications("portalNoticeFeedback")).map((row) =>
          Number(row.account_id),
        ),
      ).toEqual([2]);
    });
    it("rolls source work back when authorization storage fails and retries without losing the event", async () => {
      await material();
      const broken = worker({
        authorizeLink: async () => {
          throw new Error("temporary repository outage");
        },
      });
      await expect(broken.runOnce()).rejects.toThrow(
        "temporary repository outage",
      );
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM lms_notification_sources WHERE source_key='learning:1'",
          )
        ).rows[0].count,
      ).toBe(0);
      await worker().runOnce();
      expect(await notifications("portalNoticeMaterialPublished")).toHaveLength(
        3,
      );
    });
    it("sends review queues to the current teacher and escalates unanswered help after one working day", async () => {
      const recipient = await assignment(now + DAY);
      const submission = (
        await pool.query(
          "INSERT INTO lms_submissions(recipient_id,assignment_version_id,account_id,attempt_number,text,links,file_ids,idempotency_key,late) VALUES($1,$2,1,1,'Answer','[]','[]','unique',false) RETURNING id",
          [recipient.id, recipient.versionId],
        )
      ).rows[0];
      await event("assignment_submitted", Number(submission.id));
      const thread = (
        await pool.query(
          "INSERT INTO lms_threads(student_id,run_id,title,audience,author_account_id,assigned_user_id,created_at) VALUES(1,1,'Need help','student_teacher',1,1,'2026-10-09T05:00:00Z') RETURNING id",
        )
      ).rows[0];
      await event("help_requested", Number(thread.id));
      await pool.query("UPDATE academy_groups SET teacher_id=2 WHERE id=1");
      await worker().runOnce();
      expect(
        (
          await pool.query(
            "SELECT user_id FROM notifications WHERE title='lmsNoticeReviewQueue'",
          )
        ).rows.map((row) => row.user_id),
      ).toEqual([3]);
      expect(
        (
          await pool.query(
            "SELECT user_id FROM notifications WHERE title='lmsNoticeHelpEscalated'",
          )
        ).rows.map((row) => row.user_id),
      ).toEqual([2]);
      expect(
        (
          await pool.query(
            "SELECT assigned_user_id FROM lms_threads WHERE id=$1",
            [thread.id],
          )
        ).rows[0].assigned_user_id,
      ).toBe(3);
      await worker().runOnce();
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM notifications WHERE title='lmsNoticeHelpEscalated'",
          )
        ).rows[0].count,
      ).toBe(1);
    });
  },
);
const MINUTE = 60_000;
