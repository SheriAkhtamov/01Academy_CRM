import type { LmsListOptions } from "@shared/contracts/lms";
import type { Pool } from "pg";
import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import type {
  LmsAchievementDto,
  LmsAnnouncementDto,
  LmsAnnouncementInput,
  LmsCommentDto,
  LmsCommentInput,
  LmsHistoryDto,
  LmsMakeupDto,
  LmsMaterialDto,
  LmsPage,
  LmsReportDto,
  LmsReportInput,
  LmsThreadDto,
  LmsThreadInput,
} from "@shared/contracts/lms";
import { LmsError, type LmsStaffActor } from "../domain/policy";
import {
  one,
  rows,
  listRows,
  transaction,
  recordEvent,
  recordStaffAudit,
  idempotentStaffCommand,
  commandRequestHash,
  idempotentPortalCommand,
  type LmsSql,
} from "./postgres-base";
import { PgLearningRepository } from "./learning-repository";
export class PgEngagementRepository {
  constructor(
    readonly pool: Pool,
    readonly learning: PgLearningRepository,
  ) {}
  async syncMakeup(studentId?: number) {
    const enabledRuns = await this.learning.enabledRunIds(studentId);
    return transaction(this.pool, async (sql) => {
      await sql.query(
        `INSERT INTO lms_makeup_plans(lesson_id,student_id,run_id) SELECT mark.lesson_id,mark.student_id,run.id FROM academy_attendance mark JOIN academy_lessons lesson ON lesson.id=mark.lesson_id JOIN lms_group_runs run ON run.group_id=lesson.group_id WHERE mark.status='absent' AND lesson.status='conducted' AND ($1::integer IS NULL OR mark.student_id=$1) AND run.id=ANY($2::bigint[]) AND EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.student_id=mark.student_id AND enrollment.group_id=lesson.group_id AND lesson.scheduled_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR lesson.scheduled_at<enrollment.ended_at)) ON CONFLICT(lesson_id,student_id) DO NOTHING`,
        [studentId ?? null, enabledRuns],
      );
      await sql.query(
        `UPDATE lms_makeup_plans plan SET status='not_required' FROM academy_lessons lesson WHERE lesson.id=plan.lesson_id AND (lesson.status='cancelled' OR NOT EXISTS(SELECT 1 FROM academy_attendance mark WHERE mark.lesson_id=lesson.id AND mark.student_id=plan.student_id AND mark.status='absent')) AND plan.status IN('needed','in_progress') AND ($1::integer IS NULL OR plan.student_id=$1) AND plan.run_id=ANY($2::bigint[])`,
        [studentId ?? null, enabledRuns],
      );
      await sql.query(
        `UPDATE lms_makeup_plans plan SET status='needed' FROM academy_lessons lesson WHERE lesson.id=plan.lesson_id AND lesson.status='conducted' AND EXISTS(SELECT 1 FROM academy_attendance mark WHERE mark.lesson_id=lesson.id AND mark.student_id=plan.student_id AND mark.status='absent') AND plan.status='not_required' AND ($1::integer IS NULL OR plan.student_id=$1) AND plan.run_id=ANY($2::bigint[])`,
        [studentId ?? null, enabledRuns],
      );
      const completed = await rows<{
        id: number;
        studentId: number;
        runId: number;
        completedAt: string;
      }>(
        sql,
        `UPDATE lms_makeup_plans plan SET status='completed',completed_at=now() WHERE plan.status IN('needed','in_progress') AND ((plan.recipient_id IS NOT NULL AND EXISTS(SELECT 1 FROM lms_assignment_recipients recipient WHERE recipient.id=plan.recipient_id AND recipient.student_id=plan.student_id AND recipient.status='accepted')) OR (plan.quiz_recipient_id IS NOT NULL AND EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=plan.quiz_recipient_id AND attempt.state='finished' AND attempt.passed))) AND ($1::integer IS NULL OR plan.student_id=$1) AND plan.run_id=ANY($2::bigint[]) RETURNING plan.id,plan.student_id,plan.run_id,plan.completed_at`,
        [studentId ?? null, enabledRuns],
      );
      for (const plan of completed)
        await recordEvent(
          sql,
          plan.studentId,
          plan.runId,
          "makeup_completed",
          plan.id,
          `makeup:${plan.id}:${plan.completedAt}`,
          {},
        );
    });
  }
  async makeup(
    actor: PortalActorContext,
    page?: LmsListOptions,
    knownMaterials?: readonly LmsMaterialDto[],
  ): Promise<LmsMakeupDto[]> {
    await this.syncMakeup(actor.studentId);
    const plans = await listRows<Omit<LmsMakeupDto, "materials">>(
      this.pool,
      `SELECT plan.id,plan.lesson_id,plan.run_id,lesson.topic,lesson.scheduled_at,plan.status,plan.due_at,plan.recipient_id,plan.quiz_recipient_id FROM lms_makeup_plans plan JOIN academy_lessons lesson ON lesson.id=plan.lesson_id WHERE plan.student_id=$1 AND lesson.status<>'cancelled' ORDER BY lesson.scheduled_at DESC`,
      [actor.studentId],
      page,
      page ? await this.learning.enabledRunIds(actor.studentId) : undefined,
    );
    const materials = actor.permissions.includes("learning.read")
      ? (knownMaterials ?? (await this.learning.materials(actor)))
      : [];
    const bindings = await rows<{ lessonId: number; unitId: number }>(
      this.pool,
      "SELECT binding.lesson_id,binding.unit_id FROM lms_lesson_bindings binding JOIN lms_makeup_plans plan ON plan.lesson_id=binding.lesson_id AND plan.run_id=binding.run_id WHERE plan.student_id=$1",
      [actor.studentId],
    );
    return (await this.learning.enabledRecords(plans)).map((plan) => ({
      ...plan,
      recipientId: actor.permissions.includes("learning.read")
        ? plan.recipientId
        : null,
      quizRecipientId: actor.permissions.includes("learning.read")
        ? plan.quizRecipientId
        : null,
      materials: materials.filter(
        (material) =>
          material.runId === plan.runId &&
          material.unitId ===
            bindings.find((binding) => binding.lessonId === plan.lessonId)
              ?.unitId,
      ),
    }));
  }
  async beginMakeup(actor: PortalActorContext, id: number) {
    const owned = await one<{ runId: number }>(
      this.pool,
      "SELECT run_id FROM lms_makeup_plans WHERE id=$1 AND student_id=$2",
      [id, actor.studentId],
    );
    if (!owned) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireRunEnabled(this.pool, owned.runId);
    const plan = await one(
      this.pool,
      "UPDATE lms_makeup_plans SET status='in_progress' WHERE id=$1 AND student_id=$2 AND status='needed' RETURNING id,status",
      [id, actor.studentId],
    );
    if (!plan) throw new LmsError("lmsNotFound", 404);
    return plan;
  }
  async manageMakeup(
    actor: LmsStaffActor,
    id: number,
    input: {
      recipientId?: number | null;
      quizRecipientId?: number | null;
      dueAt?: string | null;
      complete?: boolean;
    },
  ) {
    return transaction(this.pool, async (sql) => {
      const plan = await one<{
        runId: number;
        studentId: number;
        recipientId: number | null;
        quizRecipientId: number | null;
      }>(sql, "SELECT * FROM lms_makeup_plans WHERE id=$1 FOR UPDATE", [id]);
      if (!plan) throw new LmsError("lmsNotFound", 404);
      await this.learning.requireStaffAccess(
        sql,
        actor,
        plan.runId,
        "assignments.manage",
      );
      if (
        input.recipientId &&
        !(await one(
          sql,
          "SELECT recipient.id FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE recipient.id=$1 AND recipient.student_id=$2 AND assignment.run_id=$3",
          [input.recipientId, plan.studentId, plan.runId],
        ))
      )
        throw new LmsError("lmsNotFound", 404);
      if (
        input.quizRecipientId &&
        !(await one(
          sql,
          "SELECT recipient.id FROM lms_quiz_recipients recipient JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id WHERE recipient.id=$1 AND recipient.student_id=$2 AND quiz.run_id=$3",
          [input.quizRecipientId, plan.studentId, plan.runId],
        ))
      )
        throw new LmsError("lmsNotFound", 404);
      if (
        input.complete &&
        ((input.recipientId !== undefined
          ? input.recipientId
          : plan.recipientId) ||
          (input.quizRecipientId !== undefined
            ? input.quizRecipientId
            : plan.quizRecipientId))
      )
        throw new LmsError("lmsMakeupPracticeRequired", 409);
      await sql.query(
        "UPDATE lms_makeup_plans SET recipient_id=CASE WHEN $7 THEN $2::bigint ELSE recipient_id END,quiz_recipient_id=CASE WHEN $8 THEN $3::bigint ELSE quiz_recipient_id END,due_at=CASE WHEN $9 THEN $4::timestamptz ELSE due_at END,status=CASE WHEN $5 THEN 'completed' ELSE status END,completed_at=CASE WHEN $5 THEN COALESCE(completed_at,now()) ELSE completed_at END,completed_by=CASE WHEN $5 THEN COALESCE(completed_by,$6) ELSE completed_by END WHERE id=$1",
        [
          id,
          input.recipientId ?? null,
          input.quizRecipientId ?? null,
          input.dueAt ?? null,
          input.complete ?? false,
          actor.userId,
          input.recipientId !== undefined,
          input.quizRecipientId !== undefined,
          input.dueAt !== undefined,
        ],
      );
      if (input.complete)
        await recordEvent(
          sql,
          plan.studentId,
          plan.runId,
          "makeup_completed",
          id,
          `makeup:${id}`,
        );
      const updated = await one(
        sql,
        "SELECT * FROM lms_makeup_plans WHERE id=$1",
        [id],
      );
      await recordStaffAudit(
        sql,
        actor,
        plan.runId,
        "makeup_plan",
        id,
        "update",
        plan,
        updated,
      );
      await this.learning.syncMakeupResult(
        sql,
        plan.studentId,
        plan.runId,
        `practice:${id}`,
      );
      return { updated: true };
    });
  }
  async achievements(
    actor: PortalActorContext,
    filter?: { runId?: number; from?: string; to?: string },
    page?: LmsListOptions,
  ): Promise<LmsAchievementDto[]> {
    return listRows<LmsAchievementDto>(
      this.pool,
      "SELECT id,run_id,title,reason,awarded_at,revoked_at,revoke_reason FROM lms_achievements WHERE student_id=$1 AND ($2::bigint IS NULL OR run_id=$2) AND ($3::timestamptz IS NULL OR awarded_at>=$3) AND ($4::timestamptz IS NULL OR awarded_at<$4) ORDER BY awarded_at DESC,id DESC",
      [
        actor.studentId,
        filter?.runId ?? null,
        filter?.from ?? null,
        filter?.to ?? null,
      ],
      page,
      page ? await this.learning.enabledRunIds(actor.studentId) : undefined,
    ).then((items) => this.learning.enabledRecords(items));
  }
  async history(
    actor: PortalActorContext,
    limit = 30,
    cursor?: number,
    filter?: { runId?: number; from?: string; to?: string },
  ): Promise<LmsPage<LmsHistoryDto>> {
    const items = await rows<LmsHistoryDto>(
      this.pool,
      `SELECT id,run_id,type,object_id,occurred_at,data FROM lms_learning_events WHERE student_id=$1 AND type IN('material_read','assignment_submitted','assignment_accepted','assignment_revision_required','quiz_finished','makeup_completed','makeup_reopened','report_published','achievement_awarded','achievement_revoked','achievement_restored','course_completed','course_reopened') AND ($3::bigint IS NULL OR id<$3) AND ($4::bigint IS NULL OR run_id=$4) AND ($5::timestamptz IS NULL OR occurred_at>=$5) AND ($6::timestamptz IS NULL OR occurred_at<$6) AND run_id=ANY($7::bigint[]) ORDER BY id DESC LIMIT $2`,
      [
        actor.studentId,
        limit + 1,
        cursor ?? null,
        filter?.runId ?? null,
        filter?.from ?? null,
        filter?.to ?? null,
        await this.learning.enabledRunIds(actor.studentId),
      ],
    );
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    return {
      items: page,
      nextCursor: hasMore ? page.at(-1)!.id : null,
      hasMore,
    };
  }
  async reports(
    actor: PortalActorContext,
    filter?: { runId?: number; from?: string; to?: string },
    page?: LmsListOptions,
  ): Promise<LmsReportDto[]> {
    return listRows<LmsReportDto>(
      this.pool,
      "SELECT report.id,report.run_id,report.period_from,report.period_to,report.comment,report.next_steps,report.version,report.metrics,report.best_projects,report.published_at,staff.full_name AS author_name FROM lms_reports report JOIN users staff ON staff.id=report.published_by WHERE report.student_id=$1 AND ($2::bigint IS NULL OR report.run_id=$2) AND ($3::timestamptz IS NULL OR report.period_to>$3) AND ($4::timestamptz IS NULL OR report.period_from<$4) ORDER BY report.published_at DESC",
      [
        actor.studentId,
        filter?.runId ?? null,
        filter?.from ?? null,
        filter?.to ?? null,
      ],
      page,
      page ? await this.learning.enabledRunIds(actor.studentId) : undefined,
    ).then((items) => this.learning.enabledRecords(items));
  }
  async publishReport(actor: LmsStaffActor, input: LmsReportInput) {
    return transaction(this.pool, async (sql) => {
      await this.learning.requireStaffAccess(
        sql,
        actor,
        input.runId,
        "results.manage",
      );
      return idempotentStaffCommand(
        sql,
        actor,
        input.runId,
        "report_publish",
        input,
        async () => {
          const subject = { studentId: input.studentId } as PortalActorContext;
          await this.learning.requireEnrollment(sql, subject, input.runId);
          await sql.query(
            "SELECT id FROM lms_group_runs WHERE id=$1 FOR UPDATE",
            [input.runId],
          );
          const metrics = await this.learning.monthlyMetrics(
            subject,
            input.runId,
            {
              from: input.periodFrom,
              to: input.periodTo,
            },
            sql,
          );
          const projects = input.bestProjectIds?.length
            ? await this.learning.policy.reportProjects?.(
                sql,
                actor,
                input.runId,
                input.studentId,
                input.bestProjectIds,
              )
            : [];
          if (input.bestProjectIds?.length && !projects)
            throw new LmsError("lmsInvalidRequest");
          const report = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_reports(student_id,run_id,period_from,period_to,version,metrics,comment,next_steps,published_by,best_projects) SELECT $1,$2,$3,$4,COALESCE(MAX(version),0)+1,$5::jsonb,$6,$7,$8,$9::jsonb FROM lms_reports WHERE student_id=$1 AND run_id=$2 AND period_from=$3 AND period_to=$4 RETURNING id",
            [
              input.studentId,
              input.runId,
              input.periodFrom,
              input.periodTo,
              JSON.stringify(metrics),
              input.comment,
              input.nextSteps,
              actor.userId,
              JSON.stringify(projects ?? []),
            ],
          );
          await recordEvent(
            sql,
            input.studentId,
            input.runId,
            "report_published",
            report!.id,
            `report:${report!.id}`,
          );
          await recordStaffAudit(
            sql,
            actor,
            input.runId,
            "report",
            report!.id,
            "publish",
            null,
            {
              studentId: input.studentId,
              periodFrom: input.periodFrom,
              periodTo: input.periodTo,
              bestProjectIds: input.bestProjectIds ?? [],
            },
          );
          return { id: report!.id };
        },
      );
    });
  }
  async award(
    actor: LmsStaffActor,
    input: {
      runId: number;
      studentId: number;
      title: string;
      reason: string;
      eventKey: string;
    },
  ) {
    return transaction(this.pool, async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `lms-award:${input.eventKey}`,
      ]);
      const existing = await one<{
        id: number;
        studentId: number;
        runId: number;
      }>(
        sql,
        "SELECT id,student_id,run_id FROM lms_achievements WHERE event_key=$1",
        [input.eventKey],
      );
      if (existing) {
        if (
          existing.studentId !== input.studentId ||
          existing.runId !== input.runId
        )
          throw new LmsError("lmsVersionConflict", 409);
        await this.learning.requireStaffAccess(
          sql,
          actor,
          input.runId,
          "results.manage",
        );
        return { id: existing.id };
      }
      await this.learning.requireStaffAccess(
        sql,
        actor,
        input.runId,
        "results.manage",
      );
      await this.learning.requireEnrollment(
        sql,
        { studentId: input.studentId } as PortalActorContext,
        input.runId,
      );
      const achievement = await one<{ id: number }>(
        sql,
        "INSERT INTO lms_achievements(student_id,run_id,rule,event_key,title,reason,awarded_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_key) DO UPDATE SET event_key=EXCLUDED.event_key RETURNING id",
        [
          input.studentId,
          input.runId,
          `manual:${input.eventKey}`,
          input.eventKey,
          input.title,
          input.reason,
          actor.userId,
        ],
      );
      await recordEvent(
        sql,
        input.studentId,
        input.runId,
        "achievement_awarded",
        achievement!.id,
        `achievement:${achievement!.id}`,
      );
      return { id: achievement!.id };
    });
  }
  async revokeAward(actor: LmsStaffActor, id: number, reason: string) {
    return transaction(this.pool, async (sql) => {
      const award = await one<{
        runId: number;
        studentId: number;
        revokedAt: string | null;
      }>(sql, "SELECT * FROM lms_achievements WHERE id=$1 FOR UPDATE", [id]);
      if (!award) throw new LmsError("lmsNotFound", 404);
      await this.learning.requireStaffAccess(
        sql,
        actor,
        award.runId,
        "results.manage",
      );
      if (award.revokedAt) return { revoked: true };
      const updated = await one<{ revokedAt: string }>(
        sql,
        "UPDATE lms_achievements SET revoked_at=now(),revoked_by=$2,revoke_reason=$3 WHERE id=$1 AND revoked_at IS NULL RETURNING *",
        [id, actor.userId, reason],
      );
      await recordEvent(
        sql,
        award.studentId,
        award.runId,
        "achievement_revoked",
        id,
        `achievement-revoked:${id}:${updated!.revokedAt}`,
        { reason },
      );
      await recordStaffAudit(
        sql,
        actor,
        award.runId,
        "achievement",
        id,
        "revoke",
        award,
        updated,
        reason,
      );
      return { revoked: true };
    });
  }
  async announcements(
    actor: PortalActorContext,
    page?: LmsListOptions,
  ): Promise<LmsAnnouncementDto[]> {
    return listRows<LmsAnnouncementDto>(
      this.pool,
      `SELECT announcement.id,announcement.run_id,announcement.title,announcement.body,announcement.audience,announcement.publish_at,announcement.pinned_until,announcement.file_ids,(read.read_at IS NOT NULL) AS read FROM lms_announcements announcement JOIN lms_group_runs run ON run.id=announcement.run_id LEFT JOIN lms_announcement_reads read ON read.announcement_id=announcement.id AND read.account_id=$2 WHERE announcement.publish_at<=now() AND announcement.revoked_at IS NULL AND announcement.audience=ANY($3::text[]) AND EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.student_id=$1 AND enrollment.group_id=run.group_id AND announcement.publish_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR announcement.publish_at<enrollment.ended_at)) ORDER BY (announcement.pinned_until>now()) DESC,announcement.publish_at DESC`,
      [
        actor.studentId,
        actor.portalAccountId,
        actor.kind === "self"
          ? ["students", "all"]
          : ["representatives", "all"],
      ],
      page,
      page ? await this.learning.enabledRunIds(actor.studentId) : undefined,
    ).then((items) => this.learning.enabledRecords(items));
  }
  async readAnnouncement(actor: PortalActorContext, id: number) {
    if (!(await this.announcements(actor)).some((row) => row.id === id))
      throw new LmsError("lmsNotFound", 404);
    await this.pool.query(
      "INSERT INTO lms_announcement_reads(announcement_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [id, actor.portalAccountId],
    );
    return { read: true };
  }
  async createAnnouncement(actor: LmsStaffActor, input: LmsAnnouncementInput) {
    return transaction(this.pool, async (sql) => {
      await this.learning.requireStaffAccess(
        sql,
        actor,
        input.runId,
        "announcements.manage",
      );
      return idempotentStaffCommand(
        sql,
        actor,
        input.runId,
        "announcement_create",
        input,
        async () => {
          await this.learning.authorizeFiles(sql, actor, input.fileIds, {
            runId: input.runId,
          });
          const announcement = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_announcements(run_id,title,body,audience,file_ids,publish_at,pinned_until,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id",
            [
              input.runId,
              input.title,
              input.body,
              input.audience,
              JSON.stringify(input.fileIds),
              input.publishAt,
              input.pinnedUntil,
              actor.userId,
            ],
          );
          await recordStaffAudit(
            sql,
            actor,
            input.runId,
            "announcement",
            announcement!.id,
            "publish",
            null,
            {
              audience: input.audience,
              publishAt: input.publishAt,
              pinnedUntil: input.pinnedUntil,
              fileIds: input.fileIds,
            },
          );
          return announcement;
        },
      );
    });
  }
  async managementAnnouncements(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ) {
    await this.learning.requireStaffAccess(
      this.pool,
      actor,
      runId,
      "announcements.manage",
    );
    return listRows(
      this.pool,
      "SELECT id,run_id,title,body,audience,file_ids,publish_at,pinned_until FROM lms_announcements WHERE run_id=$1 AND revoked_at IS NULL ORDER BY publish_at DESC",
      [runId],
      page,
    );
  }
  async threads(
    actor: PortalActorContext,
    page?: LmsListOptions,
  ): Promise<LmsThreadDto[]> {
    const list = await listRows<Omit<LmsThreadDto, "comments">>(
      this.pool,
      `SELECT id,run_id,unit_id,recipient_id,quiz_attempt_id,step_url,title,audience,status,author_account_id,created_at FROM lms_threads WHERE student_id=$1 AND ${actor.kind === "self" ? "audience='student_teacher'" : "author_account_id=$2"} ORDER BY created_at DESC`,
      actor.kind === "self"
        ? [actor.studentId]
        : [actor.studentId, actor.portalAccountId],
      page,
      page ? await this.learning.enabledRunIds(actor.studentId) : undefined,
    );
    return (await this.learning.enabledRecords(list)).map((thread) => ({
      ...thread,
      comments: [],
    }));
  }
  async thread(sql: LmsSql, actor: PortalActorContext, id: number) {
    const row = await one<Omit<LmsThreadDto, "comments">>(
      sql,
      `SELECT id,run_id,unit_id,recipient_id,quiz_attempt_id,step_url,title,audience,status,author_account_id,created_at FROM lms_threads WHERE id=$1 AND student_id=$2 AND ${actor.kind === "self" ? "audience='student_teacher'" : "author_account_id=$3"}`,
      actor.kind === "self"
        ? [id, actor.studentId]
        : [id, actor.studentId, actor.portalAccountId],
    );
    if (!row) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireRunEnabled(sql, row.runId);
    return row;
  }
  async comments(
    sql: LmsSql,
    threadId: number,
    staff = false,
  ): Promise<LmsCommentDto[]> {
    return rows(
      sql,
      `SELECT comment.id,comment.body,COALESCE(account.full_name,staff.full_name) AS author_name,comment.audience,comment.created_at,comment.file_ids FROM lms_comments comment LEFT JOIN portal_accounts account ON account.id=comment.account_id LEFT JOIN users staff ON staff.id=comment.staff_user_id WHERE comment.thread_id=$1 ${staff ? "" : "AND comment.audience<>'staff'"} ORDER BY comment.id`,
      [threadId],
    );
  }
  async threadDetail(actor: PortalActorContext, id: number) {
    const thread = await this.thread(this.pool, actor, id);
    return { ...thread, comments: await this.comments(this.pool, id) };
  }
  async createThread(actor: PortalActorContext, input: LmsThreadInput) {
    return transaction(this.pool, async (sql) => {
      await this.learning.requireEnrollment(sql, actor, input.runId);
      const eventKey = input.idempotencyKey
        ? `help:${actor.portalAccountId}:${actor.studentId}:${input.runId}:${input.idempotencyKey}`
        : null;
      const requestHash = commandRequestHash(input);
      if (eventKey) {
        await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          eventKey,
        ]);
        const prior = await one<{
          objectId: number;
          data: { requestHash: string };
        }>(
          sql,
          "SELECT object_id,data FROM lms_learning_events WHERE event_key=$1",
          [eventKey],
        );
        if (prior) {
          if (prior.data.requestHash !== requestHash)
            throw new LmsError("lmsVersionConflict", 409);
          return { id: prior.objectId };
        }
      }
      await this.learning.assertUnit(sql, input.runId, input.unitId);
      if (input.quizAttemptId) {
        if (
          !actor.permissions.includes("learning.read") &&
          !actor.permissions.includes("feedback.read")
        )
          throw new LmsError("portalAccessDenied", 403);
        if (
          !(await one(
            sql,
            "SELECT attempt.id FROM lms_quiz_attempts attempt JOIN lms_quiz_recipients recipient ON recipient.id=attempt.recipient_id JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id WHERE attempt.id=$1 AND recipient.student_id=$2 AND quiz.run_id=$3",
            [input.quizAttemptId, actor.studentId, input.runId],
          ))
        )
          throw new LmsError("lmsNotFound", 404);
      }
      if (actor.kind === "self" && input.audience !== "student_teacher")
        throw new LmsError("portalAccessDenied", 403);
      if (
        input.recipientId &&
        !(await one(
          sql,
          "SELECT recipient.id FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE recipient.id=$1 AND recipient.student_id=$2 AND assignment.run_id=$3",
          [input.recipientId, actor.studentId, input.runId],
        ))
      )
        throw new LmsError("lmsNotFound", 404);
      await this.learning.authorizeFiles(sql, actor, input.fileIds, {
        runId: input.runId,
        recipientId: input.recipientId,
      });
      const thread = await one<{ id: number }>(
        sql,
        "INSERT INTO lms_threads(student_id,run_id,unit_id,recipient_id,title,audience,author_account_id,assigned_user_id,quiz_attempt_id,step_url) SELECT $1,$2,$3,$4,$5,$6,$7,teacher.user_id,$8,$9 FROM lms_group_runs run JOIN academy_groups g ON g.id=run.group_id LEFT JOIN academy_teachers teacher ON teacher.id=g.teacher_id WHERE run.id=$2 RETURNING id",
        [
          actor.studentId,
          input.runId,
          input.unitId ?? null,
          input.recipientId ?? null,
          input.title,
          actor.kind === "representative" && !input.shareWithFamily
            ? "representative_teacher"
            : "student_teacher",
          actor.portalAccountId,
          input.quizAttemptId ?? null,
          input.stepUrl ?? null,
        ],
      );
      await sql.query(
        "INSERT INTO lms_comments(student_id,run_id,thread_id,account_id,audience,body,file_ids) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
        [
          actor.studentId,
          input.runId,
          thread!.id,
          actor.portalAccountId,
          actor.kind === "representative" && !input.shareWithFamily
            ? "representative_teacher"
            : "student_teacher",
          input.body,
          JSON.stringify(input.fileIds),
        ],
      );
      await recordEvent(
        sql,
        actor.studentId,
        input.runId,
        "help_requested",
        thread!.id,
        eventKey ?? `thread:${thread!.id}`,
        { accountId: actor.portalAccountId, requestHash },
      );
      return { id: thread!.id };
    });
  }
  async addComment(
    actor: PortalActorContext,
    id: number,
    input: LmsCommentInput,
  ) {
    return transaction(this.pool, async (sql) => {
      const thread = await this.thread(sql, actor, id);
      if (input.audience === "staff")
        throw new LmsError("portalAccessDenied", 403);
      return idempotentPortalCommand(
        sql,
        actor,
        thread.runId,
        "thread_comment",
        id,
        input,
        async () => {
          await this.learning.authorizeFiles(sql, actor, input.fileIds, {
            runId: thread.runId,
          });
          const comment = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_comments(student_id,run_id,thread_id,account_id,audience,body,file_ids) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id",
            [
              actor.studentId,
              thread.runId,
              id,
              actor.portalAccountId,
              thread.audience,
              input.body,
              JSON.stringify(input.fileIds),
            ],
          );
          await sql.query("UPDATE lms_threads SET status='open' WHERE id=$1", [
            id,
          ]);
          await recordEvent(
            sql,
            actor.studentId,
            thread.runId,
            "thread_comment",
            comment!.id,
            `comment:${comment!.id}`,
            { threadId: id, accountId: actor.portalAccountId },
          );
          return { id: comment!.id };
        },
      );
    });
  }
  async threadStatus(actor: PortalActorContext, id: number, status: string) {
    await this.thread(this.pool, actor, id);
    await this.pool.query("UPDATE lms_threads SET status=$2 WHERE id=$1", [
      id,
      status,
    ]);
    return { status };
  }
  async managementThreads(
    actor: LmsStaffActor,
    runId?: number,
    page?: LmsListOptions,
  ) {
    const list = await listRows<
      LmsThreadDto & { studentId: number; studentName: string }
    >(
      this.pool,
      `SELECT thread.id,thread.run_id,thread.unit_id,thread.recipient_id,thread.quiz_attempt_id,thread.step_url,thread.title,thread.audience,thread.status,thread.author_account_id,thread.created_at,thread.student_id,COALESCE(student.student_name,student.contact_name) AS student_name FROM lms_threads thread JOIN academy_students student ON student.id=thread.student_id ${runId ? "WHERE thread.run_id=$1" : ""} ORDER BY thread.created_at DESC`,
      runId ? [runId] : [],
      page,
      page
        ? await this.learning.enabledStaffRunIds(actor, "communication.manage")
        : undefined,
    );
    const visible = [];
    for (const thread of list) {
      try {
        await this.learning.requireStaffAccess(
          this.pool,
          actor,
          thread.runId,
          "communication.manage",
        );
        visible.push({ ...thread, comments: [] });
      } catch (error) {
        if (!(error instanceof LmsError)) throw error;
      }
    }
    return visible;
  }
  async staffThread(sql: LmsSql, actor: LmsStaffActor, id: number) {
    const thread = await one<LmsThreadDto & { studentId: number }>(
      sql,
      "SELECT * FROM lms_threads WHERE id=$1",
      [id],
    );
    if (!thread) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireStaffAccess(
      sql,
      actor,
      thread.runId,
      "communication.manage",
    );
    return thread;
  }
  async managementThreadDetail(actor: LmsStaffActor, id: number) {
    const thread = await this.staffThread(this.pool, actor, id);
    return { ...thread, comments: await this.comments(this.pool, id, true) };
  }
  async staffComment(actor: LmsStaffActor, id: number, input: LmsCommentInput) {
    return transaction(this.pool, async (sql) => {
      const thread = await this.staffThread(sql, actor, id);
      return idempotentStaffCommand(
        sql,
        actor,
        thread.runId,
        `thread_comment:${id}`,
        input,
        async () => {
          await this.learning.authorizeFiles(sql, actor, input.fileIds, {
            runId: thread.runId,
          });
          const comment = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_comments(student_id,run_id,thread_id,staff_user_id,audience,body,file_ids) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id",
            [
              thread.studentId,
              thread.runId,
              id,
              actor.userId,
              input.audience === "staff" ? "staff" : thread.audience,
              input.body,
              JSON.stringify(input.fileIds),
            ],
          );
          if (input.audience !== "staff")
            await sql.query(
              "UPDATE lms_threads SET status='answered' WHERE id=$1",
              [id],
            );
          await recordEvent(
            sql,
            thread.studentId,
            thread.runId,
            "thread_answered",
            comment!.id,
            `comment:${comment!.id}`,
            {
              threadId: id,
              audience: input.audience === "staff" ? "staff" : thread.audience,
              accountId: thread.authorAccountId,
            },
          );
          return { id: comment!.id };
        },
      );
    });
  }
  async staffThreadStatus(actor: LmsStaffActor, id: number, status: string) {
    await this.staffThread(this.pool, actor, id);
    await this.pool.query("UPDATE lms_threads SET status=$2 WHERE id=$1", [
      id,
      status,
    ]);
    return { status };
  }
  async managementMakeup(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ) {
    await this.learning.requireStaffAccess(
      this.pool,
      actor,
      runId,
      "assignments.manage",
    );
    await this.syncMakeup();
    return listRows(
      this.pool,
      `SELECT plan.id,plan.lesson_id,plan.run_id,lesson.topic,lesson.scheduled_at,plan.status,plan.due_at,plan.recipient_id,plan.quiz_recipient_id,plan.student_id,COALESCE(student.student_name,student.contact_name) AS student_name FROM lms_makeup_plans plan JOIN academy_lessons lesson ON lesson.id=plan.lesson_id JOIN academy_students student ON student.id=plan.student_id WHERE plan.run_id=$1 ORDER BY lesson.scheduled_at DESC`,
      [runId],
      page,
    );
  }
  async managementAwards(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ) {
    await this.learning.requireStaffAccess(
      this.pool,
      actor,
      runId,
      "results.manage",
    );
    return listRows(
      this.pool,
      "SELECT achievement.id,achievement.run_id,achievement.student_id,COALESCE(student.student_name,student.contact_name) AS student_name,achievement.title,achievement.reason,achievement.awarded_at,achievement.revoked_at,achievement.revoke_reason FROM lms_achievements achievement JOIN academy_students student ON student.id=achievement.student_id WHERE achievement.run_id=$1 ORDER BY achievement.awarded_at DESC",
      [runId],
      page,
    );
  }
  async managementReports(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ) {
    await this.learning.requireStaffAccess(
      this.pool,
      actor,
      runId,
      "results.manage",
    );
    return listRows(
      this.pool,
      "SELECT report.id,report.run_id,report.student_id,COALESCE(student.student_name,student.contact_name) AS student_name,report.period_from,report.period_to,report.version,report.metrics,report.best_projects,report.comment,report.next_steps,report.published_at,staff.full_name AS author_name FROM lms_reports report JOIN academy_students student ON student.id=report.student_id JOIN users staff ON staff.id=report.published_by WHERE report.run_id=$1 ORDER BY report.published_at DESC",
      [runId],
      page,
    );
  }
  async makeupOptions(actor: LmsStaffActor, id: number) {
    const plan = await one<{ runId: number; studentId: number }>(
      this.pool,
      "SELECT run_id,student_id FROM lms_makeup_plans WHERE id=$1",
      [id],
    );
    if (!plan) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireStaffAccess(
      this.pool,
      actor,
      plan.runId,
      "assignments.manage",
    );
    const assignments = await rows(
      this.pool,
      "SELECT recipient.id,version.title,recipient.status FROM lms_assignment_recipients recipient JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE recipient.student_id=$1 AND assignment.run_id=$2 AND recipient.status NOT IN('excused','cancelled') ORDER BY recipient.id",
      [plan.studentId, plan.runId],
    );
    const quizzes = await rows(
      this.pool,
      "SELECT recipient.id,version.title,recipient.status FROM lms_quiz_recipients recipient JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id WHERE recipient.student_id=$1 AND quiz.run_id=$2 AND recipient.status='assigned' ORDER BY recipient.id",
      [plan.studentId, plan.runId],
    );
    return { assignments, quizzes };
  }
}
