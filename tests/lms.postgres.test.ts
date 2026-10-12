import { randomBytes } from "node:crypto";
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
import {
  lmsAssignmentSchema,
  lmsMaterialSchema,
  lmsQuizSchema,
  lmsThreadSchema,
  lmsReportSchema,
  lmsAnnouncementSchema,
} from "@shared/contracts/lms";
import type { PortalActorContext } from "../server/modules/portal-identity/domain/actor-context";
import { PgLearningRepository } from "../server/modules/lms/infrastructure/learning-repository";
import { PgAssignmentRepository } from "../server/modules/lms/infrastructure/assignment-repository";
import { PgQuizRepository } from "../server/modules/lms/infrastructure/quiz-repository";
import { PgEngagementRepository } from "../server/modules/lms/infrastructure/engagement-repository";
import { LmsService } from "../server/modules/lms/application/lms-service";
import { transaction } from "../server/modules/lms/infrastructure/postgres-base";
const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `lms_it_${randomBytes(8).toString("hex")}`;
let admin: Pool;
let pool: Pool;
let learning: PgLearningRepository;
let assignments: PgAssignmentRepository;
let quizzes: PgQuizRepository;
let engagement: PgEngagementRepository;
let service: LmsService;
const teacher = { userId: 1, modules: ["teacher"], isLeadership: false };
const otherTeacher = { userId: 2, modules: ["teacher"], isLeadership: false };
const actor: PortalActorContext = {
  portalAccountId: 1,
  studentId: 1,
  linkId: 1,
  sessionId: "one",
  kind: "self",
  studentClassification: "adult",
  permissions: [
    "learning.read",
    "attendance.read",
    "feedback.read",
    "assignments.submit",
    "quizzes.attempt",
    "communication.create",
  ],
};
const stranger: PortalActorContext = {
  ...actor,
  portalAccountId: 2,
  studentId: 2,
};
const representative: PortalActorContext = {
  ...actor,
  portalAccountId: 3,
  kind: "representative",
  permissions: [
    "learning.read",
    "attendance.read",
    "feedback.read",
    "communication.create",
  ],
};
let runId: number;
let quizNow: Date | null = null;
const open = () => new Date(Date.now() - 3600000).toISOString();
const future = () => new Date(Date.now() + 86400000).toISOString();
async function createAssignment() {
  await assignments.create(
    teacher,
    lmsAssignmentSchema.parse({
      runId,
      title: "Practice",
      body: "Answer",
      opensAt: open(),
      dueAt: new Date(Date.now() - 1800000).toISOString(),
      recipientEnrollmentIds: [1],
    }),
  );
  return (await assignments.list(actor)).items[0];
}
const quizInput = () =>
  lmsQuizSchema.parse({
    runId,
    title: "Control",
    opensAt: open(),
    closesAt: future(),
    disclosure: "closed",
    recipientEnrollmentIds: [1],
    timerSeconds: 30,
    questions: [
      {
        id: "q1",
        text: "Choose",
        type: "multiple",
        weight: 3,
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
          { id: "c", text: "C" },
        ],
        correctOptionIds: ["a", "c"],
        explanation: "Secret correct answer",
      },
    ],
  });
