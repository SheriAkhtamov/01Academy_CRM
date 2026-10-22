import type { LmsListOptions } from "@shared/contracts/lms";
import { randomInt } from "node:crypto";
import type { Pool } from "pg";
import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import type {
  LmsQuizDto,
  LmsQuizInput,
  LmsQuizAttemptDto,
  LmsQuizAnswerInput,
} from "@shared/contracts/lms";
import {
  LmsError,
  quizQuestionsForPortal,
  scoreQuiz,
  shouldDiscloseQuiz,
  requireVersion,
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
  recipientEnrollmentVisibilitySql,
  type LmsSql,
} from "./postgres-base";
import { PgLearningRepository } from "./learning-repository";
type QuizRecipient = LmsQuizInput & {
  id: number;
  quizVersionId: number;
  studentId: number;
  extraAttempts: number;
  status: string;
};
type StoredAttempt = Omit<
  LmsQuizAttemptDto,
  "questions" | "disclosure" | "serverTime"
> & { questions: LmsQuizInput["questions"] };
const quizRecipientSelect = `SELECT recipient.id,recipient.id AS recipient_id,recipient.enrollment_id,quiz.run_id,quiz.unit_id,recipient.quiz_version_id,recipient.student_id,recipient.opens_at,recipient.closes_at,recipient.extra_attempts,recipient.status,version.title,version.instructions,version.required,version.questions,version.pass_percent,version.max_attempts,version.timer_seconds,version.disclosure,version.shuffle_questions,version.shuffle_options FROM lms_quiz_recipients recipient JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id`;
function shuffled<T>(input: T[]): T[] {
  const items = [...input];
  for (let i = items.length - 1; i > 0; i--) {
    const other = randomInt(i + 1);
    [items[i], items[other]] = [items[other], items[i]];
  }
  return items;
}
export class PgQuizRepository {
  constructor(
    readonly pool: Pool,
    readonly learning: PgLearningRepository,
    readonly clock: () => Date = () => new Date(),
  ) {}
  async list(
    actor: PortalActorContext,
    page?: LmsListOptions,
  ): Promise<LmsQuizDto[]> {
    return listRows<LmsQuizDto>(
      this.pool,
      `SELECT recipient.id,recipient.id AS recipient_id,recipient.enrollment_id,quiz.run_id,version.title,version.instructions,version.required,recipient.opens_at,recipient.closes_at,version.max_attempts+recipient.extra_attempts AS max_attempts,version.pass_percent,version.timer_seconds,CASE WHEN EXISTS(SELECT 1 FROM lms_quiz_attempts active WHERE active.recipient_id=recipient.id AND active.state='active') THEN 'active' ELSE recipient.status END AS status,(SELECT active.id FROM lms_quiz_attempts active WHERE active.recipient_id=recipient.id AND active.state='active') AS active_attempt_id,(SELECT finished.id FROM lms_quiz_attempts finished WHERE finished.recipient_id=recipient.id AND finished.state='finished' ORDER BY finished.attempt_number DESC LIMIT 1) AS latest_finished_attempt_id,(SELECT COUNT(*)::int FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id) AS attempts_used,(SELECT MAX(attempt.percent) FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.state='finished') AS best_percent,EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.passed) AS passed FROM lms_quiz_recipients recipient JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id WHERE recipient.student_id=$1 AND recipient.opens_at<=now() AND recipient.status<>'cancelled' AND ${recipientEnrollmentVisibilitySql()} ORDER BY recipient.id`,
      [actor.studentId],
      page,
      page ? await this.learning.enabledRunIds(actor.studentId) : undefined,
    ).then((items) => this.learning.enabledRecords(items));
  }
  async recipient(
    sql: LmsSql,
    actor: PortalActorContext,
    id: number,
    lock = false,
  ) {
    const row = await one<QuizRecipient>(
      sql,
      `${quizRecipientSelect} WHERE recipient.id=$1 AND recipient.student_id=$2 AND ${recipientEnrollmentVisibilitySql()} ${lock ? "FOR UPDATE OF recipient" : ""}`,
      [id, actor.studentId],
    );
    if (!row) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireRunEnabled(sql, row.runId);
    return row;
  }
  async attempt(
    sql: LmsSql,
    actor: PortalActorContext,
    id: number,
    lock = false,
  ) {
    const row = await one<StoredAttempt & { runId: number }>(
      sql,
      `SELECT attempt.*,quiz.run_id FROM lms_quiz_attempts attempt JOIN lms_quiz_recipients recipient ON recipient.id=attempt.recipient_id JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id WHERE attempt.id=$1 AND recipient.student_id=$2 ${lock ? "FOR UPDATE OF attempt" : ""}`,
      [id, actor.studentId],
    );
    if (!row) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireRunEnabled(sql, row.runId);
    return row;
  }
  async present(
    sql: LmsSql,
    actor: PortalActorContext,
    attempt: StoredAttempt,
  ): Promise<LmsQuizAttemptDto> {
    const recipient = await this.recipient(sql, actor, attempt.recipientId);
    const counts = await one<{ used: number }>(
      sql,
      "SELECT COUNT(*)::int AS used FROM lms_quiz_attempts WHERE recipient_id=$1",
      [attempt.recipientId],
    );
    const disclose = shouldDiscloseQuiz(
      recipient.disclosure,
      attempt.state === "finished",
      recipient.closesAt,
      counts!.used,
      recipient.maxAttempts + recipient.extraAttempts,
      this.clock(),
    );
    return {
      id: attempt.id,
      recipientId: attempt.recipientId,
      quizVersionId: attempt.quizVersionId,
      attemptNumber: attempt.attemptNumber,
      version: attempt.version,
      state: attempt.state,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      serverTime: this.clock().toISOString(),
      finishedAt: attempt.finishedAt,
      questions: quizQuestionsForPortal(attempt.questions),
      answers: attempt.answers,
      score: attempt.score,
      totalScore: attempt.totalScore,
      percent: attempt.percent,
      passed: attempt.passed,
      disclosure: disclose
        ? attempt.questions.map((question) => ({
            questionId: question.id,
            correctOptionIds: question.correctOptionIds,
            explanation: question.explanation,
          }))
        : null,
    };
  }
  async start(actor: PortalActorContext, recipientId: number) {
    return transaction(this.pool, async (sql) => {
      const recipient = await this.recipient(sql, actor, recipientId, true);
      const now = this.clock();
      const active = await one<StoredAttempt>(
        sql,
        "SELECT * FROM lms_quiz_attempts WHERE recipient_id=$1 AND state='active'",
        [recipientId],
      );
      if (active) {
        const current =
          active.deadlineAt && +new Date(active.deadlineAt) <= +now
            ? await this.finishStored(sql, actor, active, recipient)
            : active;
        return this.present(sql, actor, current);
      }
      if (
        recipient.status !== "assigned" ||
        +new Date(recipient.opensAt) > +now ||
        (recipient.closesAt && +new Date(recipient.closesAt) <= +now)
      )
        throw new LmsError("lmsQuizClosed", 409);
      const counts = await one<{ used: number }>(
        sql,
        "SELECT COUNT(*)::int AS used FROM lms_quiz_attempts WHERE recipient_id=$1",
        [recipientId],
      );
      if (counts!.used >= recipient.maxAttempts + recipient.extraAttempts)
        throw new LmsError("lmsQuizAttemptsExhausted", 409);
      let questions = recipient.questions.map((question) => ({
        ...question,
        options: recipient.shuffleOptions
          ? shuffled(question.options)
          : question.options,
      }));
      if (recipient.shuffleQuestions) questions = shuffled(questions);
      let deadlineAt = recipient.timerSeconds
        ? new Date(+now + recipient.timerSeconds * 1000).toISOString()
        : null;
      if (
        recipient.closesAt &&
        (!deadlineAt || +new Date(recipient.closesAt) < +new Date(deadlineAt))
      )
        deadlineAt = recipient.closesAt;
      const attempt = await one<StoredAttempt>(
        sql,
        "INSERT INTO lms_quiz_attempts(recipient_id,quiz_version_id,account_id,attempt_number,questions,deadline_at) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING *",
        [
          recipientId,
          recipient.quizVersionId,
          actor.portalAccountId,
          counts!.used + 1,
          JSON.stringify(questions),
          deadlineAt,
        ],
      );
      return this.present(sql, actor, attempt!);
    });
  }
  async get(actor: PortalActorContext, id: number) {
    return transaction(this.pool, async (sql) => {
      let attempt: StoredAttempt = await this.attempt(sql, actor, id, true);
      if (
        attempt.state === "active" &&
        attempt.deadlineAt &&
        +new Date(attempt.deadlineAt) <= +this.clock()
      )
        attempt = await this.finishStored(
          sql,
          actor,
          attempt,
          await this.recipient(sql, actor, attempt.recipientId),
        );
      return this.present(sql, actor, attempt);
    });
  }
  async answer(
    actor: PortalActorContext,
    id: number,
    questionId: string,
    input: LmsQuizAnswerInput,
  ) {
    return transaction(this.pool, async (sql) => {
      const attempt = await this.attempt(sql, actor, id, true);
      requireVersion(attempt.version, input.version);
      if (
        attempt.state !== "active" ||
        (attempt.deadlineAt && +new Date(attempt.deadlineAt) <= +this.clock())
      )
        throw new LmsError("lmsQuizClosed", 409);
      const question = attempt.questions.find((row) => row.id === questionId);
      if (
        !question ||
        new Set(input.optionIds).size !== input.optionIds.length ||
        input.optionIds.some(
          (optionId) =>
            !question.options.some((option) => option.id === optionId),
        ) ||
        (question.type !== "multiple" && input.optionIds.length > 1)
      )
        throw new LmsError("lmsQuizOptionsInvalid");
      const answers = { ...attempt.answers, [questionId]: input.optionIds };
      const next = await one<StoredAttempt>(
        sql,
        "UPDATE lms_quiz_attempts SET answers=$2::jsonb,version=version+1 WHERE id=$1 RETURNING *",
        [id, JSON.stringify(answers)],
      );
      return this.present(sql, actor, next!);
    });
  }
  async finish(actor: PortalActorContext, id: number, version: number) {
    return transaction(this.pool, async (sql) => {
      const attempt = await this.attempt(sql, actor, id, true);
      if (attempt.state === "finished")
        return this.present(sql, actor, attempt);
      requireVersion(attempt.version, version);
      const recipient = await this.recipient(sql, actor, attempt.recipientId);
      return this.present(
        sql,
        actor,
        await this.finishStored(sql, actor, attempt, recipient),
      );
    });
  }
  async finishStored(
    sql: LmsSql,
    actor: PortalActorContext,
    attempt: StoredAttempt,
    recipient: QuizRecipient,
  ) {
    const score = scoreQuiz(
      attempt.questions,
      attempt.answers,
      recipient.passPercent,
    );
    const finished = await one<StoredAttempt>(
      sql,
      "UPDATE lms_quiz_attempts SET state='finished',finished_at=now(),score=$2,total_score=$3,percent=$4,passed=$5,version=version+1 WHERE id=$1 RETURNING *",
      [attempt.id, score.score, score.totalScore, score.percent, score.passed],
    );
    await recordEvent(
      sql,
      actor.studentId,
      recipient.runId,
      "quiz_finished",
      attempt.id,
      `quiz-finished:${attempt.id}`,
      { percent: score.percent, passed: score.passed },
    );
    await this.learning.syncMakeupResult(
      sql,
      actor.studentId,
      recipient.runId,
      `quiz:${attempt.id}`,
    );
    return finished!;
  }
  async finishExpired() {
    const due = await rows<{
      id: number;
      studentId: number;
      accountId: number;
    }>(
      this.pool,
      "SELECT attempt.id,recipient.student_id,attempt.account_id FROM lms_quiz_attempts attempt JOIN lms_quiz_recipients recipient ON recipient.id=attempt.recipient_id JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id WHERE attempt.state='active' AND attempt.deadline_at<=$1::timestamptz AND quiz.run_id=ANY($2::bigint[]) ORDER BY attempt.deadline_at LIMIT 100",
      [this.clock().toISOString(), await this.learning.enabledRunIds()],
    );
    for (const row of due)
      await this.get(
        {
          studentId: row.studentId,
          portalAccountId: row.accountId,
        } as PortalActorContext,
        row.id,
      );
    return { finished: due.length };
  }
  async create(actor: LmsStaffActor, input: LmsQuizInput) {
    return transaction(this.pool, async (sql) => {
      await this.learning.requireStaffAccess(
        sql,
        actor,
        input.runId,
        "quizzes.manage",
      );
      return idempotentStaffCommand(
        sql,
        actor,
        input.runId,
        "quiz_create",
        input,
        async () => {
          await this.learning.assertUnit(sql, input.runId, input.unitId);
          const enrollments = await this.learning.recipientEnrollments(
            sql,
            input.runId,
            input.recipientEnrollmentIds,
          );
          const quiz = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_quizzes(run_id,unit_id,created_by) VALUES($1,$2,$3) RETURNING id",
            [input.runId, input.unitId ?? null, actor.userId],
          );
          const version = await one<{ id: number }>(
            sql,
            "INSERT INTO lms_quiz_versions(quiz_id,version,title,instructions,required,questions,pass_percent,max_attempts,timer_seconds,disclosure,shuffle_questions,shuffle_options) VALUES($1,1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11) RETURNING id",
            [
              quiz!.id,
              input.title,
              input.instructions,
              input.required,
              JSON.stringify(input.questions),
              input.passPercent,
              input.maxAttempts,
              input.timerSeconds,
              input.disclosure,
              input.shuffleQuestions,
              input.shuffleOptions,
            ],
          );
          for (const enrollment of enrollments)
            await sql.query(
              "INSERT INTO lms_quiz_recipients(quiz_id,quiz_version_id,enrollment_id,student_id,opens_at,closes_at) VALUES($1,$2,$3,$4,$5,$6)",
              [
                quiz!.id,
                version!.id,
                enrollment.id,
                enrollment.studentId,
                input.opensAt,
                input.closesAt,
              ],
            );
          await recordStaffAudit(
            sql,
            actor,
            input.runId,
            "quiz",
            quiz!.id,
            "publish",
            null,
            {
              quizVersionId: version!.id,
              recipientEnrollmentIds: enrollments.map(
                (enrollment) => enrollment.id,
              ),
              opensAt: input.opensAt,
              closesAt: input.closesAt,
              disclosure: input.disclosure,
            },
          );
          return {
            id: quiz!.id,
            quizVersionId: version!.id,
            recipientCount: enrollments.length,
          };
        },
      );
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
      "quizzes.manage",
    );
    return listRows(
      this.pool,
      "SELECT quiz.id,quiz.run_id,quiz.unit_id,quiz.state,version.title,version.required,version.pass_percent,version.max_attempts,version.timer_seconds,version.disclosure,(SELECT COUNT(*)::int FROM lms_quiz_recipients recipient WHERE recipient.quiz_id=quiz.id) AS recipient_count FROM lms_quizzes quiz JOIN LATERAL(SELECT * FROM lms_quiz_versions version WHERE version.quiz_id=quiz.id ORDER BY version DESC LIMIT 1) version ON true WHERE quiz.run_id=$1 ORDER BY quiz.id DESC",
      [runId],
      page,
    );
  }
  async extraAttempt(
    actor: LmsStaffActor,
    recipientId: number,
    reason: string,
    idempotencyKey: string,
  ) {
    return transaction(this.pool, async (sql) => {
      const row = await one<{
        runId: number;
        studentId: number;
        extraAttempts: number;
      }>(
        sql,
        `${quizRecipientSelect} WHERE recipient.id=$1 FOR UPDATE OF recipient`,
        [recipientId],
      );
      if (!row) throw new LmsError("lmsNotFound", 404);
      await this.learning.requireStaffAccess(
        sql,
        actor,
        row.runId,
        "quizzes.manage",
      );
      const eventKey = `quiz-extra:${actor.userId}:${recipientId}:${idempotencyKey}`;
      const prior = await one<{ data: { reason: string } }>(
        sql,
        "SELECT data FROM lms_learning_events WHERE event_key=$1",
        [eventKey],
      );
      if (prior) {
        if (prior.data.reason !== reason)
          throw new LmsError("lmsVersionConflict", 409);
        return { granted: true };
      }
      await sql.query(
        "UPDATE lms_quiz_recipients SET extra_attempts=extra_attempts+1 WHERE id=$1",
        [recipientId],
      );
      await recordEvent(
        sql,
        row.studentId,
        row.runId,
        "quiz_extra_attempt",
        recipientId,
        eventKey,
        { reason, staffUserId: actor.userId },
      );
      await recordStaffAudit(
        sql,
        actor,
        row.runId,
        "quiz_recipient",
        recipientId,
        "extra_attempt",
        { extraAttempts: row.extraAttempts },
        { extraAttempts: row.extraAttempts + 1 },
        reason,
      );
      return { granted: true };
    });
  }
  async results(actor: PortalActorContext, recipientId: number) {
    await this.recipient(this.pool, actor, recipientId);
    const attempt = await one<StoredAttempt>(
      this.pool,
      "SELECT * FROM lms_quiz_attempts WHERE recipient_id=$1 AND state='finished' ORDER BY attempt_number DESC LIMIT 1",
      [recipientId],
    );
    if (!attempt) throw new LmsError("lmsNotFound", 404);
    const result = await this.present(this.pool, actor, attempt);
    const quiz = await one<{ runId: number; unitId: number | null; enrollmentId: number }>(
      this.pool,
      "SELECT quiz.run_id,quiz.unit_id,recipient.enrollment_id FROM lms_quizzes quiz JOIN lms_quiz_recipients recipient ON recipient.quiz_id=quiz.id WHERE recipient.id=$1",
      [recipientId],
    );
    result.relatedMaterials =
      actor.permissions.includes("learning.read") && quiz?.unitId
        ? (await this.learning.materials(actor, quiz.runId))
            .filter((material) => material.unitId === quiz.unitId && material.enrollmentId === quiz.enrollmentId)
            .map(({ runId, publicationId, title, enrollmentId }) => ({
              enrollmentId,
              runId,
              publicationId,
              title,
            }))
        : [];
    return actor.kind === "representative" && !result.disclosure
      ? { ...result, questions: [], answers: {} }
      : result;
  }
  async managementDetail(actor: LmsStaffActor, id: number) {
    const quiz = await one<{ runId: number }>(
      this.pool,
      "SELECT run_id FROM lms_quizzes WHERE id=$1",
      [id],
    );
    if (!quiz) throw new LmsError("lmsNotFound", 404);
    await this.learning.requireStaffAccess(
      this.pool,
      actor,
      quiz.runId,
      "quizzes.manage",
    );
    const definition = await one<Record<string, unknown>>(
      this.pool,
      "SELECT quiz.id,quiz.run_id,quiz.unit_id,quiz.state,version.id AS quiz_version_id,version.title,version.instructions,version.required,version.questions,version.pass_percent,version.max_attempts,version.timer_seconds,version.disclosure,version.shuffle_questions,version.shuffle_options FROM lms_quizzes quiz JOIN LATERAL(SELECT * FROM lms_quiz_versions version WHERE version.quiz_id=quiz.id ORDER BY version DESC LIMIT 1) version ON true WHERE quiz.id=$1",
      [id],
    );
    const recipients = await rows(
      this.pool,
      `SELECT recipient.id,recipient.student_id,recipient.enrollment_id,COALESCE(student.student_name,student.contact_name) AS student_name,recipient.status,recipient.opens_at,recipient.closes_at,(SELECT COUNT(*)::int FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id) AS attempts_used,version.max_attempts+recipient.extra_attempts AS max_attempts,(SELECT MAX(attempt.percent) FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.state='finished') AS best_percent,EXISTS(SELECT 1 FROM lms_quiz_attempts attempt WHERE attempt.recipient_id=recipient.id AND attempt.passed) AS passed FROM lms_quiz_recipients recipient JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id JOIN academy_students student ON student.id=recipient.student_id WHERE recipient.quiz_id=$1 ORDER BY student_name`,
      [id],
    );
    return { ...definition, recipients, recipientCount: recipients.length };
  }
}
