import type { PoolClient } from "pg";
import type { PortalNotificationPreferencesDto } from "@shared/contracts/portal-resources";
import { learningSubjectHref } from "@shared/platform-routes";
import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import {
  DAY,
  MINUTE,
  dateValue,
  number,
  accessDenied,
  PORTAL_NOTIFICATION_EVENT_CODES,
  defaultPreferences,
  notificationEscalationAt,
  type Sql,
  type Candidate,
  type Outbox,
  type Account,
  type Params,
  type PortalNotificationWorkerOptions,
} from "./notification-support";
import { PortalNotificationSources } from "./notification-sources";
import { isNotificationResultCurrent } from "./notification-current-object";
export {
  notificationEscalationAt,
  PORTAL_NOTIFICATION_EVENT_CODES,
} from "./notification-support";
export type {
  PortalNotificationWorkerOptions,
} from "./notification-support";

export class PortalNotificationWorker {
  private running = false;
  private readonly sources: PortalNotificationSources;
  constructor(private readonly options: PortalNotificationWorkerOptions) {
    this.sources = new PortalNotificationSources(options);
  }
  private flag(value: boolean | (() => boolean) | undefined) {
    return typeof value === "function" ? value() : (value ?? false);
  }
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
  private async transaction<T>(sql: Sql, work: (client: PoolClient) => Promise<T>) {
    const supplied = "release" in sql;
    const client = supplied ? sql as PoolClient : await this.options.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      if (!supplied) client.release();
    }
  }
  async runOnce(): Promise<{ queued: number; delivered: number; cancelled: number; failed: number }> {
    const result = { queued: 0, delivered: 0, cancelled: 0, failed: 0 };
    if (this.running || !this.flag(this.options.enabled)) return result;
    this.running = true;
    try {
      const sql = await this.options.pool.connect();
      try { await this.runPhase(sql, result); } finally { sql.release(); }
      return result;
    } finally { this.running = false; }
  }
  private async runPhase(
    sql: Sql,
    result: { queued: number; delivered: number; cancelled: number; failed: number },
  ): Promise<void> {
    const phase = "in_app";
    const lockName = `academy-lms-notification-worker:${phase}`;
    let locked = false;
    try {
        locked = (await sql.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext($1||':'||current_schema())) AS locked", [lockName],
        )).rows[0].locked;
        if (!locked) return;

      const now = this.options.now?.() ?? Date.now();
        const requestedCutoff = this.options.rolloutStartedAt
        ? new Date(this.options.rolloutStartedAt).toISOString()
        : new Date(now).toISOString();
      await sql.query(
        "INSERT INTO lms_notification_worker_state(key,value) VALUES('rollout',jsonb_build_object('cutoff',$1::text)) ON CONFLICT(key) DO NOTHING",
        [requestedCutoff],
      );
      const cutoff = dateValue(
        (
          await sql.query<{ value: { cutoff: string } }>(
            "SELECT value FROM lms_notification_worker_state WHERE key='rollout'",
          )
        ).rows[0].value.cutoff,
      );
      const candidates = await this.sources.collect(sql, cutoff, now);
      for (const candidate of candidates) {
        result.queued += await this.transaction(sql, async (sql) => {
          const marker = await sql.query(
            "INSERT INTO lms_notification_sources(source_key) VALUES($1) ON CONFLICT DO NOTHING RETURNING source_key",
            [candidate.sourceKey],
          );
          if (!marker.rowCount) return 0;
          if (
            !(await this.allowedGroup(candidate.groupId)) ||
            (candidate.studentId !== null &&
              this.options.enabledForStudent &&
              !(await this.options.enabledForStudent(candidate.studentId)))
          )
            return 0;
          return this.enqueue(sql, candidate, now);
        });
      }
      for (const marker of new Set(
        candidates
          .map((candidate) => candidate.completedSourceKey)
          .filter((value): value is string => Boolean(value)),
      ))
        await sql.query(
          "INSERT INTO lms_notification_sources(source_key) VALUES($1) ON CONFLICT DO NOTHING",
          [marker],
        );
      await this.staffJobs(sql, cutoff, now);

      await sql.query(
        "UPDATE lms_resource_outbox SET state='failed',locked_at=NULL,last_error_code='delivery_interrupted' WHERE state='pending' AND channel=$2 AND attempts>=5 AND (locked_at IS NULL OR locked_at<$1)",
        [new Date(now - 5 * MINUTE), phase],
      );
      const ceiling = (await sql.query<{ id: string }>(
        "SELECT COALESCE(max(id),0)::text AS id FROM lms_resource_outbox WHERE state='pending' AND channel=$2 AND deliver_after<=$1",
        [new Date(now), phase],
      )).rows[0].id;
      const visited: string[] = [];
      for (let index = 0; index < (this.options.batchSize ?? 100); index++) {
        if (!this.flag(this.options.enabled)) break;
        const claimTime = this.options.now?.() ?? Date.now();
        const row = (await sql.query<Outbox>(`WITH candidate AS (
          SELECT id FROM lms_resource_outbox WHERE state='pending' AND channel=$3 AND attempts<5 AND deliver_after<=$1
            AND (locked_at IS NULL OR locked_at<$2) AND id<=$4::bigint AND NOT(id=ANY($5::bigint[]))
            ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
          ) UPDATE lms_resource_outbox job SET locked_at=$1 FROM candidate
            WHERE job.id=candidate.id AND job.state='pending' RETURNING job.*`,
          [new Date(claimTime), new Date(claimTime - 5 * MINUTE), phase, ceiling, visited],
        )).rows[0];
        if (!row) break;
        visited.push(row.id);
        const delivery = await this.deliver(sql, row, claimTime);
        if (delivery === "delivered") result.delivered++;
        else if (delivery === "cancelled") result.cancelled++;
        else if (delivery === "failed") result.failed++;
      }
    } finally {
      if (locked) await sql.query("SELECT pg_advisory_unlock(hashtext($1||':'||current_schema()))", [lockName]);
    }
  }
  private async preferences(sql: Sql, accountId: number): Promise<PortalNotificationPreferencesDto> {
    const row = (await sql.query<{ categories: PortalNotificationPreferencesDto['categories']; weekly_summary: boolean }>(
      'SELECT categories,weekly_summary FROM portal_notification_preferences WHERE account_id=$1', [accountId])).rows[0];
    const defaults = defaultPreferences();
    if (!row) return defaults;
    return { categories: Object.fromEntries(Object.keys(defaults.categories).map(category => {
      const key = category as keyof typeof defaults.categories;
      return [key, { inApp: key === 'security' || (row.categories[key]?.inApp ?? defaults.categories[key].inApp) }];
    })) as PortalNotificationPreferencesDto['categories'], weeklySummary: row.weekly_summary };
  }
  private async enqueue(sql: Sql, candidate: Candidate, now: number): Promise<number> {
    const links =
      candidate.studentId === null
        ? [{ id: null, account_id: candidate.accountId!, kind: null }]
        : (
            await sql.query<{
              id: number;
              account_id: number;
              kind: "self" | "representative";
            }>(
              `SELECT link.id,link.account_id,link.kind FROM portal_student_links link JOIN portal_accounts account ON account.id=link.account_id WHERE link.student_id=$1 AND link.status='active' AND link.verified_at IS NOT NULL AND (link.expires_at IS NULL OR link.expires_at>$2) AND account.status='active'`,
              [candidate.studentId, new Date(now)],
            )
          ).rows;
    let inserted = 0;
    for (const link of links) {
      if (
        candidate.accountId !== undefined &&
        number(link.account_id) !== number(candidate.accountId)
      )
        continue;
      if (candidate.audience && link.kind !== candidate.audience) continue;
      let permission = candidate.permission;
      if (link.id !== null) {
        try {
          const actor = await this.options.authorizeLink(number(link.account_id), number(link.id));
          if (permission && !actor.permissions.includes(permission)) {
            if (
              candidate.alternativePermission &&
              actor.permissions.includes(candidate.alternativePermission)
            )
              permission = candidate.alternativePermission;
            else continue;
          }
        } catch (error) {
          if (accessDenied(error)) continue;
          throw error;
        }
      }
      const preferences = await this.preferences(sql, number(link.account_id));
      const channel = "in_app";
        if (
          channel === "in_app" &&
          !preferences.categories[candidate.category].inApp &&
          candidate.category !== "security"
        )
          continue;
        let href = candidate.href;
        if (link.id !== null && candidate.params.sourceType === "thread_answered")
          href = `/learn/help?thread=${candidate.params.threadId}&linkId=${number(link.id)}`;
        if (
          link.id !== null &&
          candidate.category === "feedback" &&
          ["assignment_accepted", "assignment_revision_required"].includes(
            String(candidate.params.sourceType),
          )
        ) {
          const actor = await this.options.authorizeLink(number(link.account_id), number(link.id));
          if (!actor.permissions.includes("learning.read"))
            href =
              "/learn/feedback" +
              (candidate.params.reviewId ? `?review=${candidate.params.reviewId}` : "");
        }
        const eventKey =
          candidate.studentId !== null
            ? `${candidate.eventKey}:student:${candidate.studentId}`
            : candidate.eventKey;
        const queued = await sql.query(
          `INSERT INTO lms_resource_outbox(account_id,link_id,category,code,params,href,event_key,required_permission,channel,urgent,deliver_after) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11) ON CONFLICT(account_id,event_key,channel) DO NOTHING RETURNING id`,
          [
            link.account_id,
            link.id,
            candidate.category,
            candidate.code,
            JSON.stringify(candidate.params),
            learningSubjectHref(
              href,
              link.id !== null && link.kind
                ? { kind: link.kind, linkId: number(link.id) }
                : null,
            ),
            eventKey,
            permission,
            channel,
            candidate.urgent ?? false,
            new Date(Math.max(now, candidate.deliverAt)),
          ],
        );
        inserted += queued.rowCount ?? 0;

    }
    return inserted;
  }
  private async isCurrent(
    sql: Sql,
    row: Outbox,
    actor: PortalActorContext | null,
    now: number,
  ): Promise<boolean> {
    const params = row.params;
    const type = String(params.sourceType ?? "");
    if (params.runId) {
      const run = (
        await sql.query<{ group_id: number; access_until: Date | null }>(
          "SELECT group_id,access_until FROM lms_group_runs WHERE id=$1",
          [params.runId],
        )
      ).rows[0];
      if (
        !run ||
        !(await this.allowedGroup(run.group_id))
      )
        return false;
    }
    if (["assignment_due", "assignment_overdue"].includes(type)) {
      const recipient = (
        await sql.query<{
          status: string;
          due_at: Date | null;
          opens_at: Date;
          closes_at: Date | null;
          state: string;
        }>(
          `SELECT recipient.status,recipient.due_at,recipient.opens_at,recipient.closes_at,assignment.state FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE recipient.id=$1 AND recipient.student_id=$2`,
          [params.recipientId, actor?.studentId],
        )
      ).rows[0];
      if (
        !recipient ||
        !["assigned", "revision_required"].includes(recipient.status) ||
        recipient.state !== "published" ||
        !recipient.due_at ||
        new Date(recipient.due_at).toISOString() !== params.dueAt ||
        dateValue(recipient.opens_at) > now ||
        (recipient.closes_at && dateValue(recipient.closes_at) <= now)
      )
        return false;
      return type === "assignment_due"
        ? dateValue(recipient.due_at) > now
        : dateValue(recipient.due_at) + DAY <= now;
    }
    if (["payment_due", "payment_overdue"].includes(type)) {
      const payment = (
        await sql.query<{
          status: string;
          due_at: Date | null;
          group_id: number | null;
          amount_uzs: number;
        }>(
          `SELECT payment.status,payment.due_at,payment.group_id,COALESCE(allocation.amount_uzs,payment.amount_uzs) AS amount_uzs FROM academy_payments payment LEFT JOIN academy_payment_student_allocations allocation ON allocation.payment_id=payment.id AND allocation.student_id=$2 WHERE payment.id=$1 AND (allocation.student_id=$2 OR (payment.student_id=$2 AND NOT EXISTS(SELECT 1 FROM academy_payment_student_allocations any_allocation WHERE any_allocation.payment_id=payment.id)))`,
          [params.paymentId, actor?.studentId],
        )
      ).rows[0];
      if (
        !payment ||
        !["pending", "overdue"].includes(payment.status) ||
        !payment.due_at ||
        new Date(payment.due_at).toISOString() !== params.dueAt ||
        !(await this.allowedGroup(payment.group_id))
      )
        return false;
      row.params.amountUzs = number(payment.amount_uzs);
      return type === "payment_due"
        ? dateValue(payment.due_at) > now
        : dateValue(payment.due_at) + DAY <= now;
    }
    if (type === "material_published")
      return Boolean(
        (
          await sql.query(
            `SELECT publication.id FROM lms_material_publications publication JOIN lms_materials material ON material.id=publication.material_id JOIN academy_student_group_enrollments enrollment ON enrollment.id=publication.enrollment_id WHERE publication.id=$1 AND enrollment.student_id=$2 AND publication.revoked_at IS NULL AND material.state='published' AND publication.publish_at<=$3 AND publication.publish_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR publication.publish_at<enrollment.ended_at)`,
            [params.publicationId, actor?.studentId, new Date(now)],
          )
        ).rowCount,
      );
    if (type === "assignment_assigned")
      return Boolean(
        (
          await sql.query(
            `SELECT recipient.id FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN academy_student_group_enrollments enrollment ON enrollment.id=recipient.enrollment_id WHERE recipient.id=$1 AND recipient.student_id=$2 AND recipient.status NOT IN ('cancelled','excused') AND assignment.state='published' AND recipient.opens_at<=$3 AND recipient.opens_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR recipient.opens_at<enrollment.ended_at)`,
            [params.recipientId, actor?.studentId, new Date(now)],
          )
        ).rowCount,
      );
    if (type === "quiz_assigned")
      return Boolean(
        (
          await sql.query(
            `SELECT recipient.id FROM lms_quiz_recipients recipient JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id JOIN academy_student_group_enrollments enrollment ON enrollment.id=recipient.enrollment_id WHERE recipient.id=$1 AND recipient.student_id=$2 AND recipient.status='assigned' AND quiz.state='published' AND recipient.opens_at<=$3 AND (recipient.closes_at IS NULL OR recipient.closes_at>$3) AND recipient.opens_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR recipient.opens_at<enrollment.ended_at)`,
            [params.quizRecipientId, actor?.studentId, new Date(now)],
          )
        ).rowCount,
      );
    if (type === "announcement_published")
      return Boolean(
        (
          await sql.query(
            `SELECT announcement.id FROM lms_announcements announcement JOIN lms_group_runs run ON run.id=announcement.run_id JOIN academy_student_group_enrollments enrollment ON enrollment.group_id=run.group_id WHERE announcement.id=$1 AND enrollment.student_id=$2 AND announcement.revoked_at IS NULL AND announcement.publish_at<=$3 AND announcement.publish_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR announcement.publish_at<enrollment.ended_at) AND (announcement.audience='all' OR (announcement.audience='students' AND $4='self') OR (announcement.audience='representatives' AND $4='representative'))`,
            [params.announcementId, actor?.studentId, new Date(now), actor?.kind],
          )
        ).rowCount,
      );
    if (["lesson_rescheduled", "lesson_cancelled", "attendance_absent"].includes(type)) {
      const lesson = (
        await sql.query<{
          status: string;
          scheduled_at: Date;
          group_id: number;
        }>("SELECT status,scheduled_at,group_id FROM academy_lessons WHERE id=$1", [
          params.lessonId,
        ])
      ).rows[0];
      if (!lesson || !(await this.allowedGroup(lesson.group_id))) return false;
      if (
        type === "lesson_rescheduled" &&
        (lesson.status === "cancelled" ||
          new Date(lesson.scheduled_at).toISOString() !== params.scheduledAt)
      )
        return false;
      if (type === "lesson_cancelled" && lesson.status !== "cancelled") return false;
      if (
        type === "attendance_absent" &&
        (lesson.status !== "conducted" ||
          !(
            await sql.query(
              "SELECT id FROM academy_attendance WHERE lesson_id=$1 AND student_id=$2 AND status='absent'",
              [params.lessonId, actor?.studentId],
            )
          ).rowCount)
      )
        return false;
      return Boolean(
        (
          await sql.query(
            "SELECT id FROM academy_student_group_enrollments WHERE student_id=$1 AND group_id=$2 AND enrolled_at<=$3 AND (ended_at IS NULL OR ended_at>$3)",
            [actor?.studentId, lesson.group_id, lesson.scheduled_at],
          )
        ).rowCount,
      );
    }
    if (type === "thread_answered")
      return Boolean(
        (
          await sql.query(
            `SELECT comment.id FROM lms_comments comment JOIN lms_threads thread ON thread.id=comment.thread_id WHERE comment.id=$1 AND thread.id=$2 AND thread.student_id=$3 AND comment.audience<>'staff' AND ((thread.audience='student_teacher' AND $4='self') OR (thread.audience='representative_teacher' AND thread.author_account_id=$5))`,
            [params.commentId, params.threadId, actor?.studentId, actor?.kind, row.account_id],
          )
        ).rowCount,
      );
    if (type === "assignment_feedback")
      return Boolean(
        (
          await sql.query(
            `SELECT comment.id FROM lms_comments comment WHERE comment.id=$1 AND comment.student_id=$2 AND comment.audience<>'staff' AND (comment.audience='family_teacher' OR (comment.audience='student_teacher' AND $3='self') OR (comment.audience='representative_teacher' AND $3='representative' AND comment.audience_account_id=$4))`,
            [params.commentId, actor?.studentId, actor?.kind, row.account_id],
          )
        ).rowCount,
      );
    if (type === "family_weekly")
      return (await this.sources.weeklySummary(sql, row.account_id, now)).children > 0;
    if (type === "finance_question_answered")
      return Boolean((await sql.query(
        `SELECT message.id FROM portal_finance_question_messages message
          JOIN portal_finance_questions question ON question.id=message.question_id
          WHERE question.id=$1 AND message.id=$2 AND question.account_id=$3
            AND question.link_id=$4 AND question.student_id=$5 AND message.user_id IS NOT NULL`,
        [params.questionId, params.messageId, row.account_id, row.link_id, actor?.studentId],
      )).rowCount);
    return isNotificationResultCurrent(sql, row, actor, now);
  }
  private async deliver(
    sql: Sql,
    row: Outbox,
    now: number,
  ): Promise<"delivered" | "cancelled" | "failed" | "deferred"> {
    if (!row.locked_at) return "deferred";
    const account = (
      await sql.query<Account>(
        "SELECT id,status FROM portal_accounts WHERE id=$1",
        [row.account_id],
      )
    ).rows[0];
    let actor: PortalActorContext | null = null;
    const cancel = async () => {
      const changed = await sql.query(
        "UPDATE lms_resource_outbox SET state='cancelled',locked_at=NULL,last_error_code=NULL WHERE id=$1 AND state='pending' AND locked_at=$2 AND attempts=$3",
        [row.id, row.locked_at, row.attempts],
      );
      return changed.rowCount ? "cancelled" as const : "deferred" as const;
    };
    if (
      !account ||
      account.status === "archived" ||
      (row.category !== "security" && account.status !== "active")
    )
      return cancel();
    if (row.link_id !== null) {
      try {
        actor = await this.options.authorizeLink(
          number(row.account_id),
          number(row.link_id),
          row.required_permission ?? undefined,
        );
      } catch (error) {
        if (accessDenied(error)) return cancel();
        throw error;
      }
    }
    if (
      actor &&
      this.options.enabledForStudent &&
      !(await this.options.enabledForStudent(actor.studentId))
    )
      return cancel();
    if (!(await this.isCurrent(sql, row, actor, now))) return cancel();
    const preferences = await this.preferences(sql, number(row.account_id));
    if (row.channel === "in_app") {
      if (!preferences.categories[row.category].inApp && row.category !== "security")
        return cancel();
      if (row.params.sourceType === "family_weekly") {
        if (!preferences.weeklySummary) return cancel();
        row.params = {
          ...row.params,
          ...(await this.sources.weeklySummary(sql, row.account_id, now)),
        };
      }
      const recorded = await this.transaction(sql, async (sql) => {
        const owned = await sql.query("SELECT id FROM lms_resource_outbox WHERE id=$1 AND state='pending' AND locked_at=$2 AND attempts=$3 FOR UPDATE", [row.id, row.locked_at, row.attempts]);
        if (!owned.rowCount) return false;
        await sql.query(
          `INSERT INTO portal_notifications(account_id,link_id,category,code,params,href,event_key,required_permission) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT(account_id,event_key) DO NOTHING`,
          [
            row.account_id,
            row.link_id,
            row.category,
            row.code,
            JSON.stringify(row.params),
            row.href,
            row.event_key,
            row.required_permission,
          ],
        );
        await sql.query(
          "UPDATE lms_resource_outbox SET state='delivered',delivered_at=$2,locked_at=NULL,last_error_code=NULL WHERE id=$1 AND state='pending' AND locked_at=$3 AND attempts=$4",
          [row.id, new Date(now), row.locked_at, row.attempts],
        );
        return true;
      });
      return recorded ? "delivered" : "deferred";
    }

    return cancel();
  }
  private async staffNotification(
    sql: Sql,
    userId: number,
    eventKey: string,
    notificationCode: string,
    params: Params,
    entityType: string,
    entityId: number,
  ): Promise<void> {
    if (!this.options.staffCopy) return;
    const user = (
      await sql.query<{ is_active: boolean; is_archived: boolean }>(
        "SELECT is_active,is_archived FROM users WHERE id=$1",
        [userId],
      )
    ).rows[0];
    if (!user?.is_active || user.is_archived) return;
    const copy = this.options.staffCopy(notificationCode, params);
    await this.transaction(sql, async (sql) => {
      const dedupe = await sql.query(
        "INSERT INTO lms_staff_notification_events(user_id,event_key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id",
        [userId, eventKey],
      );
      if (!dedupe.rowCount) return;
      await sql.query(
        `INSERT INTO notifications(user_id,type,title,message,related_entity_type,related_entity_id) VALUES($1,'lms',$2,$3,$4,$5)`,
        [userId, copy.title.slice(0, 255), copy.message, entityType, entityId],
      );
    });
  }
  private async currentTeachers(sql: Sql, runId: number): Promise<number[]> {
    const rows = (
      await sql.query<{ user_id: number }>(
        `SELECT teacher.user_id FROM lms_group_runs run JOIN academy_groups g ON g.id=run.group_id JOIN academy_teachers teacher ON teacher.id=g.teacher_id JOIN users staff ON staff.id=teacher.user_id WHERE run.id=$1 AND teacher.status='active' AND staff.is_active=true AND staff.is_archived=false AND (staff.module='teacher' OR EXISTS(SELECT 1 FROM user_modules WHERE user_id=staff.id AND module='teacher'))`,
        [runId],
      )
    ).rows;
    return rows.map((row) => row.user_id);
  }
  private async coordinators(sql: Sql): Promise<number[]> {
    const rows = (
      await sql.query<{ id: number }>(
        `SELECT staff.id FROM users staff WHERE staff.is_active=true AND staff.is_archived=false AND (staff.module='administration' OR EXISTS(SELECT 1 FROM user_modules WHERE user_id=staff.id AND module='administration') OR EXISTS(SELECT 1 FROM lms_staff_permissions WHERE user_id=staff.id AND permission='communication.manage'))`,
        [],
      )
    ).rows;
    return rows.map((row) => row.id);
  }
  private async staffJobs(sql: Sql, cutoff: number, now: number): Promise<void> {
    if (!this.options.staffCopy) return;
    const events = (
      await sql.query<{
        id: string;
        type: string;
        object_id: string;
        run_id: string;
        group_id: number;
        event_key: string;
        data: Record<string, unknown>;
      }>(
        `SELECT event.id,event.type,event.object_id,event.run_id,run.group_id,event.event_key,event.data FROM lms_learning_events event JOIN lms_group_runs run ON run.id=event.run_id WHERE event.occurred_at>=$1 AND event.type IN ('assignment_submitted','help_requested','thread_comment','assignment_comment','material_published','assignment_assigned') ORDER BY event.id DESC LIMIT 1000`,
        [new Date(cutoff)],
      )
    ).rows;
    for (const event of events) {
      if (!(await this.allowedGroup(event.group_id)) || event.data.imported === true) continue;
      const teacherIds = await this.currentTeachers(sql, number(event.run_id));
      if (event.type === "assignment_submitted") {
        const submission = (
          await sql.query<{
            title: string;
            withdrawn_at: Date | null;
            review_id: string | null;
          }>(
            `SELECT version.title,submission.withdrawn_at,(SELECT id FROM lms_reviews WHERE submission_id=submission.id ORDER BY id DESC LIMIT 1) AS review_id FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE submission.id=$1`,
            [event.object_id],
          )
        ).rows[0];
        if (!submission || submission.withdrawn_at || submission.review_id) continue;
        const recipients = teacherIds.length ? teacherIds : await this.coordinators(sql);
        for (const userId of recipients)
          await this.staffNotification(
            sql,
            userId,
            `review:${event.event_key}`,
            "lmsNoticeReviewQueue",
            { title: submission.title },
            "lms_submission",
            number(event.object_id),
          );
      } else if (["help_requested", "thread_comment"].includes(event.type)) {
        const threadId =
          event.type === "help_requested" ? number(event.object_id) : number(event.data.threadId);
        const thread = (
          await sql.query<{ title: string; status: string }>(
            "SELECT title,status FROM lms_threads WHERE id=$1",
            [threadId],
          )
        ).rows[0];
        if (!thread || thread.status === "resolved") continue;
        const recipients = teacherIds.length ? teacherIds : await this.coordinators(sql);
        for (const userId of recipients)
          await this.staffNotification(
            sql,
            userId,
            `help:${event.event_key}`,
            "lmsNoticeHelpRequested",
            { title: thread.title },
            "lms_thread",
            threadId,
          );
      } else if (event.type === "assignment_comment") {
        if (event.data.audience === "staff") continue;
        const recipient = (
          await sql.query<{ title: string }>(
            "SELECT version.title FROM lms_assignment_recipients recipient JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE recipient.id=$1",
            [event.data.recipientId],
          )
        ).rows[0];
        if (!recipient) continue;
        for (const userId of teacherIds.length ? teacherIds : await this.coordinators(sql))
          await this.staffNotification(
            sql,
            userId,
            `comment:${event.event_key}`,
            "lmsNoticeHelpRequested",
            { title: recipient.title },
            "lms_assignment",
            number(event.data.recipientId),
          );
      } else {
        const authorRow =
          event.type === "material_published"
            ? (
                await sql.query<{ created_by: number; title: string }>(
                  `SELECT material.created_by,version.title FROM lms_material_publications publication JOIN lms_materials material ON material.id=publication.material_id JOIN lms_material_versions version ON version.id=publication.material_version_id WHERE publication.id=$1 AND publication.publish_at<=$2 AND publication.revoked_at IS NULL`,
                  [event.object_id, new Date(now)],
                )
              ).rows[0]
            : (
                await sql.query<{ created_by: number; title: string }>(
                  `SELECT assignment.created_by,version.title FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id WHERE recipient.id=$1 AND recipient.opens_at<=$2 AND recipient.status NOT IN ('cancelled','excused')`,
                  [event.object_id, new Date(now)],
                )
              ).rows[0];
        if (authorRow)
          await this.staffNotification(
            sql,
            authorRow.created_by,
            `published:${event.event_key}`,
            "lmsNoticePublished",
            { title: authorRow.title },
            "lms_group_run",
            number(event.run_id),
          );
      }
    }
    const changes = (
      await sql.query<{
        lesson_id: number;
        topic: string;
        group_id: number;
        event_key: string;
        run_id: string;
      }>(
        `SELECT lesson.id AS lesson_id,lesson.topic,lesson.group_id,run.id AS run_id,'reschedule:'||history.id::text AS event_key FROM academy_lesson_reschedules history JOIN academy_lessons lesson ON lesson.id=history.lesson_id JOIN lms_group_runs run ON run.group_id=lesson.group_id WHERE history.created_at>=$1 UNION ALL SELECT lesson.id AS lesson_id,lesson.topic,lesson.group_id,run.id AS run_id,'cancel:'||history.id::text AS event_key FROM academy_lesson_status_history history JOIN academy_lessons lesson ON lesson.id=history.lesson_id JOIN lms_group_runs run ON run.group_id=lesson.group_id WHERE history.created_at>=$1 AND history.to_status='cancelled'`,
        [new Date(cutoff)],
      )
    ).rows;
    for (const change of changes) {
      if (!(await this.allowedGroup(change.group_id))) continue;
      for (const teacherId of await this.currentTeachers(sql, number(change.run_id)))
        await this.staffNotification(
          sql,
          teacherId,
          `schedule:${change.event_key}`,
          "lmsNoticeLessonChanged",
          { title: change.topic },
          "academy_lesson",
          change.lesson_id,
        );
    }
    const overdue = (
      await sql.query<{
        id: string;
        run_id: string;
        group_id: number;
        title: string;
        due_at: Date;
      }>(
        `SELECT recipient.id,assignment.run_id,run.group_id,version.title,recipient.due_at FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_assignment_versions version ON version.id=recipient.assignment_version_id JOIN lms_group_runs run ON run.id=assignment.run_id WHERE recipient.status IN ('assigned','revision_required') AND recipient.due_at>=$1 AND recipient.due_at<=$2`,
        [new Date(cutoff - DAY), new Date(now - DAY)],
      )
    ).rows;
    for (const assignment of overdue) {
      if (!(await this.allowedGroup(assignment.group_id))) continue;
      for (const teacherId of await this.currentTeachers(sql, number(assignment.run_id)))
        await this.staffNotification(
          sql,
          teacherId,
          `overdue:${assignment.id}:${new Date(assignment.due_at).toISOString()}`,
          "lmsNoticeAssignmentOverdue",
          { title: assignment.title },
          "lms_assignment",
          number(assignment.id),
        );
    }
    const threads = (
      await sql.query<{
        id: string;
        run_id: string;
        group_id: number;
        title: string;
        assigned_user_id: number | null;
        created_at: Date;
      }>(
        `SELECT thread.id,thread.run_id,run.group_id,thread.title,thread.assigned_user_id,thread.created_at FROM lms_threads thread JOIN lms_group_runs run ON run.id=thread.run_id WHERE thread.status='open' AND thread.created_at>=$1 AND NOT EXISTS(SELECT 1 FROM lms_comments comment WHERE comment.thread_id=thread.id AND comment.staff_user_id IS NOT NULL AND comment.audience<>'staff')`,
        [new Date(cutoff)],
      )
    ).rows;
    for (const thread of threads) {
      if (!(await this.allowedGroup(thread.group_id))) continue;
      const teachers = await this.currentTeachers(sql, number(thread.run_id));
      if (!thread.assigned_user_id || !teachers.includes(thread.assigned_user_id)) {
        const recipients = teachers.length ? teachers : await this.coordinators(sql);
        if (recipients[0])
          await sql.query("UPDATE lms_threads SET assigned_user_id=$2 WHERE id=$1", [
            thread.id,
            recipients[0],
          ]);
      }
      if (
        notificationEscalationAt(dateValue(thread.created_at)) > now
      )
        continue;
      for (const coordinator of await this.coordinators(sql))
        await this.staffNotification(
          sql,
          coordinator,
          `help-escalated:${thread.id}`,
          "lmsNoticeHelpEscalated",
          { title: thread.title },
          "lms_thread",
          number(thread.id),
        );
    }
  }
}
