import type { PoolClient } from "pg";
import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import {
  DAY,
  HOUR,
  MINUTE,
  TASHKENT,
  code,
  localDate,
  dateValue,
  number,
  accessDenied,
  type Sql,
  type Params,
  type Candidate,
  type PortalNotificationWorkerOptions,
} from "./notification-support";
const notificationLearningEventTypes = [
  "material_published", "assignment_assigned", "assignment_submitted",
  "assignment_accepted", "assignment_revision_required", "thread_answered",
  "assignment_feedback", "report_published", "achievement_awarded",
  "achievement_revoked", "quiz_finished", "course_completed", "course_reopened",
] as const;

export class PortalNotificationSources {
  constructor(private readonly options: PortalNotificationWorkerOptions) {}
  private async allowedGroup(groupId: number | null) {
    const ids =
      typeof this.options.groupIds === "function"
        ? this.options.groupIds()
        : (this.options.groupIds ?? []);
    return (
      (groupId === null || !ids.length || ids.includes(groupId)) &&
      (groupId === null ||
        !this.options.enabledForGroup ||
        (await this.options.enabledForGroup(groupId)))
    );
  }
  async collect(sql: Sql, cutoff: number, now: number): Promise<Candidate[]> {
    return [
      ...(await this.learningCandidates(sql, cutoff, now)),
      ...(await this.publicationCandidates(sql, cutoff, now)),
      ...(await this.scheduleCandidates(sql, cutoff, now)),
      ...(await this.absenceCandidates(sql, cutoff, now)),
      ...(await this.reminderCandidates(sql, cutoff, now)),
      ...(await this.securityCandidates(sql, cutoff, now)),
      ...(await this.weeklyCandidates(sql, now)),
    ];
  }
  private async learningCandidates(
    sql: Sql,
    cutoff: number,
    now: number,
  ): Promise<Candidate[]> {
    const events = (
      await sql.query<{
        id: string;
        student_id: number;
        run_id: string;
        type: string;
        object_id: string;
        event_key: string;
        data: Record<string, unknown>;
        occurred_at: Date;
        group_id: number;
      }>(
        `SELECT event.*,run.group_id FROM lms_learning_events event JOIN lms_group_runs run ON run.id=event.run_id WHERE event.occurred_at>=$1 AND event.occurred_at<=$2
          AND event.type=ANY($3::text[]) AND event.data->'imported' IS DISTINCT FROM 'true'::jsonb
          AND NOT EXISTS(SELECT 1 FROM lms_notification_sources source WHERE source.source_key='learning:'||event.id::text) ORDER BY event.id LIMIT 1000`,
        [new Date(cutoff), new Date(now), [...notificationLearningEventTypes]],
      )
    ).rows;
    const candidates: Candidate[] = [];
    for (const event of events) {
      const base = {
        sourceKey: `learning:${event.id}`,
        eventKey: event.event_key,
        studentId: event.student_id,
        runId: number(event.run_id),
        groupId: event.group_id,
        params: {
          sourceType: event.type,
          objectId: number(event.object_id),
          runId: number(event.run_id),
        } as Params,
        deliverAt: now,
        urgent: false,
      };
      if (event.data.imported === true) {
        await sql.query(
          "INSERT INTO lms_notification_sources(source_key) VALUES($1) ON CONFLICT DO NOTHING",
          [base.sourceKey],
        );
        continue;
      }
      let candidate: Candidate | null = null;
      if (event.type === "material_published") {
        const row = (
          await sql.query<{
            title: string;
            publish_at: Date;
            revoked_at: Date | null;
            state: string;
          }>(
            `SELECT version.title,publication.publish_at,publication.revoked_at,material.state FROM lms_material_publications publication JOIN lms_material_versions version ON version.id=publication.material_version_id JOIN lms_materials material ON material.id=publication.material_id WHERE publication.id=$1`,
            [event.object_id],
          )
        ).rows[0];
        if (row && !row.revoked_at && row.state === "published")
          candidate = {
            ...base,
            category: "learning",
            code: code("material_published"),
            permission: "learning.read",
            href: `/learn/courses/${event.run_id}/materials/${event.object_id}`,
            deliverAt: dateValue(row.publish_at),
            params: {
              ...base.params,
              publicationId: number(event.object_id),
              title: row.title,
            },
          };
      } else if (event.type === "assignment_assigned") {
        const row = (
          await sql.query<{ title: string; opens_at: Date; status: string }>(
            `SELECT version.title,recipient.opens_at,recipient.status FROM lms_assignment_recipients recipient JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE recipient.id=$1`,
            [event.object_id],
          )
        ).rows[0];
        if (row && !["cancelled", "excused"].includes(row.status))
          candidate = {
            ...base,
            category: "learning",
            code: code("assignment_assigned"),
            permission: "learning.read",
            href: `/learn/assignments/${event.object_id}`,
            deliverAt: dateValue(row.opens_at),
            params: {
              ...base.params,
              recipientId: number(event.object_id),
              title: row.title,
            },
          };
      } else if (
        [
          "assignment_submitted",
          "assignment_accepted",
          "assignment_revision_required",
        ].includes(event.type)
      ) {
        const submissionId =
          event.type === "assignment_submitted"
            ? number(event.object_id)
            : event.data.submissionId
              ? number(event.data.submissionId)
              : null;
        const row = submissionId
          ? (
              await sql.query<{ id: string; title: string }>(
                `SELECT recipient.id,version.title FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE submission.id=$1`,
                [submissionId],
              )
            ).rows[0]
          : (
              await sql.query<{ id: string; title: string }>(
                `SELECT recipient.id,version.title FROM lms_assignment_recipients recipient JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE recipient.id=$1`,
                [event.object_id],
              )
            ).rows[0];
        if (row)
          candidate = {
            ...base,
            category: "feedback",
            code: code(
              event.type as
                | "assignment_submitted"
                | "assignment_accepted"
                | "assignment_revision_required",
            ),
            permission:
              event.type === "assignment_submitted"
                ? "learning.read"
                : "feedback.read",
            audience:
              event.type === "assignment_submitted"
                ? "representative"
                : undefined,
            href: `/learn/assignments/${row.id}`,
            params: {
              ...base.params,
              recipientId: number(row.id),
              title: row.title,
              ...(event.data.submissionId
                ? { reviewId: number(event.object_id) }
                : {}),
            },
          };
      } else if (event.type === "thread_answered") {
        const comment = (
          await sql.query<{
            id: string;
            thread_id: string;
            audience: string;
            title: string;
            author_account_id: number;
            thread_audience: string;
          }>(
            `SELECT comment.id,comment.thread_id,comment.audience,thread.title,thread.author_account_id,thread.audience AS thread_audience FROM lms_comments comment JOIN lms_threads thread ON thread.id=comment.thread_id WHERE comment.id=$1`,
            [event.object_id],
          )
        ).rows[0];
        if (comment && comment.audience !== "staff")
          candidate = {
            ...base,
            category: "feedback",
            code: code("thread_answered"),
            permission: "communication.create",
            accountId: number(comment.author_account_id),
            audience:
              comment.thread_audience === "representative_teacher"
                ? "representative"
                : "self",
            href: `/learn/help?thread=${number(comment.thread_id)}`,
            params: {
              ...base.params,
              threadId: number(comment.thread_id),
              commentId: number(comment.id),
              title: comment.title,
            },
          };
      } else if (event.type === "assignment_feedback") {
        const comment = (
          await sql.query<{
            id: string;
            recipient_id: string;
            audience: string;
            audience_account_id: number | null;
            title: string;
          }>(
            `SELECT comment.id,comment.recipient_id,comment.audience,comment.audience_account_id,version.title FROM lms_comments comment JOIN lms_assignment_recipients recipient ON recipient.id=comment.recipient_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE comment.id=$1`,
            [event.object_id],
          )
        ).rows[0];
        if (comment && comment.audience !== "staff")
          candidate = {
            ...base,
            category: "feedback",
            code: code("assignment_feedback"),
            permission: "feedback.read",
            accountId:
              comment.audience === "representative_teacher"
                ? number(comment.audience_account_id)
                : undefined,
            audience:
              comment.audience === "student_teacher"
                ? "self"
                : comment.audience === "representative_teacher"
                  ? "representative"
                  : undefined,
            href: `/learn/assignments/${comment.recipient_id}`,
            params: {
              ...base.params,
              recipientId: number(comment.recipient_id),
              commentId: number(comment.id),
              title: comment.title,
            },
          };
      } else if (
        [
          "report_published",
          "achievement_awarded",
          "achievement_revoked",
          "quiz_finished",
          "course_completed",
          "course_reopened",
        ].includes(event.type)
      ) {
        candidate = {
          ...base,
          category: "feedback",
          code: code(
            event.type as
              | "report_published"
              | "achievement_awarded"
              | "achievement_revoked"
              | "quiz_finished"
              | "course_completed"
              | "course_reopened",
          ),
          permission: "feedback.read",
          href:
            event.type === "quiz_finished"
              ? "/learn/quizzes"
              : "/learn/progress",
          params: base.params,
        };
      }
      if (candidate) candidates.push(candidate);
      else
        await sql.query(
          "INSERT INTO lms_notification_sources(source_key) VALUES($1) ON CONFLICT DO NOTHING",
          [base.sourceKey],
        );
    }
    return candidates;
  }
  private async publicationCandidates(
    sql: Sql,
    cutoff: number,
    now: number,
  ): Promise<Candidate[]> {
    const materials = (
      await sql.query<{
        id: string;
        student_id: number;
        run_id: string;
        group_id: number;
        publish_at: Date;
        title: string;
      }>(
        `SELECT publication.id,enrollment.student_id,material.run_id,run.group_id,publication.publish_at,version.title FROM lms_material_publications publication JOIN lms_material_versions version ON version.id=publication.material_version_id JOIN lms_materials material ON material.id=publication.material_id JOIN lms_group_runs run ON run.id=material.run_id JOIN academy_student_group_enrollments enrollment ON enrollment.id=publication.enrollment_id WHERE publication.publish_at>=$1 AND publication.revoked_at IS NULL AND material.state='published' AND publication.publish_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR publication.publish_at<enrollment.ended_at) AND NOT EXISTS(SELECT 1 FROM lms_notification_sources source WHERE source.source_key='publication:'||publication.id::text) ORDER BY publication.id LIMIT 500`,
        [new Date(cutoff)],
      )
    ).rows;
    const assignments = (
      await sql.query<{
        id: string;
        student_id: number;
        run_id: string;
        group_id: number;
        opens_at: Date;
        title: string;
      }>(
        `SELECT recipient.id,recipient.student_id,assignment.run_id,run.group_id,recipient.opens_at,version.title FROM lms_assignment_recipients recipient JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_group_runs run ON run.id=assignment.run_id JOIN academy_student_group_enrollments enrollment ON enrollment.id=recipient.enrollment_id WHERE recipient.opens_at>=$1 AND recipient.status NOT IN ('cancelled','excused') AND assignment.state='published' AND recipient.opens_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR recipient.opens_at<enrollment.ended_at) AND NOT EXISTS(SELECT 1 FROM lms_notification_sources source WHERE source.source_key='assignment-publication:'||recipient.id::text) ORDER BY recipient.id LIMIT 500`,
        [new Date(cutoff)],
      )
    ).rows;
    const quizzes = (
      await sql.query<{
        id: string;
        student_id: number;
        run_id: string;
        group_id: number;
        opens_at: Date;
        title: string;
      }>(
        `SELECT recipient.id,recipient.student_id,quiz.run_id,run.group_id,recipient.opens_at,version.title FROM lms_quiz_recipients recipient JOIN lms_quiz_versions version ON version.id=recipient.quiz_version_id JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id JOIN lms_group_runs run ON run.id=quiz.run_id JOIN academy_student_group_enrollments enrollment ON enrollment.id=recipient.enrollment_id WHERE recipient.opens_at>=$1 AND recipient.status='assigned' AND quiz.state='published' AND recipient.opens_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR recipient.opens_at<enrollment.ended_at) AND NOT EXISTS(SELECT 1 FROM lms_notification_sources source WHERE source.source_key='quiz-publication:'||recipient.id::text) ORDER BY recipient.id LIMIT 500`,
        [new Date(cutoff)],
      )
    ).rows;
    const announcements = (
      await sql.query<{
        id: string;
        student_id: number;
        run_id: string;
        group_id: number;
        publish_at: Date;
        title: string;
        audience: string;
      }>(
        `SELECT announcement.id,enrollment.student_id,announcement.run_id,run.group_id,announcement.publish_at,announcement.title,announcement.audience FROM lms_announcements announcement JOIN lms_group_runs run ON run.id=announcement.run_id JOIN academy_student_group_enrollments enrollment ON enrollment.group_id=run.group_id WHERE announcement.publish_at>=$1 AND announcement.revoked_at IS NULL AND announcement.publish_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR announcement.publish_at<enrollment.ended_at) AND NOT EXISTS(SELECT 1 FROM lms_notification_sources source WHERE source.source_key='announcement:'||announcement.id::text||':student:'||enrollment.student_id::text) ORDER BY announcement.id,enrollment.student_id LIMIT 500`,
        [new Date(cutoff)],
      )
    ).rows;
    return [
      ...materials.map(
        (row): Candidate => ({
          sourceKey: `publication:${row.id}`,
          eventKey: `material-published:${row.id}`,
          studentId: row.student_id,
          runId: number(row.run_id),
          groupId: row.group_id,
          category: "learning",
          code: code("material_published"),
          permission: "learning.read",
          href: `/learn/courses/${row.run_id}/materials/${row.id}`,
          params: {
            sourceType: "material_published",
            publicationId: number(row.id),
            runId: number(row.run_id),
            title: row.title,
          },
          deliverAt: dateValue(row.publish_at),
        }),
      ),
      ...assignments.map(
        (row): Candidate => ({
          sourceKey: `assignment-publication:${row.id}`,
          eventKey: `assignment-assigned:${row.id}`,
          studentId: row.student_id,
          runId: number(row.run_id),
          groupId: row.group_id,
          category: "learning",
          code: code("assignment_assigned"),
          permission: "learning.read",
          href: `/learn/assignments/${row.id}`,
          params: {
            sourceType: "assignment_assigned",
            recipientId: number(row.id),
            runId: number(row.run_id),
            title: row.title,
          },
          deliverAt: dateValue(row.opens_at),
        }),
      ),
      ...quizzes.map(
        (row): Candidate => ({
          sourceKey: `quiz-publication:${row.id}`,
          eventKey: `quiz-assigned:${row.id}`,
          studentId: row.student_id,
          runId: number(row.run_id),
          groupId: row.group_id,
          category: "learning",
          code: code("quiz_assigned"),
          permission: "learning.read",
          href: "/learn/quizzes",
          params: {
            sourceType: "quiz_assigned",
            quizRecipientId: number(row.id),
            runId: number(row.run_id),
            title: row.title,
          },
          deliverAt: dateValue(row.opens_at),
        }),
      ),
      ...announcements.map(
        (row): Candidate => ({
          sourceKey: `announcement:${row.id}:student:${row.student_id}`,
          eventKey: `announcement:${row.id}`,
          studentId: row.student_id,
          runId: number(row.run_id),
          groupId: row.group_id,
          category: "learning",
          code: code("announcement_published"),
          permission: "learning.read",
          audience:
            row.audience === "students"
              ? "self"
              : row.audience === "representatives"
                ? "representative"
                : undefined,
          href: `/learn/courses/${row.run_id}`,
          params: {
            sourceType: "announcement_published",
            announcementId: number(row.id),
            runId: number(row.run_id),
            title: row.title,
          },
          deliverAt: dateValue(row.publish_at),
        }),
      ),
    ].map((candidate) => ({
      ...candidate,
      deliverAt: Math.max(candidate.deliverAt, now),
    }));
  }
  private async scheduleCandidates(
    sql: Sql,
    cutoff: number,
    now: number,
  ): Promise<Candidate[]> {
    const reschedules = (
      await sql.query<{
        id: number;
        lesson_id: number;
        student_id: number;
        run_id: string;
        group_id: number;
        topic: string;
        scheduled_at: Date;
        next_scheduled_at: Date;
      }>(
        `SELECT reschedule.id,reschedule.lesson_id,enrollment.student_id,run.id AS run_id,run.group_id,lesson.topic,lesson.scheduled_at,reschedule.next_scheduled_at FROM academy_lesson_reschedules reschedule JOIN academy_lessons lesson ON lesson.id=reschedule.lesson_id JOIN lms_group_runs run ON run.group_id=lesson.group_id JOIN academy_student_group_enrollments enrollment ON enrollment.group_id=lesson.group_id WHERE reschedule.created_at>=$1 AND lesson.scheduled_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR lesson.scheduled_at<enrollment.ended_at) AND NOT EXISTS(SELECT 1 FROM lms_notification_sources source WHERE source.source_key='reschedule:'||reschedule.id::text||':student:'||enrollment.student_id::text) ORDER BY reschedule.id,enrollment.student_id LIMIT 500`,
        [new Date(cutoff)],
      )
    ).rows;
    const cancellations = (
      await sql.query<{
        id: number;
        lesson_id: number;
        student_id: number;
        run_id: string;
        group_id: number;
        topic: string;
        scheduled_at: Date;
      }>(
        `SELECT history.id,history.lesson_id,enrollment.student_id,run.id AS run_id,run.group_id,lesson.topic,lesson.scheduled_at FROM academy_lesson_status_history history JOIN academy_lessons lesson ON lesson.id=history.lesson_id JOIN lms_group_runs run ON run.group_id=lesson.group_id JOIN academy_student_group_enrollments enrollment ON enrollment.group_id=lesson.group_id WHERE history.to_status='cancelled' AND history.created_at>=$1 AND lesson.scheduled_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR lesson.scheduled_at<enrollment.ended_at) AND NOT EXISTS(SELECT 1 FROM lms_notification_sources source WHERE source.source_key='lesson-cancelled:'||history.id::text||':student:'||enrollment.student_id::text) ORDER BY history.id,enrollment.student_id LIMIT 500`,
        [new Date(cutoff)],
      )
    ).rows;
    return [
      ...reschedules.map(
        (row): Candidate => ({
          sourceKey: `reschedule:${row.id}:student:${row.student_id}`,
          eventKey: `lesson-rescheduled:${row.id}`,
          studentId: row.student_id,
          runId: number(row.run_id),
          groupId: row.group_id,
          category: "schedule",
          code: code("lesson_rescheduled"),
          permission: "attendance.read",
          alternativePermission: "learning.read",
          href: "/learn/schedule",
          params: {
            sourceType: "lesson_rescheduled",
            lessonId: row.lesson_id,
            rescheduleId: row.id,
            runId: number(row.run_id),
            scheduledAt: new Date(row.next_scheduled_at).toISOString(),
            title: row.topic,
          },
          deliverAt: now,
          urgent: dateValue(row.scheduled_at) <= now + DAY,
        }),
      ),
      ...cancellations.map(
        (row): Candidate => ({
          sourceKey: `lesson-cancelled:${row.id}:student:${row.student_id}`,
          eventKey: `lesson-cancelled:${row.id}`,
          studentId: row.student_id,
          runId: number(row.run_id),
          groupId: row.group_id,
          category: "schedule",
          code: code("lesson_cancelled"),
          permission: "attendance.read",
          alternativePermission: "learning.read",
          href: "/learn/schedule",
          params: {
            sourceType: "lesson_cancelled",
            lessonId: row.lesson_id,
            runId: number(row.run_id),
            title: row.topic,
          },
          deliverAt: now,
          urgent: dateValue(row.scheduled_at) <= now + DAY,
        }),
      ),
    ];
  }
  private async absenceCandidates(
    sql: Sql,
    cutoff: number,
    now: number,
  ): Promise<Candidate[]> {
    const values = (
      await sql.query<{
        id: number;
        lesson_id: number;
        student_id: number;
        run_id: string;
        group_id: number;
        topic: string;
        updated_at: Date;
      }>(
        `SELECT mark.id,mark.lesson_id,mark.student_id,run.id AS run_id,run.group_id,lesson.topic,mark.updated_at FROM academy_attendance mark JOIN academy_lessons lesson ON lesson.id=mark.lesson_id JOIN lms_group_runs run ON run.group_id=lesson.group_id WHERE mark.status='absent' AND lesson.status='conducted' AND mark.updated_at>=$1 AND NOT EXISTS(SELECT 1 FROM lms_notification_sources source WHERE source.source_key='absence:'||mark.id::text||':'||floor(extract(epoch FROM mark.updated_at)*1000)::bigint::text) ORDER BY mark.id LIMIT 500`,
        [new Date(cutoff)],
      )
    ).rows;
    return values.map((row) => ({
      sourceKey: `absence:${row.id}:${dateValue(row.updated_at)}`,
      eventKey: `absence:${row.id}:${dateValue(row.updated_at)}`,
      studentId: row.student_id,
      runId: number(row.run_id),
      groupId: row.group_id,
      category: "schedule",
      code: code("attendance_absent"),
      permission: "attendance.read",
      href: "/learn/schedule",
      params: {
        sourceType: "attendance_absent",
        attendanceId: row.id,
        lessonId: row.lesson_id,
        runId: number(row.run_id),
        title: row.topic,
      },
      deliverAt: now,
    }));
  }
  private async reminderCandidates(
    sql: Sql,
    cutoff: number,
    now: number,
  ): Promise<Candidate[]> {
    const assignments = (
      await sql.query<{
        id: string;
        student_id: number;
        run_id: string;
        group_id: number;
        due_at: Date;
        title: string;
      }>(
        `SELECT recipient.id,recipient.student_id,assignment.run_id,run.group_id,recipient.due_at,version.title FROM lms_assignment_recipients recipient JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_group_runs run ON run.id=assignment.run_id WHERE recipient.status IN ('assigned','revision_required') AND assignment.state='published' AND recipient.due_at IS NOT NULL AND recipient.due_at>=$1 AND recipient.due_at<=$3 AND recipient.opens_at<=$2 AND (recipient.closes_at IS NULL OR recipient.closes_at>$2) ORDER BY recipient.due_at LIMIT 1000`,
        [
          new Date(Math.max(cutoff - DAY, now - 2 * DAY)),
          new Date(now + DAY),
          new Date(now + 2 * DAY),
        ],
      )
    ).rows;
    const payments = (
      await sql.query<{
        id: number;
        student_id: number;
        group_id: number | null;
        due_at: Date;
        amount_uzs: number;
      }>(
        `SELECT payment.id,COALESCE(allocation.student_id,payment.student_id) AS student_id,payment.group_id,payment.due_at,COALESCE(allocation.amount_uzs,payment.amount_uzs) AS amount_uzs FROM academy_payments payment LEFT JOIN academy_payment_student_allocations allocation ON allocation.payment_id=payment.id WHERE payment.status IN ('pending','overdue') AND payment.due_at IS NOT NULL AND payment.due_at>=$1 AND payment.due_at<=$2 AND COALESCE(allocation.student_id,payment.student_id) IS NOT NULL AND payment.amount_uzs>0 ORDER BY payment.due_at LIMIT 1000`,
        [
          new Date(Math.max(cutoff - DAY, now - 2 * DAY)),
          new Date(now + 6 * DAY),
        ],
      )
    ).rows;
    const candidates: Candidate[] = [];
    for (const row of assignments) {
      const dueAt = dateValue(row.due_at);
      const dueIso = new Date(dueAt).toISOString();
      for (const overdue of [false, true]) {
        const scheduled = dueAt + (overdue ? DAY : -DAY);
        if (
          scheduled < cutoff ||
          scheduled > now + DAY ||
          (!overdue && dueAt <= now)
        )
          continue;
        const type = overdue ? "assignment_overdue" : "assignment_due";
        const sourceKey = `${type}:${row.id}:${dueIso}`;
        candidates.push({
          sourceKey,
          eventKey: sourceKey,
          studentId: row.student_id,
          runId: number(row.run_id),
          groupId: row.group_id,
          category: "learning",
          code: code(type),
          permission: "learning.read",
          href: `/learn/assignments/${row.id}`,
          params: {
            sourceType: type,
            recipientId: number(row.id),
            runId: number(row.run_id),
            dueAt: dueIso,
            title: row.title,
          },
          deliverAt: Math.max(now, scheduled),
        });
      }
    }
    for (const row of payments) {
      const dueAt = dateValue(row.due_at);
      const dueIso = new Date(dueAt).toISOString();
      for (const overdue of [false, true]) {
        const scheduled = dueAt + (overdue ? DAY : -3 * DAY);
        if (
          scheduled < cutoff ||
          scheduled > now + 3 * DAY ||
          (!overdue && dueAt <= now)
        )
          continue;
        const type = overdue ? "payment_overdue" : "payment_due";
        const sourceKey = `${type}:${row.id}:${dueIso}:student:${row.student_id}`;
        candidates.push({
          sourceKey,
          eventKey: `${type}:${row.id}:${dueIso}`,
          studentId: row.student_id,
          runId: null,
          groupId: row.group_id,
          category: "finance",
          code: code(type),
          permission: "finance.read",
          href: "/learn/payments",
          params: {
            sourceType: type,
            paymentId: row.id,
            dueAt: dueIso,
            amountUzs: number(row.amount_uzs),
          },
          deliverAt: Math.max(now, scheduled),
        });
      }
    }
    return candidates;
  }
  private async securityCandidates(
    sql: Sql,
    cutoff: number,
    now: number,
  ): Promise<Candidate[]> {
    const events = (
      await sql.query<{
        id: string;
        account_id: number | null;
        student_id: number | null;
        action: string;
        details: Record<string, unknown>;
      }>(
        `SELECT audit.id,audit.account_id,audit.student_id,audit.action,audit.details FROM portal_access_audit audit WHERE audit.created_at>=$1 AND audit.action IN ('PASSWORD_CHANGED','RECOVERY_COMPLETED','STAFF_CREDENTIALS_RESET','CHILD_CREDENTIALS_RESET','EMAIL_CHANGED','LINK_REVOKED','LINK_PERMISSIONS_CHANGED','CONSENT_GRANTED','CONSENT_REVOKED','CLASSIFICATION_VERIFIED','ACCOUNT_SUSPENDED','ACCOUNT_RESUMED','INVITATION_ACCEPTED') AND NOT EXISTS(SELECT 1 FROM lms_notification_sources source WHERE source.source_key='security-audit:'||audit.id::text) ORDER BY audit.id LIMIT 500`,
        [new Date(cutoff)],
      )
    ).rows;
    const candidates: Candidate[] = [];
    for (const event of events) {
      const passwordEvent = [
        "PASSWORD_CHANGED",
        "RECOVERY_COMPLETED",
        "STAFF_CREDENTIALS_RESET",
        "CHILD_CREDENTIALS_RESET",
        "EMAIL_CHANGED",
      ].includes(event.action);
      const accounts = new Set<number>();
      if (event.details.subjectAccountId)
        accounts.add(number(event.details.subjectAccountId));
      else if (event.account_id) accounts.add(event.account_id);
      if (event.action === "CHILD_CREDENTIALS_RESET" && event.account_id)
        accounts.add(event.account_id);
      if (event.details.linkId) {
        const link = (
          await sql.query<{ account_id: number }>(
            "SELECT account_id FROM portal_student_links WHERE id=$1",
            [event.details.linkId],
          )
        ).rows[0];
        if (link) accounts.add(link.account_id);
      }
      if (event.action === "CLASSIFICATION_VERIFIED" && event.student_id) {
        for (const link of (
          await sql.query<{ account_id: number }>(
            "SELECT account_id FROM portal_student_links WHERE student_id=$1 AND kind='representative' AND status<>'revoked'",
            [event.student_id],
          )
        ).rows)
          accounts.add(link.account_id);
      }
      // One atomic source marker covers all intended owners; outbox uniqueness remains per owner and channel.
      if (!accounts.size) {
        await sql.query(
          "INSERT INTO lms_notification_sources(source_key) VALUES($1) ON CONFLICT DO NOTHING",
          [`security-audit:${event.id}`],
        );
        continue;
      }
      for (const accountId of accounts)
        candidates.push({
          completedSourceKey: `security-audit:${event.id}`,
          sourceKey: `security-audit:${event.id}:account:${accountId}`,
          eventKey: `security:${event.id}`,
          studentId: null,
          runId: null,
          groupId: null,
          accountId,
          category: "security",
          code: code(passwordEvent ? "password_changed" : "access_changed"),
          permission: null,
          href: "/learn/profile",
          params: {
            sourceType: passwordEvent ? "password_changed" : "access_changed",
          },
          deliverAt: now,
          urgent: true,
        });
    }
    return candidates;
  }
  private async weeklyCandidates(sql: Sql, now: number): Promise<Candidate[]> {
    const local = new Date(now + TASHKENT);
    if (local.getUTCDay() !== 1 || local.getUTCHours() < 8) return [];
    const week = localDate(now);
    const preferences = (
      await sql.query<{ account_id: number }>(
        `SELECT preference.account_id FROM portal_notification_preferences preference JOIN portal_accounts account ON account.id=preference.account_id WHERE preference.weekly_summary=true AND account.status='active' AND NOT EXISTS(SELECT 1 FROM lms_notification_sources source WHERE source.source_key='weekly:'||$1||':'||preference.account_id::text)`,
        [week],
      )
    ).rows;
    const candidates: Candidate[] = [];
    for (const preference of preferences) {
      const summary = await this.weeklySummary(sql, preference.account_id, now);
      if (!summary.children) continue;
      candidates.push({
        sourceKey: `weekly:${week}:${preference.account_id}`,
        eventKey: `weekly:${week}`,
        studentId: null,
        runId: null,
        groupId: null,
        accountId: preference.account_id,
        category: "family",
        code: code("family_weekly"),
        permission: null,
        href: "/learn",
        params: {
          sourceType: "family_weekly",
          children: summary.children,
          updates: summary.updates,
        },
        deliverAt: now,
      });
    }
    return candidates;
  }
  async weeklySummary(
    sql: Sql,
    accountId: number,
    now: number,
  ): Promise<{ children: number; updates: number }> {
    const links = (
      await sql.query<{ id: number; student_id: number }>(
        "SELECT id,student_id FROM portal_student_links WHERE account_id=$1 AND kind='representative' AND status='active'",
        [accountId],
      )
    ).rows;
    let children = 0,
      updates = 0;
    for (const link of links) {
      let actor: PortalActorContext;
      try {
        actor = await this.options.authorizeLink(accountId, number(link.id));
      } catch (error) {
        if (accessDenied(error)) continue;
        throw error;
      }
      const groups = (
        await sql.query<{ group_id: number }>(
          "SELECT group_id FROM academy_student_group_enrollments WHERE student_id=$1",
          [link.student_id],
        )
      ).rows;
      if (
        groups.length &&
        !(
          await Promise.all(
            groups.map((group) => this.allowedGroup(group.group_id)),
          )
        ).some(Boolean)
      )
        continue;
      children++;
      const types: string[] = [];
      if (actor.permissions.includes("learning.read"))
        types.push(
          "material_published",
          "assignment_assigned",
          "assignment_submitted",
          "quiz_finished",
        );
      if (actor.permissions.includes("feedback.read"))
        types.push(
          "assignment_accepted",
          "assignment_revision_required",
          "report_published",
          "achievement_awarded",
        );
      if (types.length) {
        const counts = (
          await sql.query<{ count: string; group_id: number }>(
            "SELECT run.group_id,count(*) AS count FROM lms_learning_events event JOIN lms_group_runs run ON run.id=event.run_id WHERE event.student_id=$1 AND event.type=ANY($2::text[]) AND event.occurred_at>=$3 AND event.occurred_at<=$4 AND ($5::int[] IS NULL OR run.group_id=ANY($5::int[])) GROUP BY run.group_id",
            [
              link.student_id,
              types,
              new Date(now - 7 * DAY),
              new Date(now),
              this.currentGroupIds(),
            ],
          )
        ).rows;
        for (const count of counts)
          if (await this.allowedGroup(count.group_id))
            updates += number(count.count);
      }
      if (actor.permissions.includes("attendance.read")) {
        const counts = (
          await sql.query<{ count: string; group_id: number }>(
            "SELECT lesson.group_id,count(*) AS count FROM academy_attendance mark JOIN academy_lessons lesson ON lesson.id=mark.lesson_id WHERE mark.student_id=$1 AND mark.status='absent' AND lesson.status='conducted' AND mark.updated_at>=$2 AND mark.updated_at<=$3 AND ($4::int[] IS NULL OR lesson.group_id=ANY($4::int[])) GROUP BY lesson.group_id",
            [
              link.student_id,
              new Date(now - 7 * DAY),
              new Date(now),
              this.currentGroupIds(),
            ],
          )
        ).rows;
        for (const count of counts)
          if (await this.allowedGroup(count.group_id))
            updates += number(count.count);
      }
    }
    return { children, updates };
  }
  private currentGroupIds() {
    const ids =
      typeof this.options.groupIds === "function"
        ? this.options.groupIds()
        : (this.options.groupIds ?? []);
    return ids.length ? [...ids] : null;
  }
}
