import { insertCrmCourseUnits } from './crm-course-units';
import { courseLessonPosition, flattenCourseCurriculum } from '@shared/contracts/course-curriculum';
import type {
  LmsListOptions,
  LmsReportProjectSnapshot,
  LmsAnalyticsDto,
  LmsAnalyticsInput,
  LmsAnalyticsRatioDto,
  LmsStaffAssignmentResultDto,
  LmsStaffQuizResultDto,
  LmsTeacherSummaryDto,
  LmsStaffRunDto,
} from "@shared/contracts/lms";
import { LMS_STAFF_PERMISSIONS } from "@shared/contracts/lms";
import type { Pool } from "pg";
import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import type {
  LmsCourseDto,
  LmsCourseDetailDto,
  LmsMaterialDto,
  LmsMaterialInput,
  LmsScheduleDto,
  LmsUnitDto,
  LmsProgressDto,
  LmsRunUpdateInput,
} from "@shared/contracts/lms";
import {
  LmsError,
  progressMetric,
  requireVersion,
  type LmsStaffActor,
} from "../domain/policy";
import { crmGroupFormat, crmProgramUnits, type CrmLearningFormat, type CrmPreparationStatus } from "../domain/crm-preparation";
import {
  one,
  rows,
  listRows,
  transaction,
  requireStaffRun,
  hasImplicitStaffRunAccess,
  recordStaffAudit,
  idempotentStaffCommand,
  enrollmentVisibilitySql,
  runUnitSelectionSql,
  recipientEnrollmentVisibilitySql,
  recordEvent,
  denyUnintegratedFiles,
  type LmsAttachmentAuthorizer,
  type LmsSql,
} from "./postgres-base";
export type LmsLearningPolicy = {
  crmPreparationDefaultFormat?: () => CrmLearningFormat | null;
  reportProjects?: (
    sql: LmsSql,
    actor: LmsStaffActor,
    runId: number,
    studentId: number,
    ids: number[],
  ) => Promise<LmsReportProjectSnapshot[]>;
  copyFiles?: (
    actor: LmsStaffActor,
    fileIds: number[],
    sourceRunId: number,
    targetRunId: number,
    idempotencyKey?: string,
  ) => Promise<{ fileIds: number[]; discardUnused: () => Promise<void> }>;
  afterReview?: (
    sql: LmsSql,
    actor: LmsStaffActor,
    context: {
      studentId: number;
      runId: number;
      submissionId: number;
      decision: "accepted" | "revision_required";
      reason: string;
    },
  ) => Promise<void>;
  achievementTemplate?: (
    rule: string,
  ) =>
    | Promise<{ title: string; reason: string } | null>
    | { title: string; reason: string }
    | null;
};
export class PgLearningRepository {
  constructor(
    readonly pool: Pool,
    readonly authorizeFiles: LmsAttachmentAuthorizer = denyUnintegratedFiles,
    readonly enabledForGroup: (
      groupId: number,
    ) => Promise<boolean> | boolean = () => false,
    readonly policy: LmsLearningPolicy = {},
  ) {}
  async teacherSummary(actor: LmsStaffActor): Promise<LmsTeacherSummaryDto> {
    if (
      !(await one(
        this.pool,
        "SELECT id FROM users WHERE id=$1 AND is_active AND NOT is_archived",
        [actor.userId],
      ))
    )
      throw new LmsError("lmsNotFound", 404);
    const [reviewRuns, helpRuns, contentRuns, scheduleRuns] = await Promise.all(
      [
        this.enabledStaffRunIds(actor, "reviews.manage"),
        this.enabledStaffRunIds(actor, "communication.manage"),
        this.enabledStaffRunIds(actor, "content.manage"),
        this.enabledStaffRunIds(actor, "schedule.manage"),
      ],
    );
    const runIds = [...new Set([...reviewRuns, ...helpRuns, ...contentRuns])];
    const runRows = await rows<{
      runId: number;
      groupName: string;
      courseId: number;
      pendingReviews: number;
      openHelp: number;
    }>(
      this.pool,
      `SELECT run.id AS run_id,g.name AS group_name,g.course_id,
      CASE WHEN run.id=ANY($2::bigint[]) THEN (SELECT COUNT(*)::int FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN LATERAL(SELECT id,withdrawn_at FROM lms_submissions submission WHERE submission.recipient_id=recipient.id ORDER BY attempt_number DESC LIMIT 1) submission ON true WHERE assignment.run_id=run.id AND recipient.status='submitted' AND submission.withdrawn_at IS NULL) ELSE 0 END AS pending_reviews,
      CASE WHEN run.id=ANY($3::bigint[]) THEN (SELECT COUNT(*)::int FROM lms_threads thread WHERE thread.run_id=run.id AND thread.status='open') ELSE 0 END AS open_help
      FROM lms_group_runs run JOIN academy_groups g ON g.id=run.group_id WHERE run.id=ANY($1::bigint[]) AND run.status<>'archived' AND NOT g.is_archived ORDER BY g.name,run.id`,
      [runIds, reviewRuns, helpRuns],
    );
    const lessons = await rows<{
      runId: number;
      lessonId: number;
      topic: string;
      scheduledAt: string;
      unitId: number | null;
    }>(
      this.pool,
      `SELECT run.id AS run_id,lesson.id AS lesson_id,lesson.topic,lesson.scheduled_at,binding.unit_id FROM academy_lessons lesson JOIN lms_group_runs run ON run.group_id=lesson.group_id JOIN academy_groups g ON g.id=run.group_id LEFT JOIN lms_lesson_bindings binding ON binding.run_id=run.id AND binding.lesson_id=lesson.id WHERE run.id=ANY($1::bigint[]) AND run.status<>'archived' AND NOT g.is_archived AND lesson.status='scheduled' AND lesson.scheduled_at>=now() AND lesson.scheduled_at<now()+interval '7 days' AND NOT EXISTS(SELECT 1 FROM lms_materials material JOIN lms_material_publications publication ON publication.material_id=material.id WHERE material.run_id=run.id AND material.unit_id=binding.unit_id AND material.state='published' AND publication.revoked_at IS NULL AND publication.publish_at<=lesson.scheduled_at) ORDER BY lesson.scheduled_at,lesson.id`,
      [contentRuns],
    );
    const runs = runRows
      .map((run) => ({
        ...run,
        canManageSchedule: scheduleRuns.includes(run.runId),
        unpreparedLessons: lessons
          .filter((lesson) => lesson.runId === run.runId)
          .map(({ runId: _runId, ...lesson }) => lesson),
      }))
      .filter(
        (run) =>
          run.pendingReviews > 0 ||
          run.openHelp > 0 ||
          run.unpreparedLessons.length > 0,
      );
    return {
      pendingReviews: runs.reduce((sum, run) => sum + run.pendingReviews, 0),
      openHelp: runs.reduce((sum, run) => sum + run.openHelp, 0),
      unpreparedLessons: runs.reduce(
        (sum, run) => sum + run.unpreparedLessons.length,
        0,
      ),
      runs,
    };
  }
  async analytics(
    actor: LmsStaffActor,
    input: LmsAnalyticsInput,
  ): Promise<LmsAnalyticsDto> {
    if (!actor.isLeadership) throw new LmsError("portalAccessDenied", 403);
    const enabledRuns = await this.enabledRunIds();
    if (input.runId && !enabledRuns.includes(input.runId))
      throw new LmsError("lmsNotFound", 404);
    const periodTo = new Date().toISOString();
    const periodFrom = new Date(
      +new Date(periodTo) - input.days * 86400000,
    ).toISOString();
    const result = (await one<Record<string, number | string | null>>(
      this.pool,
      `
      WITH scoped_runs AS (
        SELECT id,group_id FROM lms_group_runs WHERE id=ANY($1::bigint[]) AND ($4::bigint IS NULL OR id=$4)
      ), enrolled AS (
        SELECT DISTINCT enrollment.student_id,run.id AS run_id FROM academy_student_group_enrollments enrollment JOIN scoped_runs run ON run.group_id=enrollment.group_id
        WHERE enrollment.enrolled_at<$3::timestamptz AND (enrollment.ended_at IS NULL OR enrollment.ended_at>$2::timestamptz)
      ), learners AS (SELECT DISTINCT student_id FROM enrolled), activity AS (
        SELECT event.student_id,event.run_id FROM lms_learning_events event WHERE event.type='material_read' AND event.data->>'actorKind'='self' AND event.occurred_at>=$2 AND event.occurred_at<$3
        UNION SELECT recipient.student_id,assignment.run_id FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE submission.submitted_at>=$2 AND submission.submitted_at<$3
        UNION SELECT recipient.student_id,assignment.run_id FROM lms_submission_drafts draft JOIN lms_assignment_recipients recipient ON recipient.id=draft.recipient_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE draft.saved_at>=$2 AND draft.saved_at<$3
        UNION SELECT recipient.student_id,quiz.run_id FROM lms_quiz_attempts attempt JOIN lms_quiz_recipients recipient ON recipient.id=attempt.recipient_id JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id WHERE (attempt.started_at>=$2 AND attempt.started_at<$3) OR (attempt.finished_at>=$2 AND attempt.finished_at<$3)
      ), first_submissions AS (
        SELECT DISTINCT ON(submission.recipient_id) submission.*,recipient.due_at FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN scoped_runs run ON run.id=assignment.run_id ORDER BY submission.recipient_id,submission.attempt_number
      ), current_submissions AS (
        SELECT DISTINCT ON(submission.recipient_id) submission.*,recipient.status FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN scoped_runs run ON run.id=assignment.run_id WHERE submission.withdrawn_at IS NULL ORDER BY submission.recipient_id,submission.attempt_number DESC
      ), first_reviews AS (
        SELECT submission.id,submission.submitted_at,MIN(review.created_at) AS reviewed_at FROM lms_submissions submission JOIN lms_reviews review ON review.submission_id=submission.id JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN scoped_runs run ON run.id=assignment.run_id GROUP BY submission.id
      ), scoped_threads AS (
        SELECT thread.*,(SELECT MIN(comment.created_at) FROM lms_comments comment WHERE comment.thread_id=thread.id AND comment.staff_user_id IS NOT NULL AND comment.audience<>'staff') AS replied_at FROM lms_threads thread JOIN scoped_runs run ON run.id=thread.run_id
      ), marks AS (
        SELECT mark.*,run.id AS run_id FROM academy_attendance mark JOIN academy_lessons lesson ON lesson.id=mark.lesson_id JOIN scoped_runs run ON run.group_id=lesson.group_id WHERE lesson.status='conducted' AND lesson.scheduled_at>=$2 AND lesson.scheduled_at<$3 AND EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.student_id=mark.student_id AND enrollment.group_id=lesson.group_id AND lesson.scheduled_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR lesson.scheduled_at<enrollment.ended_at))
      ), makeup AS (
        SELECT plan.* FROM lms_makeup_plans plan JOIN marks ON marks.lesson_id=plan.lesson_id AND marks.student_id=plan.student_id AND marks.run_id=plan.run_id WHERE marks.status='absent' AND plan.status<>'not_required'
      ) SELECT
        (SELECT COUNT(*)::int FROM learners) AS learners,
        (SELECT COUNT(*)::int FROM learners WHERE EXISTS(SELECT 1 FROM portal_student_links link JOIN portal_accounts account ON account.id=link.account_id WHERE link.student_id=learners.student_id AND link.kind='self' AND link.status='active' AND account.status='active' AND (link.expires_at IS NULL OR link.expires_at>$3))) AS activated,
        (SELECT COUNT(DISTINCT activity.student_id)::int FROM activity JOIN enrolled ON enrolled.student_id=activity.student_id AND enrolled.run_id=activity.run_id) AS learning_active,
        (SELECT COUNT(*)::int FROM first_submissions WHERE submitted_at>=$2 AND submitted_at<$3 AND CASE WHEN receipt_snapshot ? 'dueAt' THEN receipt_snapshot->>'dueAt' IS NOT NULL ELSE due_at IS NOT NULL END) AS dated_submissions,
        (SELECT COUNT(*)::int FROM first_submissions WHERE submitted_at>=$2 AND submitted_at<$3 AND NOT late AND CASE WHEN receipt_snapshot ? 'dueAt' THEN receipt_snapshot->>'dueAt' IS NOT NULL ELSE due_at IS NOT NULL END) AS on_time,
        (SELECT COUNT(*)::int FROM current_submissions WHERE submitted_at>=$2 AND submitted_at<$3) AS current_submissions,
        (SELECT COUNT(*)::int FROM current_submissions WHERE submitted_at>=$2 AND submitted_at<$3 AND status='submitted' AND NOT EXISTS(SELECT 1 FROM lms_reviews review WHERE review.submission_id=current_submissions.id)) AS awaiting_review,
        (SELECT COUNT(*)::int FROM first_reviews WHERE reviewed_at>=$2 AND reviewed_at<$3) AS reviewed,
        (SELECT AVG(EXTRACT(EPOCH FROM reviewed_at-submitted_at)/3600)::float8 FROM first_reviews WHERE reviewed_at>=$2 AND reviewed_at<$3) AS review_hours,
        (SELECT COUNT(*)::int FROM scoped_threads WHERE created_at>=$2 AND created_at<$3) AS help_created,
        (SELECT COUNT(*)::int FROM scoped_threads WHERE created_at>=$2 AND created_at<$3 AND status='open') AS open_help,
        (SELECT COUNT(*)::int FROM scoped_threads WHERE replied_at>=$2 AND replied_at<$3) AS answered,
        (SELECT AVG(EXTRACT(EPOCH FROM replied_at-created_at)/3600)::float8 FROM scoped_threads WHERE replied_at>=$2 AND replied_at<$3) AS response_hours,
        (SELECT COUNT(*)::int FROM marks) AS marked_lessons,
        (SELECT COUNT(*)::int FROM marks WHERE status='absent') AS absences,
        (SELECT COUNT(*)::int FROM makeup) AS makeup_plans,
        (SELECT COUNT(*)::int FROM makeup WHERE status='completed' AND completed_at<$3) AS makeup_completed`,
      [enabledRuns, periodFrom, periodTo, input.runId ?? null],
    ))!;
    const numeric = (key: string) => Number(result[key] ?? 0);
    const ratio = (
      numerator: string,
      denominator: string,
    ): LmsAnalyticsRatioDto => {
      const total = numeric(denominator);
      const value = numeric(numerator);
      return {
        numerator: value,
        denominator: total,
        percent: total ? Math.round((value / total) * 1000) / 10 : null,
      };
    };
    const latency = (hours: string, samples: string) => ({
      averageHours:
        result[hours] === null ? null : Math.round(numeric(hours) * 100) / 100,
      samples: numeric(samples),
    });
    return {
      periodFrom,
      periodTo,
      runId: input.runId ?? null,
      activatedAccounts: ratio("activated", "learners"),
      learningActive: ratio("learningActive", "learners"),
      onTimeSubmissions: ratio("onTime", "datedSubmissions"),
      awaitingReview: ratio("awaitingReview", "currentSubmissions"),
      reviewLatency: latency("reviewHours", "reviewed"),
      openHelp: ratio("openHelp", "helpCreated"),
      responseLatency: latency("responseHours", "answered"),
      absences: ratio("absences", "markedLessons"),
      completedMakeup: ratio("makeupCompleted", "makeupPlans"),
    };
  }
  async courses(
    actor: PortalActorContext,
    page?: LmsListOptions,
  ): Promise<LmsCourseDto[]> {
    const courses = await listRows<LmsCourseDto>(
      this.pool,
      `WITH course_enrollments AS MATERIALIZED (
        SELECT enrollment.*,run.id AS learning_run_id,run.status AS learning_run_status,run.access_until AS learning_run_access_until
        FROM academy_student_group_enrollments enrollment JOIN lms_group_runs run ON run.group_id=enrollment.group_id
        WHERE enrollment.student_id=$1
      ) SELECT enrollment.id,enrollment.learning_run_id AS run_id,enrollment.id AS enrollment_id,g.id AS group_id,g.name AS group_name,course.name AS course_name,teacher.full_name AS teacher_name,
        CASE WHEN EXISTS(SELECT 1 FROM lms_course_completions completion WHERE completion.student_id=enrollment.student_id AND completion.run_id=enrollment.learning_run_id AND completion.reopened_at IS NULL) THEN 'completed' ELSE enrollment.learning_run_status END AS status,
        enrollment.enrolled_at,enrollment.ended_at,NULL::timestamptz AS access_until,jsonb_build_object('completed',0,'total',0,'percent',null) AS progress
      FROM course_enrollments enrollment JOIN academy_groups g ON g.id=enrollment.group_id JOIN academy_courses course ON course.id=g.course_id
      LEFT JOIN academy_teachers teacher ON teacher.id=g.teacher_id
      WHERE enrollment.student_id=$1 ORDER BY enrollment.enrolled_at DESC,enrollment.id DESC`,
      [actor.studentId],
      page,
      page ? await this.enabledRunIds(actor.studentId) : undefined,
    );
    const materials = await this.materials(actor);
    const schedule = await this.schedule(
      actor,
      new Date().toISOString(),
      new Date(Date.now() + 90 * 86400000).toISOString(),
      undefined,
      materials,
    );
    return Promise.all(
      (await this.enabledRecords(courses)).map(async (course) => {
        const metrics = await one<{ completed: number; total: number }>(
          this.pool,
          `SELECT COUNT(*) FILTER(WHERE recipient.status='accepted')::int AS completed,COUNT(*)::int AS total FROM lms_assignment_recipients recipient JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE recipient.enrollment_id=$1 AND version.required AND recipient.opens_at<=now() AND recipient.status NOT IN('excused','cancelled')`,
          [course.enrollmentId],
        );
        return {
          ...course,
          nextLesson:
            schedule.find(
              (lesson) =>
                lesson.runId === course.runId && lesson.status !== "cancelled",
            ) ?? null,
          calendarUnitId:
            schedule.find(
              (lesson) =>
                lesson.runId === course.runId && lesson.status !== "cancelled",
            )?.unitId ?? null,
          currentUnit:
            (await this.publishedUnits(actor, course.runId, materials))
              .filter((unit) => unit.status === "available")
              .map(({ id, title }) => ({ id, title }))[0] ?? null,
          progress: progressMetric(
            metrics?.completed ?? 0,
            metrics?.total ?? 0,
          ),
        };
      }),
    );
  }
  async requireEnrollment(
    sql: LmsSql,
    actor: PortalActorContext,
    runId: number,
  ) {
    const enrollment = await one<{
      id: number;
      enrolledAt: string;
      endedAt: string | null;
      accessUntil: string | null;
    }>(
      sql,
      `SELECT enrollment.id,enrollment.enrolled_at,enrollment.ended_at,run.access_until FROM academy_student_group_enrollments enrollment JOIN lms_group_runs run ON run.group_id=enrollment.group_id WHERE enrollment.student_id=$1 AND run.id=$2 ORDER BY enrollment.enrolled_at DESC LIMIT 1`,
      [actor.studentId, runId],
    );
    if (!enrollment) throw new LmsError("lmsNotFound", 404);
    await this.requireRunEnabled(sql, runId);
    return enrollment;
  }
  async course(
    actor: PortalActorContext,
    runId: number,
  ): Promise<LmsCourseDetailDto> {
    await this.requireEnrollment(this.pool, actor, runId);
    const course = (await this.courses(actor)).find(
      (row) => row.runId === runId,
    );
    if (!course) throw new LmsError("lmsNotFound", 404);
    const materials = await this.materials(actor, runId);
    const units = await this.publishedUnits(actor, runId, materials);
    return {
      ...course,
      units,
      materials,
    };
  }
  async materials(
    actor: PortalActorContext,
    runId?: number,
    page?: LmsListOptions,
    sql: LmsSql = this.pool,
  ): Promise<LmsMaterialDto[]> {
    return listRows<LmsMaterialDto>(
      sql,
      `WITH visible_publications AS MATERIALIZED (
        SELECT publication.* FROM lms_material_publications publication
        JOIN academy_student_group_enrollments enrollment ON enrollment.id=publication.enrollment_id
        WHERE ${enrollmentVisibilitySql()} AND publication.publish_at<=now() AND publication.revoked_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM lms_material_publications newer WHERE newer.material_id=publication.material_id AND newer.enrollment_id=enrollment.id AND newer.id>publication.id AND newer.publish_at<=now() AND newer.revoked_at IS NULL)
      ) SELECT publication.id,publication.id AS publication_id,version.id AS material_version_id,material.run_id,material.unit_id,version.title,version.body,version.category,version.links,version.file_ids,version.video_url,version.duration_minutes,author.full_name AS author_name,publication.publish_at AS published_at,
        (SELECT MIN(lesson.scheduled_at) FROM lms_lesson_bindings binding JOIN academy_lessons lesson ON lesson.id=binding.lesson_id WHERE binding.run_id=material.run_id AND binding.unit_id=material.unit_id) AS lesson_at,
        EXISTS(SELECT 1 FROM lms_material_reads read JOIN lms_material_publications read_publication ON read_publication.id=read.publication_id WHERE read.student_id=$1 AND read_publication.material_id=material.id) AS read
      FROM visible_publications publication JOIN lms_material_versions version ON version.id=publication.material_version_id
      LEFT JOIN users author ON author.id=version.created_by JOIN lms_materials material ON material.id=publication.material_id
      JOIN lms_group_runs run ON run.id=material.run_id
      WHERE material.state='published' AND (material.unit_id IS NULL OR ${runUnitSelectionSql('run', 'material.unit_id')}) AND TRUE ${runId ? "AND material.run_id=$2" : ""}
      ORDER BY publication.publish_at,publication.id`,
      runId ? [actor.studentId, runId] : [actor.studentId],
      page,
      page ? await this.enabledRunIds(actor.studentId, sql) : undefined,
    ).then((items) => this.enabledRecords(items, sql));
  }
  async unit(actor: PortalActorContext, unitId: number) {
    const materials = (await this.materials(actor)).filter(
      (material) => material.unitId === unitId,
    );
    if (!materials.length) throw new LmsError("lmsNotFound", 404);
    const unit = (await this.publishedUnits(actor, materials[0].runId)).find(
      (item) => item.id === unitId,
    );
    if (!unit) throw new LmsError("lmsNotFound", 404);
    return unit;
  }
  async publishedUnits(
    actor: PortalActorContext,
    runId: number,
    knownMaterials?: readonly LmsMaterialDto[],
  ): Promise<LmsUnitDto[]> {
    const materials = (
      knownMaterials ?? (await this.materials(actor, runId))
    ).filter((material) => material.runId === runId);
    const enrollment = await this.requireEnrollment(this.pool, actor, runId);
    const units = await rows<{
      id: number;
      title: string;
      position: number;
      required: boolean;
      sectionTitle: string | null;
      openAt: string | null;
      preview: boolean;
      pending: boolean;
    }>(
      this.pool,
      `WITH pending_units AS MATERIALIZED (
        SELECT assignment.unit_id FROM lms_assignment_recipients recipient
        JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id
        JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id
        WHERE recipient.student_id=$1 AND assignment.run_id=$2 AND version.required AND recipient.opens_at<=now() AND recipient.status NOT IN('accepted','excused','cancelled')
        UNION ALL
        SELECT quiz.unit_id FROM lms_quiz_recipients recipient JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id
        JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id
        WHERE recipient.student_id=$1 AND quiz.run_id=$2 AND version.required AND recipient.opens_at<=now() AND recipient.status='assigned'
        AND NOT EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.state='finished' AND attempt.passed)
      ) SELECT unit.id,unit.title,unit.position,unit.required,section.title AS section_title,preview.open_at,(preview.enabled AND preview.visible_from<=now() AND TRUE AND preview.visible_from>=$3::timestamptz AND ($4::timestamptz IS NULL OR preview.visible_from<$4::timestamptz)) AS preview,
      EXISTS(SELECT 1 FROM pending_units pending_unit WHERE pending_unit.unit_id=unit.id) AS pending
      FROM lms_units unit JOIN lms_group_runs run ON run.course_version_id=unit.course_version_id LEFT JOIN lms_sections section ON section.id=unit.section_id LEFT JOIN lms_unit_previews preview ON preview.run_id=run.id AND preview.unit_id=unit.id WHERE run.id=$2 AND ${runUnitSelectionSql()} ORDER BY unit.position`,
      [actor.studentId, runId, enrollment.enrolledAt, enrollment.endedAt],
    );
    return units
      .filter(
        (unit) =>
          unit.preview ||
          materials.some((material) => material.unitId === unit.id),
      )
      .map((unit) => {
        const published = materials.filter(
          (material) => material.unitId === unit.id,
        );
        return {
          id: unit.id,
          title: unit.title,
          position: unit.position,
          required: unit.required,
          sectionTitle: unit.sectionTitle,
          openAt: published.length ? published[0].publishedAt : unit.openAt,
          status: !published.length
            ? "soon"
            : !unit.pending && published.every((material) => material.read)
              ? "studied"
              : "available",
          materials: published,
        };
      });
  }
  async readMaterial(
    actor: PortalActorContext,
    publicationId: number,
    read: boolean,
  ) {
    return transaction(this.pool, async (sql) => {
      const material = (
        await this.materials(actor, undefined, undefined, sql)
      ).find((row) => row.publicationId === publicationId);
      if (!material) throw new LmsError("lmsNotFound", 404);
      if (read) {
        await sql.query(
          "INSERT INTO lms_material_reads(publication_id,student_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [publicationId, actor.studentId],
        );
        await recordEvent(
          sql,
          actor.studentId,
          material.runId,
          "material_read",
          publicationId,
          `material-read:${actor.studentId}:${publicationId}:${actor.portalAccountId}`,
          { accountId: actor.portalAccountId, actorKind: actor.kind },
        );
      } else
        await sql.query(
          "DELETE FROM lms_material_reads WHERE student_id=$2 AND publication_id IN(SELECT id FROM lms_material_publications WHERE material_id=(SELECT material_id FROM lms_material_publications WHERE id=$1))",
          [publicationId, actor.studentId],
        );
      return { read };
    });
  }
  async schedule(
    actor: PortalActorContext,
    from: string,
    to: string,
    page?: LmsListOptions,
    knownMaterials?: readonly LmsMaterialDto[],
  ): Promise<LmsScheduleDto[]> {
    const schedule = await listRows<LmsScheduleDto>(
      this.pool,
      `SELECT lesson.id,lesson.id AS lesson_id,run.id AS run_id,binding.unit_id,EXISTS(SELECT 1 FROM academy_lesson_reschedules change WHERE change.lesson_id=lesson.id) AS rescheduled,(SELECT change.previous_scheduled_at FROM academy_lesson_reschedules change WHERE change.lesson_id=lesson.id ORDER BY change.id DESC LIMIT 1) AS previous_scheduled_at,course.name AS course_name,g.name AS group_name,lesson.topic,lesson.scheduled_at,(lesson.scheduled_at + lesson.duration_minutes * interval '1 minute') AS ends_at,lesson.duration_minutes,lesson.status,(SELECT teacher.full_name FROM academy_teachers teacher WHERE teacher.id=COALESCE(lesson.teacher_id,g.teacher_id)) AS teacher_name,(SELECT school.name FROM academy_schools school WHERE school.id=lesson.school_id) AS school_name,(SELECT room.name FROM academy_rooms room WHERE room.id=lesson.room_id) AS room_name,COALESCE(binding.format,run.format) AS format,CASE WHEN COALESCE(binding.format,run.format)='online' THEN COALESCE(binding.meeting_url,run.meeting_url) ELSE NULL END AS meeting_url,(SELECT mark.status FROM academy_attendance mark WHERE mark.lesson_id=lesson.id AND mark.student_id=$1) AS attendance,lesson.updated_at FROM academy_lessons lesson JOIN academy_groups g ON g.id=lesson.group_id JOIN academy_courses course ON course.id=g.course_id JOIN lms_group_runs run ON run.group_id=g.id LEFT JOIN lms_lesson_bindings binding ON binding.lesson_id=lesson.id AND binding.run_id=run.id WHERE lesson.scheduled_at>=$2::timestamptz AND lesson.scheduled_at<$3::timestamptz AND EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.group_id=g.id AND enrollment.student_id=$1 AND lesson.scheduled_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR lesson.scheduled_at<enrollment.ended_at)) ORDER BY lesson.scheduled_at,lesson.id`,
      [actor.studentId, from, to],
      page,
      page ? await this.enabledRunIds(actor.studentId) : undefined,
    ).then((items) => this.enabledRecords(items));
    if (!actor.permissions?.includes("learning.read"))
      return schedule.map((lesson) => ({
        ...lesson,
        unitId: null,
        materials: [],
        assignments: [],
      }));
    const materials = knownMaterials ?? (await this.materials(actor));
    const assignments = await rows<{
      runId: number;
      unitId: number | null;
      recipientId: number;
      title: string;
      status: import("@shared/contracts/lms").LmsAssignmentStatus;
    }>(
      this.pool,
      `SELECT assignment.run_id,assignment.unit_id,recipient.id AS recipient_id,version.title,recipient.status FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id JOIN academy_student_group_enrollments enrollment ON enrollment.id=recipient.enrollment_id WHERE ${enrollmentVisibilitySql("enrollment", "recipient.opens_at")} AND recipient.opens_at<=now() AND recipient.status<>'cancelled'`,
      [actor.studentId],
    );
    return schedule.map((lesson) => ({
      ...lesson,
      attendance: actor.permissions.includes("attendance.read")
        ? lesson.attendance
        : null,
      materials: materials.filter(
        (material) =>
          material.runId === lesson.runId && material.unitId === lesson.unitId,
      ),
      assignments: assignments
        .filter(
          (assignment) =>
            assignment.runId === lesson.runId &&
            assignment.unitId === lesson.unitId,
        )
        .map(({ recipientId, title, status }) => ({
          recipientId,
          title,
          status,
        })),
    }));
  }
  async attendance(actor: PortalActorContext, page?: LmsListOptions) {
    return listRows<LmsScheduleDto>(
      this.pool,
      `SELECT lesson.id,lesson.id AS lesson_id,run.id AS run_id,lesson.topic,lesson.scheduled_at,lesson.status,mark.status AS attendance,g.name AS group_name,course.name AS course_name FROM academy_lessons lesson JOIN academy_groups g ON g.id=lesson.group_id JOIN academy_courses course ON course.id=g.course_id JOIN lms_group_runs run ON run.group_id=g.id LEFT JOIN academy_attendance mark ON mark.lesson_id=lesson.id AND mark.student_id=$1 WHERE lesson.status='conducted' AND EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.group_id=g.id AND enrollment.student_id=$1 AND lesson.scheduled_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR lesson.scheduled_at<enrollment.ended_at)) ORDER BY lesson.scheduled_at DESC,lesson.id DESC`,
      [actor.studentId],
      page,
      page ? await this.enabledRunIds(actor.studentId) : undefined,
    ).then((items) => this.enabledRecords(items));
  }
  async progress(
    actor: PortalActorContext,
    runId?: number,
    period?: { from: string; to: string },
    knownMaterials?: readonly LmsMaterialDto[],
    sql: LmsSql = this.pool,
  ): Promise<LmsProgressDto> {
    if (runId) await this.requireRunEnabled(sql, runId);
    const allowedRuns = await this.enabledRunIds(actor.studentId, sql);
    const runClause = runId
      ? " AND run.id=ANY($2::bigint[]) AND run.id=$3"
      : " AND run.id=ANY($2::bigint[])";
    const params: unknown[] = runId
      ? [actor.studentId, allowedRuns, runId]
      : [actor.studentId, allowedRuns];
    const periodClause = period
      ? ` AND lesson.scheduled_at>=$${params.length + 1}::timestamptz AND lesson.scheduled_at<$${params.length + 2}::timestamptz`
      : "";
    const attendanceParams = period
      ? [...params, period.from, period.to]
      : params;
    const attendance = await one<{
      present: number;
      absent: number;
      unmarked: number;
    }>(
      sql,
      `SELECT COUNT(*) FILTER(WHERE mark.status='present')::int AS present,COUNT(*) FILTER(WHERE mark.status='absent')::int AS absent,COUNT(*) FILTER(WHERE mark.status IS NULL)::int AS unmarked FROM academy_lessons lesson JOIN lms_group_runs run ON run.group_id=lesson.group_id LEFT JOIN academy_attendance mark ON mark.lesson_id=lesson.id AND mark.student_id=$1 WHERE lesson.status='conducted' AND EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.group_id=lesson.group_id AND enrollment.student_id=$1 AND lesson.scheduled_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR lesson.scheduled_at<enrollment.ended_at))${runClause}${periodClause}`,
      attendanceParams,
    );
    const activityPeriodClause = period
      ? ` AND recipient.opens_at>=$${params.length + 1}::timestamptz AND recipient.opens_at<$${params.length + 2}::timestamptz`
      : "";
    const activityParams = period
      ? [...params, period.from, period.to]
      : params;
    const assignments = await one<{ completed: number; total: number }>(
      sql,
      `SELECT COUNT(*) FILTER(WHERE recipient.status='accepted')::int AS completed,COUNT(*)::int AS total FROM lms_assignment_recipients recipient JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_group_runs run ON run.id=assignment.run_id WHERE recipient.student_id=$1 AND recipient.status NOT IN('excused','cancelled') AND version.required AND recipient.opens_at<=now() AND ${recipientEnrollmentVisibilitySql()}${runClause}${activityPeriodClause}`,
      activityParams,
    );
    const quizzes = await one<{ completed: number; total: number }>(
      sql,
      `SELECT COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.passed AND attempt.state='finished'))::int AS completed,COUNT(*)::int AS total FROM lms_quiz_recipients recipient JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id JOIN lms_group_runs run ON run.id=quiz.run_id WHERE recipient.student_id=$1 AND recipient.status='assigned' AND version.required AND recipient.opens_at<=now() AND ${recipientEnrollmentVisibilitySql()}${runClause}${activityPeriodClause}`,
      activityParams,
    );
    const materials = (
      knownMaterials ?? (await this.materials(actor, runId, undefined, sql))
    ).filter(
      (row) =>
        allowedRuns.includes(row.runId) &&
        (!runId || row.runId === runId) &&
        (!period ||
          (+new Date(row.publishedAt) >= +new Date(period.from) &&
            +new Date(row.publishedAt) < +new Date(period.to))),
    );
    return {
      attendance: {
        ...progressMetric(
          attendance?.present ?? 0,
          (attendance?.present ?? 0) + (attendance?.absent ?? 0),
        ),
        unmarked: attendance?.unmarked ?? 0,
      },
      assignments: progressMetric(
        assignments?.completed ?? 0,
        assignments?.total ?? 0,
      ),
      quizzes: progressMetric(quizzes?.completed ?? 0, quizzes?.total ?? 0),
      materials: progressMetric(
        materials.filter((row) => row.read).length,
        materials.length,
      ),
    };
  }
  async createRun(
    actor: LmsStaffActor,
    input: {
      groupId: number;
      courseVersionId?: number;
      format: string;
      meetingUrl: string | null;
    },
  ) {
    if (!(await this.enabledForGroup(input.groupId)))
      throw new LmsError("portalUnavailable", 404);
    return transaction(this.pool, async (sql) => {
      const group = await one<{
        courseId: number;
        program: unknown;
        selectedCourseLessonIds?: string[] | null;
      }>(
        sql,
        `SELECT g.course_id,course.program,to_jsonb(g)->'selected_course_lesson_ids' AS selected_course_lesson_ids FROM academy_groups g JOIN academy_courses course ON course.id=g.course_id WHERE g.id=$1 AND ($2 OR ($4::boolean AND EXISTS(SELECT 1 FROM academy_teachers teacher WHERE teacher.id=g.teacher_id AND teacher.user_id=$3 AND teacher.status='active')) OR EXISTS(SELECT 1 FROM lms_staff_permissions p WHERE p.user_id=$3 AND p.permission='content.manage')) FOR UPDATE OF g`,
        [
          input.groupId,
          actor.isLeadership,
          actor.userId,
          actor.modules.includes("teacher"),
        ],
      );
      if (!group) throw new LmsError("lmsNotFound", 404);
      const existing = await one(
        sql,
        "SELECT * FROM lms_group_runs WHERE group_id=$1",
        [input.groupId],
      );
      if (existing) return existing;
      let versionId = input.courseVersionId;
      if (versionId) {
        const published = await one<{ id: number; program: unknown }>(sql,
          "SELECT id,program FROM lms_course_versions WHERE id=$1 AND course_id=$2 AND state='published'", [versionId, group.courseId]);
        const publishedIds = new Set(flattenCourseCurriculum(published?.program).map(lesson => lesson.id));
        if (!published || group.selectedCourseLessonIds?.some(id => !publishedIds.has(id))) throw new LmsError("lmsCourseVersionInvalid");
      } else {
        await sql.query(
          "SELECT id FROM academy_courses WHERE id=$1 FOR UPDATE",
          [group.courseId],
        );
        const version = await one<{ id: number }>(
          sql,
          `INSERT INTO lms_course_versions(course_id,version,program,created_by) SELECT $1,COALESCE(MAX(version),0)+1,$2::jsonb,$3 FROM lms_course_versions WHERE course_id=$1 RETURNING id`,
          [group.courseId, JSON.stringify(group.program), actor.userId],
        );
        versionId = version!.id;
        await insertCrmCourseUnits(sql, versionId, group.program);
      }
      const run = await one<{ id: number }>(
        sql,
        "INSERT INTO lms_group_runs(group_id,course_version_id,format,meeting_url) VALUES($1,$2,$3,$4) RETURNING *",
        [input.groupId, versionId, input.format, input.meetingUrl],
      );
      const lessons = await rows<{
        id: number;
        lessonNumber: number;
        topic: string;
        materials: string | null;
        courseLessonId?: string | null;
      }>(
        sql,
        "SELECT id,lesson_number,topic,materials,to_jsonb(academy_lessons)->>'course_lesson_id' AS course_lesson_id FROM academy_lessons WHERE group_id=$1 AND status<>'cancelled' ORDER BY lesson_number",
        [input.groupId],
      );
      const units = await rows<{ id: number; position: number }>(
        sql,
        "SELECT id,position FROM lms_units WHERE course_version_id=$1 ORDER BY position",
        [versionId],
      );
      if (!units.length && !input.courseVersionId) {
        for (let i = 0; i < lessons.length; i++) {
          const unit = await one<{ id: number; position: number }>(
            sql,
            "INSERT INTO lms_units(course_version_id,title,position) VALUES($1,$2,$3) RETURNING id,position",
            [versionId, lessons[i].topic, i],
          );
          units.push(unit!);
        }
      }
      const pinned = await one<{ program: unknown }>(sql, "SELECT program FROM lms_course_versions WHERE id=$1", [versionId]);
      for (const lesson of lessons) {
        const position = courseLessonPosition(pinned?.program, lesson.courseLessonId, lesson.lessonNumber);
        const unit = units.find(
          (item) => item.position === position,
        );
        if (unit)
          await sql.query(
            "INSERT INTO lms_lesson_bindings(run_id,unit_id,lesson_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [run!.id, unit.id, lesson.id],
          );
        if (lesson.materials?.trim()) {
          const material = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_materials(run_id,unit_id,created_by) VALUES($1,$2,$3) RETURNING id",
            [run!.id, unit?.id ?? null, actor.userId],
          );
          await sql.query(
            "INSERT INTO lms_material_versions(material_id,version,title,body,category,created_by) VALUES($1,1,$2,$3,'lesson',$4)",
            [material!.id, lesson.topic, lesson.materials, actor.userId],
          );
        }
      }
      await recordStaffAudit(
        sql,
        actor,
        run!.id,
        "group_run",
        run!.id,
        "create",
        null,
        {
          groupId: input.groupId,
          courseVersionId: versionId,
          format: input.format,
          meetingUrl: input.meetingUrl,
        },
      );
      return run;
    });
  }
  async createMaterial(actor: LmsStaffActor, input: LmsMaterialInput) {
    return transaction(this.pool, async (sql) => {
      await this.requireStaffAccess(sql, actor, input.runId, "content.manage");
      return idempotentStaffCommand(
        sql,
        actor,
        input.runId,
        "material_create",
        input,
        async () => {
          await this.assertUnit(sql, input.runId, input.unitId);
          await this.authorizeFiles(sql, actor, input.fileIds, {
            runId: input.runId,
          });
          const material = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_materials(run_id,unit_id,created_by) VALUES($1,$2,$3) RETURNING id",
            [input.runId, input.unitId ?? null, actor.userId],
          );
          const version = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_material_versions(material_id,version,title,body,category,links,file_ids,created_by,video_url,duration_minutes) VALUES($1,1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) RETURNING id",
            [
              material!.id,
              input.title,
              input.body,
              input.category,
              JSON.stringify(input.links),
              JSON.stringify(input.fileIds),
              actor.userId,
              input.videoUrl,
              input.durationMinutes,
            ],
          );
          if (input.publishAt) {
            await this.publishMaterial(
              sql,
              actor,
              material!.id,
              version!.id,
              input.publishAt,
              input.recipientEnrollmentIds,
            );
          } else
            await recordStaffAudit(
              sql,
              actor,
              input.runId,
              "material",
              material!.id,
              "create",
              null,
              {
                materialVersionId: version!.id,
                unitId: input.unitId ?? null,
                state: "draft",
              },
            );
          return {
            id: material!.id,
            materialVersionId: version!.id,
            state: input.publishAt ? "published" : "draft",
          };
        },
      );
    });
  }
  async assertUnit(sql: LmsSql, runId: number, unitId?: number | null) {
    if (unitId) await sql.query(
      'SELECT selected_group.id FROM academy_groups selected_group JOIN lms_group_runs selected_run ON selected_run.group_id=selected_group.id WHERE selected_run.id=$1 FOR SHARE OF selected_group',
      [runId],
    );
    if (
      unitId &&
      !(await one(
        sql,
        `SELECT unit.id FROM lms_units unit JOIN lms_group_runs run ON run.course_version_id=unit.course_version_id WHERE run.id=$1 AND unit.id=$2 AND ${runUnitSelectionSql()}`,
        [runId, unitId],
      ))
    )
      throw new LmsError("lmsNotFound", 404);
  }
  async publishMaterial(
    sql: LmsSql,
    actor: LmsStaffActor,
    materialId: number,
    versionId: number,
    publishAt: string,
    recipients?: number[],
  ) {
    const material = await one<{ runId: number; unitId: number | null }>(
      sql,
      "SELECT run_id,unit_id FROM lms_materials WHERE id=$1 FOR UPDATE",
      [materialId],
    );
    if (!material) throw new LmsError("lmsNotFound", 404);
    await this.requireStaffAccess(sql, actor, material.runId, "content.manage");
    await this.assertUnit(sql, material.runId, material.unitId);
    await sql.query("UPDATE lms_materials SET state='published' WHERE id=$1", [
      materialId,
    ]);
    const enrollments = await this.recipientEnrollments(
      sql,
      material.runId,
      recipients,
    );
    for (const enrollment of enrollments) {
      const publication = await one<{ id: number }>(
        sql,
        "INSERT INTO lms_material_publications(material_id,material_version_id,enrollment_id,publish_at) VALUES($1,$2,$3,$4) ON CONFLICT(material_version_id,enrollment_id) DO UPDATE SET material_id=EXCLUDED.material_id RETURNING id",
        [materialId, versionId, enrollment.id, publishAt],
      );
      await recordEvent(
        sql,
        enrollment.studentId,
        material.runId,
        "material_published",
        publication!.id,
        `material-published:${publication!.id}`,
        { publishAt },
      );
    }
    await recordStaffAudit(
      sql,
      actor,
      material.runId,
      "material",
      materialId,
      "publish",
      null,
      {
        materialVersionId: versionId,
        publishAt,
        recipientEnrollmentIds: enrollments.map((enrollment) => enrollment.id),
      },
    );
    return { recipientCount: enrollments.length };
  }
  async recipientEnrollments(sql: LmsSql, runId: number, ids?: number[]) {
    const enrollments = await rows<{ id: number; studentId: number }>(
      sql,
      `SELECT enrollment.id,enrollment.student_id FROM academy_student_group_enrollments enrollment JOIN lms_group_runs run ON run.group_id=enrollment.group_id WHERE run.id=$1 AND enrollment.status='active' ${ids ? "AND enrollment.id=ANY($2::int[])" : ""}`,
      ids ? [runId, ids] : [runId],
    );
    if (ids && enrollments.length !== new Set(ids).size)
      throw new LmsError("lmsRecipientsInvalid");
    return enrollments;
  }
  async managementGroups(actor: LmsStaffActor, page?: LmsListOptions) {
    const enabledGroups = [];
    if (page)
      for (const group of await rows<{ id: number }>(
        this.pool,
        "SELECT id FROM academy_groups",
      ))
        if (await this.enabledForGroup(group.id)) enabledGroups.push(group.id);
    const groups = await listRows<LmsStaffRunDto & { id:number; crmCourseId:number|null; crmProgram:unknown; preparedSetupStatus:CrmPreparationStatus|null }>(
      this.pool,
      `SELECT g.id,g.id AS group_id,g.name AS group_name,course.name AS course_name,course.id AS course_id,crm_course.id AS crm_course_id,crm_course.program AS crm_program,preparation.new_value->>'setupStatus' AS prepared_setup_status,teacher_name.full_name AS teacher_name,run.id AS run_id,COALESCE(run.status,g.status) AS status,run.course_version_id,run.version,run.format,run.meeting_url,NULL::timestamptz AS access_until,(SELECT COUNT(*)::int FROM academy_student_group_enrollments enrollment WHERE enrollment.group_id=g.id AND enrollment.status='active') AS student_count
       FROM academy_groups g LEFT JOIN lms_group_runs run ON run.group_id=g.id LEFT JOIN lms_course_versions pinned ON pinned.id=run.course_version_id
       LEFT JOIN academy_courses course ON course.id=COALESCE(pinned.course_id,g.course_id) LEFT JOIN academy_courses crm_course ON crm_course.id=g.course_id
       LEFT JOIN LATERAL(SELECT new_value FROM lms_learning_audit WHERE entity_type='crm_group_preparation' AND entity_id=g.id AND action='crm.prepared' ORDER BY id DESC LIMIT 1) preparation ON true
       LEFT JOIN academy_teachers teacher_name ON teacher_name.id=g.teacher_id WHERE ($1 OR ($5::boolean AND EXISTS(SELECT 1 FROM academy_teachers teacher WHERE teacher.id=g.teacher_id AND teacher.user_id=$2 AND teacher.status='active')) OR EXISTS(SELECT 1 FROM lms_staff_permissions p WHERE p.user_id=$2 AND p.permission=ANY($3::text[]))) AND ($4::bigint[] IS NULL OR g.id=ANY($4)) ORDER BY g.name`,
      [
        actor.isLeadership,
        actor.userId,
        LMS_STAFF_PERMISSIONS.filter(
          (permission) =>
            !["access.manage", "portfolio.moderate"].includes(permission),
        ),
        page ? enabledGroups : null,
        actor.modules.includes("teacher"),
      ],
      page,
    );
    const grants = await rows<{ permission: string }>(
      this.pool,
      "SELECT permission FROM lms_staff_permissions WHERE user_id=$1",
      [actor.userId],
    );
    const grantNames = grants.map((row) => row.permission);
    const visible = [];
    for (const group of groups) {
      if (await this.enabledForGroup(group.groupId)) {
        const assigned =
          actor.modules.includes("teacher") &&
          (await one(
            this.pool,
            "SELECT teacher.id FROM academy_groups g JOIN academy_teachers teacher ON teacher.id=g.teacher_id WHERE g.id=$1 AND teacher.user_id=$2 AND teacher.status='active'",
            [group.groupId, actor.userId],
          ));
        const {crmCourseId,crmProgram,preparedSetupStatus,...publicGroup} = group;
        const setupStatus:CrmPreparationStatus = crmCourseId === null ? "needs_course" : group.runId ? preparedSetupStatus === "needs_program_review" ? "needs_program_review" : "ready" : !crmGroupFormat(group.groupName,this.policy.crmPreparationDefaultFormat?.() ?? null) ? "needs_format" : crmProgramUnits(crmProgram) ? "preparing" : "needs_program_review";
        visible.push({
          ...publicGroup,
          setupStatus,
          permissions: LMS_STAFF_PERMISSIONS.filter(
            (permission) =>
              assigned ||
              grantNames.includes(permission) ||
              hasImplicitStaffRunAccess(actor, permission),
          ),
          canManageTemplates:
            actor.isLeadership || Boolean(assigned) || grantNames.includes("content.manage"),
        });
      }
    }
    return visible;
  }
  async managementMaterials(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ) {
    await this.requireStaffAccess(this.pool, actor, runId, "content.manage");
    return listRows(
      this.pool,
      `SELECT material.id,material.run_id,material.unit_id,material.state,version.id AS material_version_id,version.version,version.title,version.body,version.category,version.links,version.file_ids,version.video_url,version.duration_minutes,(SELECT MAX(publish_at) FROM lms_material_publications publication WHERE publication.material_version_id=version.id AND publication.revoked_at IS NULL) AS publish_at FROM lms_materials material JOIN lms_group_runs run ON run.id=material.run_id JOIN LATERAL(SELECT * FROM lms_material_versions v WHERE v.material_id=material.id ORDER BY version DESC LIMIT 1) version ON true WHERE material.run_id=$1 AND (material.unit_id IS NULL OR ${runUnitSelectionSql("run", "material.unit_id")}) ORDER BY material.id DESC`,
      [runId],
      page,
    );
  }
  async reviseMaterial(
    actor: LmsStaffActor,
    materialId: number,
    input: LmsMaterialInput,
  ) {
    return transaction(this.pool, async (sql) => {
      const material = await one<{ runId: number; unitId: number | null }>(
        sql,
        "SELECT run_id,unit_id FROM lms_materials WHERE id=$1 FOR UPDATE",
        [materialId],
      );
      if (!material || material.runId !== input.runId)
        throw new LmsError("lmsNotFound", 404);
      await this.requireStaffAccess(
        sql,
        actor,
        material.runId,
        "content.manage",
      );
      await this.assertUnit(sql, material.runId, material.unitId);
      return idempotentStaffCommand(
        sql,
        actor,
        material.runId,
        `material_revise:${materialId}`,
        input,
        async () => {
          await this.authorizeFiles(sql, actor, input.fileIds, {
            runId: material.runId,
          });
          const version = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_material_versions(material_id,version,title,body,category,links,file_ids,created_by,video_url,duration_minutes) SELECT $1,MAX(version)+1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9 FROM lms_material_versions WHERE material_id=$1 RETURNING id",
            [
              materialId,
              input.title,
              input.body,
              input.category,
              JSON.stringify(input.links),
              JSON.stringify(input.fileIds),
              actor.userId,
              input.videoUrl,
              input.durationMinutes,
            ],
          );
          if (input.publishAt)
            await this.publishMaterial(
              sql,
              actor,
              materialId,
              version!.id,
              input.publishAt,
              input.recipientEnrollmentIds,
            );
          else
            await recordStaffAudit(
              sql,
              actor,
              material.runId,
              "material",
              materialId,
              "revise",
              null,
              { materialVersionId: version!.id, state: "draft" },
            );
          return { id: materialId, materialVersionId: version!.id };
        },
      );
    });
  }
  async archiveMaterial(actor: LmsStaffActor, materialId: number) {
    return transaction(this.pool, async (sql) => {
      const material = await one<{ runId: number; state: string }>(
        sql,
        "SELECT run_id,state FROM lms_materials WHERE id=$1 FOR UPDATE",
        [materialId],
      );
      if (!material) throw new LmsError("lmsNotFound", 404);
      await this.requireStaffAccess(
        sql,
        actor,
        material.runId,
        "content.manage",
      );
      if (material.state === "archived") return { archived: true };
      await sql.query("UPDATE lms_materials SET state='archived' WHERE id=$1", [
        materialId,
      ]);
      await sql.query(
        "UPDATE lms_material_publications SET revoked_at=now() WHERE material_id=$1 AND revoked_at IS NULL",
        [materialId],
      );
      await recordStaffAudit(
        sql,
        actor,
        material.runId,
        "material",
        materialId,
        "archive",
        { state: material.state },
        { state: "archived" },
      );
      return { archived: true };
    });
  }
  async publishExistingMaterial(
    actor: LmsStaffActor,
    materialId: number,
    input: { publishAt: string; recipientEnrollmentIds?: number[] },
  ) {
    return transaction(this.pool, async (sql) => {
      const version = await one<{ id: number }>(
        sql,
        "SELECT id FROM lms_material_versions WHERE material_id=$1 ORDER BY version DESC LIMIT 1",
        [materialId],
      );
      if (!version) throw new LmsError("lmsNotFound", 404);
      return this.publishMaterial(
        sql,
        actor,
        materialId,
        version.id,
        input.publishAt,
        input.recipientEnrollmentIds,
      );
    });
  }
  async enrollments(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ) {
    await this.requireStaffAccess(
      this.pool,
      actor,
      runId,
      LMS_STAFF_PERMISSIONS.filter(
        (permission) =>
          !["access.manage", "portfolio.moderate"].includes(permission),
      ),
    );
    return listRows<{
      id: number;
      studentId: number;
      studentName: string;
      status: string;
      enrolledAt: string;
      endedAt: string | null;
    }>(
      this.pool,
      `SELECT enrollment.id,enrollment.student_id,COALESCE(student.student_name,student.contact_name) AS student_name,enrollment.status,enrollment.enrolled_at,enrollment.ended_at FROM academy_student_group_enrollments enrollment JOIN academy_students student ON student.id=enrollment.student_id JOIN lms_group_runs run ON run.group_id=enrollment.group_id WHERE run.id=$1 ORDER BY student_name,enrollment.id`,
      [runId],
      page,
    );
  }
  async results(actor: LmsStaffActor, runId: number, page?: LmsListOptions) {
    await this.requireStaffAccess(this.pool, actor, runId, "results.manage");
    const enrollments = await listRows<{
      id: number;
      studentId: number;
      studentName: string;
    }>(
      this.pool,
      "SELECT enrollment.id,enrollment.student_id,COALESCE(student.student_name,student.contact_name) AS student_name FROM (SELECT DISTINCT ON(enrollment.student_id) enrollment.id,enrollment.student_id FROM academy_student_group_enrollments enrollment JOIN lms_group_runs run ON run.group_id=enrollment.group_id WHERE run.id=$1 ORDER BY enrollment.student_id,enrollment.enrolled_at DESC,enrollment.id DESC) enrollment JOIN academy_students student ON student.id=enrollment.student_id ORDER BY student_name,enrollment.id",
      [runId],
      page,
    );
    const studentIds = enrollments.map((item) => item.studentId);
    const [assignmentResults, quizResults, signals, completions] =
      await Promise.all([
        rows<LmsStaffAssignmentResultDto>(
          this.pool,
          `SELECT recipient.id,assignment.id AS assignment_id,recipient.student_id,version.title,recipient.status,submission.id AS submission_id,review.score,version.max_score,version.grading_mode,recipient.due_at FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id LEFT JOIN LATERAL(SELECT id FROM lms_submissions submission WHERE submission.recipient_id=recipient.id AND submission.withdrawn_at IS NULL ORDER BY submission.attempt_number DESC LIMIT 1) submission ON true LEFT JOIN LATERAL(SELECT score FROM lms_reviews review WHERE review.submission_id=submission.id ORDER BY review.id DESC LIMIT 1) review ON true WHERE assignment.run_id=$1 AND recipient.student_id=ANY($2::integer[]) AND recipient.opens_at<=now() ORDER BY assignment.id,recipient.id DESC`,
          [runId, studentIds],
        ),
        rows<LmsStaffQuizResultDto>(
          this.pool,
          `SELECT recipient.id,quiz.id AS quiz_id,recipient.student_id,version.title,recipient.status,(SELECT MAX(attempt.percent) FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.state='finished') AS best_percent,EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.state='finished' AND attempt.passed) AS passed,(SELECT COUNT(*)::int FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id) AS attempts_used FROM lms_quiz_recipients recipient JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id WHERE quiz.run_id=$1 AND recipient.student_id=ANY($2::integer[]) AND recipient.opens_at<=now() ORDER BY quiz.id,recipient.id DESC`,
          [runId, studentIds],
        ),
        rows<{ studentId: number; openHelp: number; absences: number }>(
          this.pool,
          `SELECT student.id AS student_id,(SELECT COUNT(*)::int FROM lms_threads thread WHERE thread.student_id=student.id AND thread.run_id=$1 AND thread.status='open') AS open_help,(SELECT COUNT(*)::int FROM academy_attendance mark JOIN academy_lessons lesson ON lesson.id=mark.lesson_id JOIN lms_group_runs run ON run.group_id=lesson.group_id WHERE mark.student_id=student.id AND run.id=$1 AND mark.status='absent' AND lesson.status='conducted' AND EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.student_id=student.id AND enrollment.group_id=lesson.group_id AND lesson.scheduled_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR lesson.scheduled_at<enrollment.ended_at))) AS absences FROM academy_students student WHERE student.id=ANY($2::integer[])`,
          [runId, studentIds],
        ),
        rows<{ studentId: number }>(
          this.pool,
          "SELECT student_id FROM lms_course_completions WHERE run_id=$1 AND student_id=ANY($2::integer[]) AND reopened_at IS NULL",
          [runId, studentIds],
        ),
      ]);
    return Promise.all(
      enrollments.map(async (enrollment) => ({
        id: enrollment.id,
        runId,
        studentId: enrollment.studentId,
        studentName: enrollment.studentName,
        completed: completions.some(
          (item) => item.studentId === enrollment.studentId,
        ),
        assignmentResults: assignmentResults.filter(
          (item) => item.studentId === enrollment.studentId,
        ),
        quizResults: quizResults.filter(
          (item) => item.studentId === enrollment.studentId,
        ),
        openHelp:
          signals.find((item) => item.studentId === enrollment.studentId)
            ?.openHelp ?? 0,
        absences:
          signals.find((item) => item.studentId === enrollment.studentId)
            ?.absences ?? 0,
        progress: await this.progress(
          { studentId: enrollment.studentId } as PortalActorContext,
          runId,
        ),
      })),
    );
  }
  async createCourseVersion(
    actor: LmsStaffActor,
    input: {
      idempotencyKey?: string;
      courseId: number;
      sections: {
        title: string;
        units: { title: string; required: boolean }[];
      }[];
      publish: boolean;
    },
  ) {
    return transaction(this.pool, async (sql) => {
      if (
        !actor.isLeadership &&
        !(await one(
          sql,
          "SELECT teacher.user_id FROM academy_groups g JOIN academy_teachers teacher ON teacher.id=g.teacher_id WHERE g.course_id=$2 AND teacher.user_id=$1 AND teacher.status='active' AND $3::boolean UNION ALL SELECT user_id FROM lms_staff_permissions WHERE user_id=$1 AND permission='content.manage'",
          [actor.userId, input.courseId, actor.modules.includes("teacher")],
        ))
      )
        throw new LmsError("portalAccessDenied", 403);
      if (
        !(await one(
          sql,
          "SELECT id FROM academy_courses WHERE id=$1 FOR UPDATE",
          [input.courseId],
        ))
      )
        throw new LmsError("lmsNotFound", 404);
      return idempotentStaffCommand(
        sql,
        actor,
        null,
        `course_version:${input.courseId}`,
        input,
        async () => {
          const version = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_course_versions(course_id,version,state,program,created_by) SELECT $1,COALESCE(MAX(version),0)+1,$2,$3::jsonb,$4 FROM lms_course_versions WHERE course_id=$1 RETURNING id",
            [
              input.courseId,
              input.publish ? "published" : "draft",
              JSON.stringify(input.sections),
              actor.userId,
            ],
          );
          let position = 0;
          for (let index = 0; index < input.sections.length; index++) {
            const section = input.sections[index];
            const saved = await one<{ id: number }>(
              sql,
              "INSERT INTO lms_sections(course_version_id,title,position) VALUES($1,$2,$3) RETURNING id",
              [version!.id, section.title, index],
            );
            for (const unit of section.units)
              await sql.query(
                "INSERT INTO lms_units(course_version_id,section_id,title,position,required) VALUES($1,$2,$3,$4,$5)",
                [version!.id, saved!.id, unit.title, position++, unit.required],
              );
          }
          await recordStaffAudit(
            sql,
            actor,
            null,
            "course_version",
            version!.id,
            input.publish ? "publish" : "create",
            null,
            {
              courseId: input.courseId,
              state: input.publish ? "published" : "draft",
              unitCount: position,
            },
          );
          return {
            id: version!.id,
            state: input.publish ? "published" : "draft",
          };
        },
      );
    });
  }
  async completeCourse(
    actor: LmsStaffActor,
    runId: number,
    studentId: number,
    reason: string,
  ) {
    return transaction(this.pool, async (sql) => {
      await this.requireStaffAccess(sql, actor, runId, "results.manage");
      await this.requireEnrollment(
        sql,
        { studentId } as PortalActorContext,
        runId,
      );
      const run = await one<{ courseVersionId: number }>(
        sql,
        "SELECT course_version_id FROM lms_group_runs WHERE id=$1 FOR UPDATE",
        [runId],
      );
      const units = await rows<{ id: number }>(
        sql,
        `SELECT unit.id FROM lms_units unit JOIN lms_group_runs run ON run.course_version_id=unit.course_version_id WHERE unit.course_version_id=$1 AND run.id=$2 AND unit.required AND ${runUnitSelectionSql()}`,
        [run!.courseVersionId, runId],
      );
      const missing = await one<{ count: number }>(
        sql,
        `SELECT COUNT(*)::int AS count FROM lms_units unit JOIN lms_group_runs run ON run.course_version_id=unit.course_version_id WHERE unit.course_version_id=$1 AND run.id=$2 AND unit.required AND ${runUnitSelectionSql()} AND NOT EXISTS(SELECT 1 FROM lms_materials material JOIN lms_material_publications publication ON publication.material_id=material.id JOIN academy_student_group_enrollments enrollment ON enrollment.id=publication.enrollment_id WHERE material.unit_id=unit.id AND material.run_id=$2 AND material.state='published' AND publication.publish_at<=now() AND publication.revoked_at IS NULL AND enrollment.student_id=$3)`,
        [run!.courseVersionId, runId, studentId],
      );
      const progress = await this.progress(
        { studentId } as PortalActorContext,
        runId,
        undefined,
        undefined,
        sql,
      );
      const pending = await one<{ count: number }>(
        sql,
        `SELECT (
        (SELECT COUNT(*) FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE recipient.student_id=$1 AND assignment.run_id=$2 AND version.required AND recipient.status NOT IN('accepted','excused','cancelled')) +
        (SELECT COUNT(*) FROM lms_quiz_recipients recipient JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id WHERE recipient.student_id=$1 AND quiz.run_id=$2 AND version.required AND recipient.status='assigned' AND NOT EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.state='finished' AND attempt.passed)))::int AS count`,
        [studentId, runId],
      );
      if (
        !units.length ||
        missing!.count ||
        pending!.count ||
        progress.assignments.completed !== progress.assignments.total ||
        progress.quizzes.completed !== progress.quizzes.total
      )
        throw new LmsError("lmsCourseIncomplete", 409);
      const completion = await one<{ id: number }>(
        sql,
        "INSERT INTO lms_course_completions(student_id,run_id,completed_by,reason) VALUES($1,$2,$3,$4) ON CONFLICT(student_id,run_id) WHERE reopened_at IS NULL DO UPDATE SET reason=lms_course_completions.reason RETURNING id",
        [studentId, runId, actor.userId, reason],
      );
      const requirements = await this.completionRequirements(
        sql,
        studentId,
        runId,
      );
      await recordEvent(
        sql,
        studentId,
        runId,
        "course_completed",
        completion!.id,
        `completion:${completion!.id}`,
        {
          reason,
          courseVersionId: run!.courseVersionId,
          unitIds: units.map((unit) => unit.id),
          ...requirements,
        },
      );
      await this.awardAutomatic(
        sql,
        studentId,
        runId,
        "course_completed",
        `course-completed:${studentId}:${runId}`,
        "lmsAchievementCourseCompleted",
        reason,
        actor.userId,
        actor.requestId,
      );
      await recordStaffAudit(
        sql,
        actor,
        runId,
        "course_completion",
        completion!.id,
        "complete",
        null,
        completion,
        reason,
      );
      return { id: completion!.id, completed: true };
    });
  }
  private async completionRequirements(
    sql: LmsSql,
    studentId: number,
    runId: number,
  ) {
    const assignments = await rows<{ id: number }>(
      sql,
      "SELECT recipient.id FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE recipient.student_id=$1 AND assignment.run_id=$2 AND version.required ORDER BY recipient.id",
      [studentId, runId],
    );
    const quizzes = await rows<{ id: number }>(
      sql,
      "SELECT recipient.id FROM lms_quiz_recipients recipient JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id WHERE recipient.student_id=$1 AND quiz.run_id=$2 AND version.required ORDER BY recipient.id",
      [studentId, runId],
    );
    return {
      assignmentRecipientIds: assignments.map((item) => item.id),
      quizRecipientIds: quizzes.map((item) => item.id),
    };
  }
  async reconcileCompletionAchievement(
    sql: LmsSql,
    actor: LmsStaffActor,
    studentId: number,
    runId: number,
    reason: string,
    changeKey: string,
  ) {
    const completion = await one<{
      id: number;
      reason: string;
      data: { assignmentRecipientIds?: number[]; quizRecipientIds?: number[] };
    }>(
      sql,
      "SELECT completion.id,completion.reason,event.data FROM lms_course_completions completion LEFT JOIN lms_learning_events event ON event.type='course_completed' AND event.object_id=completion.id AND event.student_id=completion.student_id AND event.run_id=completion.run_id WHERE completion.student_id=$1 AND completion.run_id=$2 AND completion.reopened_at IS NULL FOR UPDATE OF completion",
      [studentId, runId],
    );
    if (!completion) return;
    const snapshot =
      completion.data?.assignmentRecipientIds &&
      completion.data?.quizRecipientIds
        ? completion.data
        : await this.completionRequirements(sql, studentId, runId);
    const pending = await one<{ count: number }>(
      sql,
      `SELECT (
        (SELECT COUNT(*) FROM unnest($1::bigint[]) required(id) LEFT JOIN lms_assignment_recipients recipient ON recipient.id=required.id WHERE recipient.id IS NULL OR recipient.status NOT IN('accepted','excused','cancelled')) +
        (SELECT COUNT(*) FROM unnest($2::bigint[]) required(id) LEFT JOIN lms_quiz_recipients recipient ON recipient.id=required.id WHERE recipient.id IS NULL OR (recipient.status='assigned' AND NOT EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.state='finished' AND attempt.passed))))::int AS count`,
      [snapshot.assignmentRecipientIds, snapshot.quizRecipientIds],
    );
    if (!pending!.count) {
      await this.awardAutomatic(
        sql,
        studentId,
        runId,
        "course_completed",
        `course-completed:${studentId}:${runId}`,
        "lmsAchievementCourseCompleted",
        completion.reason,
        actor.userId,
        actor.requestId,
      );
      return;
    }
    const old = await one<{ id: number; revokedAt: string | null }>(
      sql,
      "SELECT * FROM lms_achievements WHERE student_id=$1 AND run_id=$2 AND rule='course_completed' FOR UPDATE",
      [studentId, runId],
    );
    if (!old || old.revokedAt) return;
    const revoked = await one<{ id: number }>(
      sql,
      "UPDATE lms_achievements SET revoked_at=now(),revoked_by=$2,revoke_reason=$3 WHERE id=$1 RETURNING *",
      [old.id, actor.userId, reason],
    );
    await recordEvent(
      sql,
      studentId,
      runId,
      "achievement_revoked",
      old.id,
      `completion-achievement-correction:${old.id}:${changeKey}`,
      { reason },
    );
    await recordStaffAudit(
      sql,
      actor,
      runId,
      "achievement",
      old.id,
      "revoke",
      old,
      revoked,
      reason,
    );
  }
  async reopenCourse(
    actor: LmsStaffActor,
    runId: number,
    studentId: number,
    reason: string,
  ) {
    return transaction(this.pool, async (sql) => {
      await this.requireStaffAccess(sql, actor, runId, "results.manage");
      const completion = await one<{ id: number }>(
        sql,
        "UPDATE lms_course_completions SET reopened_at=now(),reopened_by=$3,reason=$4 WHERE student_id=$1 AND run_id=$2 AND reopened_at IS NULL RETURNING id",
        [studentId, runId, actor.userId, reason],
      );
      if (!completion) throw new LmsError("lmsNotFound", 404);
      const award = await one<{ id: number; revokedAt: string }>(
        sql,
        "UPDATE lms_achievements SET revoked_at=now(),revoked_by=$3,revoke_reason=$4 WHERE student_id=$1 AND run_id=$2 AND rule='course_completed' AND revoked_at IS NULL RETURNING *",
        [studentId, runId, actor.userId, reason],
      );
      if (award)
        await recordEvent(
          sql,
          studentId,
          runId,
          "achievement_revoked",
          award.id,
          `completion-achievement-revoked:${award.id}:${award.revokedAt}`,
          { reason },
        );
      await recordEvent(
        sql,
        studentId,
        runId,
        "course_reopened",
        completion.id,
        `completion-reopened:${completion.id}`,
        { reason },
      );
      await recordStaffAudit(
        sql,
        actor,
        runId,
        "course_completion",
        completion.id,
        "reopen",
        null,
        completion,
        reason,
      );
      return { reopened: true };
    });
  }
  async communicationCourses(actor: PortalActorContext, page?: LmsListOptions) {
    return listRows<{
      id: number;
      runId: number;
      courseName: string;
      groupName: string;
    }>(
      this.pool,
      "SELECT run.id,run.id AS run_id,course.name AS course_name,g.name AS group_name FROM lms_group_runs run JOIN academy_groups g ON g.id=run.group_id JOIN academy_courses course ON course.id=g.course_id WHERE EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.group_id=g.id AND enrollment.student_id=$1) ORDER BY run.id DESC",
      [actor.studentId],
      page,
      await this.enabledRunIds(actor.studentId),
    ).then((items) => this.enabledRecords(items));
  }
  async managementUnits(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ) {
    await this.requireStaffAccess(this.pool, actor, runId, [
      "content.manage",
      "schedule.manage",
    ]);
    return listRows<{
      id: number;
      title: string;
      position: number;
      required: boolean;
    }>(
      this.pool,
      `SELECT unit.id,unit.title,unit.position,unit.required,COALESCE(preview.enabled,false) AS preview_enabled,preview.visible_from,preview.open_at FROM lms_units unit JOIN lms_group_runs run ON run.course_version_id=unit.course_version_id LEFT JOIN lms_unit_previews preview ON preview.run_id=run.id AND preview.unit_id=unit.id WHERE run.id=$1 AND ${runUnitSelectionSql()} ORDER BY unit.position`,
      [runId],
      page,
    );
  }
  async setUnitPreview(
    actor: LmsStaffActor,
    runId: number,
    unitId: number,
    input: { enabled: boolean; visibleFrom: string; openAt: string },
  ) {
    return transaction(this.pool, async (sql) => {
      await this.requireStaffAccess(sql, actor, runId, "content.manage");
      await this.assertUnit(sql, runId, unitId);
      const old = await one(
        sql,
        "SELECT * FROM lms_unit_previews WHERE run_id=$1 AND unit_id=$2 FOR UPDATE",
        [runId, unitId],
      );
      const result = await one(
        sql,
        "INSERT INTO lms_unit_previews(run_id,unit_id,enabled,visible_from,open_at,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,unit_id) DO UPDATE SET enabled=EXCLUDED.enabled,visible_from=EXCLUDED.visible_from,open_at=EXCLUDED.open_at,created_by=EXCLUDED.created_by,updated_at=now() RETURNING *",
        [
          runId,
          unitId,
          input.enabled,
          input.visibleFrom,
          input.openAt,
          actor.userId,
        ],
      );
      await recordStaffAudit(
        sql,
        actor,
        runId,
        "unit_preview",
        unitId,
        "update",
        old,
        result,
      );
      return result;
    });
  }
  async managementLessons(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ) {
    await this.requireStaffAccess(this.pool, actor, runId, [
      "content.manage",
      "schedule.manage",
    ]);
    return listRows(
      this.pool,
      "SELECT lesson.id,lesson.lesson_number,lesson.topic,lesson.scheduled_at,lesson.duration_minutes,lesson.status,binding.unit_id,COALESCE(binding.format,run.format) AS format,CASE WHEN COALESCE(binding.format,run.format)='online' THEN COALESCE(binding.meeting_url,run.meeting_url) ELSE NULL END AS meeting_url FROM academy_lessons lesson JOIN lms_group_runs run ON run.group_id=lesson.group_id LEFT JOIN lms_lesson_bindings binding ON binding.lesson_id=lesson.id AND binding.run_id=run.id WHERE run.id=$1 ORDER BY lesson.scheduled_at",
      [runId],
      page,
    );
  }
  async bindLesson(
    actor: LmsStaffActor,
    runId: number,
    lessonId: number,
    input: {
      unitId: number | null;
      format: "offline" | "online" | null;
      meetingUrl: string | null;
    },
  ) {
    return transaction(this.pool, async (sql) => {
      await this.requireStaffAccess(sql, actor, runId, "schedule.manage");
      await this.assertUnit(sql, runId, input.unitId);
      if (
        !(await one(
          sql,
          "SELECT lesson.id FROM academy_lessons lesson JOIN lms_group_runs run ON run.group_id=lesson.group_id WHERE run.id=$1 AND lesson.id=$2",
          [runId, lessonId],
        ))
      )
        throw new LmsError("lmsNotFound", 404);
      const old = await one(
        sql,
        "SELECT * FROM lms_lesson_bindings WHERE run_id=$1 AND lesson_id=$2 FOR UPDATE",
        [runId, lessonId],
      );
      const binding = await one<{ id: number }>(
        sql,
        "INSERT INTO lms_lesson_bindings(run_id,unit_id,lesson_id,format,meeting_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id,lesson_id) DO UPDATE SET unit_id=EXCLUDED.unit_id,format=EXCLUDED.format,meeting_url=EXCLUDED.meeting_url RETURNING *",
        [runId, input.unitId, lessonId, input.format, input.meetingUrl],
      );
      await recordStaffAudit(
        sql,
        actor,
        runId,
        "lesson_binding",
        binding!.id,
        "update",
        old,
        binding,
      );
      return binding;
    });
  }
  async courseVersions(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ) {
    const run = await this.requireStaffAccess(
      this.pool,
      actor,
      runId,
      "content.manage",
    );
    const versions = await listRows<{ id: number }>(
      this.pool,
      "SELECT version.id,version.course_id,version.version,version.state,version.created_at FROM lms_course_versions version JOIN academy_groups g ON g.course_id=version.course_id WHERE g.id=$1 ORDER BY version.version DESC",
      [run.groupId],
      page,
    );
    return Promise.all(
      versions.map(async (version) => ({
        ...version,
        units: await rows(
          this.pool,
          "SELECT unit.id,unit.title,unit.position,unit.required,section.title AS section_title FROM lms_units unit LEFT JOIN lms_sections section ON section.id=unit.section_id WHERE unit.course_version_id=$1 ORDER BY unit.position",
          [version.id],
        ),
      })),
    );
  }
  async monthlyMetrics(
    actor: PortalActorContext,
    runId: number,
    period: { from: string; to: string },
    sql: LmsSql = this.pool,
  ) {
    const progress = await this.progress(actor, runId, period, undefined, sql);
    const assignments = await one<{ completed: number; total: number }>(
      sql,
      `SELECT COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM lms_reviews review JOIN lms_submissions submission ON submission.id=review.submission_id WHERE submission.recipient_id=recipient.id AND review.decision='accepted' AND review.created_at>=$3::timestamptz AND review.created_at<$4::timestamptz))::int AS completed,COUNT(*)::int AS total FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE recipient.student_id=$1 AND assignment.run_id=$2 AND version.required AND recipient.status NOT IN('excused','cancelled') AND recipient.opens_at<=now() AND ${recipientEnrollmentVisibilitySql()} AND recipient.opens_at<$4::timestamptz AND (recipient.due_at IS NULL OR recipient.due_at>=$3::timestamptz OR EXISTS(SELECT 1 FROM lms_submissions submission WHERE submission.recipient_id=recipient.id AND submission.submitted_at>=$3::timestamptz AND submission.submitted_at<$4::timestamptz))`,
      [actor.studentId, runId, period.from, period.to],
    );
    const quizzes = await one<{ completed: number; total: number }>(
      sql,
      `SELECT COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.passed AND attempt.finished_at>=$3::timestamptz AND attempt.finished_at<$4::timestamptz))::int AS completed,COUNT(*)::int AS total FROM lms_quiz_recipients recipient JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id WHERE recipient.student_id=$1 AND quiz.run_id=$2 AND version.required AND recipient.status='assigned' AND recipient.opens_at<=now() AND ${recipientEnrollmentVisibilitySql()} AND recipient.opens_at<$4::timestamptz AND (recipient.closes_at IS NULL OR recipient.closes_at>=$3::timestamptz)`,
      [actor.studentId, runId, period.from, period.to],
    );
    return {
      ...progress,
      assignments: progressMetric(
        assignments?.completed ?? 0,
        assignments?.total ?? 0,
      ),
      quizzes: progressMetric(quizzes?.completed ?? 0, quizzes?.total ?? 0),
    };
  }
  async enabledRunIds(studentId?: number, sql: LmsSql = this.pool) {
    const runs = await rows<{ id: number; groupId: number }>(
      sql,
      `SELECT run.id,run.group_id FROM lms_group_runs run WHERE ($1::integer IS NULL OR EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.group_id=run.group_id AND enrollment.student_id=$1))`,
      [studentId ?? null],
    );
    const enabled = [];
    for (const run of runs) {
      if (await this.enabledForGroup(run.groupId)) enabled.push(run.id);
    }
    return enabled;
  }
  async enabledStaffRunIds(actor: LmsStaffActor, permission: string) {
    const ids = await this.enabledRunIds();
    return (
      await rows<{ id: number }>(
        this.pool,
        `SELECT run.id FROM lms_group_runs run WHERE run.id=ANY($1::bigint[]) AND ($2::boolean OR ($3::boolean AND EXISTS(SELECT 1 FROM academy_groups g JOIN academy_teachers teacher ON teacher.id=g.teacher_id WHERE g.id=run.group_id AND teacher.user_id=$4 AND teacher.status='active')) OR EXISTS(SELECT 1 FROM lms_staff_permissions grant_row WHERE grant_row.user_id=$4 AND grant_row.permission=$5)) ORDER BY run.id`,
        [
          ids,
          hasImplicitStaffRunAccess(actor, permission),
          actor.modules.includes("teacher"),
          actor.userId,
          permission,
        ],
      )
    ).map((run) => run.id);
  }
  async reconcileGroupLifecycle() {
    const enabledRuns = await this.enabledRunIds();
    if (!enabledRuns.length) return { completed: 0 };
    const result = await this.pool.query(
      `UPDATE lms_group_runs run SET status='completed',completed_at=COALESCE(run.completed_at,source.completed_at),access_until=NULL,version=run.version+1 FROM (SELECT g.id AS group_id,LEAST(now(),COALESCE((SELECT MAX(lesson.scheduled_at+lesson.duration_minutes*interval '1 minute') FROM academy_lessons lesson WHERE lesson.group_id=g.id AND lesson.status='conducted'),g.end_date,g.updated_at,now())) AS completed_at FROM academy_groups g WHERE g.status='completed') source WHERE run.group_id=source.group_id AND run.status='active' AND run.id=ANY($1::bigint[]) RETURNING run.id`,
      [enabledRuns],
    );
    return { completed: result.rowCount ?? 0 };
  }
  async syncMakeupResult(
    sql: LmsSql,
    studentId: number,
    runId: number,
    eventKey: string,
  ) {
    const restored = await rows<{ id: number; completedAt: string }>(
      sql,
      `UPDATE lms_makeup_plans plan SET status='completed',completed_at=now() WHERE plan.student_id=$1 AND plan.run_id=$2 AND plan.status IN('needed','in_progress') AND EXISTS(SELECT 1 FROM academy_lessons lesson JOIN academy_attendance mark ON mark.lesson_id=lesson.id AND mark.student_id=plan.student_id WHERE lesson.id=plan.lesson_id AND lesson.status='conducted' AND mark.status='absent') AND ((plan.recipient_id IS NOT NULL AND EXISTS(SELECT 1 FROM lms_assignment_recipients recipient WHERE recipient.id=plan.recipient_id AND recipient.status='accepted')) OR (plan.quiz_recipient_id IS NOT NULL AND EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=plan.quiz_recipient_id AND attempt.state='finished' AND attempt.passed))) RETURNING plan.id,plan.completed_at`,
      [studentId, runId],
    );
    for (const plan of restored)
      await recordEvent(
        sql,
        studentId,
        runId,
        "makeup_completed",
        plan.id,
        `makeup:${plan.id}:${eventKey}:${plan.completedAt}`,
        {},
      );
    const reopened = await rows<{ id: number }>(
      sql,
      `UPDATE lms_makeup_plans plan SET status='in_progress',completed_at=NULL WHERE plan.student_id=$1 AND plan.run_id=$2 AND plan.status='completed' AND plan.completed_by IS NULL AND (plan.recipient_id IS NOT NULL OR plan.quiz_recipient_id IS NOT NULL) AND EXISTS(SELECT 1 FROM academy_lessons lesson JOIN academy_attendance mark ON mark.lesson_id=lesson.id AND mark.student_id=plan.student_id WHERE lesson.id=plan.lesson_id AND lesson.status='conducted' AND mark.status='absent') AND NOT EXISTS(SELECT 1 FROM lms_assignment_recipients recipient WHERE recipient.id=plan.recipient_id AND recipient.status='accepted') AND NOT EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=plan.quiz_recipient_id AND attempt.state='finished' AND attempt.passed) RETURNING plan.id`,
      [studentId, runId],
    );
    for (const plan of reopened)
      await recordEvent(
        sql,
        studentId,
        runId,
        "makeup_reopened",
        plan.id,
        `makeup-reopened:${plan.id}:${eventKey}`,
        {},
      );
  }
  async enabledRecords<T extends { runId: number }>(
    items: T[],
    sql: LmsSql = this.pool,
  ): Promise<T[]> {
    if (!items.length) return [];
    const runs = await rows<{ id: number; groupId: number }>(
      sql,
      "SELECT id,group_id FROM lms_group_runs WHERE id=ANY($1::bigint[])",
      [Array.from(new Set(items.map((item) => item.runId)))],
    );
    const enabled = new Set<number>();
    for (const run of runs) {
      if (await this.enabledForGroup(run.groupId)) enabled.add(run.id);
    }
    return items.filter((item) => enabled.has(item.runId));
  }
  async requireRunEnabled(sql: LmsSql, runId: number) {
    const run = await one<{ groupId: number }>(
      sql,
      "SELECT group_id FROM lms_group_runs WHERE id=$1",
      [runId],
    );
    if (!run || !(await this.enabledForGroup(run.groupId)))
      throw new LmsError("portalUnavailable", 404);
    return run;
  }
  async requireStaffAccess(
    sql: LmsSql,
    actor: LmsStaffActor,
    runId: number,
    permission: string | readonly string[],
  ) {
    await this.requireRunEnabled(sql, runId);
    return requireStaffRun(sql, actor, runId, permission);
  }
  async staffPermissions(actor: LmsStaffActor, page?: LmsListOptions) {
    if (!actor.isLeadership) throw new LmsError("portalAccessDenied", 403);
    return listRows(
      this.pool,
      "SELECT staff.id,staff.id AS user_id,staff.full_name,staff.module,ARRAY(SELECT DISTINCT assigned.module FROM (SELECT staff.module UNION SELECT module FROM user_modules WHERE user_id=staff.id) assigned ORDER BY assigned.module) AS modules,COALESCE(jsonb_agg(permission.permission ORDER BY permission.permission) FILTER(WHERE permission.permission IS NOT NULL),'[]'::jsonb) AS permissions FROM users staff LEFT JOIN lms_staff_permissions permission ON permission.user_id=staff.id WHERE staff.is_active AND NOT staff.is_archived GROUP BY staff.id ORDER BY staff.full_name",
      [],
      page,
    );
  }
  async changeStaffPermissions(
    actor: LmsStaffActor,
    userId: number,
    input: { permissions: string[]; reason: string },
  ) {
    if (!actor.isLeadership) throw new LmsError("portalAccessDenied", 403);
    return transaction(this.pool, async (sql) => {
      if (
        !(await one(
          sql,
          "SELECT id FROM users WHERE id=$1 AND is_active AND NOT is_archived FOR UPDATE",
          [userId],
        ))
      )
        throw new LmsError("lmsNotFound", 404);
      if (
        input.permissions.includes("access.manage") &&
        !(await one(
          sql,
          "SELECT id FROM users WHERE id=$1 AND (module IN('sales','administration') OR EXISTS(SELECT 1 FROM user_modules WHERE user_id=$1 AND module IN('sales','administration')))",
          [userId],
        ))
      )
        throw new LmsError("portalAccessDenied", 403);
      const old = await rows(
        sql,
        "SELECT permission FROM lms_staff_permissions WHERE user_id=$1",
        [userId],
      );
      await sql.query("DELETE FROM lms_staff_permissions WHERE user_id=$1", [
        userId,
      ]);
      for (const permission of input.permissions)
        await sql.query(
          "INSERT INTO lms_staff_permissions(user_id,permission) VALUES($1,$2)",
          [userId, permission],
        );
      await recordStaffAudit(
        sql,
        actor,
        null,
        "staff_permissions",
        userId,
        "replace",
        old,
        input.permissions,
        input.reason,
      );
      return { permissions: input.permissions };
    });
  }
  async updateRun(
    actor: LmsStaffActor,
    runId: number,
    input: LmsRunUpdateInput,
  ) {
    return transaction(this.pool, async (sql) => {
      await this.requireStaffAccess(sql, actor, runId, "content.manage");
      const old = await one<{
        version: number;
        format: string;
        meetingUrl: string | null;
        accessUntil: string | null;
        status: string;
      }>(sql, "SELECT * FROM lms_group_runs WHERE id=$1 FOR UPDATE", [runId]);
      requireVersion(old!.version, input.version);
      const format = input.format ?? old!.format;
      const meeting =
        input.meetingUrl !== undefined ? input.meetingUrl : old!.meetingUrl;
      if (format === "online" && !meeting)
        throw new LmsError("lmsMeetingLinkRequired");
      const accessUntil = null;
      const updated = await one(
        sql,
        "UPDATE lms_group_runs SET format=$2,meeting_url=$3,access_until=$4,status=COALESCE($5,status),completed_at=CASE WHEN $5='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END,version=version+1 WHERE id=$1 RETURNING *",
        [
          runId,
          format,
          format === "online" ? meeting : null,
          accessUntil,
          input.status ?? null,
        ],
      );
      await recordStaffAudit(
        sql,
        actor,
        runId,
        "group_run",
        runId,
        "update",
        old,
        updated,
        input.reason,
      );
      return updated;
    });
  }
  async awardAutomatic(
    sql: LmsSql,
    studentId: number,
    runId: number,
    rule: string,
    eventKey: string,
    title: string,
    reason: string,
    staffId?: number,
    requestId?: string,
  ) {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `lms-award:${studentId}:${runId}:${rule}`,
    ]);
    const configured = await this.policy.achievementTemplate?.(rule);
    const old = await one<{ id: number; revokedAt: string | null }>(
      sql,
      "SELECT * FROM lms_achievements WHERE student_id=$1 AND run_id=$2 AND rule=$3 FOR UPDATE",
      [studentId, runId, rule],
    );
    if (old && !old.revokedAt) return { id: old.id, awarded: false };
    const award = await one<{ id: number; awardedAt: string }>(
      sql,
      "INSERT INTO lms_achievements(student_id,run_id,rule,event_key,title,reason,awarded_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(student_id,run_id,rule) DO UPDATE SET revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL,awarded_at=now(),awarded_by=EXCLUDED.awarded_by,title=EXCLUDED.title,reason=EXCLUDED.reason RETURNING *",
      [
        studentId,
        runId,
        rule,
        eventKey,
        configured?.title ?? title,
        configured?.reason ?? reason,
        staffId ?? null,
      ],
    );
    await recordEvent(
      sql,
      studentId,
      runId,
      old ? "achievement_restored" : "achievement_awarded",
      award!.id,
      `achievement:${award!.id}:${award!.awardedAt}`,
      {
        rule,
        title: configured?.title ?? title,
        reason: configured?.reason ?? reason,
        previousRevokedAt: old?.revokedAt ?? null,
      },
    );
    if (staffId)
      await recordStaffAudit(
        sql,
        { userId: staffId, requestId } as LmsStaffActor,
        runId,
        "achievement",
        award!.id,
        old ? "restore" : "award",
        old ?? null,
        award,
        reason,
      );
    return { id: award!.id, awarded: true };
  }
}