describe.skipIf(!databaseUrl)("LMS isolated PostgreSQL vertical slices", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    if (
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
        new URL(databaseUrl).hostname,
      )
    )
      throw new Error("LMS integration tests require local PostgreSQL");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema} -c timezone=UTC`,
      max: 10,
    });
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY,full_name text NOT NULL,module text NOT NULL DEFAULT 'teacher',is_active boolean NOT NULL DEFAULT true,is_archived boolean NOT NULL DEFAULT false);CREATE TABLE user_modules(id serial PRIMARY KEY,user_id integer,module text);
      CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text NOT NULL,manager_id integer);
      CREATE TABLE academy_courses(id serial PRIMARY KEY,name text NOT NULL,program jsonb NOT NULL DEFAULT '[]');
      CREATE TABLE academy_schools(id serial PRIMARY KEY,name text NOT NULL);
      CREATE TABLE academy_rooms(id serial PRIMARY KEY,name text NOT NULL);
      CREATE TABLE academy_teachers(id serial PRIMARY KEY,user_id integer,full_name text,status text NOT NULL DEFAULT 'active');
      CREATE TABLE academy_groups(id serial PRIMARY KEY,name text NOT NULL,course_id integer NOT NULL,teacher_id integer,school_id integer,room_id integer,status text NOT NULL DEFAULT 'open',end_date timestamptz,updated_at timestamptz DEFAULT now(),is_archived boolean NOT NULL DEFAULT false);
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer NOT NULL,group_id integer NOT NULL,status text NOT NULL DEFAULT 'active',enrolled_at timestamptz NOT NULL,ended_at timestamptz);
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer NOT NULL,lesson_number integer NOT NULL,topic text NOT NULL,materials text,scheduled_at timestamptz NOT NULL,duration_minutes integer NOT NULL DEFAULT 120,status text NOT NULL DEFAULT 'scheduled',teacher_id integer,school_id integer,room_id integer,updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_lesson_reschedules(id serial PRIMARY KEY,lesson_id integer,previous_scheduled_at timestamptz,new_scheduled_at timestamptz,changed_by integer,changed_at timestamptz DEFAULT now(),reason text);
      CREATE TABLE academy_attendance(id serial PRIMARY KEY,lesson_id integer NOT NULL,student_id integer NOT NULL,status text NOT NULL,UNIQUE(lesson_id,student_id));`);
    await pool.query(
      readFileSync(
        new URL("../migrations/0134_portal_identity.sql", import.meta.url),
        "utf8",
      ),
    );
    await pool.query(
      readFileSync(
        new URL("../migrations/0135_lms_learning.sql", import.meta.url),
        "utf8",
      ),
    );
    learning = new PgLearningRepository(pool, undefined, () => true);
    assignments = new PgAssignmentRepository(pool, learning);
    quizzes = new PgQuizRepository(pool, learning, () => quizNow ?? new Date());
    engagement = new PgEngagementRepository(pool, learning);
    service = new LmsService({ learning, assignments, quizzes, engagement });
  });
  beforeEach(async () => {
    quizNow = null;
    const names = (
      await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [
        schema,
      ])
    ).rows
      .map((row) => `"${schema}"."${row.tablename}"`)
      .join(",");
    await pool.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
    await pool.query(
      `INSERT INTO users(full_name) VALUES('Teacher'),('Other teacher'); INSERT INTO academy_students(student_name,contact_name) VALUES('Learner','Learner'),('Stranger','Stranger'); INSERT INTO academy_courses(name,program) VALUES('Course','[{"lessonNumber":1,"topic":"Topic"}]'); INSERT INTO academy_schools(name) VALUES('School'); INSERT INTO academy_rooms(name) VALUES('Room'); INSERT INTO academy_teachers(user_id,full_name) VALUES(1,'Teacher'),(2,'Other teacher'); INSERT INTO academy_groups(name,course_id,teacher_id,school_id,room_id) VALUES('Group',1,1,1,1),('Other group',1,2,1,1); INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(1,1,now()-interval '30 days'),(2,2,now()-interval '30 days'); INSERT INTO academy_lessons(group_id,lesson_number,topic,materials,scheduled_at,status,teacher_id,school_id,room_id) VALUES(1,1,'Topic','Staff internal note',now()-interval '1 day','conducted',1,1,1),(2,1,'Other topic',NULL,now()-interval '1 day','conducted',2,1,1); INSERT INTO portal_accounts(login,full_name,status,password_hash) VALUES('learner','Learner','active','hash'),('stranger','Stranger','active','hash'),('parent','Parent','active','hash'),('parent.two','Second parent','active','hash');`,
    );
    const run = (await learning.createRun(teacher, {
      groupId: 1,
      format: "offline",
      meetingUrl: null,
    })) as { id: number };
    runId = run.id;
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
  it("imports legacy lesson content as private draft and restricts teacher to assigned group", async () => {
    expect(await learning.materials(actor)).toEqual([]);
    expect(
      (await learning.managementMaterials(teacher, runId))[0],
    ).toMatchObject({ state: "draft", body: "Staff internal note" });
    await expect(
      learning.managementMaterials(otherTeacher, runId),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
    await expect(
      learning.createRun(teacher, {
        groupId: 2,
        format: "offline",
        meetingUrl: null,
      }),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
    expect(await learning.courses(stranger)).toEqual([]);
    await expect(learning.course(stranger, runId)).rejects.toMatchObject({
      code: "lmsNotFound",
    });
  });
  it("keeps administration metadata access without implicitly granting reviews or corrections", async () => {
    const administration = { userId: 1, modules: ["administration"], isLeadership: true };
    const finance = { userId: 2, modules: ["finance"], isLeadership: false };
    const recipient = await createAssignment();
    await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId, draftVersion: 0,
      text: "Review permission boundary", links: [], fileIds: [], idempotencyKey: "review-boundary-submit",
    });
    const detail = await assignments.detail(actor, recipient.id);
    const submissionId = detail.submissions[0].id;
    expect((await learning.managementGroups(administration)).find((group) => group.groupId === 1)?.permissions)
      .toEqual(expect.arrayContaining(["content.manage", "assignments.manage", "results.manage"]));
    expect((await learning.managementGroups(administration)).find((group) => group.groupId === 1)?.permissions)
      .not.toContain("reviews.manage");
    expect((await learning.managementMaterials(administration, runId)).length).toBeGreaterThan(0);
    expect((await learning.results(administration, runId))[0].assignmentResults).toHaveLength(1);
    for (const employee of [administration, finance]) {
      expect(await assignments.reviewQueue(employee, runId)).toEqual([]);
      expect(await assignments.reviewQueue(employee, undefined, { limit: 20 })).toEqual([]);
      await expect(assignments.reviewDetail(employee, submissionId)).rejects.toMatchObject({ code: "lmsNotFound" });
      await expect(assignments.startReview(employee, submissionId, detail.version)).rejects.toMatchObject({ code: "lmsNotFound" });
      await expect(assignments.review(employee, submissionId, {
        version: detail.version, decision: "accepted", comment: "Unauthorised", criterionScores: {},
      })).rejects.toMatchObject({ code: "lmsNotFound" });
    }
    expect((await learning.teacherSummary(administration)).pendingReviews).toBe(0);
    expect((await pool.query("SELECT status,version FROM lms_assignment_recipients WHERE id=$1", [recipient.id])).rows[0])
      .toEqual({ status: "submitted", version: detail.version });
    expect((await pool.query("SELECT review_started_by FROM lms_submissions WHERE id=$1", [submissionId])).rows[0].review_started_by).toBeNull();
    expect((await pool.query("SELECT count(*)::int count FROM lms_reviews")).rows[0].count).toBe(0);
    const started = await assignments.startReview(teacher, submissionId, detail.version);
    await assignments.review(teacher, submissionId, {
      version: started.version, decision: "accepted", comment: "Teacher accepted", criterionScores: {},
    });
    const accepted = await assignments.detail(actor, recipient.id);
    await expect(assignments.review(administration, submissionId, {
      version: accepted.version, decision: "revision_required", comment: "Unauthorised correction", reason: "Change decision", criterionScores: {},
    })).rejects.toMatchObject({ code: "lmsNotFound" });
    await expect(assignments.reopen(administration, recipient.id, {
      version: accepted.version, dueAt: future(), reason: "Unauthorised reopening",
    })).rejects.toMatchObject({ code: "lmsNotFound" });
    expect((await assignments.detail(actor, recipient.id)).status).toBe("accepted");
    expect((await pool.query("SELECT count(*)::int count FROM lms_reviews")).rows[0].count).toBe(1);
  });
  it.each([
    { userId: 1, modules: ["administration"], isLeadership: true },
    { userId: 2, modules: ["finance"], isLeadership: false },
  ])("honours and revokes an explicit review grant for $modules without relying on leadership", async (employee) => {
    const recipient = await createAssignment();
    await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId, draftVersion: 0,
      text: "Explicit review permission", links: [], fileIds: [], idempotencyKey: "explicit-review-submit",
    });
    const submissionId = (await assignments.detail(actor, recipient.id)).submissions[0].id;
    await pool.query("INSERT INTO lms_staff_permissions(user_id,permission) VALUES($1,'reviews.manage')", [employee.userId]);
    expect((await learning.managementGroups(employee)).find((group) => group.groupId === 1)?.permissions).toContain("reviews.manage");
    expect((await assignments.reviewQueue(employee, runId))[0].submissionId).toBe(submissionId);
    const detail = await assignments.reviewDetail(employee, submissionId);
    const started = await assignments.startReview(employee, submissionId, detail.version);
    await assignments.review(employee, submissionId, {
      version: started.version, decision: "accepted", comment: "Granted reviewer", criterionScores: {},
    });
    const accepted = await assignments.reviewDetail(employee, submissionId);
    await assignments.review(employee, submissionId, {
      version: accepted.version, decision: "accepted", comment: "Corrected feedback", reason: "Clarify assessment", criterionScores: {},
    });
    expect((await assignments.detail(actor, recipient.id)).submissions[0].reviewHistory).toHaveLength(2);
    const corrected = await assignments.detail(actor, recipient.id);
    await assignments.reopen(employee, recipient.id, { version: corrected.version, dueAt: future(), reason: "Agreed further practice" });
    await pool.query("DELETE FROM lms_staff_permissions WHERE user_id=$1 AND permission='reviews.manage'", [employee.userId]);
    await expect(assignments.reviewDetail(employee, submissionId)).rejects.toMatchObject({ code: "lmsNotFound" });
    expect((await learning.managementGroups(employee)).find((group) => group.groupId === 1)?.permissions ?? []).not.toContain("reviews.manage");
  });
  it("limits implicit review access to the assigned active teacher with the teacher module", async () => {
    const recipient = await createAssignment();
    await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId, draftVersion: 0,
      text: "Assigned teacher scope", links: [], fileIds: [], idempotencyKey: "assigned-review-submit",
    });
    const detail = await assignments.detail(actor, recipient.id);
    const submissionId = detail.submissions[0].id;
    expect((await assignments.reviewDetail(teacher, submissionId)).submissionId).toBe(submissionId);
    expect((await learning.managementGroups(teacher)).find((group) => group.groupId === 1)?.permissions).toContain("reviews.manage");
    await expect(assignments.reviewDetail(otherTeacher, submissionId)).rejects.toMatchObject({ code: "lmsNotFound" });
    await expect(assignments.startReview(otherTeacher, submissionId, detail.version)).rejects.toMatchObject({ code: "lmsNotFound" });
    await expect(assignments.review(otherTeacher, submissionId, { version: detail.version, decision: "accepted", comment: "Foreign", criterionScores: {} })).rejects.toMatchObject({ code: "lmsNotFound" });
    await pool.query("UPDATE academy_teachers SET status='inactive' WHERE user_id=1");
    expect(await assignments.reviewQueue(teacher, runId)).toEqual([]);
    expect((await learning.managementGroups(teacher)).some((group) => group.groupId === 1)).toBe(false);
    await expect(assignments.reviewDetail(teacher, submissionId)).rejects.toMatchObject({ code: "lmsNotFound" });
    await expect(assignments.startReview(teacher, submissionId, detail.version)).rejects.toMatchObject({ code: "lmsNotFound" });
    await expect(assignments.review(teacher, submissionId, { version: detail.version, decision: "accepted", comment: "Inactive", criterionScores: {} })).rejects.toMatchObject({ code: "lmsNotFound" });
    await pool.query("UPDATE academy_teachers SET status='active' WHERE user_id=1");
    const started = await assignments.startReview(teacher, submissionId, detail.version);
    await assignments.review(teacher, submissionId, { version: started.version, decision: "accepted", comment: "Assigned", criterionScores: {} });
    expect((await assignments.detail(actor, recipient.id)).status).toBe("accepted");
  });
  it("requires review permission when recipient updates reopen submission history and preserves assignment metadata actions", async () => {
    const administration = { userId: 1, modules: ["administration"], isLeadership: true };
    const recipient = await createAssignment();
    await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId, draftVersion: 0,
      text: "Reopening boundary", links: [], fileIds: [], idempotencyKey: "history-reopen-submit",
    });
    const submitted = await assignments.detail(actor, recipient.id);
    const eventCount = (await pool.query("SELECT count(*)::int count FROM lms_learning_events")).rows[0].count;
    const auditCount = (await pool.query("SELECT count(*)::int count FROM lms_learning_audit")).rows[0].count;
    await expect(assignments.updateRecipient(administration, recipient.id, { version: submitted.version, status: "assigned", reason: "Reset submitted work" })).rejects.toMatchObject({ code: "lmsNotFound" });
    expect((await assignments.detail(actor, recipient.id)).version).toBe(submitted.version);
    expect((await pool.query("SELECT count(*)::int count FROM lms_learning_events")).rows[0].count).toBe(eventCount);
    expect((await pool.query("SELECT count(*)::int count FROM lms_learning_audit")).rows[0].count).toBe(auditCount);
    await assignments.updateRecipient(administration, recipient.id, { version: submitted.version, dueAt: future(), reason: "Extend deadline" });
    const extended = await assignments.detail(actor, recipient.id);
    await assignments.updateRecipient(administration, recipient.id, { version: extended.version, status: "excused", reason: "Excuse assignment" });
    const excused = await assignments.detail(actor, recipient.id);
    await expect(assignments.updateRecipient(administration, recipient.id, { version: excused.version, status: "assigned", reason: "Reset historical work" })).rejects.toMatchObject({ code: "lmsNotFound" });
    await assignments.updateRecipient(administration, recipient.id, { version: excused.version, status: "cancelled", reason: "Cancel assignment" });
    const cancelled = await assignments.detail(actor, recipient.id);
    const updatesBeforeRetry = (await pool.query("SELECT count(*)::int count FROM lms_learning_audit WHERE entity_type='assignment_recipient' AND entity_id=$1 AND action='update'", [recipient.id])).rows[0].count;
    await pool.query("INSERT INTO lms_staff_permissions(user_id,permission) VALUES(1,'reviews.manage')");
    const attempts = await Promise.allSettled([
      assignments.updateRecipient(administration, recipient.id, { version: cancelled.version, status: "assigned", reason: "Granted reopening" }),
      assignments.updateRecipient(administration, recipient.id, { version: cancelled.version, status: "assigned", reason: "Granted reopening" }),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "lmsVersionConflict" } });
    const reopened = await assignments.detail(actor, recipient.id);
    expect(reopened).toMatchObject({ status: "assigned", version: cancelled.version + 1 });
    expect(reopened.submissions).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int count FROM lms_learning_audit WHERE entity_type='assignment_recipient' AND entity_id=$1 AND action='update'", [recipient.id])).rows[0].count).toBe(updatesBeforeRetry + 1);
    await pool.query("DELETE FROM lms_staff_permissions WHERE user_id=1 AND permission='reviews.manage'");
    await assignments.updateRecipient(teacher, recipient.id, { version: reopened.version, status: "excused", reason: "Teacher excuse" });
    const teacherExcused = await assignments.detail(actor, recipient.id);
    await assignments.updateRecipient(teacher, recipient.id, { version: teacherExcused.version, status: "assigned", reason: "Teacher reopening" });
    expect((await assignments.detail(actor, recipient.id)).status).toBe("assigned");
    const unopened = await createAssignment();
    await assignments.updateRecipient(administration, unopened.id, { version: unopened.version, status: "excused", reason: "No submission yet" });
    const unopenedExcused = await assignments.detail(actor, unopened.id);
    await assignments.updateRecipient(administration, unopened.id, { version: unopenedExcused.version, status: "assigned", reason: "Assign unopened work" });
    expect((await assignments.detail(actor, unopened.id)).status).toBe("assigned");
  });
  it("counts only actionable review/help jobs and unprepared lessons within the coming seven days", async () => {
    const recipient = await createAssignment();
    await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId,
      draftVersion: 0,
      text: "Needs review",
      links: [],
      fileIds: [],
      idempotencyKey: "summary-submission",
    });
    const pending = await assignments.detail(actor, recipient.id);
    await assignments.startReview(
      teacher,
      pending.submissions[0].id,
      pending.version,
    );
    expect((await assignments.reviewQueue(teacher, runId))[0]).toMatchObject({
      reviewStartedName: "Teacher",
      reviewStartedBy: 1,
    });
    await engagement.createThread(
      actor,
      lmsThreadSchema.parse({
        runId,
        title: "Help",
        body: "Question",
        audience: "student_teacher",
      }),
    );
    const { rows: lessons } = await pool.query(
      "INSERT INTO academy_lessons(group_id,lesson_number,topic,scheduled_at,status) VALUES(1,2,'Soon lesson',now()+interval '1 day','scheduled'),(1,3,'Far lesson',now()+interval '8 days','scheduled'),(1,4,'Canceled lesson',now()+interval '2 days','cancelled') RETURNING id",
    );
    const unit = (await learning.managementUnits(teacher, runId))[0];
    await learning.bindLesson(teacher, runId, lessons[0].id, {
      unitId: unit.id,
      format: null,
      meetingUrl: null,
    });
    const summary = await learning.teacherSummary(teacher);
    expect(summary).toMatchObject({
      pendingReviews: 1,
      openHelp: 1,
      unpreparedLessons: 1,
    });
    expect(summary.runs[0]).toMatchObject({
      runId,
      canManageSchedule: true,
      unpreparedLessons: [
        { lessonId: lessons[0].id, topic: "Soon lesson", unitId: unit.id },
      ],
    });
    await learning.createMaterial(
      teacher,
      lmsMaterialSchema.parse({
        runId,
        unitId: unit.id,
        title: "Prepared lesson",
        body: "Ready",
        publishAt: open(),
      }),
    );
    expect(await learning.teacherSummary(teacher)).toMatchObject({
      pendingReviews: 1,
      openHelp: 1,
      unpreparedLessons: 0,
    });
    expect(await learning.teacherSummary(otherTeacher)).toEqual({
      pendingReviews: 0,
      openHelp: 0,
      unpreparedLessons: 0,
      runs: [],
    });
  });
  it("reevaluates teacher handover, group feature flags, archival and active employment for homepage counters", async () => {
    await engagement.createThread(
      actor,
      lmsThreadSchema.parse({
        runId,
        title: "Open request",
        body: "Question",
        audience: "student_teacher",
      }),
    );
    expect((await learning.teacherSummary(teacher)).openHelp).toBe(1);
    await pool.query("UPDATE academy_groups SET teacher_id=2 WHERE id=1");
    expect((await learning.teacherSummary(teacher)).openHelp).toBe(0);
    expect((await learning.teacherSummary(otherTeacher)).openHelp).toBe(1);
    const disabled = new PgLearningRepository(pool, undefined, () => false);
    expect(await disabled.teacherSummary(otherTeacher)).toEqual({
      pendingReviews: 0,
      openHelp: 0,
      unpreparedLessons: 0,
      runs: [],
    });
    await pool.query("UPDATE academy_groups SET is_archived=true WHERE id=1");
    expect((await learning.teacherSummary(otherTeacher)).openHelp).toBe(0);
    await pool.query("UPDATE users SET is_active=false WHERE id=2");
    await expect(learning.teacherSummary(otherTeacher)).rejects.toMatchObject({
      code: "lmsNotFound",
    });
  });
  it("limits explicitly granted employee counters to their actual learning duties", async () => {
    await engagement.createThread(
      actor,
      lmsThreadSchema.parse({
        runId,
        title: "Open request",
        body: "Question",
        audience: "student_teacher",
      }),
    );
    await pool.query(
      "INSERT INTO lms_staff_permissions(user_id,permission) VALUES(2,'communication.manage')",
    );
    await pool.query(
      "INSERT INTO academy_lessons(group_id,lesson_number,topic,scheduled_at,status) VALUES(1,2,'Unprepared lesson',now()+interval '1 day','scheduled')",
    );
    const employee = { userId: 2, modules: ["sales"], isLeadership: false };
    expect(
      (await learning.managementGroups(employee)).every(
        (group) => group.permissions.join(",") === "communication.manage",
      ),
    ).toBe(true);
    expect(await learning.teacherSummary(employee)).toMatchObject({
      pendingReviews: 0,
      openHelp: 1,
      unpreparedLessons: 0,
      runs: [{ runId, canManageSchedule: false, unpreparedLessons: [] }],
    });
    await pool.query("DELETE FROM lms_staff_permissions WHERE user_id=2");
    expect((await learning.teacherSummary(employee)).runs).toEqual([]);
    expect(await learning.managementGroups(employee)).toEqual([]);
    await expect(
      learning.createRun(employee, {
        groupId: 2,
        format: "offline",
        meetingUrl: null,
      }),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
  });
  it("keeps publication versions immutable and preserves read state across corrections", async () => {
    const material = await learning.createMaterial(
      teacher,
      lmsMaterialSchema.parse({
        runId,
        title: "Public",
        body: "Safe text",
        publishAt: open(),
      }),
    );
    const first = (await learning.materials(actor))[0];
    await learning.readMaterial(actor, first.publicationId, true);
    await learning.reviseMaterial(
      teacher,
      material.id,
      lmsMaterialSchema.parse({
        runId,
        title: "Public corrected",
        body: "New safe text",
        publishAt: open(),
      }),
    );
    const visible = await learning.materials(actor);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ title: "Public corrected", read: true });
    expect(await learning.materials(stranger)).toEqual([]);
    await expect(
      pool.query("UPDATE lms_material_versions SET body=$2 WHERE id=$1", [
        first.materialVersionId,
        "Overwritten",
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await learning.archiveMaterial(teacher, material.id);
    expect(await learning.materials(actor)).toEqual([]);
  });
  it("keeps material enrollment start inclusive and end exclusive with publication revocation and unlimited historical access", async () => {
    const start = new Date(Date.now() - 2 * 86400000).toISOString();
    const end = new Date(Date.now() - 86400000).toISOString();
    const inside = new Date(+new Date(start) + 3600000).toISOString();
    for (const [title, publishAt] of [
      ["Before enrollment", new Date(+new Date(start) - 1).toISOString()],
      ["At enrollment start", start],
      ["Inside enrollment", inside],
      ["At enrollment end", end],
    ])
      await learning.createMaterial(
        teacher,
        lmsMaterialSchema.parse({ runId, title, body: title, publishAt }),
      );
    await pool.query(
      "UPDATE academy_student_group_enrollments SET enrolled_at=$1,ended_at=$2,status='completed' WHERE id=1",
      [start, end],
    );
    const visible = await learning.materials(actor, runId);
    expect(visible.map((material) => material.title)).toEqual([
      "At enrollment start",
      "Inside enrollment",
    ]);
    expect(await learning.materials(actor, runId + 1000)).toEqual([]);
    expect(await learning.materials(stranger, runId)).toEqual([]);
    await pool.query(
      "UPDATE lms_material_publications SET revoked_at=now() WHERE id=$1",
      [visible[1].publicationId],
    );
    expect((await learning.materials(actor, runId)).map((row) => row.title))
      .toEqual(["At enrollment start"]);
    await pool.query(
      "UPDATE lms_group_runs SET access_until=now()-interval '1 second' WHERE id=$1",
      [runId],
    );
    expect((await learning.materials(actor, runId)).map(row => row.title)).toEqual(["At enrollment start"]);
  });
  it("stores the HTTP request correlation separately from authored audit content", async () => {
    const requestTeacher = {
      ...teacher,
      requestId: "isolated-material-publication-request",
    };
    const material = await learning.createMaterial(
      requestTeacher,
      lmsMaterialSchema.parse({
        runId,
        title: "Correlated publication",
        body: "Authored content",
        publishAt: open(),
      }),
    );
    const audit = (
      await pool.query(
        "SELECT request_id,new_value FROM lms_learning_audit WHERE entity_type='material' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
        [material.id],
      )
    ).rows[0];
    expect(audit.request_id).toBe(requestTeacher.requestId);
    expect(JSON.stringify(audit.new_value)).not.toContain(
      requestTeacher.requestId,
    );
    const recipient = await createAssignment();
    await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId,
      draftVersion: 0,
      text: "Reviewed answer",
      links: [],
      fileIds: [],
      idempotencyKey: "request-correlated-grade",
    });
    const submitted = await assignments.detail(actor, recipient.id);
    await assignments.review(requestTeacher, submitted.submissions[0].id, {
      version: submitted.version,
      decision: "accepted",
      comment: "Accepted result",
      criterionScores: {},
    });
    expect(
      (
        await pool.query(
          "SELECT request_id FROM lms_learning_audit WHERE entity_type='achievement' AND action='award'",
        )
      ).rows,
    ).toEqual([{ request_id: requestTeacher.requestId }]);
  });
  it("serializes competing drafts, deduplicates retried submissions, and keeps the receipt stable after review", async () => {
    const recipient = await createAssignment();
    const results = await Promise.allSettled([
      assignments.saveDraft(actor, recipient.id, {
        version: 0,
        text: "First",
        links: [],
        fileIds: [],
      }),
      assignments.saveDraft(actor, recipient.id, {
        version: 0,
        text: "Second",
        links: [],
        fileIds: [],
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const detail = await assignments.detail(actor, recipient.id);
    const input = {
      assignmentVersionId: recipient.assignmentVersionId,
      draftVersion: detail.draft.version,
      text: detail.draft.text,
      links: [],
      fileIds: [],
      idempotencyKey: "retry-submit-key",
    };
    const [one, two] = await Promise.all([
      assignments.submit(actor, recipient.id, input),
      assignments.submit(actor, recipient.id, input),
    ]);
    expect(one).toEqual(two);
    const submitted = await assignments.detail(actor, recipient.id);
    expect(submitted.submissions).toHaveLength(1);
    expect(submitted.submissions[0].late).toBe(true);
    await assignments.review(teacher, submitted.submissions[0].id, {
      version: submitted.version,
      decision: "accepted",
      comment: "Good",
      criterionScores: {},
    });
    expect(await assignments.submit(actor, recipient.id, input)).toEqual(one);
    await expect(
      pool.query("UPDATE lms_submissions SET text=$2 WHERE id=$1", [
        submitted.submissions[0].id,
        "Mutated",
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("detects concurrent review/withdraw and preserves independent revision attempts", async () => {
    const recipient = await createAssignment();
    await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId,
      draftVersion: 0,
      text: "Answer",
      links: [],
      fileIds: [],
      idempotencyKey: "first-answer-key",
    });
    const first = await assignments.detail(actor, recipient.id);
    const id = first.submissions[0].id;
    const outcomes = await Promise.allSettled([
      assignments.startReview(teacher, id, first.version),
      assignments.withdraw(actor, id, first.version),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const current = await assignments.detail(actor, recipient.id);
    if (current.status === "submitted") {
      await assignments.review(teacher, id, {
        version: current.version,
        decision: "revision_required",
        comment: "Improve",
        criterionScores: {},
      });
      const revised = await assignments.detail(actor, recipient.id);
      await assignments.submit(actor, recipient.id, {
        assignmentVersionId: recipient.assignmentVersionId,
        draftVersion: revised.draft.version,
        text: "Improved",
        links: [],
        fileIds: [],
        idempotencyKey: "second-answer-key",
      });
      expect(
        (await assignments.detail(actor, recipient.id)).submissions,
      ).toHaveLength(2);
    } else {
      expect(current.submissions[0].withdrawnAt).not.toBeNull();
      expect(current.draft.text).toBe("Answer");
    }
  });
  it("prevents newcomer auto-assignment and mixed group/student references at database layer", async () => {
    const recipient = await createAssignment();
    await pool.query(
      "INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(2,1,now())",
    );
    expect((await assignments.list(stranger)).items).toEqual([]);
    await expect(
      pool.query(
        "INSERT INTO lms_assignment_recipients(assignment_id,assignment_version_id,enrollment_id,student_id,opens_at) SELECT assignment_id,assignment_version_id,2,2,now() FROM lms_assignment_recipients WHERE id=$1",
        [recipient.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      assignments.detail(stranger, recipient.id),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
    await expect(
      assignments.saveDraft(actor, recipient.id, {
        version: 0,
        text: "Answer",
        links: [],
        fileIds: [123],
      }),
    ).rejects.toMatchObject({ code: "lmsFileNotReady" });
  });
  it("resumes one immutable quiz attempt across simultaneous tabs and withholds answers until closure", async () => {
    await quizzes.create(teacher, quizInput());
    const recipient = (await quizzes.list(actor))[0];
    const [first, second] = await Promise.all([
      quizzes.start(actor, recipient.id),
      quizzes.start(actor, recipient.id),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.disclosure).toBeNull();
    expect(JSON.stringify(first)).not.toContain("correctOptionIds");
    expect(JSON.stringify(first)).not.toContain("Secret correct answer");
    await expect(
      quizzes.answer(stranger, first.id, "q1", {
        version: 1,
        optionIds: ["a"],
      }),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
    const saved = await quizzes.answer(actor, first.id, "q1", {
      version: first.version,
      optionIds: ["c", "a"],
    });
    const finish = await quizzes.finish(actor, first.id, saved.version);
    expect(finish).toMatchObject({
      score: 3,
      percent: 100,
      passed: true,
      disclosure: null,
    });
    expect((await learning.progress(actor)).quizzes).toMatchObject({
      completed: 1,
      total: 1,
      percent: 100,
    });
    await pool.query(
      "UPDATE lms_quiz_recipients SET closes_at=now()-interval '1 second' WHERE id=$1",
      [recipient.id],
    );
    expect(
      (await quizzes.get(actor, first.id)).disclosure?.[0].correctOptionIds,
    ).toEqual(["a", "c"]);
  });
  it("rejects post-deadline answers and background completion grades only saved answers", async () => {
    await quizzes.create(teacher, quizInput());
    const recipient = (await quizzes.list(actor))[0];
    const attempt = await quizzes.start(actor, recipient.id);
    quizNow = new Date(+new Date(attempt.deadlineAt!) + 1000);
    await expect(
      quizzes.answer(actor, attempt.id, "q1", {
        version: attempt.version,
        optionIds: ["a", "c"],
      }),
    ).rejects.toMatchObject({ code: "lmsQuizClosed" });
    await quizzes.finishExpired();
    expect(await quizzes.get(actor, attempt.id)).toMatchObject({
      state: "finished",
      score: 0,
      passed: false,
    });
  });
  it("deduplicates makeup plans and never converts absences into attendance credit", async () => {
    await pool.query(
      "INSERT INTO academy_attendance(lesson_id,student_id,status) VALUES(1,1,'absent')",
    );
    await Promise.all([engagement.syncMakeup(1), engagement.syncMakeup(1)]);
    const plans = await engagement.makeup(actor);
    expect(plans).toHaveLength(1);
    await engagement.manageMakeup(teacher, plans[0].id, { complete: true });
    expect((await learning.progress(actor)).attendance).toMatchObject({
      completed: 0,
      total: 1,
      percent: 0,
    });
    await pool.query(
      "UPDATE academy_attendance SET status='present' WHERE lesson_id=1 AND student_id=1",
    );
    expect((await engagement.makeup(actor))[0].status).toBe("completed");
  });
  it("isolates a parent private thread from child, second parent, and unassigned teacher", async () => {
    const thread = await engagement.createThread(representative, {
      runId,
      title: "Parent question",
      body: "Private concern",
      audience: "representative_teacher",
      fileIds: [],
    });
    await expect(
      engagement.threadDetail(actor, thread.id),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
    await expect(
      engagement.threadDetail(
        { ...representative, portalAccountId: 4 },
        thread.id,
      ),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
    await expect(
      engagement.managementThreadDetail(otherTeacher, thread.id),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
    await engagement.staffComment(teacher, thread.id, {
      body: "Private staff note",
      audience: "staff",
      fileIds: [],
    });
    await engagement.staffComment(teacher, thread.id, {
      body: "Reply",
      audience: "family_teacher",
      fileIds: [],
    });
    const detail = await engagement.threadDetail(representative, thread.id);
    expect(detail.comments.map((comment) => comment.body)).toEqual([
      "Private concern",
      "Reply",
    ]);
    expect((await engagement.history(actor)).items).toEqual([]);
  });
  it("deduplicates a verified achievement and preserves revoked history", async () => {
    const input = {
      runId,
      studentId: 1,
      title: "Completed project",
      reason: "Finished own project",
      eventKey: "project-event-key",
    };
    const [first, second] = await Promise.all([
      engagement.award(teacher, input),
      engagement.award(teacher, input),
    ]);
    expect(first.id).toBe(second.id);
    await engagement.revokeAward(teacher, first.id, "Correction");
    expect((await engagement.achievements(actor))[0]).toMatchObject({
      revokedAt: expect.any(String),
      revokeReason: "Correction",
    });
  });
  it("shows only approved lesson previews and ties the personal step to published requirements", async () => {
    const unit = (await learning.managementUnits(teacher, runId))[0];
    expect((await learning.course(actor, runId)).units).toEqual([]);
    await learning.setUnitPreview(teacher, runId, unit.id, {
      enabled: true,
      visibleFrom: open(),
      openAt: future(),
    });
    expect((await learning.course(actor, runId)).units[0]).toMatchObject({
      id: unit.id,
      status: "soon",
      materials: [],
    });
    const material = await learning.createMaterial(
      teacher,
      lmsMaterialSchema.parse({
        runId,
        unitId: unit.id,
        title: "Published",
        body: "Safe lesson",
        publishAt: open(),
        videoUrl: "https://youtu.be/example",
        durationMinutes: 8,
      }),
    );
    const course = await learning.course(actor, runId);
    expect(course.currentUnit?.id).toBe(unit.id);
    expect(course.units[0].status).toBe("available");
    expect(course.materials[0]).toMatchObject({
      authorName: "Teacher",
      videoUrl: "https://youtu.be/example",
      durationMinutes: 8,
      lessonAt: expect.any(String),
    });
    await learning.readMaterial(actor, course.materials[0].publicationId, true);
    expect((await learning.course(actor, runId)).units[0].status).toBe(
      "studied",
    );
    expect(
      (await learning.managementMaterials(teacher, runId)).find(
        (row: unknown) => (row as { id: number }).id === material.id,
      ),
    ).toBeDefined();
    await expect(
      learning.setUnitPreview(otherTeacher, runId, unit.id, {
        enabled: true,
        visibleFrom: open(),
        openAt: future(),
      }),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
  });
  it("keeps published units pending through assignment and failed quiz work while counting unpublished requirements in course progress", async () => {
    const unit = (await learning.managementUnits(teacher, runId))[0];
    const hidden = (
      await pool.query(
        "INSERT INTO lms_units(course_version_id,title,position) SELECT course_version_id,'Unpublished requirement',1 FROM lms_group_runs WHERE id=$1 RETURNING id",
        [runId],
      )
    ).rows[0];
    await learning.createMaterial(
      teacher,
      lmsMaterialSchema.parse({
        runId,
        unitId: unit.id,
        title: "Published unit",
        body: "Lesson",
        publishAt: open(),
      }),
    );
    const material = (await learning.materials(actor, runId))[0];
    await learning.readMaterial(actor, material.publicationId, true);
    for (const [title, unitId, opensAt] of [
      ["Published requirement", unit.id, open()],
      ["Unpublished requirement", hidden.id, open()],
      ["Future requirement", unit.id, future()],
    ])
      await assignments.create(
        teacher,
        lmsAssignmentSchema.parse({
          runId,
          unitId,
          title,
          body: title,
          required: true,
          opensAt,
          dueAt: null,
          recipientEnrollmentIds: [1],
        }),
      );
    await quizzes.create(teacher, { ...quizInput(), unitId: unit.id });
    expect(await learning.publishedUnits(actor, runId)).toMatchObject([
      { id: unit.id, status: "available" },
    ]);
    const pending = (await assignments.list(actor)).items.find(
      (item) => item.title === "Published requirement",
    )!;
    await assignments.submit(actor, pending.id, {
      assignmentVersionId: pending.assignmentVersionId,
      draftVersion: 0,
      text: "Completed work",
      links: [],
      fileIds: [],
      idempotencyKey: "published-unit-completion",
    });
    const submitted = await assignments.detail(actor, pending.id);
    await assignments.review(teacher, submitted.submissions[0].id, {
      version: submitted.version,
      decision: "accepted",
      comment: "Accepted",
      criterionScores: {},
    });
    const quiz = (await quizzes.list(actor))[0];
    const first = await quizzes.start(actor, quiz.id);
    const failedAnswer = await quizzes.answer(actor, first.id, "q1", {
      version: first.version,
      optionIds: ["b"],
    });
    expect(await quizzes.finish(actor, first.id, failedAnswer.version))
      .toMatchObject({ passed: false });
    expect(await learning.publishedUnits(actor, runId)).toMatchObject([
      { id: unit.id, status: "available" },
    ]);
    const second = await quizzes.start(actor, quiz.id);
    const passedAnswer = await quizzes.answer(actor, second.id, "q1", {
      version: second.version,
      optionIds: ["a", "c"],
    });
    expect(await quizzes.finish(actor, second.id, passedAnswer.version))
      .toMatchObject({ passed: true });
    expect(await learning.publishedUnits(actor, runId)).toMatchObject([
      { id: unit.id, status: "studied" },
    ]);
    expect((await learning.courses(actor))[0]).toMatchObject({
      currentUnit: null,
      progress: { completed: 1, total: 2, percent: 50 },
    });
  });
  it("pages course enrollment metadata and keeps personal completion separate from run status and access dates", async () => {
    const secondRun = (await learning.createRun(otherTeacher, {
      groupId: 2,
      format: "offline",
      meetingUrl: null,
    })) as { id: number };
    const enrolledAt = new Date(Date.now() - 14 * 86400000).toISOString();
    const endedAt = new Date(Date.now() - 7 * 86400000).toISOString();
    const expiry = new Date(Date.now() - 86400000).toISOString();
    await pool.query(
      "INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at,ended_at,status) VALUES(1,2,$1,$2,'completed')",
      [enrolledAt, endedAt],
    );
    await pool.query(
      "UPDATE lms_group_runs SET status='completed',access_until=$2 WHERE id=$1",
      [secondRun.id, expiry],
    );
    await pool.query(
      "INSERT INTO lms_course_completions(student_id,run_id,completed_by) VALUES(1,$1,1)",
      [runId],
    );
    const first = await service.portalCollection(actor, "courses", { limit: 1 });
    expect(first).toMatchObject({
      hasMore: true,
      items: [{
        enrollmentId: 3,
        runId: secondRun.id,
        groupName: "Other group",
        courseName: "Course",
        teacherName: "Other teacher",
        status: "completed",
        enrolledAt,
        endedAt,
        accessUntil: null,
      }],
    });
    const second = await service.portalCollection(actor, "courses", {
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second).toMatchObject({
      hasMore: false,
      items: [{ enrollmentId: 1, runId, status: "completed", accessUntil: null }],
    });
    await pool.query(
      "UPDATE lms_course_completions SET reopened_at=now() WHERE student_id=1 AND run_id=$1",
      [runId],
    );
    expect((await learning.courses(actor)).find((course) => course.runId === runId))
      .toMatchObject({ status: "active" });
  });
  it("reads materials once per courses or dashboard request while retaining current publications, reads and requirements across runs", async () => {
    const secondRun = (await learning.createRun(otherTeacher, {
      groupId: 2,
      format: "offline",
      meetingUrl: null,
    })) as { id: number };
    await pool.query(
      "INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(1,2,now()-interval '30 days')",
    );
    const unit = (await learning.managementUnits(teacher, runId))[0];
    const secondUnit = (
      await learning.managementUnits(otherTeacher, secondRun.id)
    )[0];
    const materialInput = lmsMaterialSchema.parse({
      runId,
      unitId: unit.id,
      title: "Original publication",
      body: "Original body",
      publishAt: open(),
    });
    const material = await learning.createMaterial(teacher, materialInput);
    const firstPublication = (await learning.materials(actor))[0];
    await learning.readMaterial(actor, firstPublication.publicationId, true);
    await learning.reviseMaterial(teacher, material.id, {
      ...materialInput,
      title: "Corrected publication",
      body: "Corrected body",
    });
    await learning.createMaterial(
      otherTeacher,
      lmsMaterialSchema.parse({
        runId: secondRun.id,
        unitId: secondUnit.id,
        title: "Second course publication",
        body: "Second course body",
        publishAt: open(),
      }),
    );
    await learning.createMaterial(teacher, {
      ...materialInput,
      title: "Future publication",
      publishAt: future(),
    });
    await assignments.create(
      teacher,
      lmsAssignmentSchema.parse({
        runId,
        unitId: unit.id,
        title: "Pending requirement",
        body: "Practice",
        opensAt: open(),
        dueAt: null,
        recipientEnrollmentIds: [1],
      }),
    );
    const lessons = (
      await pool.query(
        "INSERT INTO academy_lessons(group_id,lesson_number,topic,scheduled_at) VALUES(1,2,'Next own lesson',now()+interval '1 day'),(2,2,'Next other lesson',now()+interval '2 days') RETURNING id",
      )
    ).rows;
    await learning.bindLesson(teacher, runId, lessons[0].id, {
      unitId: unit.id,
      format: null,
      meetingUrl: null,
    });
    await learning.bindLesson(otherTeacher, secondRun.id, lessons[1].id, {
      unitId: secondUnit.id,
      format: null,
      meetingUrl: null,
    });
    const expectedMaterials = await learning.materials(actor);
    expect(expectedMaterials).toHaveLength(2);
    const querySpy = vi.spyOn(pool, "query");
    const materialQueryCount = () =>
      querySpy.mock.calls.filter(
        ([sql]) => typeof sql === "string" && sql.includes("AS publication_id"),
      ).length;
    try {
      const courses = await learning.courses(actor);
      expect(materialQueryCount()).toBe(1);
      expect(courses).toHaveLength(2);
      expect(courses.find((course) => course.runId === runId)).toMatchObject({
        currentUnit: { id: unit.id },
        nextLesson: {
          materials: [{ title: "Corrected publication", read: true }],
          assignments: [{ title: "Pending requirement" }],
        },
      });
      expect(JSON.stringify(courses)).not.toContain("Original publication");
      expect(JSON.stringify(courses)).not.toContain("Future publication");
      querySpy.mockClear();
      const dashboard = await service.dashboard(actor);
      expect(materialQueryCount()).toBe(1);
      expect(dashboard.nextLesson?.materials).toEqual(
        expectedMaterials.filter((row) => row.runId === runId),
      );
      expect(dashboard.nextMaterial?.title).toBe("Second course publication");
      expect(dashboard.progress.materials).toEqual({
        completed: 1,
        total: 2,
        percent: 50,
      });
      expect(dashboard.progress.assignments).toEqual({
        completed: 0,
        total: 1,
        percent: 0,
      });
      querySpy.mockClear();
      await learning.readMaterial(
        actor,
        expectedMaterials.find((row) => row.runId === runId)!.publicationId,
        false,
      );
      querySpy.mockClear();
      const refreshed = await service.dashboard(actor);
      expect(materialQueryCount()).toBe(1);
      expect(refreshed.progress.materials.completed).toBe(0);
      expect(refreshed.nextLesson?.materials?.[0]?.read).toBe(false);
    } finally {
      querySpy.mockRestore();
    }
  });
  it("shares materials only within the current actor request and retains live cohort and permission masks", async () => {
    const unit = (await learning.managementUnits(teacher, runId))[0];
    await learning.createMaterial(
      teacher,
      lmsMaterialSchema.parse({
        runId,
        unitId: unit.id,
        title: "Own learning body",
        body: "Private learning body",
        publishAt: open(),
      }),
    );
    let enabled = true;
    const scopedLearning = new PgLearningRepository(
      pool,
      undefined,
      (groupId) => enabled && groupId === 1,
    );
    const scopedService = new LmsService({
      learning: scopedLearning,
      assignments: new PgAssignmentRepository(pool, scopedLearning),
      quizzes: new PgQuizRepository(pool, scopedLearning),
      engagement: new PgEngagementRepository(pool, scopedLearning),
    });
    const materialSpy = vi.spyOn(scopedLearning, "materials");
    try {
      expect((await scopedService.dashboard(actor)).nextMaterial?.title).toBe(
        "Own learning body",
      );
      expect(materialSpy).toHaveBeenCalledTimes(1);
      materialSpy.mockClear();
      const parent = await scopedService.dashboard({
        ...representative,
        permissions: ["attendance.read"],
      });
      expect(materialSpy).not.toHaveBeenCalled();
      expect(parent.nextMaterial).toBeNull();
      expect(parent.progress.materials).toEqual({
        completed: 0,
        total: 0,
        percent: null,
      });
      const feedbackOnly = await scopedService.dashboard({
        ...representative,
        permissions: ["feedback.read"],
      });
      expect(materialSpy).not.toHaveBeenCalled();
      expect(feedbackOnly.nextLesson).toBeNull();
      materialSpy.mockClear();
      expect((await scopedService.dashboard(stranger)).nextMaterial).toBeNull();
      expect(materialSpy).toHaveBeenCalledTimes(1);
      const currentSnapshot = await scopedLearning.materials(actor);
      enabled = false;
      expect(
        (
          await scopedLearning.progress(
            actor,
            undefined,
            undefined,
            currentSnapshot,
          )
        ).materials.total,
      ).toBe(0);
      await expect(
        scopedLearning.publishedUnits(actor, runId, currentSnapshot),
      ).rejects.toMatchObject({ code: "portalUnavailable" });
      expect(await scopedLearning.courses(actor)).toEqual([]);
      expect((await scopedService.dashboard(actor)).nextMaterial).toBeNull();
    } finally {
      materialSpy.mockRestore();
    }
  });
  it("preserves schedule metadata, enrollment boundaries, reschedules and permission masks with unique scalar lookups", async () => {
    const firstAt = new Date(Date.now() + 86400000).toISOString();
    const secondAt = new Date(Date.now() + 129600000).toISOString();
    const endedAt = new Date(Date.now() + 172800000).toISOString();
    const afterEnrollment = new Date(Date.now() + 259200000).toISOString();
    const previousAt = new Date(Date.now() + 43200000).toISOString();
    const lessons = (
      await pool.query(
        "INSERT INTO academy_lessons(group_id,lesson_number,topic,scheduled_at,teacher_id,school_id,room_id) VALUES(1,2,'Override',$1,2,1,1),(1,3,'Fallback',$2,NULL,NULL,NULL),(1,4,'After enrollment',$3,1,1,1),(2,2,'Foreign lesson',$1,2,1,1) RETURNING id",
        [firstAt, secondAt, afterEnrollment],
      )
    ).rows;
    await pool.query(
      "UPDATE academy_student_group_enrollments SET ended_at=$1 WHERE id=1",
      [endedAt],
    );
    await pool.query(
      "INSERT INTO academy_attendance(lesson_id,student_id,status) VALUES($1,1,'present'),($1,2,'absent');",
      [lessons[0].id],
    );
    await pool.query(
      "INSERT INTO academy_lesson_reschedules(lesson_id,previous_scheduled_at,new_scheduled_at) VALUES($1,$2,$3)",
      [lessons[0].id, previousAt, firstAt],
    );
    await learning.bindLesson(teacher, runId, lessons[0].id, {
      unitId: null,
      format: "online",
      meetingUrl: "https://meet.example/lesson",
    });
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 345600000).toISOString();
    const schedule = await learning.schedule(actor, from, to);
    expect(schedule).toHaveLength(2);
    expect(schedule[0]).toMatchObject({
      id: lessons[0].id,
      runId,
      topic: "Override",
      teacherName: "Other teacher",
      schoolName: "School",
      roomName: "Room",
      format: "online",
      meetingUrl: "https://meet.example/lesson",
      attendance: "present",
      rescheduled: true,
      previousScheduledAt: previousAt,
    });
    expect(schedule[1]).toMatchObject({
      id: lessons[1].id,
      topic: "Fallback",
      teacherName: "Teacher",
      schoolName: null,
      roomName: null,
      attendance: null,
      format: "offline",
      meetingUrl: null,
      rescheduled: false,
      previousScheduledAt: null,
    });
    const learningOnly = await learning.schedule(
      { ...representative, permissions: ["learning.read"] },
      from,
      to,
    );
    expect(learningOnly[0].attendance).toBeNull();
    const attendanceOnly = await learning.schedule(
      { ...representative, permissions: ["attendance.read"] },
      from,
      to,
    );
    expect(attendanceOnly[0]).toMatchObject({
      attendance: "present",
      unitId: null,
      materials: [],
      assignments: [],
    });
    const page = await service.schedulePage(actor, from, to, { limit: 1 });
    const nextPage = await service.schedulePage(actor, from, to, {
      limit: 1,
      cursor: page.nextCursor!,
    });
    expect(page.hasMore).toBe(true);
    expect(nextPage.hasMore).toBe(false);
    expect(
      [...page.items, ...nextPage.items].map((lesson) => lesson.id).sort(),
    ).toEqual(schedule.map((lesson) => lesson.id).sort());
  });
  it("pages all published collections in PostgreSQL without dropping history beyond old limits", async () => {
    for (let i = 0; i < 5; i++)
      await learning.createMaterial(
        teacher,
        lmsMaterialSchema.parse({
          runId,
          title: `Material ${i}`,
          body: "Content",
          publishAt: open(),
        }),
      );
    const first = await service.portalCollection(actor, "materials", {
      limit: 2,
    });
    const second = await service.portalCollection(actor, "materials", {
      limit: 2,
      cursor: first.nextCursor!,
    });
    const third = await service.portalCollection(actor, "materials", {
      limit: 2,
      cursor: second.nextCursor!,
    });
    expect([
      first.items.length,
      second.items.length,
      third.items.length,
    ]).toEqual([2, 2, 1]);
    expect(third).toMatchObject({ hasMore: false, nextCursor: null });
    expect(
      new Set(
        [...first.items, ...second.items, ...third.items].map(
          (item) => item.id,
        ),
      ).size,
    ).toBe(5);
    const staffFirst = await service.staffCollection(
      teacher,
      "materials",
      { limit: 2 },
      runId,
    );
    expect(staffFirst).toMatchObject({
      hasMore: true,
      nextCursor: expect.any(Number),
    });
    const staffSecond = await service.staffCollection(
      teacher,
      "materials",
      { limit: 2, cursor: staffFirst.nextCursor! },
      runId,
    );
    expect(
      staffSecond.items.every((item) => item.id < staffFirst.nextCursor!),
    ).toBe(true);
    await expect(
      service.portalCollection(
        { ...actor, permissions: ["attendance.read"] },
        "materials",
        { limit: 2 },
      ),
    ).rejects.toMatchObject({ code: "portalAccessDenied" });
  });
  it("restores an automatic achievement once and preserves each revoke and restore event", async () => {
    const award = () =>
      transaction(pool, (sql) =>
        learning.awardAutomatic(
          sql,
          1,
          runId,
          "first_accepted",
          `first-accepted:${runId}:1`,
          "lmsAchievementFirstAccepted",
          "Verified work",
          1,
        ),
      );
    const [first, duplicate] = await Promise.all([award(), award()]);
    expect(first!.id).toBe(duplicate!.id);
    await engagement.revokeAward(teacher, first!.id, "Review corrected");
    await engagement.revokeAward(teacher, first!.id, "Duplicate retry");
    const restored = await award();
    expect(restored!.id).toBe(first!.id);
    expect((await award())!.awarded).toBe(false);
    expect((await engagement.achievements(actor))[0].revokedAt).toBeNull();
    const events = (await engagement.history(actor)).items.map(
      (event) => event.type,
    );
    expect(
      events.filter((event) => event === "achievement_awarded"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event === "achievement_revoked"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event === "achievement_restored"),
    ).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT action FROM lms_learning_audit WHERE entity_type='achievement' ORDER BY id",
        )
      ).rows.map((row) => row.action),
    ).toEqual(["award", "revoke", "restore"]);
  });
  it("keeps unlimited access explicit and blocks course completion while future required work remains", async () => {
    const unlimited = new PgLearningRepository(pool, undefined, () => true);
    await unlimited.updateRun(teacher, runId, {
      version: 1,
      status: "completed",
      reason: "Group finished",
    });
    expect(
      (
        await pool.query(
          "SELECT access_until FROM lms_group_runs WHERE id=$1",
          [runId],
        )
      ).rows[0].access_until,
    ).toBeNull();
    const unit = (await learning.managementUnits(teacher, runId))[0];
    await learning.createMaterial(
      teacher,
      lmsMaterialSchema.parse({
        runId,
        unitId: unit.id,
        title: "Lesson",
        body: "Content",
        publishAt: open(),
      }),
    );
    const assignment = await assignments.create(
      teacher,
      lmsAssignmentSchema.parse({
        runId,
        title: "Future requirement",
        body: "Practice",
        opensAt: future(),
        dueAt: null,
        recipientEnrollmentIds: [1],
      }),
    );
    await expect(
      learning.completeCourse(teacher, runId, 1, "Ready"),
    ).rejects.toMatchObject({ code: "lmsCourseIncomplete" });
    const recipient = (
      await pool.query(
        "SELECT id,version FROM lms_assignment_recipients WHERE assignment_id=$1",
        [assignment.id],
      )
    ).rows[0];
    await assignments.updateRecipient(teacher, Number(recipient.id), {
      version: recipient.version,
      status: "excused",
      reason: "Equivalent work accepted",
    });
    await learning.completeCourse(teacher, runId, 1, "Requirements fulfilled");
    await learning.reopenCourse(teacher, runId, 1, "Continue programme");
    expect(
      (await engagement.achievements(actor)).find(
        (award) => award.title === "lmsAchievementCourseCompleted",
      )?.revokedAt,
    ).toEqual(expect.any(String));
    await learning.completeCourse(
      teacher,
      runId,
      1,
      "Requirements fulfilled again",
    );
    expect(
      (await engagement.achievements(actor)).filter(
        (award) => award.title === "lmsAchievementCourseCompleted",
      ),
    ).toHaveLength(1);
  });
  it("revokes and restores the completion award against its original requirements without reopening the confirmed course", async () => {
    const unit = (await learning.managementUnits(teacher, runId))[0];
    await learning.createMaterial(
      teacher,
      lmsMaterialSchema.parse({
        runId,
        unitId: unit.id,
        title: "Published programme",
        body: "Lesson",
        publishAt: open(),
      }),
    );
    const recipient = await createAssignment();
    const receipt = (await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId,
      draftVersion: 0,
      text: "Finished work",
      links: [],
      fileIds: [],
      idempotencyKey: "completion-correction-submit",
    })) as { id: number; version: number };
    const first = await assignments.review(teacher, receipt.id, {
      version: receipt.version,
      decision: "accepted",
      comment: "Accepted",
      criterionScores: {},
    });
    await learning.completeCourse(teacher, runId, 1, "Confirmed completion");
    await assignments.create(
      teacher,
      lmsAssignmentSchema.parse({
        runId,
        title: "Later optional programme extension",
        body: "New practice",
        opensAt: open(),
        dueAt: null,
        recipientEnrollmentIds: [1],
      }),
    );
    const correction = await assignments.review(teacher, receipt.id, {
      version: first.version,
      decision: "revision_required",
      comment: "Needs a correction",
      reason: "Assessment corrected",
      criterionScores: {},
    });
    let award = (await engagement.achievements(actor)).find(
      (item) => item.title === "lmsAchievementCourseCompleted",
    )!;
    expect(award.revokedAt).toEqual(expect.any(String));
    expect((await learning.course(actor, runId)).status).toBe("completed");
    await assignments.review(teacher, receipt.id, {
      version: correction.version,
      decision: "accepted",
      comment: "Corrected result accepted",
      reason: "Rechecked evidence",
      criterionScores: {},
    });
    award = (await engagement.achievements(actor)).find(
      (item) => item.title === "lmsAchievementCourseCompleted",
    )!;
    expect(award.revokedAt).toBeNull();
    expect(
      (await assignments.detail(actor, recipient.id)).submissions[0]
        .reviewHistory,
    ).toHaveLength(3);
    const snapshot = (
      await pool.query(
        "SELECT data FROM lms_learning_events WHERE type='course_completed'",
      )
    ).rows[0].data;
    expect(snapshot.assignmentRecipientIds).toEqual([recipient.id]);
    expect(snapshot.unitIds).toEqual([unit.id]);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM lms_course_completions WHERE reopened_at IS NULL",
        )
      ).rows[0].count,
    ).toBe(1);
  });
  it("replays staff material, quiz, report and announcement commands without duplicate versions or recipients", async () => {
    const administration = {
      userId: 1,
      modules: ["administration"],
      isLeadership: true,
    };
    const programme = {
      courseId: 1,
      sections: [
        {
          title: "New programme",
          units: [{ title: "Next lesson", required: true }],
        },
      ],
      publish: true,
      idempotencyKey: "programme-author-retry",
    };
    const [programmeVersion, programmeRetry] = await Promise.all([
      learning.createCourseVersion(administration, programme),
      learning.createCourseVersion(administration, programme),
    ]);
    expect(programmeRetry).toEqual(programmeVersion);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM lms_course_versions WHERE course_id=1",
        )
      ).rows[0].count,
    ).toBe(2);
    const materialInput = lmsMaterialSchema.parse({
      runId,
      title: "Lesson",
      body: "Published lesson",
      publishAt: open(),
      idempotencyKey: "material-author-retry",
    });
    const [material, materialRetry] = await Promise.all([
      learning.createMaterial(teacher, materialInput),
      learning.createMaterial(teacher, materialInput),
    ]);
    expect(materialRetry).toEqual(material);
    const correction = {
      ...materialInput,
      body: "Corrected lesson",
      idempotencyKey: "material-revise-retry",
    };
    const [version, versionRetry] = await Promise.all([
      learning.reviseMaterial(teacher, material.id, correction),
      learning.reviseMaterial(teacher, material.id, correction),
    ]);
    expect(versionRetry).toEqual(version);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM lms_material_versions WHERE material_id=$1",
          [material.id],
        )
      ).rows[0].count,
    ).toBe(2);
    const quiz = { ...quizInput(), idempotencyKey: "quiz-author-retry" };
    const [published, publishedRetry] = await Promise.all([
      quizzes.create(teacher, quiz),
      quizzes.create(teacher, quiz),
    ]);
    expect(publishedRetry).toEqual(published);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM lms_quiz_recipients",
        )
      ).rows[0].count,
    ).toBe(1);
    const report = lmsReportSchema.parse({
      runId,
      studentId: 1,
      periodFrom: open(),
      periodTo: future(),
      comment: "Feedback",
      nextSteps: "Practice",
      idempotencyKey: "report-author-retry",
    });
    const [saved, savedRetry] = await Promise.all([
      engagement.publishReport(teacher, report),
      engagement.publishReport(teacher, report),
    ]);
    expect(savedRetry).toEqual(saved);
    expect(
      (await pool.query("SELECT COUNT(*)::int AS count FROM lms_reports"))
        .rows[0].count,
    ).toBe(1);
    await expect(
      engagement.publishReport(teacher, {
        ...report,
        comment: "Changed retry",
      }),
    ).rejects.toMatchObject({ code: "lmsVersionConflict" });
    await engagement.publishReport(teacher, {
      ...report,
      idempotencyKey: "report-new-version",
    });
    expect(
      (await pool.query("SELECT MAX(version)::int AS version FROM lms_reports"))
        .rows[0].version,
    ).toBe(2);
    const announcement = lmsAnnouncementSchema.parse({
      runId,
      title: "Announcement",
      body: "Details",
      publishAt: open(),
      idempotencyKey: "announcement-author-retry",
    });
    const [notice, noticeRetry] = await Promise.all([
      engagement.createAnnouncement(teacher, announcement),
      engagement.createAnnouncement(teacher, announcement),
    ]);
    expect(noticeRetry).toEqual(notice);
    expect(
      (await pool.query("SELECT COUNT(*)::int AS count FROM lms_announcements"))
        .rows[0].count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT entity_type,COUNT(*)::int AS count FROM lms_learning_audit WHERE action='publish' GROUP BY entity_type ORDER BY entity_type",
        )
      ).rows,
    ).toEqual([
      { entity_type: "announcement", count: 1 },
      { entity_type: "course_version", count: 1 },
      { entity_type: "material", count: 2 },
      { entity_type: "quiz", count: 1 },
      { entity_type: "report", count: 2 },
    ]);
    await pool.query("UPDATE academy_groups SET teacher_id=2 WHERE id=1");
    await expect(
      learning.createMaterial(teacher, materialInput),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
  });
  it("replays help, portal comments, staff replies and grade decisions after a lost response without duplicate messages or reviews", async () => {
    const threadInput = lmsThreadSchema.parse({
      runId,
      title: "Help",
      body: "Question",
      audience: "student_teacher",
      idempotencyKey: "help-create-retry",
    });
    const [thread, threadRetry] = await Promise.all([
      engagement.createThread(actor, threadInput),
      engagement.createThread(actor, threadInput),
    ]);
    expect(threadRetry).toEqual(thread);
    expect(
      (await pool.query("SELECT COUNT(*)::int AS count FROM lms_threads"))
        .rows[0].count,
    ).toBe(1);
    await expect(
      engagement.createThread(actor, {
        ...threadInput,
        body: "Changed question",
      }),
    ).rejects.toMatchObject({ code: "lmsVersionConflict" });
    const portalComment = {
      body: "More context",
      audience: "student_teacher" as const,
      fileIds: [],
      idempotencyKey: "help-comment-retry",
    };
    const [comment, commentRetry] = await Promise.all([
      engagement.addComment(actor, thread.id, portalComment),
      engagement.addComment(actor, thread.id, portalComment),
    ]);
    expect(commentRetry).toEqual(comment);
    const staffReply = {
      ...portalComment,
      body: "Try this step",
      idempotencyKey: "staff-reply-retry",
    };
    const [reply, replyRetry] = await Promise.all([
      engagement.staffComment(teacher, thread.id, staffReply),
      engagement.staffComment(teacher, thread.id, staffReply),
    ]);
    expect(replyRetry).toEqual(reply);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM lms_comments WHERE thread_id=$1",
          [thread.id],
        )
      ).rows[0].count,
    ).toBe(3);
    const recipient = await createAssignment();
    const [assignmentComment, assignmentCommentRetry] = await Promise.all([
      assignments.addComment(actor, recipient.id, portalComment),
      assignments.addComment(actor, recipient.id, portalComment),
    ]);
    expect(assignmentCommentRetry).toEqual(assignmentComment);
    const [assignmentReply, assignmentReplyRetry] = await Promise.all([
      assignments.staffComment(teacher, recipient.id, staffReply),
      assignments.staffComment(teacher, recipient.id, staffReply),
    ]);
    expect(assignmentReplyRetry).toEqual(assignmentReply);
    const receipt = (await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId,
      draftVersion: 0,
      text: "Work",
      links: [],
      fileIds: [],
      idempotencyKey: "grade-submit-retry",
    })) as { id: number; version: number };
    const started = await assignments.startReview(
      teacher,
      receipt.id,
      receipt.version,
    );
    expect(
      await assignments.startReview(teacher, receipt.id, receipt.version),
    ).toEqual(started);
    const input = {
      version: started.version,
      decision: "accepted" as const,
      comment: "Verified",
      criterionScores: {},
      idempotencyKey: "review-decision-retry",
    };
    const [review, reviewRetry] = await Promise.all([
      assignments.review(teacher, receipt.id, input),
      assignments.review(teacher, receipt.id, input),
    ]);
    expect(reviewRetry).toEqual(review);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM lms_reviews WHERE submission_id=$1",
          [receipt.id],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT version FROM lms_assignment_recipients WHERE id=$1",
          [recipient.id],
        )
      ).rows[0].version,
    ).toBe(started.version + 1);
    await expect(
      assignments.review(teacher, receipt.id, {
        ...input,
        comment: "Changed retry",
      }),
    ).rejects.toMatchObject({ code: "lmsVersionConflict" });
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM lms_learning_events WHERE type='help_requested'",
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (await engagement.history(actor)).items.every(
        (item) => item.type !== "portal_command_completed",
      ),
    ).toBe(true);
  });
  it("keeps material reads, report snapshots and course completion inside the existing transaction with a one-connection pool", async () => {
    const single = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema} -c timezone=UTC`,
      max: 1,
    });
    try {
      const repository = new PgLearningRepository(
        single,
        undefined,
        () => true,
      );
      const reports = new PgEngagementRepository(single, repository);
      const unit = (await repository.managementUnits(teacher, runId))[0];
      await repository.createMaterial(
        teacher,
        lmsMaterialSchema.parse({
          runId,
          unitId: unit.id,
          title: "Lesson",
          body: "Programme",
          publishAt: open(),
        }),
      );
      const publication = (await repository.materials(actor))[0];
      expect(
        await repository.readMaterial(actor, publication.publicationId, true),
      ).toEqual({ read: true });
      await reports.publishReport(
        teacher,
        lmsReportSchema.parse({
          runId,
          studentId: 1,
          periodFrom: open(),
          periodTo: future(),
          comment: "Feedback",
          nextSteps: "Practice",
          idempotencyKey: "single-pool-report",
        }),
      );
      expect(
        await repository.completeCourse(
          teacher,
          runId,
          1,
          "Requirements fulfilled",
        ),
      ).toMatchObject({ completed: true });
    } finally {
      await single.end();
    }
  });
  it("projects individual assignment and quiz journal results, zero scores, open help and absences without exposing another run", async () => {
    await pool.query(
      "INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(2,1,now()-interval '30 days'),(1,1,now()-interval '10 days');INSERT INTO academy_attendance(lesson_id,student_id,status) VALUES(1,1,'absent'),(1,2,'present')",
    );
    await assignments.create(
      teacher,
      lmsAssignmentSchema.parse({
        runId,
        title: "Scored work",
        body: "Practice",
        gradingMode: "points",
        maxScore: 10,
        opensAt: open(),
        dueAt: null,
        recipientEnrollmentIds: [1],
      }),
    );
    const recipient = (await assignments.list(actor)).items[0];
    const receipt = (await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId,
      draftVersion: 0,
      text: "Work",
      links: [],
      fileIds: [],
      idempotencyKey: "journal-submit",
    })) as { id: number; version: number };
    await assignments.review(teacher, receipt.id, {
      version: receipt.version,
      decision: "revision_required",
      comment: "Try again",
      criterionScores: {},
      score: 0,
    });
    await quizzes.create(teacher, quizInput());
    const quiz = (await quizzes.list(actor))[0];
    const attempt = await quizzes.start(actor, quiz.id);
    const answered = await quizzes.answer(actor, attempt.id, "q1", {
      version: attempt.version,
      optionIds: ["b"],
    });
    await quizzes.finish(actor, attempt.id, answered.version);
    await engagement.createThread(
      actor,
      lmsThreadSchema.parse({
        runId,
        title: "Help",
        body: "Question",
        audience: "student_teacher",
      }),
    );
    const otherRun = (await learning.createRun(otherTeacher, {
      groupId: 2,
      format: "offline",
      meetingUrl: null,
    })) as { id: number };
    await assignments.create(
      otherTeacher,
      lmsAssignmentSchema.parse({
        runId: otherRun.id,
        title: "Foreign work",
        body: "Other course",
        opensAt: open(),
        dueAt: null,
        recipientEnrollmentIds: [2],
      }),
    );
    const journal = await learning.results(teacher, runId);
    expect(journal).toHaveLength(2);
    const first = journal.find((item) => item.studentId === 1)!;
    const second = journal.find((item) => item.studentId === 2)!;
    expect(first.assignmentResults[0]).toMatchObject({
      title: "Scored work",
      score: 0,
      maxScore: 10,
      status: "revision_required",
    });
    expect(first.quizResults[0]).toMatchObject({
      bestPercent: 0,
      passed: false,
      attemptsUsed: 1,
    });
    expect(first).toMatchObject({ openHelp: 1, absences: 1 });
    expect(second).toMatchObject({
      assignmentResults: [],
      quizResults: [],
      openHelp: 0,
      absences: 0,
    });
    expect(JSON.stringify(journal)).not.toContain("Foreign work");
    await expect(learning.results(otherTeacher, runId)).rejects.toMatchObject({
      code: "lmsNotFound",
    });
  });
  it("closes assignments and quizzes published after enrollment ended while preserving the earlier learning history", async () => {
    const earlier = await createAssignment();
    await assignments.create(
      teacher,
      lmsAssignmentSchema.parse({
        runId,
        title: "Later publication",
        body: "Should be closed",
        opensAt: new Date(Date.now() - 1800000).toISOString(),
        dueAt: null,
        recipientEnrollmentIds: [1],
      }),
    );
    const later = (await assignments.list(actor)).items[0];
    await quizzes.create(teacher, {
      ...quizInput(),
      opensAt: new Date(Date.now() - 1800000).toISOString(),
    });
    const laterQuiz = (await quizzes.list(actor))[0];
    await pool.query(
      "UPDATE academy_student_group_enrollments SET ended_at=now()-interval '45 minutes',status='completed' WHERE id=1",
    );
    expect(
      (await assignments.list(actor)).items.map((item) => item.id),
    ).toEqual([earlier.id]);
    expect(await quizzes.list(actor)).toEqual([]);
    await expect(assignments.detail(actor, later.id)).rejects.toMatchObject({
      code: "lmsNotFound",
    });
    await expect(quizzes.start(actor, laterQuiz.id)).rejects.toMatchObject({
      code: "lmsNotFound",
    });
    expect((await learning.progress(actor, runId)).assignments.total).toBe(1);
    expect((await learning.progress(actor, runId)).quizzes.total).toBe(0);
  });
  it("copies assignment files across runs before opening the learning transaction and freezes the publication receipt", async () => {
    const target = (await learning.createRun(otherTeacher, {
      groupId: 2,
      format: "offline",
      meetingUrl: null,
    })) as { id: number };
    const single = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema} -c timezone=UTC`,
      max: 1,
    });
    const adminActor = {
      userId: 1,
      modules: ["administration"],
      isLeadership: true,
    };
    const prepared: Array<{ source: number; target: number; ids: number[] }> =
      [];
    let discarded = 0;
    try {
      const copyLearning = new PgLearningRepository(
        single,
        async (_sql, _actor, ids, context) => {
          if (ids.some((id) => id !== (context.runId === runId ? 11 : 22)))
            throw new Error("Wrong file scope");
        },
        () => true,
        {
          copyFiles: async (_actor, ids, sourceRunId, targetRunId) => {
            await single.query("SELECT 1");
            prepared.push({ source: sourceRunId, target: targetRunId, ids });
            return {
              fileIds: [22],
              discardUnused: async () => {
                discarded++;
                await single.query("SELECT 1");
              },
            };
          },
        },
      );
      const copies = new PgAssignmentRepository(single, copyLearning);
      const source = await copies.create(
        adminActor,
        lmsAssignmentSchema.parse({
          runId,
          title: "Original",
          body: "Practice",
          opensAt: open(),
          dueAt: null,
          fileIds: [11],
          recipientEnrollmentIds: [1],
        }),
      );
      const input = lmsAssignmentSchema.parse({
        runId: target.id,
        title: "Copied",
        body: "Fresh publication",
        opensAt: open(),
        dueAt: future(),
        fileIds: [11],
        recipientEnrollmentIds: [2],
        copySourceAssignmentId: source.id,
        copySourceAssignmentVersionId: source.assignmentVersionId,
        idempotencyKey: "copy-publication-retry",
      });
      const [first, second] = await Promise.all([
        copies.create(adminActor, input),
        copies.create(adminActor, input),
      ]);
      expect(first).toEqual(second);
      expect(first.recipientCount).toBe(1);
      expect(prepared.length).toBeGreaterThan(0);
      expect(
        prepared.every(
          (item) =>
            item.source === runId &&
            item.target === target.id &&
            item.ids[0] === 11,
        ),
      ).toBe(true);
      expect(discarded).toBe(prepared.length);
      expect(
        (
          await single.query(
            "SELECT file_ids FROM lms_assignment_versions WHERE id=$1",
            [first.assignmentVersionId],
          )
        ).rows[0].file_ids,
      ).toEqual([22]);
      expect(
        (
          await single.query(
            "SELECT COUNT(*)::int AS count FROM lms_assignments WHERE run_id=$1",
            [target.id],
          )
        ).rows[0].count,
      ).toBe(1);
      expect(await copies.create(adminActor, input)).toEqual(first);
      await expect(
        copies.create(adminActor, { ...input, title: "Changed retry" }),
      ).rejects.toMatchObject({ code: "lmsVersionConflict" });
      await expect(
        copies.create(teacher, {
          ...input,
          idempotencyKey: "copy-foreign-run",
        }),
      ).rejects.toMatchObject({ code: "lmsNotFound" });
    } finally {
      await single.end();
    }
  });
  it("preserves selected report projects as immutable snapshots and removes their content for feedback-only representatives", async () => {
    const reportLearning = new PgLearningRepository(
      pool,
      undefined,
      () => true,
      {
        reportProjects: async (_sql, _actor, _runId, _studentId, ids) =>
          ids.map((id) => ({
            id,
            title: "Accepted project",
            description: "Private project body",
            fileIds: [7],
            links: ["https://example.org/work"],
            review: "Confirmed progress",
          })),
      },
    );
    const reports = new PgEngagementRepository(pool, reportLearning);
    const reportService = new LmsService({
      learning: reportLearning,
      assignments,
      quizzes,
      engagement: reports,
    });
    const published = await reports.publishReport(
      teacher,
      lmsReportSchema.parse({
        runId,
        studentId: 1,
        periodFrom: new Date(Date.now() - 86400000).toISOString(),
        periodTo: future(),
        comment: "Results",
        nextSteps: "Next practice",
        bestProjectIds: [5],
      }),
    );
    expect(
      (await reportService.reports(actor))[0].bestProjects?.[0],
    ).toMatchObject({
      id: 5,
      description: "Private project body",
      fileIds: [7],
    });
    expect(
      (
        await reportService.reports({
          ...representative,
          permissions: ["feedback.read"],
        })
      )[0].bestProjects?.[0],
    ).toMatchObject({
      title: "Accepted project",
      description: "",
      fileIds: [],
      links: [],
      review: "Confirmed progress",
    });
    await expect(
      pool.query("UPDATE lms_reports SET best_projects='[]' WHERE id=$1", [
        published.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("deduplicates a retried quiz extra-attempt grant and rejects a changed reason for the same key", async () => {
    await quizzes.create(teacher, quizInput());
    const recipient = (await quizzes.list(actor))[0];
    const responses = await Promise.all([
      quizzes.extraAttempt(
        teacher,
        recipient.id,
        "Additional practice",
        "extra-attempt-retry",
      ),
      quizzes.extraAttempt(
        teacher,
        recipient.id,
        "Additional practice",
        "extra-attempt-retry",
      ),
    ]);
    expect(responses).toEqual([{ granted: true }, { granted: true }]);
    expect(
      (
        await pool.query(
          "SELECT extra_attempts FROM lms_quiz_recipients WHERE id=$1",
          [recipient.id],
        )
      ).rows[0].extra_attempts,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM lms_learning_audit WHERE action='extra_attempt'",
        )
      ).rows[0].count,
    ).toBe(1);
    await expect(
      quizzes.extraAttempt(
        teacher,
        recipient.id,
        "Changed reason",
        "extra-attempt-retry",
      ),
    ).rejects.toMatchObject({ code: "lmsVersionConflict" });
    await quizzes.extraAttempt(
      teacher,
      recipient.id,
      "Further agreed practice",
      "extra-attempt-next",
    );
    expect(
      (
        await pool.query(
          "SELECT extra_attempts FROM lms_quiz_recipients WHERE id=$1",
          [recipient.id],
        )
      ).rows[0].extra_attempts,
    ).toBe(2);
  });
  it("calculates 7/30-day learning analytics from actual learning work, deadlines, first reviews and replies, attendance and makeup", async () => {
    const administration = {
      userId: 1,
      modules: ["administration"],
      isLeadership: true,
    };
    await pool.query(`INSERT INTO academy_students(student_name,contact_name) VALUES('Quiet learner','Quiet learner');
      INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(2,1,now()-interval '30 days'),(3,1,now()-interval '30 days');
      INSERT INTO portal_student_links(account_id,student_id,kind,status,verified_at,verified_by) VALUES(1,1,'self','active',now(),1),(2,2,'self','active',now(),1);
      UPDATE portal_accounts SET last_seen_at=now() WHERE id=2;
      INSERT INTO academy_attendance(lesson_id,student_id,status) VALUES(1,1,'absent'),(1,2,'present');
      INSERT INTO academy_lessons(group_id,lesson_number,topic,scheduled_at,status,teacher_id) VALUES(1,2,'Earlier lesson',now()-interval '8 days','conducted',1);
      INSERT INTO academy_attendance(lesson_id,student_id,status) VALUES(3,2,'absent');`);
    await pool.query(
      `INSERT INTO lms_learning_events(student_id,run_id,type,event_key,data,occurred_at) VALUES
      (1,$1,'material_read','recent-self','{"actorKind":"self"}',now()-interval '1 day'),
      (2,$1,'material_read','earlier-self','{"actorKind":"self"}',now()-interval '8 days'),
      (3,$1,'material_read','parent-only','{"actorKind":"representative"}',now()-interval '1 day'),
      (3,$1,'achievement_awarded','staff-only','{}',now()-interval '1 day')`,
      [runId],
    );
    await pool.query(
      "INSERT INTO lms_makeup_plans(lesson_id,student_id,run_id,status,completed_at,completed_by) VALUES(1,1,$1,'completed',now()-interval '1 hour',1),(3,2,$1,'needed',NULL,NULL)",
      [runId],
    );
    const recipients: Array<{
      id: number;
      assignmentVersionId: number;
      dueAt: string | null;
    }> = [];
    for (const [index, dueAt] of [future(), open(), null].entries()) {
      await assignments.create(
        teacher,
        lmsAssignmentSchema.parse({
          runId,
          title: `Work ${index}`,
          body: "Practice",
          opensAt: new Date(Date.now() - 86400000).toISOString(),
          dueAt,
          recipientEnrollmentIds: [1],
        }),
      );
      recipients.push((await assignments.list(actor)).items[0]);
    }
    const submittedIds: number[] = [];
    for (const [index, recipient] of recipients.entries()) {
      const result = await pool.query(
        "INSERT INTO lms_submissions(recipient_id,assignment_version_id,account_id,attempt_number,text,links,file_ids,idempotency_key,submitted_at,late,receipt_snapshot) VALUES($1,$2,1,1,'Work','[]','[]',$3,now()-interval '4 hours',$4,$5::jsonb) RETURNING id",
        [
          recipient.id,
          recipient.assignmentVersionId,
          `analytics-submit-${index}`,
          index === 1,
          JSON.stringify({ dueAt: recipient.dueAt }),
        ],
      );
      submittedIds.push(Number(result.rows[0].id));
      await pool.query(
        "UPDATE lms_assignment_recipients SET status='submitted',version=version+1 WHERE id=$1",
        [recipient.id],
      );
    }
    await assignments.updateRecipient(teacher, recipients[0].id, {
      version: 2,
      dueAt: null,
      reason: "Deadline removed after submission",
    });
    await pool.query(
      "INSERT INTO lms_reviews(submission_id,decision,comment,reviewer_id,created_at) VALUES($1,'accepted','First review',1,now()-interval '2 hours'),($1,'accepted','Later correction',1,now()-interval '1 hour'),($2,'accepted','First review',1,now()-interval '2 hours')",
      [submittedIds[0], submittedIds[1]],
    );
    await pool.query(
      "UPDATE lms_assignment_recipients SET status='accepted' WHERE id=ANY($1::bigint[])",
      [[recipients[0].id, recipients[1].id]],
    );
    const answered = (
      await pool.query(
        "INSERT INTO lms_threads(student_id,run_id,title,audience,author_account_id,status,created_at) VALUES(1,$1,'Question','student_teacher',1,'answered',now()-interval '4 hours') RETURNING id",
        [runId],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO lms_threads(student_id,run_id,title,audience,author_account_id,status,created_at) VALUES(2,$1,'Open question','student_teacher',2,'open',now()-interval '1 day'),(3,$1,'Earlier question','representative_teacher',3,'open',now()-interval '15 days')",
      [runId],
    );
    await pool.query(
      "INSERT INTO lms_comments(student_id,run_id,thread_id,staff_user_id,audience,body,created_at) VALUES(1,$1,$2,1,'staff','Internal note',now()-interval '3 hours'),(1,$1,$2,1,'student_teacher','First reply',now()-interval '1 hour'),(1,$1,$2,1,'student_teacher','Later reply',now())",
      [runId, answered],
    );
    const seven = await learning.analytics(administration, { days: 7, runId });
    expect(seven.activatedAccounts).toEqual({
      numerator: 2,
      denominator: 3,
      percent: 66.7,
    });
    expect(seven.learningActive).toEqual({
      numerator: 1,
      denominator: 3,
      percent: 33.3,
    });
    expect(seven.onTimeSubmissions).toEqual({
      numerator: 1,
      denominator: 2,
      percent: 50,
    });
    expect(seven.awaitingReview).toEqual({
      numerator: 1,
      denominator: 3,
      percent: 33.3,
    });
    expect(seven.reviewLatency).toEqual({ averageHours: 2, samples: 2 });
    expect(seven.openHelp).toEqual({
      numerator: 1,
      denominator: 2,
      percent: 50,
    });
    expect(seven.responseLatency).toEqual({ averageHours: 3, samples: 1 });
    expect(seven.absences).toEqual({
      numerator: 1,
      denominator: 2,
      percent: 50,
    });
    expect(seven.completedMakeup).toEqual({
      numerator: 1,
      denominator: 1,
      percent: 100,
    });
    const thirty = await learning.analytics(administration, {
      days: 30,
      runId,
    });
    expect(thirty.learningActive).toEqual({
      numerator: 2,
      denominator: 3,
      percent: 66.7,
    });
    expect(thirty.openHelp).toEqual({
      numerator: 2,
      denominator: 3,
      percent: 66.7,
    });
    expect(thirty.absences).toEqual({
      numerator: 2,
      denominator: 3,
      percent: 66.7,
    });
    expect(thirty.completedMakeup).toEqual({
      numerator: 1,
      denominator: 2,
      percent: 50,
    });
    expect(+new Date(seven.periodTo) - +new Date(seven.periodFrom)).toBe(
      7 * 86400000,
    );
    expect(JSON.stringify(seven)).not.toContain("Internal note");
    expect(JSON.stringify(seven)).not.toContain("contact");
  });
  it("keeps analytics administration-only, filters disabled groups, and reports empty denominators without invented percentages", async () => {
    const administration = {
      userId: 1,
      modules: ["administration"],
      isLeadership: true,
    };
    await pool.query(
      "INSERT INTO lms_staff_permissions(user_id,permission) VALUES(2,'results.manage')",
    );
    await expect(
      learning.analytics(teacher, { days: 7 }),
    ).rejects.toMatchObject({ code: "portalAccessDenied" });
    await expect(
      learning.analytics(
        { userId: 2, modules: ["finance"], isLeadership: false },
        { days: 7 },
      ),
    ).rejects.toMatchObject({ code: "portalAccessDenied" });
    const otherRun = (await learning.createRun(otherTeacher, {
      groupId: 2,
      format: "offline",
      meetingUrl: null,
    })) as { id: number };
    await pool.query(
      "INSERT INTO lms_learning_events(student_id,run_id,type,event_key,data) VALUES(2,$1,'material_read','disabled-only','{\"actorKind\":\"self\"}')",
      [otherRun.id],
    );
    const scoped = new PgLearningRepository(
      pool,
      undefined,
      (groupId) => groupId === 1,
    );
    const result = await scoped.analytics(administration, { days: 7 });
    expect(result.learningActive).toEqual({
      numerator: 0,
      denominator: 1,
      percent: 0,
    });
    expect(result.onTimeSubmissions).toEqual({
      numerator: 0,
      denominator: 0,
      percent: null,
    });
    expect(result.reviewLatency).toEqual({ averageHours: null, samples: 0 });
    await expect(
      scoped.analytics(administration, { days: 7, runId: otherRun.id }),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
    const disabled = new PgLearningRepository(pool);
    expect(
      (await disabled.analytics(administration, { days: 7 })).learningActive,
    ).toEqual({ numerator: 0, denominator: 0, percent: null });
  });
  it("follows existing group completion without treating archival as a material revocation", async () => {
    await pool.query("UPDATE academy_groups SET is_archived=true WHERE id=1");
    expect(await learning.reconcileGroupLifecycle()).toEqual({ completed: 0 });
    await pool.query("UPDATE academy_groups SET status='completed' WHERE id=1");
    expect(await learning.reconcileGroupLifecycle()).toEqual({ completed: 1 });
    const run = (
      await pool.query(
        "SELECT status,completed_at,access_until,version FROM lms_group_runs WHERE id=$1",
        [runId],
      )
    ).rows[0];
    expect(run.status).toBe("completed");
    expect(run.access_until).toBeNull();
    expect(run.version).toBe(2);
    expect(await learning.reconcileGroupLifecycle()).toEqual({ completed: 0 });
    await pool.query(
      "UPDATE lms_group_runs SET status='active',access_until=$2 WHERE id=$1",
      [runId, future()],
    );
    const explicit = (
      await pool.query("SELECT access_until FROM lms_group_runs WHERE id=$1", [
        runId,
      ])
    ).rows[0].access_until;
    await learning.reconcileGroupLifecycle();
    expect(
      (
        await pool.query(
          "SELECT access_until FROM lms_group_runs WHERE id=$1",
          [runId],
        )
      ).rows[0].access_until,
    ).toBeNull();
  });
  it("retains quiz context in help requests and rejects a foreign attempt even in direct database writes", async () => {
    await quizzes.create(teacher, quizInput());
    const attempt = await quizzes.start(
      actor,
      (await quizzes.list(actor))[0].recipientId,
    );
    const input = lmsThreadSchema.parse({
      runId,
      quizAttemptId: attempt.id,
      title: "Question",
      body: "Need a hint",
      stepUrl: "https://academy.example/learn/tests",
    });
    const thread = await engagement.createThread(actor, input);
    expect(await engagement.threadDetail(actor, thread.id)).toMatchObject({
      quizAttemptId: attempt.id,
      stepUrl: input.stepUrl,
    });
    const parent = await engagement.createThread(
      representative,
      lmsThreadSchema.parse({ ...input, title: "Parent question" }),
    );
    await expect(
      engagement.threadDetail(actor, parent.id),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
    const shared = await engagement.createThread(representative, {
      ...input,
      shareWithFamily: true,
    });
    expect((await engagement.threadDetail(actor, shared.id)).audience).toBe(
      "student_teacher",
    );
    await expect(
      engagement.createThread(stranger, input),
    ).rejects.toMatchObject({ code: "lmsNotFound" });
    await expect(
      pool.query(
        "INSERT INTO lms_threads(student_id,run_id,quiz_attempt_id,title,audience,author_account_id) VALUES(2,$1,$2,'Invalid','student_teacher',2)",
        [runId, attempt.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("returns neutral empty progress instead of 100 and works with permission-scoped parent dashboard", async () => {
    expect(await learning.progress(actor)).toEqual({
      attendance: { completed: 0, total: 0, percent: null, unmarked: 1 },
      assignments: { completed: 0, total: 0, percent: null },
      quizzes: { completed: 0, total: 0, percent: null },
      materials: { completed: 0, total: 0, percent: null },
    });
    const dashboard = await service.dashboard({
      ...representative,
      permissions: ["attendance.read"],
    });
    expect(dashboard.assignments).toEqual([]);
    expect(dashboard.announcements).toEqual([]);
  });
  it("limits mixed enrollments and all direct learning objects to enabled pilot groups", async () => {
    const own = await createAssignment();
    const run2 = (await learning.createRun(otherTeacher, {
      groupId: 2,
      format: "offline",
      meetingUrl: null,
    })) as { id: number };
    await pool.query(
      "INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(1,2,now()-interval '30 days')",
    );
    await assignments.create(
      otherTeacher,
      lmsAssignmentSchema.parse({
        runId: run2.id,
        title: "Hidden",
        body: "Hidden body",
        opensAt: open(),
        dueAt: null,
        recipientEnrollmentIds: [3],
      }),
    );
    await quizzes.create(otherTeacher, {
      ...quizInput(),
      runId: run2.id,
      recipientEnrollmentIds: [3],
    });
    const hidden = (await assignments.list(actor)).items.find(
      (item) => item.runId === run2.id,
    )!;
    const scopedLearning = new PgLearningRepository(
      pool,
      undefined,
      (groupId) => groupId === 1,
    );
    const scopedAssignments = new PgAssignmentRepository(pool, scopedLearning);
    const scopedQuizzes = new PgQuizRepository(pool, scopedLearning);
    const scopedEngagement = new PgEngagementRepository(pool, scopedLearning);
    expect(
      (await scopedLearning.courses(actor)).map((course) => course.groupId),
    ).toEqual([1]);
    expect(
      (await scopedAssignments.list(actor)).items.map((item) => item.id),
    ).toEqual([own.id]);
    expect(await scopedQuizzes.list(actor)).toEqual([]);
    await expect(
      scopedAssignments.detail(actor, hidden.id),
    ).rejects.toMatchObject({ code: "portalUnavailable" });
    await expect(scopedLearning.course(actor, run2.id)).rejects.toMatchObject({
      code: "portalUnavailable",
    });
    expect(
      (await scopedLearning.attendance(actor)).map((lesson) => lesson.runId),
    ).toEqual([runId]);
    expect((await scopedLearning.progress(actor)).attendance.unmarked).toBe(1);
    const privateThread = await engagement.createThread(actor, {
      runId: run2.id,
      title: "Hidden help",
      body: "Question",
      audience: "student_teacher",
      fileIds: [],
    });
    expect(await scopedEngagement.threads(actor)).toEqual([]);
    await expect(
      scopedEngagement.threadDetail(actor, privateThread.id),
    ).rejects.toMatchObject({ code: "portalUnavailable" });
    const closed = new PgLearningRepository(pool);
    expect(await closed.managementGroups(teacher)).toEqual([]);
    await expect(
      closed.createRun(teacher, {
        groupId: 1,
        format: "offline",
        meetingUrl: null,
      }),
    ).rejects.toMatchObject({ code: "portalUnavailable" });
  });
  it("isolates a parent assignment note and supports explicit family sharing without leaking staff notes", async () => {
    const recipient = await createAssignment();
    await assignments.addComment(representative, recipient.id, {
      body: "Private parent note",
      audience: "family_teacher",
      fileIds: [],
    });
    expect((await assignments.detail(actor, recipient.id)).comments).toEqual(
      [],
    );
    expect(
      (
        await assignments.detail(
          { ...representative, portalAccountId: 4 },
          recipient.id,
        )
      ).comments,
    ).toEqual([]);
    expect(
      (await assignments.detail(representative, recipient.id)).comments.map(
        (comment) => comment.body,
      ),
    ).toEqual(["Private parent note"]);
    await assignments.addComment(representative, recipient.id, {
      body: "Shared note",
      audience: "family_teacher",
      shareWithFamily: true,
      fileIds: [],
    });
    expect(
      (await assignments.detail(actor, recipient.id)).comments.map(
        (comment) => comment.body,
      ),
    ).toEqual(["Shared note"]);
    await assignments.staffComment(teacher, recipient.id, {
      body: "Staff note",
      audience: "staff",
      fileIds: [],
    });
    expect(
      (await assignments.detail(actor, recipient.id)).comments.map(
        (comment) => comment.body,
      ),
    ).toEqual(["Shared note"]);
    await assignments.submit(actor, recipient.id, {
      assignmentVersionId: recipient.assignmentVersionId,
      draftVersion: 0,
      text: "Answer",
      links: [],
      fileIds: [],
      idempotencyKey: "private-review-answer",
    });
    const detail = await assignments.detail(actor, recipient.id);
    expect(
      (
        await assignments.reviewDetail(teacher, detail.submissions[0].id)
      ).comments.map((comment) => comment.body),
    ).toEqual(["Private parent note", "Shared note", "Staff note"]);
    await assignments.review(teacher, detail.submissions[0].id, {
      version: detail.version,
      decision: "accepted",
      comment: "Public feedback",
      criterionScores: {},
    });
    const feedbackOnly = {
      ...representative,
      permissions: ["feedback.read"] as PortalActorContext["permissions"],
    };
    const page = (await service.feedback(feedbackOnly)) as {
      items: Array<Record<string, unknown>>;
    };
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      comment: "Public feedback",
      assignmentTitle: "Practice",
    });
    expect(page.items[0]).not.toHaveProperty("body");
    expect(page.items[0]).not.toHaveProperty("fileIds");
    await expect(
      service.assignment(feedbackOnly, recipient.id),
    ).rejects.toMatchObject({ code: "portalAccessDenied" });
  });
  it("keeps restoration materials and graded percentages out of attendance-only or learning-only representative projections", async () => {
    const material = await learning.createMaterial(
      teacher,
      lmsMaterialSchema.parse({
        runId,
        title: "Material",
        body: "Restricted body",
        publishAt: open(),
        unitId: (await learning.managementUnits(teacher, runId))[0].id,
      }),
    );
    await pool.query(
      "INSERT INTO academy_attendance(lesson_id,student_id,status) VALUES(1,1,'absent')",
    );
    const attendanceOnly = {
      ...representative,
      permissions: ["attendance.read"] as PortalActorContext["permissions"],
    };
    const makeup = await engagement.makeup(attendanceOnly);
    expect(makeup[0].materials).toEqual([]);
    expect(makeup[0].recipientId).toBeNull();
    expect(makeup[0].quizRecipientId).toBeNull();
    expect(
      (await service.dashboard(attendanceOnly)).makeup[0].materials,
    ).toEqual([]);
    await quizzes.create(teacher, { ...quizInput(), disclosure: "practice" });
    const quiz = (await quizzes.list(actor))[0];
    const attempt = await quizzes.start(actor, quiz.id);
    const answer = await quizzes.answer(actor, attempt.id, "q1", {
      version: attempt.version,
      optionIds: ["a", "c"],
    });
    await quizzes.finish(actor, attempt.id, answer.version);
    const learningOnly = {
      ...representative,
      permissions: ["learning.read"] as PortalActorContext["permissions"],
    };
    expect((await service.quizzes(learningOnly))[0].bestPercent).toBeNull();
    expect(() => service.quizResults(learningOnly, quiz.id)).toThrow(
      "portalAccessDenied",
    );
    expect((await learning.materials(actor))[0].title).toBe("Material");
    expect(material.id).toBeGreaterThan(0);
  });
  it("gives the assigned teacher every learning action and programme creation without employee grants", async () => {
    const own=(await learning.managementGroups(teacher)).find(group=>group.groupId===1)!;
    expect(own.canManageTemplates).toBe(true);
    expect(own.permissions).toEqual(expect.arrayContaining(['content.manage','assignments.manage','reviews.manage','quizzes.manage','results.manage','communication.manage','announcements.manage','schedule.manage','portfolio.moderate']));
    const programme={courseId:1,sections:[{title:'Teacher programme',units:[{title:'Unit',required:true}]}],publish:true};
    expect(await learning.createCourseVersion(teacher,programme)).toMatchObject({id:expect.any(Number)});
    await expect(learning.createCourseVersion({...teacher,modules:['sales']},programme)).rejects.toMatchObject({code:'portalAccessDenied'});
    const unrelated=(await pool.query("INSERT INTO academy_courses(name) VALUES('Unassigned') RETURNING id")).rows[0].id;
    await expect(learning.createCourseVersion(teacher,{...programme,courseId:unrelated})).rejects.toMatchObject({code:'portalAccessDenied'});
  });

});
