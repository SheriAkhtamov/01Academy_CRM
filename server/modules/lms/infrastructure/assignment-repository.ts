import type { LmsListOptions } from "@shared/contracts/lms";
import type { Pool } from "pg";
import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import type {
  LmsAssignmentDto,
  LmsAssignmentDetailDto,
  LmsAssignmentInput,
  LmsDraftDto,
  LmsDraftInput,
  LmsSubmitInput,
  LmsSubmissionDto,
  LmsReviewInput,
  LmsReviewDto,
  LmsPage,
  LmsReviewQueueDto,
  LmsCommentDto,
  LmsCommentInput,
} from "@shared/contracts/lms";
import {
  LmsError,
  requireVersion,
  requireAssignmentOpen,
  type LmsStaffActor,
} from "../domain/policy";
import {
  one,
  rows,
  listRows,
  transaction,
  recordEvent,
  recordStaffAudit,
  idempotentStaffCommand,
  idempotentPortalCommand,
  recipientEnrollmentVisibilitySql,
  type LmsSql,
} from "./postgres-base";
import { PgLearningRepository } from "./learning-repository";
const assignmentSelect = `SELECT recipient.id,recipient.id AS recipient_id,recipient.assignment_version_id,assignment.run_id,assignment.unit_id,version.title,version.body,version.required,version.allowed_answers,version.file_ids,version.criteria,version.grading_mode,version.max_score,course.name AS course_name,g.name AS group_name,recipient.opens_at,recipient.due_at,recipient.closes_at,recipient.status,(recipient.due_at<now() AND recipient.status IN('assigned','revision_required')) AS overdue,recipient.version,recipient.student_id FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id JOIN lms_group_runs run ON run.id=assignment.run_id JOIN academy_groups g ON g.id=run.group_id JOIN academy_courses course ON course.id=g.course_id`;
export class PgAssignmentRepository {
  constructor(
    readonly pool: Pool,
    readonly learning: PgLearningRepository,
  ) {}
  async list(
    actor: PortalActorContext,
    limit = 30,
    cursor?: number,
  ): Promise<LmsPage<LmsAssignmentDto>> {
    const items = await rows<LmsAssignmentDto>(
      this.pool,
      `${assignmentSelect} WHERE recipient.student_id=$1 AND recipient.opens_at<=now() AND recipient.status<>'cancelled' AND ${recipientEnrollmentVisibilitySql()} AND ($3::bigint IS NULL OR recipient.id<$3) AND run.id=ANY($4::bigint[]) ORDER BY recipient.id DESC LIMIT $2`,
      [
        actor.studentId,
        limit + 1,
        cursor ?? null,
        await this.learning.enabledRunIds(actor.studentId),
      ],
    );
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    return {
      items: page.map((row) => this.summary(row)),
      nextCursor: hasMore ? page.at(-1)!.id : null,
      hasMore,
    };
  }
  summary(row: LmsAssignmentDto): LmsAssignmentDto {
    return {
      id: row.id,
      recipientId: row.recipientId,
      assignmentVersionId: row.assignmentVersionId,
      runId: row.runId,
      unitId: row.unitId,
      title: row.title,
      courseName: row.courseName,
      groupName: row.groupName,
      opensAt: row.opensAt,
      dueAt: row.dueAt,
      closesAt: row.closesAt,
      required: row.required,
      status: row.status,
      overdue: row.overdue,
      version: row.version,
    };
  }
  async recipient(
    sql: LmsSql,
    actor: PortalActorContext,
    id: number,
    lock = false,
  ) {
    const row = await one<LmsAssignmentDetailDto & { studentId: number }>(
      sql,
      `${assignmentSelect} WHERE recipient.id=$1 AND recipient.student_id=$2 AND recipient.opens_at<=now() AND ${recipientEnrollmentVisibilitySql()} ${lock ? "FOR UPDATE OF recipient" : ""}`,
      [id, actor.studentId],
    );
    if (!row) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireRunEnabled(sql, row.runId);
    return row;
  }
  async detail(
    actor: PortalActorContext,
    id: number,
    staff = false,
  ): Promise<LmsAssignmentDetailDto> {
    const row = await this.recipient(this.pool, actor, id);
    const draft =
      actor.kind === "self"
        ? await this.draft(this.pool, id)
        : { version: 0, text: "", links: [], fileIds: [], savedAt: null };
    const submissions = await this.submissions(id);
    const reviewStarted = Boolean(
      await one(
        this.pool,
        "SELECT id FROM (SELECT id,review_started_at FROM lms_submissions WHERE recipient_id=$1 AND withdrawn_at IS NULL ORDER BY attempt_number DESC LIMIT 1) latest WHERE review_started_at IS NOT NULL",
        [id],
      ),
    );
    const comments = await rows<LmsCommentDto>(
      this.pool,
      `SELECT comment.id,comment.body,COALESCE(account.full_name,staff.full_name) AS author_name,comment.audience,comment.created_at,comment.file_ids ${staff ? ",comment.account_id AS author_account_id,comment.audience_account_id" : ""} FROM lms_comments comment LEFT JOIN portal_accounts account ON account.id=comment.account_id LEFT JOIN users staff ON staff.id=comment.staff_user_id WHERE comment.recipient_id=$1 AND ($3::boolean OR comment.audience='family_teacher' OR ($4='self' AND comment.audience='student_teacher') OR ($4='representative' AND comment.audience='representative_teacher' AND comment.audience_account_id=$2)) ORDER BY comment.id`,
      [id, actor.portalAccountId ?? null, staff, actor.kind],
    );
    return {
      ...this.summary(row),
      reviewStarted,
      canWithdraw:
        actor.kind === "self" &&
        row.status === "submitted" &&
        !reviewStarted &&
        Boolean(
          submissions[0] &&
          !submissions[0].withdrawnAt &&
          !submissions[0].review,
        ),
      body: row.body,
      gradingMode: row.gradingMode,
      maxScore: row.maxScore,
      criteria: row.criteria,
      allowedAnswers: row.allowedAnswers,
      fileIds: row.fileIds,
      draft,
      submissions,
      comments,
    };
  }
  async draft(sql: LmsSql, id: number): Promise<LmsDraftDto> {
    return (
      (await one<LmsDraftDto>(
        sql,
        "SELECT version,text,links,file_ids,saved_at FROM lms_submission_drafts WHERE recipient_id=$1",
        [id],
      )) ?? { version: 0, text: "", links: [], fileIds: [], savedAt: null }
    );
  }
  async submissions(id: number): Promise<LmsSubmissionDto[]> {
    const submissions = await rows<LmsSubmissionDto>(
      this.pool,
      `SELECT submission.id,submission.assignment_version_id,source_version.title,source_version.criteria,source_version.max_score,source_version.grading_mode,submission.attempt_number,submission.text,submission.links,submission.file_ids,submission.submitted_at,submission.late,submission.withdrawn_at,CASE WHEN review.id IS NULL THEN NULL ELSE jsonb_build_object('id',review.id,'decision',review.decision,'comment',review.comment,'score',review.score,'criterionScores',review.criterion_scores,'reviewerName',staff.full_name,'createdAt',review.created_at) END AS review FROM lms_submissions submission JOIN lms_assignment_versions source_version ON source_version.id=submission.assignment_version_id LEFT JOIN LATERAL(SELECT * FROM lms_reviews r WHERE r.submission_id=submission.id ORDER BY id DESC LIMIT 1) review ON true LEFT JOIN users staff ON staff.id=review.reviewer_id WHERE submission.recipient_id=$1 ORDER BY submission.attempt_number DESC`,
      [id],
    );
    const reviews = await rows<LmsReviewDto & { submissionId: number }>(
      this.pool,
      "SELECT review.id,review.submission_id,review.decision,review.comment,review.score,review.criterion_scores,review.reason,review.created_at,staff.full_name AS reviewer_name FROM lms_reviews review JOIN lms_submissions submission ON submission.id=review.submission_id JOIN users staff ON staff.id=review.reviewer_id WHERE submission.recipient_id=$1 ORDER BY review.id",
      [id],
    );
    return submissions.map((submission) => ({
      ...submission,
      reviewHistory: reviews
        .filter((review) => review.submissionId === submission.id)
        .map(({ submissionId: _, ...review }) => review),
    }));
  }
  async saveDraft(actor: PortalActorContext, id: number, input: LmsDraftInput) {
    return transaction(this.pool, async (sql) => {
      const recipient = await this.recipient(sql, actor, id, true);
      requireAssignmentOpen(recipient, new Date());
      await this.learning.authorizeFiles(sql, actor, input.fileIds, {
        runId: recipient.runId,
        recipientId: id,
      });
      const current = await this.draft(sql, id);
      requireVersion(current.version, input.version);
      return one<LmsDraftDto>(
        sql,
        `INSERT INTO lms_submission_drafts(recipient_id,version,text,links,file_ids) VALUES($1,1,$2,$3::jsonb,$4::jsonb) ON CONFLICT(recipient_id) DO UPDATE SET version=lms_submission_drafts.version+1,text=EXCLUDED.text,links=EXCLUDED.links,file_ids=EXCLUDED.file_ids,saved_at=now() RETURNING version,text,links,file_ids,saved_at`,
        [
          id,
          input.text,
          JSON.stringify(input.links),
          JSON.stringify(input.fileIds),
        ],
      );
    });
  }
  async submit(actor: PortalActorContext, id: number, input: LmsSubmitInput) {
    return transaction(this.pool, async (sql) => {
      const recipient = await this.recipient(sql, actor, id, true);
      const existing = await one<{ receiptSnapshot: Record<string, unknown> }>(
        sql,
        "SELECT receipt_snapshot FROM lms_submissions WHERE account_id=$1 AND recipient_id=$2 AND idempotency_key=$3",
        [actor.portalAccountId, id, input.idempotencyKey],
      );
      if (existing) return existing.receiptSnapshot;
      const now = new Date();
      requireAssignmentOpen(recipient, now);
      requireVersion((await this.draft(sql, id)).version, input.draftVersion);
      if (recipient.assignmentVersionId !== input.assignmentVersionId)
        throw new LmsError("lmsVersionConflict", 409);
      if (
        (!input.text && !input.links.length && !input.fileIds.length) ||
        (input.text && !recipient.allowedAnswers.includes("text")) ||
        (input.links.length && !recipient.allowedAnswers.includes("links")) ||
        (input.fileIds.length && !recipient.allowedAnswers.includes("files"))
      )
        throw new LmsError("lmsAnswerRequired");
      await this.learning.authorizeFiles(sql, actor, input.fileIds, {
        runId: recipient.runId,
        recipientId: id,
      });
      const submission = await one<{
        id: number;
        attemptNumber: number;
        submittedAt: string;
        late: boolean;
      }>(
        sql,
        `INSERT INTO lms_submissions(recipient_id,assignment_version_id,account_id,attempt_number,text,links,file_ids,idempotency_key,late) SELECT $1,$2,$3,COALESCE(MAX(attempt_number),0)+1,$4,$5::jsonb,$6::jsonb,$7,$8 FROM lms_submissions WHERE recipient_id=$1 RETURNING id,attempt_number,submitted_at,late`,
        [
          id,
          input.assignmentVersionId,
          actor.portalAccountId,
          input.text,
          JSON.stringify(input.links),
          JSON.stringify(input.fileIds),
          input.idempotencyKey,
          !!recipient.dueAt && +new Date(recipient.dueAt) < +now,
        ],
      );
      await sql.query(
        "UPDATE lms_assignment_recipients SET status='submitted',version=version+1 WHERE id=$1",
        [id],
      );
      await recordEvent(
        sql,
        actor.studentId,
        recipient.runId,
        "assignment_submitted",
        submission!.id,
        `submission:${submission!.id}`,
      );
      const receipt = {
        ...submission!,
        version: recipient.version + 1,
        status: "submitted",
        dueAt: recipient.dueAt,
      };
      await sql.query(
        "UPDATE lms_submissions SET receipt_snapshot=$2::jsonb WHERE id=$1",
        [submission!.id, JSON.stringify(receipt)],
      );
      return receipt;
    });
  }
  async withdraw(
    actor: PortalActorContext,
    submissionId: number,
    version: number,
  ) {
    return transaction(this.pool, async (sql) => {
      const submission = await one<{
        recipientId: number;
        reviewStartedBy: number | null;
        withdrawnAt: string | null;
        text: string;
        links: string[];
        fileIds: number[];
      }>(
        sql,
        "SELECT submission.* FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id WHERE submission.id=$1 AND recipient.student_id=$2",
        [submissionId, actor.studentId],
      );
      if (!submission) throw new LmsError("lmsNotFound", 404);
      const recipient = await this.recipient(
        sql,
        actor,
        submission.recipientId,
        true,
      );
      requireVersion(recipient.version, version);
      const latest = await one<{
        id: number;
        reviewStartedBy: number | null;
        withdrawnAt: string | null;
      }>(
        sql,
        "SELECT id,review_started_by,withdrawn_at FROM lms_submissions WHERE recipient_id=$1 ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE",
        [submission.recipientId],
      );
      if (
        latest!.id !== submissionId ||
        latest!.reviewStartedBy ||
        latest!.withdrawnAt ||
        recipient.status !== "submitted" ||
        (await one(sql, "SELECT id FROM lms_reviews WHERE submission_id=$1", [
          submissionId,
        ]))
      )
        throw new LmsError("lmsReviewStateConflict", 409);
      await sql.query(
        "UPDATE lms_submissions SET withdrawn_at=now() WHERE id=$1",
        [submissionId],
      );
      await sql.query(
        "UPDATE lms_assignment_recipients SET status='assigned',version=version+1 WHERE id=$1",
        [submission.recipientId],
      );
      await sql.query(
        "INSERT INTO lms_submission_drafts(recipient_id,text,links,file_ids) VALUES($1,$2,$3::jsonb,$4::jsonb) ON CONFLICT(recipient_id) DO UPDATE SET text=EXCLUDED.text,links=EXCLUDED.links,file_ids=EXCLUDED.file_ids,version=lms_submission_drafts.version+1,saved_at=now()",
        [
          submission.recipientId,
          submission.text,
          JSON.stringify(submission.links),
          JSON.stringify(submission.fileIds),
        ],
      );
      return { withdrawn: true, version: version + 1 };
    });
  }
  async create(actor: LmsStaffActor, input: LmsAssignmentInput) {
    await this.learning.requireStaffAccess(
      this.pool,
      actor,
      input.runId,
      "assignments.manage",
    );
    const receipt = await this.assignmentReceipt(this.pool, actor, input);
    if (receipt) return receipt;
    const source = input.copySourceAssignmentId
      ? await this.copySource(this.pool, actor, input)
      : null;
    let fileIds = input.fileIds;
    let prepared:
      | { fileIds: number[]; discardUnused: () => Promise<void> }
      | undefined;
    if (source && source.runId !== input.runId) {
      const sourceFiles = fileIds.filter((id) => source.fileIds.includes(id));
      if (sourceFiles.length) {
        if (!this.learning.policy.copyFiles)
          throw new LmsError("lmsFileAccessDenied", 403);
        prepared = await this.learning.policy.copyFiles(
          actor,
          sourceFiles,
          source.runId,
          input.runId,
          input.idempotencyKey,
        );
        if (prepared.fileIds.length !== sourceFiles.length) {
          await prepared.discardUnused();
          throw new LmsError("lmsFileAccessDenied", 403);
        }
        const replacements = new Map(
          sourceFiles.map((id, index) => [id, prepared!.fileIds[index]]),
        );
        fileIds = fileIds.map((id) => replacements.get(id) ?? id);
      }
    }
    try {
      return await transaction(this.pool, async (sql) => {
        if (input.idempotencyKey) {
          await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            `lms-assignment:${actor.userId}:${input.idempotencyKey}`,
          ]);
          const receipt = await this.assignmentReceipt(sql, actor, input);
          if (receipt) return receipt;
        }

        await this.learning.requireStaffAccess(
          sql,
          actor,
          input.runId,
          "assignments.manage",
        );
        await this.learning.assertUnit(sql, input.runId, input.unitId);
        if (input.copySourceAssignmentId) {
          const source = await this.copySource(sql, actor, input);
          if (
            source!.runId !== input.runId &&
            source!.fileIds.some((id) => input.fileIds.includes(id)) &&
            !prepared
          )
            throw new LmsError("lmsFileAccessDenied", 403);
        }
        await this.learning.authorizeFiles(sql, actor, fileIds, {
          runId: input.runId,
        });
        const enrollments = await this.learning.recipientEnrollments(
          sql,
          input.runId,
          input.recipientEnrollmentIds,
        );
        const assignment = await one<{ id: number }>(
          sql,
          "INSERT INTO lms_assignments(run_id,unit_id,created_by,idempotency_key,request_snapshot) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id",
          [
            input.runId,
            input.unitId ?? null,
            actor.userId,
            input.idempotencyKey ?? null,
            JSON.stringify(input),
          ],
        );
        const version = await one<{ id: number }>(
          sql,
          "INSERT INTO lms_assignment_versions(assignment_id,version,title,body,required,allowed_answers,file_ids,criteria,grading_mode,max_score) VALUES($1,1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9) RETURNING id",
          [
            assignment!.id,
            input.title,
            input.body,
            input.required,
            JSON.stringify(input.allowedAnswers),
            JSON.stringify(fileIds),
            JSON.stringify(input.criteria),
            input.gradingMode,
            input.maxScore,
          ],
        );
        for (const enrollment of enrollments) {
          const recipient = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_assignment_recipients(assignment_id,assignment_version_id,enrollment_id,student_id,opens_at,due_at,closes_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [
              assignment!.id,
              version!.id,
              enrollment.id,
              enrollment.studentId,
              input.opensAt,
              input.dueAt,
              input.closesAt,
            ],
          );
          await recordEvent(
            sql,
            enrollment.studentId,
            input.runId,
            "assignment_assigned",
            recipient!.id,
            `assignment-assigned:${recipient!.id}`,
            { opensAt: input.opensAt },
          );
        }
        const result = {
          id: assignment!.id,
          assignmentVersionId: version!.id,
          recipientCount: enrollments.length,
        };
        await sql.query(
          "UPDATE lms_assignments SET response_snapshot=$2::jsonb WHERE id=$1",
          [assignment!.id, JSON.stringify(result)],
        );
        await recordStaffAudit(
          sql,
          actor,
          input.runId,
          "assignment",
          assignment!.id,
          "publish",
          null,
          {
            assignmentVersionId: version!.id,
            recipientEnrollmentIds: enrollments.map(
              (enrollment) => enrollment.id,
            ),
            opensAt: input.opensAt,
            dueAt: input.dueAt,
            closesAt: input.closesAt,
            sourceAssignmentId: input.copySourceAssignmentId ?? null,
            sourceVersionId: input.copySourceAssignmentVersionId ?? null,
          },
        );
        return result;
      });
    } finally {
      await prepared?.discardUnused().catch(() => undefined);
    }
  }
  async assignmentReceipt(
    sql: LmsSql,
    actor: LmsStaffActor,
    input: LmsAssignmentInput,
  ): Promise<{
    id: number;
    assignmentVersionId: number;
    recipientCount: number;
  } | null> {
    if (!input.idempotencyKey) return null;
    const existing = await one<{
      matches: boolean;
      responseSnapshot: {
        id: number;
        assignmentVersionId: number;
        recipientCount: number;
      };
    }>(
      sql,
      "SELECT request_snapshot=$3::jsonb AS matches,response_snapshot FROM lms_assignments WHERE created_by=$1 AND idempotency_key=$2",
      [actor.userId, input.idempotencyKey, JSON.stringify(input)],
    );
    if (!existing) return null;
    if (!existing.matches || !existing.responseSnapshot)
      throw new LmsError("lmsVersionConflict", 409);
    return existing.responseSnapshot;
  }
  async copySource(
    sql: LmsSql,
    actor: LmsStaffActor,
    input: LmsAssignmentInput,
  ) {
    const source = await one<{ runId: number; fileIds: number[] }>(
      sql,
      "SELECT assignment.run_id,version.file_ids FROM lms_assignments assignment JOIN lms_assignment_versions version ON version.assignment_id=assignment.id WHERE assignment.id=$1 AND version.id=$2",
      [input.copySourceAssignmentId, input.copySourceAssignmentVersionId],
    );
    if (!source) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireStaffAccess(
      sql,
      actor,
      source.runId,
      "assignments.manage",
    );
    return source;
  }
  async reviewQueue(
    actor: LmsStaffActor,
    runId?: number,
    page?: LmsListOptions,
  ): Promise<LmsReviewQueueDto[]> {
    const results = await listRows<LmsReviewQueueDto>(
      this.pool,
      `${assignmentSelect.replace(" FROM", ",COALESCE(student.student_name,student.contact_name) AS student_name,submission.id AS submission_id,submission.submitted_at,submission.attempt_number,submission.late,submission.review_started_by,(SELECT full_name FROM users WHERE id=submission.review_started_by) AS review_started_name FROM")} JOIN academy_students student ON student.id=recipient.student_id JOIN LATERAL(SELECT * FROM lms_submissions s WHERE s.recipient_id=recipient.id ORDER BY attempt_number DESC LIMIT 1) submission ON true WHERE recipient.status='submitted' AND submission.withdrawn_at IS NULL ${runId ? "AND run.id=$1" : ""} ORDER BY submission.submitted_at`,
      runId ? [runId] : [],
      page,
      page
        ? await this.learning.enabledStaffRunIds(actor, "reviews.manage")
        : undefined,
    );
    const visible: LmsReviewQueueDto[] = [];
    for (const row of results) {
      try {
        await this.learning.requireStaffAccess(
          this.pool,
          actor,
          row.runId,
          "reviews.manage",
        );
        visible.push({
          ...this.summary(row),
          studentId: row.studentId,
          studentName: row.studentName,
          submissionId: row.submissionId,
          submittedAt: row.submittedAt,
          attemptNumber: row.attemptNumber,
          late: row.late,
          reviewStartedBy: row.reviewStartedBy,
          reviewStartedName: row.reviewStartedName,
        });
      } catch (error) {
        if (!(error instanceof LmsError)) throw error;
      }
    }
    return visible;
  }
  async reviewRecipient(
    sql: LmsSql,
    actor: LmsStaffActor,
    submissionId: number,
  ) {
    const row = await one<{
      runId: number;
      recipientId: number;
      studentId: number;
      studentName: string;
    }>(
      sql,
      `SELECT assignment.run_id,recipient.id AS recipient_id,recipient.student_id,COALESCE(student.student_name,student.contact_name) AS student_name FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN academy_students student ON student.id=recipient.student_id WHERE submission.id=$1`,
      [submissionId],
    );
    if (!row) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireStaffAccess(
      sql,
      actor,
      row.runId,
      "reviews.manage",
    );
    return row;
  }
  async reviewDetail(actor: LmsStaffActor, submissionId: number) {
    const row = await this.reviewRecipient(this.pool, actor, submissionId);
    const detail = await this.detail(
      { studentId: row.studentId, kind: "self" } as PortalActorContext,
      row.recipientId,
      true,
    );
    const submission = await one<{ reviewStartedBy: number | null }>(
      this.pool,
      "SELECT review_started_by FROM lms_submissions WHERE id=$1",
      [submissionId],
    );
    return {
      ...detail,
      ...row,
      submissionId,
      reviewStartedBy: submission!.reviewStartedBy,
    };
  }
  async startReview(
    actor: LmsStaffActor,
    submissionId: number,
    version: number,
  ) {
    return transaction(this.pool, async (sql) => {
      const row = await this.reviewRecipient(sql, actor, submissionId);
      const recipient = await one<{ version: number; status: string }>(
        sql,
        "SELECT version,status FROM lms_assignment_recipients WHERE id=$1 FOR UPDATE",
        [row.recipientId],
      );
      const latest = await one<{
        id: number;
        withdrawnAt: string | null;
        reviewStartedBy: number | null;
      }>(
        sql,
        "SELECT id,withdrawn_at,review_started_by FROM lms_submissions WHERE recipient_id=$1 ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE",
        [row.recipientId],
      );
      if (
        recipient!.status !== "submitted" ||
        latest!.id !== submissionId ||
        latest!.withdrawnAt
      )
        throw new LmsError("lmsReviewStateConflict", 409);
      if (latest!.reviewStartedBy === actor.userId)
        return { version: recipient!.version, reviewStartedBy: actor.userId };
      requireVersion(recipient!.version, version);
      await sql.query(
        "UPDATE lms_submissions SET review_started_by=$2,review_started_at=now() WHERE id=$1",
        [submissionId, actor.userId],
      );
      await sql.query(
        "UPDATE lms_assignment_recipients SET version=version+1 WHERE id=$1",
        [row.recipientId],
      );
      return { version: version + 1, reviewStartedBy: actor.userId };
    });
  }
  async review(
    actor: LmsStaffActor,
    submissionId: number,
    input: LmsReviewInput,
  ) {
    return transaction(this.pool, async (sql) => {
      const row = await this.reviewRecipient(sql, actor, submissionId);
      const recipient = await this.recipient(
        sql,
        { studentId: row.studentId } as PortalActorContext,
        row.recipientId,
        true,
      );
      return idempotentStaffCommand(
        sql,
        actor,
        row.runId,
        `review:${submissionId}`,
        input,
        async () => {
          requireVersion(recipient.version, input.version);
          const latest = await one<{ id: number; withdrawnAt: string | null }>(
            sql,
            "SELECT id,withdrawn_at FROM lms_submissions WHERE recipient_id=$1 ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE",
            [row.recipientId],
          );
          if (
            latest!.id !== submissionId ||
            latest!.withdrawnAt ||
            !["submitted", "accepted", "revision_required"].includes(
              recipient.status,
            )
          )
            throw new LmsError("lmsReviewStateConflict", 409);
          if (recipient.status !== "submitted" && !input.reason)
            throw new LmsError("lmsReasonRequired");
          if (
            recipient.gradingMode === "acceptance" &&
            input.score !== undefined
          )
            throw new LmsError("lmsScoreInvalid");
          if (
            input.dueAt &&
            +new Date(input.dueAt) < +new Date(recipient.opensAt)
          )
            throw new LmsError("lmsDatesInvalid");
          if (
            recipient.gradingMode === "points" &&
            (input.score === undefined ||
              input.score > (recipient.maxScore ?? 0))
          )
            throw new LmsError("lmsScoreInvalid");
          if (
            recipient.gradingMode === "points" &&
            recipient.criteria.length &&
            (recipient.criteria.some(
              (criterion) =>
                input.criterionScores[criterion.id] === undefined ||
                input.criterionScores[criterion.id] >
                  ((recipient.maxScore ?? 0) * criterion.weight) / 100,
            ) ||
              Math.abs(
                Object.values(input.criterionScores).reduce(
                  (sum, score) => sum + score,
                  0,
                ) - (input.score ?? 0),
              ) > 0.001)
          )
            throw new LmsError("lmsScoreInvalid");
          if (
            Object.keys(input.criterionScores).some(
              (id) =>
                !recipient.criteria.some((criterion) => criterion.id === id),
            )
          )
            throw new LmsError("lmsScoreInvalid");
          const priorReview = await one<Record<string, unknown>>(
            sql,
            "SELECT * FROM lms_reviews WHERE submission_id=$1 ORDER BY id DESC LIMIT 1",
            [submissionId],
          );
          const review = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_reviews(submission_id,decision,comment,score,criterion_scores,reviewer_id,reason) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id",
            [
              submissionId,
              input.decision,
              input.comment,
              input.score ?? null,
              JSON.stringify(input.criterionScores),
              actor.userId,
              input.reason ?? null,
            ],
          );
          await sql.query(
            "UPDATE lms_assignment_recipients SET status=$2,version=version+1,due_at=CASE WHEN $3::boolean THEN $4::timestamptz ELSE due_at END WHERE id=$1",
            [
              row.recipientId,
              input.decision,
              input.dueAt !== undefined,
              input.dueAt ?? null,
            ],
          );
          await recordEvent(
            sql,
            row.studentId,
            row.runId,
            `assignment_${input.decision}`,
            review!.id,
            `review:${review!.id}`,
            { submissionId },
          );
          await recordStaffAudit(
            sql,
            actor,
            row.runId,
            "review",
            review!.id,
            priorReview ? "correct" : "review",
            priorReview,
            { ...input, id: review!.id, submissionId },
            input.reason,
          );
          if (input.decision === "accepted")
            await this.learning.awardAutomatic(
              sql,
              row.studentId,
              row.runId,
              "first_accepted",
              `first-accepted:${row.studentId}:${row.runId}`,
              "lmsAchievementFirstAccepted",
              "lmsAchievementAcceptedReason",
              actor.userId,
              actor.requestId,
            );
          else {
            const revoked = await rows<{ id: number }>(
              sql,
              "UPDATE lms_achievements SET revoked_at=now(),revoked_by=$3,revoke_reason=$4 WHERE student_id=$1 AND run_id=$2 AND rule IN('first_accepted','first_accepted_work') AND revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM lms_assignment_recipients other JOIN lms_assignments a ON a.id=other.assignment_id WHERE other.student_id=$1 AND a.run_id=$2 AND other.status='accepted') RETURNING id",
              [
                row.studentId,
                row.runId,
                actor.userId,
                input.reason ?? input.comment,
              ],
            );
            for (const achievement of revoked)
              await recordEvent(
                sql,
                row.studentId,
                row.runId,
                "achievement_revoked",
                achievement.id,
                `automatic-achievement-revoked:${achievement.id}:${review!.id}`,
                { reason: input.reason ?? input.comment },
              );
          }
          await this.reconcileSectionAchievements(
            sql,
            actor,
            row.runId,
            row.studentId,
            input.reason ?? input.comment,
            review!.id,
          );
          await this.learning.policy.afterReview?.(sql, actor, {
            studentId: row.studentId,
            runId: row.runId,
            submissionId,
            decision: input.decision,
            reason: input.reason ?? input.comment,
          });
          await this.learning.syncMakeupResult(
            sql,
            row.studentId,
            row.runId,
            `review:${review!.id}`,
          );
          await this.learning.reconcileCompletionAchievement(
            sql,
            actor,
            row.studentId,
            row.runId,
            input.reason ?? input.comment,
            `review:${review!.id}`,
          );
          return {
            id: review!.id,
            version: input.version + 1,
            status: input.decision,
          };
        },
      );
    });
  }
  async updateRecipient(
    actor: LmsStaffActor,
    id: number,
    input: {
      version: number;
      dueAt?: string | null;
      status?: string;
      reason: string;
    },
  ) {
    return transaction(this.pool, async (sql) => {
      const row = await one<{
        runId: number;
        studentId: number;
        version: number;
        status: string;
        dueAt: string | null;
        opensAt: string;
      }>(
        sql,
        "SELECT assignment.run_id,recipient.student_id,recipient.version,recipient.status,recipient.due_at,recipient.opens_at FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE recipient.id=$1 FOR UPDATE OF recipient",
        [id],
      );
      if (!row) throw new LmsError("lmsNotFound", 404);
      await this.learning.requireStaffAccess(
        sql,
        actor,
        row.runId,
        "assignments.manage",
      );
      requireVersion(row.version, input.version);
      if (input.status === "assigned" && row.status === "accepted")
        throw new LmsError("lmsReviewStateConflict", 409);
      if (input.dueAt && +new Date(input.dueAt) < +new Date(row.opensAt))
        throw new LmsError("lmsDatesInvalid");
      await sql.query(
        "UPDATE lms_assignment_recipients SET due_at=CASE WHEN $2 THEN $3::timestamptz ELSE due_at END,status=COALESCE($4,status),reason=$5,version=version+1 WHERE id=$1",
        [
          id,
          input.dueAt !== undefined,
          input.dueAt ?? null,
          input.status ?? null,
          input.reason,
        ],
      );
      await this.learning.reconcileCompletionAchievement(
        sql,
        actor,
        row.studentId,
        row.runId,
        input.reason,
        `recipient:${id}:${input.version + 1}`,
      );
      await recordStaffAudit(
        sql,
        actor,
        row.runId,
        "assignment_recipient",
        id,
        "update",
        row,
        {
          ...row,
          status: input.status ?? row.status,
          dueAt: input.dueAt === undefined ? row.dueAt : input.dueAt,
          version: input.version + 1,
        },
        input.reason,
      );
      return { version: input.version + 1 };
    });
  }
  async assignEnrollment(
    actor: LmsStaffActor,
    runId: number,
    input: {
      enrollmentId: number;
      assignmentVersionIds: number[];
      opensAt: string;
      dueAt: string | null;
      reason: string;
    },
  ) {
    return transaction(this.pool, async (sql) => {
      await this.learning.requireStaffAccess(
        sql,
        actor,
        runId,
        "assignments.manage",
      );
      const enrollments = await this.learning.recipientEnrollments(sql, runId, [
        input.enrollmentId,
      ]);
      const enrollment = enrollments[0];
      if (input.dueAt && +new Date(input.dueAt) < +new Date(input.opensAt))
        throw new LmsError("lmsDatesInvalid");
      let count = 0;
      for (const versionId of new Set(input.assignmentVersionIds)) {
        const assignment = await one<{ id: number }>(
          sql,
          "SELECT assignment.id FROM lms_assignments assignment JOIN lms_assignment_versions version ON version.assignment_id=assignment.id WHERE version.id=$1 AND assignment.run_id=$2 AND assignment.state='published'",
          [versionId, runId],
        );
        if (!assignment) throw new LmsError("lmsNotFound", 404);
        const recipient = await one<{ id: number }>(
          sql,
          "INSERT INTO lms_assignment_recipients(assignment_id,assignment_version_id,enrollment_id,student_id,opens_at,due_at,reason) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(assignment_id,enrollment_id) DO NOTHING RETURNING id",
          [
            assignment.id,
            versionId,
            enrollment.id,
            enrollment.studentId,
            input.opensAt,
            input.dueAt,
            input.reason,
          ],
        );
        if (recipient) {
          count++;
          await recordEvent(
            sql,
            enrollment.studentId,
            runId,
            "assignment_assigned",
            recipient.id,
            `assignment-assigned:${recipient.id}`,
            { opensAt: input.opensAt },
          );
        }
      }
      return { recipientCount: count };
    });
  }
  async reopen(
    actor: LmsStaffActor,
    recipientId: number,
    input: { version: number; dueAt: string | null; reason: string },
  ) {
    return transaction(this.pool, async (sql) => {
      const row = await one<{
        runId: number;
        version: number;
        status: string;
        studentId: number;
        opensAt: string;
      }>(
        sql,
        "SELECT assignment.run_id,recipient.version,recipient.status,recipient.student_id,recipient.opens_at FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE recipient.id=$1 FOR UPDATE OF recipient",
        [recipientId],
      );
      if (!row) throw new LmsError("lmsNotFound", 404);
      await this.learning.requireStaffAccess(
        sql,
        actor,
        row.runId,
        "reviews.manage",
      );
      requireVersion(row.version, input.version);
      if (row.status !== "accepted")
        throw new LmsError("lmsReviewStateConflict", 409);
      if (input.dueAt && +new Date(input.dueAt) < +new Date(row.opensAt))
        throw new LmsError("lmsDatesInvalid");
      await sql.query(
        "UPDATE lms_assignment_recipients SET status='revision_required',version=version+1,due_at=$2,reason=$3 WHERE id=$1",
        [recipientId, input.dueAt, input.reason],
      );
      await recordEvent(
        sql,
        row.studentId,
        row.runId,
        "assignment_revision_required",
        recipientId,
        `assignment-reopened:${recipientId}:${input.version}`,
        { reason: input.reason },
      );
      await recordStaffAudit(
        sql,
        actor,
        row.runId,
        "assignment_recipient",
        recipientId,
        "reopen",
        row,
        {
          ...row,
          status: "revision_required",
          dueAt: input.dueAt,
          version: input.version + 1,
        },
        input.reason,
      );
      await this.learning.reconcileCompletionAchievement(
        sql,
        actor,
        row.studentId,
        row.runId,
        input.reason,
        `reopen:${recipientId}:${input.version + 1}`,
      );
      return { version: input.version + 1, status: "revision_required" };
    });
  }
  async managementList(
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
    return listRows(
      this.pool,
      `SELECT assignment.id,assignment.run_id,assignment.unit_id,version.id AS assignment_version_id,version.title,version.body,version.required,MIN(recipient.opens_at) AS opens_at,MAX(recipient.due_at) AS due_at,COUNT(recipient.id)::int AS recipient_count,COUNT(*) FILTER(WHERE recipient.status='accepted')::int AS accepted_count,COUNT(*) FILTER(WHERE recipient.status='submitted')::int AS submitted_count,COUNT(*) FILTER(WHERE recipient.status='revision_required')::int AS revision_count FROM lms_assignments assignment JOIN LATERAL(SELECT * FROM lms_assignment_versions version WHERE version.assignment_id=assignment.id ORDER BY version DESC LIMIT 1) version ON true LEFT JOIN lms_assignment_recipients recipient ON recipient.assignment_id=assignment.id WHERE assignment.run_id=$1 GROUP BY assignment.id,version.id,version.title,version.body,version.required ORDER BY assignment.id DESC`,
      [runId],
      page,
    );
  }
  async addComment(
    actor: PortalActorContext,
    id: number,
    input: LmsCommentInput,
  ) {
    return transaction(this.pool, async (sql) => {
      const recipient = await this.recipient(sql, actor, id, true);
      if (
        input.audience === "staff" ||
        (actor.kind === "self" && input.audience === "representative_teacher")
      )
        throw new LmsError("portalAccessDenied", 403);
      return idempotentPortalCommand(
        sql,
        actor,
        recipient.runId,
        "assignment_comment",
        id,
        input,
        async () => {
          await this.learning.authorizeFiles(sql, actor, input.fileIds, {
            runId: recipient.runId,
            recipientId: id,
          });
          const audience =
            actor.kind === "representative"
              ? input.shareWithFamily === true
                ? "family_teacher"
                : "representative_teacher"
              : input.audience;
          const target =
            audience === "representative_teacher"
              ? actor.portalAccountId
              : null;
          const comment = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_comments(student_id,run_id,recipient_id,account_id,audience,audience_account_id,body,file_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id",
            [
              actor.studentId,
              recipient.runId,
              id,
              actor.portalAccountId,
              audience,
              target,
              input.body,
              JSON.stringify(input.fileIds),
            ],
          );
          await recordEvent(
            sql,
            actor.studentId,
            recipient.runId,
            "assignment_comment",
            comment!.id,
            `assignment-comment:${comment!.id}`,
            { recipientId: id, audience, accountId: target },
          );
          return { id: comment!.id };
        },
      );
    });
  }
  async staffComment(actor: LmsStaffActor, id: number, input: LmsCommentInput) {
    return transaction(this.pool, async (sql) => {
      const row = await one<{ runId: number; studentId: number }>(
        sql,
        "SELECT assignment.run_id,recipient.student_id FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE recipient.id=$1",
        [id],
      );
      if (!row) throw new LmsError("lmsNotFound", 404);
      await this.learning.requireStaffAccess(
        sql,
        actor,
        row.runId,
        "reviews.manage",
      );
      return idempotentStaffCommand(
        sql,
        actor,
        row.runId,
        `assignment_comment:${id}`,
        input,
        async () => {
          await this.learning.authorizeFiles(sql, actor, input.fileIds, {
            runId: row.runId,
            recipientId: id,
          });
          if (
            input.audience === "representative_teacher" &&
            (!input.audienceAccountId ||
              !(await one(
                sql,
                "SELECT id FROM portal_student_links WHERE student_id=$1 AND account_id=$2 AND kind='representative' AND status='active'",
                [row.studentId, input.audienceAccountId],
              )))
          )
            throw new LmsError("lmsNotFound", 404);
          const target =
            input.audience === "representative_teacher"
              ? input.audienceAccountId
              : null;
          const comment = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_comments(student_id,run_id,recipient_id,staff_user_id,audience,audience_account_id,body,file_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id",
            [
              row.studentId,
              row.runId,
              id,
              actor.userId,
              input.audience,
              target,
              input.body,
              JSON.stringify(input.fileIds),
            ],
          );
          await recordEvent(
            sql,
            row.studentId,
            row.runId,
            "assignment_feedback",
            comment!.id,
            `assignment-comment:${comment!.id}`,
            { recipientId: id, audience: input.audience, accountId: target },
          );
          return { id: comment!.id };
        },
      );
    });
  }
  async managementDetail(actor: LmsStaffActor, id: number) {
    const assignment = await one<{ runId: number }>(
      this.pool,
      "SELECT run_id FROM lms_assignments WHERE id=$1",
      [id],
    );
    if (!assignment) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireStaffAccess(
      this.pool,
      actor,
      assignment.runId,
      "assignments.manage",
    );
    const summary = (
      (await this.managementList(actor, assignment.runId)) as Array<{
        id: number;
      }>
    ).find((item) => item.id === id);
    const version = await one<Record<string, unknown>>(
      this.pool,
      "SELECT grading_mode,max_score,criteria,allowed_answers,file_ids FROM lms_assignment_versions WHERE assignment_id=$1 ORDER BY version DESC LIMIT 1",
      [id],
    );
    const recipients = await rows(
      this.pool,
      `SELECT recipient.id,recipient.student_id,COALESCE(student.student_name,student.contact_name) AS student_name,recipient.enrollment_id,recipient.status,recipient.due_at,recipient.opens_at,recipient.version,(SELECT submission.id FROM lms_submissions submission WHERE submission.recipient_id=recipient.id AND submission.withdrawn_at IS NULL ORDER BY attempt_number DESC LIMIT 1) AS latest_submission_id FROM lms_assignment_recipients recipient JOIN academy_students student ON student.id=recipient.student_id WHERE recipient.assignment_id=$1 ORDER BY student_name,recipient.id`,
      [id],
    );
    return { ...summary, ...version, recipients };
  }
  async dashboard(actor: PortalActorContext) {
    const items = await rows<LmsAssignmentDto>(
      this.pool,
      `${assignmentSelect} WHERE recipient.student_id=$1 AND recipient.opens_at<=now() AND ${recipientEnrollmentVisibilitySql()} AND recipient.status IN('assigned','revision_required') AND run.id=ANY($2::bigint[]) ORDER BY CASE WHEN recipient.status='revision_required' AND recipient.due_at<now() THEN 0 WHEN recipient.due_at<now() THEN 1 ELSE 2 END,recipient.due_at NULLS LAST,recipient.id LIMIT 6`,
      [actor.studentId, await this.learning.enabledRunIds(actor.studentId)],
    );
    return items.map((item) => this.summary(item));
  }
  async feedback(actor: PortalActorContext, limit = 30, cursor?: number) {
    const items = await rows(
      this.pool,
      `SELECT review.id,recipient.id AS recipient_id,submission.id AS submission_id,version.title AS assignment_title,course.name AS course_name,g.name AS group_name,review.decision,review.comment,review.score,version.max_score,staff.full_name AS reviewer_name,review.created_at FROM lms_reviews review JOIN lms_submissions submission ON submission.id=review.submission_id JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id JOIN lms_assignment_versions version ON version.id=submission.assignment_version_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_group_runs run ON run.id=assignment.run_id JOIN academy_groups g ON g.id=run.group_id JOIN academy_courses course ON course.id=g.course_id JOIN users staff ON staff.id=review.reviewer_id WHERE recipient.student_id=$1 AND ($3::bigint IS NULL OR review.id<$3) AND run.id=ANY($4::bigint[]) ORDER BY review.id DESC LIMIT $2`,
      [
        actor.studentId,
        limit + 1,
        cursor ?? null,
        await this.learning.enabledRunIds(actor.studentId),
      ],
    );
    const hasMore = items.length > limit;
    const page = items.slice(0, limit) as Array<{ id: number }>;
    return {
      items: page,
      nextCursor: hasMore ? page.at(-1)!.id : null,
      hasMore,
    };
  }
  async feedbackItem(actor: PortalActorContext, id: number) {
    const row = await one(
      this.pool,
      `SELECT review.id,recipient.id AS recipient_id,submission.id AS submission_id,version.title AS assignment_title,course.name AS course_name,g.name AS group_name,review.decision,review.comment,review.score,version.max_score,staff.full_name AS reviewer_name,review.created_at FROM lms_reviews review JOIN lms_submissions submission ON submission.id=review.submission_id JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id JOIN lms_assignment_versions version ON version.id=submission.assignment_version_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_group_runs run ON run.id=assignment.run_id JOIN academy_groups g ON g.id=run.group_id JOIN academy_courses course ON course.id=g.course_id JOIN users staff ON staff.id=review.reviewer_id WHERE recipient.student_id=$1 AND review.id=$2 AND run.id=ANY($3::bigint[])`,
      [actor.studentId, id, await this.learning.enabledRunIds(actor.studentId)],
    );
    if (!row) throw new LmsError("lmsNotFound", 404);
    return row;
  }
  async reconcileSectionAchievements(
    sql: LmsSql,
    actor: LmsStaffActor,
    runId: number,
    studentId: number,
    reason: string,
    reviewId: number,
  ) {
    const sections = await rows<{
      id: number;
      title: string;
      total: number;
      accepted: number;
    }>(
      sql,
      `SELECT section.id,section.title,COUNT(recipient.id)::int AS total,COUNT(recipient.id) FILTER(WHERE recipient.status='accepted')::int AS accepted FROM lms_sections section JOIN lms_units unit ON unit.section_id=section.id JOIN lms_assignments assignment ON assignment.unit_id=unit.id AND assignment.run_id=$1 JOIN lms_assignment_recipients recipient ON recipient.assignment_id=assignment.id AND recipient.student_id=$2 JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE version.required AND recipient.status NOT IN('excused','cancelled') GROUP BY section.id,section.title`,
      [runId, studentId],
    );
    for (const section of sections) {
      const rule = `section_completed:${section.id}`;
      if (section.total > 0 && section.total === section.accepted)
        await this.learning.awardAutomatic(
          sql,
          studentId,
          runId,
          rule,
          `section-completed:${studentId}:${runId}:${section.id}`,
          "lmsAchievementSectionCompleted",
          section.title,
          actor.userId,
          actor.requestId,
        );
      else {
        const revoked = await one<{ id: number }>(
          sql,
          "UPDATE lms_achievements SET revoked_at=now(),revoked_by=$4,revoke_reason=$5 WHERE student_id=$1 AND run_id=$2 AND rule=$3 AND revoked_at IS NULL RETURNING id",
          [studentId, runId, rule, actor.userId, reason],
        );
        if (revoked)
          await recordEvent(
            sql,
            studentId,
            runId,
            "achievement_revoked",
            revoked.id,
            `automatic-achievement-revoked:${revoked.id}:${reviewId}`,
            { reason },
          );
      }
    }
  }
}
