import type { Pool } from 'pg';
import { getComputedPaymentStatus } from '@shared/academy';
import {
  PORTAL_FILE_QUOTA_BYTES, PORTAL_NOTIFICATION_CATEGORIES,
  type PortalNotificationDto, type PortalNotificationPageDto, type PortalNotificationPreferencesDto,
  type PortalPaymentDto, type PortalPaymentsDto,
} from '@shared/contracts/portal-resources';
import type { PortalActorContext } from '../../portal-identity/domain/actor-context';
import type { PortalResourceRepository, ResourceFile, ResourceScanClaim } from '../application/ports';
import { PortalResourceError, type ResourceStaffActor } from '../domain/policy';
import { fileDto, filesByIds } from './project-repository';
import { PaymentAllocationRepository } from './payment-allocation-repository';
import { resourceRows, resourceOne, resourceTransaction, resourceAudit, checkResourceLink, type ResourceSql } from './sql';

const fileSelect = 'SELECT file.* FROM lms_files file';
const defaultPreferences = (): PortalNotificationPreferencesDto => ({
  categories: Object.fromEntries(PORTAL_NOTIFICATION_CATEGORIES.map((category) => [category, { inApp: true }])) as PortalNotificationPreferencesDto['categories'],
  weeklySummary: false,
});
const visibleNotification = `(notification.link_id IS NULL OR EXISTS(SELECT 1 FROM portal_student_links link
  WHERE link.id=notification.link_id AND link.account_id=notification.account_id AND link.status='active'
  AND (link.expires_at IS NULL OR link.expires_at>now()) AND (notification.required_permission IS NULL OR link.permissions ? notification.required_permission)
  AND (link.kind='self' OR EXISTS(SELECT 1 FROM portal_student_identity identity WHERE identity.student_id=link.student_id AND identity.classification='minor')
    OR EXISTS(SELECT 1 FROM portal_consents consent WHERE consent.link_id=link.id AND consent.revoked_at IS NULL AND consent.method IN ('in_person','portal') AND consent.permissions @> link.permissions))
  AND (notification.category<>'finance' OR link.kind<>'self' OR EXISTS(SELECT 1 FROM portal_student_identity identity WHERE identity.student_id=link.student_id AND identity.classification='adult'))))`;
const staffRun = async (sql: ResourceSql, actor: ResourceStaffActor, runId: number) => {
  if (!await resourceOne(sql, 'SELECT id FROM users WHERE id=$1 AND is_active=true AND is_archived=false FOR SHARE', [actor.userId])) throw new PortalResourceError('portalAccessDenied', 403);
  const granted = await resourceOne(sql,"SELECT user_id FROM lms_staff_permissions WHERE user_id=$1 AND permission=ANY($2::text[]) LIMIT 1",[actor.userId,['content.manage','assignments.manage','reviews.manage','quizzes.manage','communication.manage','announcements.manage','results.manage']]);
  if (!actor.isLeadership && !actor.modules.includes('teacher') && !granted) throw new PortalResourceError('portalAccessDenied', 403);
  if (!await resourceOne(sql, `SELECT run.id FROM lms_group_runs run JOIN academy_groups g ON g.id=run.group_id
    LEFT JOIN academy_teachers teacher ON teacher.id=g.teacher_id WHERE run.id=$1 AND ($2 OR (teacher.user_id=$3 AND teacher.status='active'))`, [runId, actor.isLeadership || Boolean(granted), actor.userId])) throw new PortalResourceError('portalNotFound', 404);
};
// Every saved work reference protects its original bytes, including withdrawn or archived work.
const unreferencedLearningFile = `      AND NOT EXISTS(SELECT 1 FROM lms_submission_drafts draft WHERE draft.file_ids @> jsonb_build_array(file.id))
      AND NOT EXISTS(SELECT 1 FROM lms_submissions submission WHERE submission.file_ids @> jsonb_build_array(file.id))
      AND NOT EXISTS(SELECT 1 FROM academy_portfolio_projects project WHERE project.file_ids @> jsonb_build_array(file.id) OR project.cover_file_id=file.id)
      AND NOT EXISTS(SELECT 1 FROM lms_material_versions version WHERE version.file_ids @> jsonb_build_array(file.id))
      AND NOT EXISTS(SELECT 1 FROM lms_assignment_versions version WHERE version.file_ids @> jsonb_build_array(file.id))
      AND NOT EXISTS(SELECT 1 FROM lms_comments comment WHERE comment.file_ids @> jsonb_build_array(file.id))
      AND NOT EXISTS(SELECT 1 FROM lms_announcements announcement WHERE announcement.file_ids @> jsonb_build_array(file.id))
      AND NOT EXISTS(SELECT 1 FROM lms_portfolio_shares share WHERE (share.snapshot->'fileIds') @> jsonb_build_array(file.id))
      AND NOT EXISTS(SELECT 1 FROM lms_reports report, jsonb_array_elements(report.best_projects) project WHERE (project->'fileIds') @> jsonb_build_array(file.id))
      AND NOT EXISTS(SELECT 1 FROM lms_project_comparisons comparison WHERE (comparison.first_snapshot->'fileIds') @> jsonb_build_array(file.id) OR (comparison.latest_snapshot->'fileIds') @> jsonb_build_array(file.id))`;
export class PostgresPortalResourceRepository extends PaymentAllocationRepository implements PortalResourceRepository {
  constructor(pool: Pool, enabledForGroup: (groupId: number) => Promise<boolean> = async () => false, private readonly quotas: () => { studentBytes: number; schoolBytes: number } = () => ({ studentBytes: PORTAL_FILE_QUOTA_BYTES, schoolBytes: 20 * 1024 ** 3 }), verifiedProject?: (sql: ResourceSql, studentId: number, runId: number, projectId: number) => Promise<void>) {
    super(pool,enabledForGroup,verifiedProject);
  }
  async filesByIds(ids: number[]) { return filesByIds(this.pool, ids); }
  async readFile(actor: PortalActorContext, fileId: number): Promise<ResourceFile | null> {
    const value = await resourceOne<Parameters<typeof fileDto>[0]>(this.pool, `${fileSelect} WHERE file.id=$1 AND file.deleted_at IS NULL AND (
      (file.owner_account_id=$2 AND file.student_id=$3)
      OR ($4 AND EXISTS(SELECT 1 FROM lms_material_versions version JOIN lms_material_publications publication ON publication.material_version_id=version.id
        JOIN lms_materials material ON material.id=version.material_id JOIN academy_student_group_enrollments enrollment ON enrollment.id=publication.enrollment_id
        JOIN lms_group_runs run ON run.id=material.run_id WHERE version.file_ids @> jsonb_build_array(file.id) AND enrollment.student_id=$3
        AND publication.publish_at<=now() AND publication.revoked_at IS NULL AND material.state='published'
        AND publication.publish_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR publication.publish_at<enrollment.ended_at)
        AND TRUE))
      OR ($4 AND EXISTS(SELECT 1 FROM lms_assignment_versions version JOIN lms_assignment_recipients recipient ON recipient.assignment_version_id=version.id
        JOIN academy_student_group_enrollments enrollment ON enrollment.id=recipient.enrollment_id
        JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_group_runs run ON run.id=assignment.run_id
        WHERE recipient.student_id=$3 AND recipient.opens_at<=now() AND recipient.opens_at>=enrollment.enrolled_at
        AND (enrollment.ended_at IS NULL OR recipient.opens_at<enrollment.ended_at) AND TRUE
        AND recipient.status NOT IN ('cancelled','excused') AND version.file_ids @> jsonb_build_array(file.id)))
      OR ($4 AND EXISTS(SELECT 1 FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id
        JOIN lms_assignment_versions version ON version.id=submission.assignment_version_id
        JOIN academy_student_group_enrollments enrollment ON enrollment.id=recipient.enrollment_id
        JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id JOIN lms_group_runs run ON run.id=assignment.run_id
        WHERE recipient.student_id=$3 AND recipient.opens_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR recipient.opens_at<enrollment.ended_at)
        AND TRUE AND version.file_ids @> jsonb_build_array(file.id)))
      OR ($4 AND EXISTS(SELECT 1 FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id
        WHERE recipient.student_id=$3 AND submission.file_ids @> jsonb_build_array(file.id)))
      OR ($4 AND EXISTS(SELECT 1 FROM academy_portfolio_projects project WHERE project.student_id=$3 AND project.archived_at IS NULL AND project.file_ids @> jsonb_build_array(file.id)))
      OR ($4 AND EXISTS(SELECT 1 FROM lms_project_comparisons comparison WHERE comparison.student_id=$3 AND ((comparison.first_snapshot->'fileIds') @> jsonb_build_array(file.id) OR (comparison.latest_snapshot->'fileIds') @> jsonb_build_array(file.id))))
      OR ($4 AND EXISTS(SELECT 1 FROM lms_reports report,jsonb_array_elements(report.best_projects) project WHERE report.student_id=$3 AND (project->'fileIds') @> jsonb_build_array(file.id)))
      OR ($5 AND EXISTS(SELECT 1 FROM lms_portfolio_shares share JOIN academy_portfolio_projects project ON project.id=share.project_id
        WHERE project.student_id=$3 AND share.status IN ('awaiting_approval','awaiting_moderation','published') AND (share.snapshot->'fileIds') @> jsonb_build_array(file.id)))
      OR EXISTS(SELECT 1 FROM lms_comments comment LEFT JOIN lms_threads thread ON thread.id=comment.thread_id
        WHERE comment.student_id=$3 AND comment.file_ids @> jsonb_build_array(file.id) AND comment.audience<>'staff'
        AND (((comment.audience='student_teacher' AND $6='self') OR comment.audience='family_teacher') AND $7
        OR (comment.audience='representative_teacher' AND (thread.author_account_id=$2 OR (thread.id IS NULL AND comment.audience_account_id=$2)))))
      OR ($4 AND EXISTS(SELECT 1 FROM lms_announcements announcement JOIN lms_group_runs run ON run.id=announcement.run_id
        JOIN academy_student_group_enrollments enrollment ON enrollment.group_id=run.group_id WHERE enrollment.student_id=$3
        AND announcement.file_ids @> jsonb_build_array(file.id) AND announcement.publish_at<=now() AND announcement.revoked_at IS NULL
        AND announcement.publish_at>=enrollment.enrolled_at AND (enrollment.ended_at IS NULL OR announcement.publish_at<enrollment.ended_at)
        AND (announcement.audience='all' OR announcement.audience=CASE WHEN $6='self' THEN 'students' ELSE 'representatives' END)))
      )`, [fileId, actor.portalAccountId, actor.studentId, actor.permissions.includes('learning.read'), actor.permissions.includes('portfolio.approve'), actor.kind, actor.permissions.includes('feedback.read')]);
    return value && await this.runEnabled(value.runId) ? fileDto(value) : null;
  }
  async registerFile(actor: PortalActorContext, file: { name: string; mime: string; size: number; storageKey: string; sha256: string; runId: number | null }): Promise<ResourceFile> {
    await this.requireEnabledRun(file.runId);
    return resourceTransaction(this.pool, async (sql) => {
      const permission = ['assignments.submit', 'portfolio.edit', 'communication.create'].find((value) => actor.permissions.includes(value as typeof actor.permissions[number]));
      if (!permission) throw new PortalResourceError('portalAccessDenied', 403);
      await checkResourceLink(sql, actor, permission);
      await sql.query('SELECT id FROM academy_students WHERE id=$1 FOR UPDATE', [actor.studentId]);
      const quota = await resourceOne<{ totalBytes: number }>(sql, 'SELECT COALESCE(sum(size_bytes),0) AS total_bytes FROM lms_files WHERE student_id=$1 AND deleted_at IS NULL', [actor.studentId]);
      if (Number(quota?.totalBytes ?? 0) + file.size > this.quotas().studentBytes) throw new PortalResourceError('portalFileQuotaExceeded', 413);
      if (file.runId && !await resourceOne(sql, `SELECT run.id FROM lms_group_runs run JOIN academy_student_group_enrollments enrollment ON enrollment.group_id=run.group_id WHERE run.id=$1 AND enrollment.student_id=$2 AND enrollment.status='active'`, [file.runId, actor.studentId])) throw new PortalResourceError('portalNotFound', 404);
      const row = await resourceOne<Parameters<typeof fileDto>[0]>(sql, `INSERT INTO lms_files(owner_account_id,student_id,run_id,name,mime,size_bytes,storage_key,sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [actor.portalAccountId, actor.studentId, file.runId, file.name, file.mime, file.size, file.storageKey, file.sha256]);
      await resourceAudit(sql, actor, 'file.uploaded', 'file', row!.id, { size: file.size });
      return fileDto(row!);
    });
  }
  async registerStaffFile(actor: ResourceStaffActor, runId: number, file: { name: string; mime: string; size: number; storageKey: string; sha256: string }): Promise<ResourceFile> {
    await this.requireEnabledRun(runId);
    return resourceTransaction(this.pool, async (sql) => {
      await staffRun(sql, actor, runId);
      await sql.query('SELECT pg_advisory_xact_lock(136036)');
      const used = await resourceOne<{ totalBytes: number }>(sql,'SELECT COALESCE(sum(size_bytes),0) AS total_bytes FROM lms_files WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL');
      if (Number(used?.totalBytes ?? 0)+file.size > this.quotas().schoolBytes) throw new PortalResourceError('portalFileQuotaExceeded',413);
      const row = await resourceOne<Parameters<typeof fileDto>[0]>(sql, `INSERT INTO lms_files(owner_user_id,run_id,name,mime,size_bytes,storage_key,sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [actor.userId, runId, file.name, file.mime, file.size, file.storageKey, file.sha256]);
      await resourceAudit(sql, actor, 'file.uploaded', 'file', row!.id, { size: file.size, runId });
      return fileDto(row!);
    });
  }
  async readStaffFile(actor: ResourceStaffActor, fileId: number) {
    const file = (await this.filesByIds([fileId]))[0];
    if (!file || !file.runId) return null;
    await this.requireEnabledRun(file.runId);
    await staffRun(this.pool, actor, file.runId);
    return file;
  }
  async registerStaffClone(actor:ResourceStaffActor,sourceId:number,sourceRunId:number,targetRunId:number,requestKey:string,storageKey:string) {
    await this.requireEnabledRun(sourceRunId);await this.requireEnabledRun(targetRunId);
    return resourceTransaction(this.pool,async sql => {
      await staffRun(sql,actor,sourceRunId);await staffRun(sql,actor,targetRunId);
      await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`file-copy:${actor.userId}:${requestKey}:${sourceId}:${targetRunId}`]);
      const existing = await resourceOne<Parameters<typeof fileDto>[0]>(sql,`SELECT file.* FROM lms_staff_file_copies receipt JOIN lms_files file ON file.id=receipt.file_id WHERE receipt.user_id=$1 AND receipt.request_key=$2 AND receipt.source_file_id=$3 AND receipt.target_run_id=$4 AND file.deleted_at IS NULL`,[actor.userId,requestKey,sourceId,targetRunId]);
      if (existing) { if(existing.state!=='ready')throw new PortalResourceError('portalFileNotReady',409);return {file:fileDto(existing),created:false}; }
      const source = await resourceOne<Parameters<typeof fileDto>[0] & {sha256:string}>(sql,'SELECT * FROM lms_files WHERE id=$1 AND run_id=$2 AND owner_user_id IS NOT NULL AND state=\'ready\' AND deleted_at IS NULL FOR SHARE',[sourceId,sourceRunId]);
      if(!source)throw new PortalResourceError('portalNotFound',404);
      await sql.query('SELECT pg_advisory_xact_lock(136036)');
      const used = await resourceOne<{totalBytes:number}>(sql,'SELECT COALESCE(sum(size_bytes),0) AS total_bytes FROM lms_files WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL');
      if(Number(used?.totalBytes ?? 0)+Number(source.sizeBytes)>this.quotas().schoolBytes)throw new PortalResourceError('portalFileQuotaExceeded',413);
      const file = await resourceOne<Parameters<typeof fileDto>[0]>(sql,'INSERT INTO lms_files(owner_user_id,run_id,name,mime,size_bytes,storage_key,sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[actor.userId,targetRunId,source.name,source.mime,source.sizeBytes,storageKey,source.sha256]);
      await sql.query('INSERT INTO lms_staff_file_copies(user_id,request_key,source_file_id,target_run_id,file_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,request_key,source_file_id,target_run_id) DO UPDATE SET file_id=EXCLUDED.file_id',[actor.userId,requestKey,sourceId,targetRunId,file!.id]);
      await resourceAudit(sql,actor,'file.copied','file',file!.id,{sourceId,sourceRunId,targetRunId});
      return {file:fileDto(file!),created:true};
    });
  }
  async completeStaffClone(fileId:number) { await this.pool.query("UPDATE lms_files SET state='ready',checked_at=now() WHERE id=$1 AND state='uploading' AND deleted_at IS NULL",[fileId]); }
  async discardUnusedFile(fileId:number) {
    const file = await resourceOne<Parameters<typeof fileDto>[0]>(this.pool,`UPDATE lms_files file SET deleted_at=now(),state='rejected',rejection_code='portalUploadFailed' WHERE id=$1 AND attached_at IS NULL AND deleted_at IS NULL
${unreferencedLearningFile} RETURNING *`,[fileId]);
    return file ? fileDto(file):null;
  }
  async finishUpload(fileId: number) { await this.pool.query("UPDATE lms_files SET state='checking',scan_after=now() WHERE id=$1 AND state='uploading'", [fileId]); }
  async removeFailedUpload(fileId: number) { await this.pool.query("UPDATE lms_files SET deleted_at=now(),state='rejected',rejection_code='portalUploadFailed' WHERE id=$1", [fileId]); }
  async scanningFiles(): Promise<ResourceScanClaim[]> {
    const values = await resourceRows<Parameters<typeof fileDto>[0] & { scanLease: string; sha256: string }>(this.pool, `WITH candidate AS (
      SELECT id FROM lms_files WHERE state='checking' AND scan_after<=clock_timestamp() AND deleted_at IS NULL
      ORDER BY scan_after,id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE lms_files file SET scan_after=clock_timestamp()+interval '3 minutes'
      FROM candidate WHERE file.id=candidate.id AND file.state='checking' AND file.deleted_at IS NULL
      RETURNING file.*,file.scan_after::text AS scan_lease`);
    return values.map(file => ({ file: fileDto(file), sha256: file.sha256, leaseToken: file.scanLease }));
  }
  async scanned(fileId: number, result: 'ready' | 'rejected' | 'retry', rejectionCode: string | undefined, leaseToken: string) {
    await this.pool.query(`UPDATE lms_files SET state=CASE WHEN $2='retry' THEN 'checking' ELSE $2 END,
      rejection_code=$3,scan_attempts=scan_attempts+1,checked_at=CASE WHEN $2='retry' THEN NULL ELSE now() END,
      scan_after=now()+interval '1 minute'*LEAST(30,power(2,LEAST(scan_attempts,5)))
      WHERE id=$1 AND deleted_at IS NULL AND state='checking' AND scan_after=$4::timestamptz AND scan_after>clock_timestamp()`,
      [fileId, result, rejectionCode ?? null, leaseToken]);
  }
  async cleanupFiles(): Promise<ResourceFile[]> {
    await this.pool.query(`UPDATE lms_files file SET deleted_at=now()
      WHERE attached_at IS NULL AND created_at<now()-interval '24 hours' AND deleted_at IS NULL
${unreferencedLearningFile}`);
    const values = await resourceRows<Parameters<typeof fileDto>[0]>(this.pool, `SELECT file.* FROM lms_files file
      WHERE deleted_at IS NOT NULL AND attached_at IS NULL AND created_at<now()-interval '24 hours'
${unreferencedLearningFile}
        AND NOT EXISTS(SELECT 1 FROM portal_access_audit receipt WHERE receipt.action='file.storage_removed' AND receipt.actor_kind='anonymous' AND receipt.details->>'fileId'=file.id::text)
      ORDER BY deleted_at,id LIMIT 100`);
    return values.map(fileDto);
  }
  async fileStorageRemoved(fileId: number) {
    await resourceTransaction(this.pool, async (sql) => {
      const file = await resourceOne<{ id: number; studentId: number | null }>(sql,
        "SELECT id,student_id FROM lms_files WHERE id=$1 AND deleted_at IS NOT NULL FOR UPDATE", [fileId]);
      if (!file) return;
      await sql.query(`INSERT INTO portal_access_audit(actor_kind,student_id,action,details)
        SELECT 'anonymous',$2,'file.storage_removed',jsonb_build_object('fileId',$1::bigint)
        WHERE NOT EXISTS(SELECT 1 FROM portal_access_audit WHERE actor_kind='anonymous' AND action='file.storage_removed' AND details->>'fileId'=$1::text)`,
        [fileId, file.studentId]);
    });
  }
  async payments(actor: PortalActorContext,cursor:number|null=null,limit=100): Promise<PortalPaymentsDto> {
    const student = await resourceOne<{ nextPaymentAt: string | null; unresolved: boolean }>(this.pool, `SELECT student.next_payment_at,
      EXISTS(SELECT 1 FROM academy_payments payment WHERE payment.lead_id=student.lead_id AND payment.student_id IS NULL
      AND (SELECT COALESCE(sum(allocation.amount_uzs),0) FROM academy_payment_student_allocations allocation WHERE allocation.payment_id=payment.id)<payment.amount_uzs) AS unresolved
      FROM academy_students student WHERE student.id=$1`, [actor.studentId]);
    const values = await resourceRows<PortalPaymentDto>(this.pool, `SELECT payment.id,COALESCE(allocation.amount_uzs,payment.amount_uzs) AS amount_uzs,payment.status,payment.method,payment.type,
      payment.period,payment.paid_at,payment.due_at,CASE WHEN allocation.payment_id IS NULL THEN payment.paid_until END AS paid_until
      FROM academy_payments payment LEFT JOIN academy_payment_student_allocations allocation ON allocation.payment_id=payment.id AND allocation.student_id=$1
      WHERE (allocation.student_id=$1 OR (payment.student_id=$1 AND NOT EXISTS(SELECT 1 FROM academy_payment_student_allocations any_allocation WHERE any_allocation.payment_id=payment.id)))
      AND ($2::integer IS NULL OR payment.id<$2) ORDER BY payment.id DESC LIMIT $3`, [actor.studentId,cursor,limit+1]);
    const items = values.map((payment) => ({ ...payment, amountUzs: Number(payment.amountUzs), status: getComputedPaymentStatus(payment.status, payment.dueAt) }));
    const totals = await resourceRows<{ status: string; dueAt: string | null; amountUzs: number; paidUntil: string | null }>(this.pool, `SELECT payment.status,payment.due_at,
      COALESCE(allocation.amount_uzs,payment.amount_uzs) AS amount_uzs,CASE WHEN allocation.payment_id IS NULL THEN payment.paid_until END AS paid_until
      FROM academy_payments payment LEFT JOIN academy_payment_student_allocations allocation ON allocation.payment_id=payment.id AND allocation.student_id=$1
      WHERE allocation.student_id=$1 OR (payment.student_id=$1 AND NOT EXISTS(SELECT 1 FROM academy_payment_student_allocations any_allocation WHERE any_allocation.payment_id=payment.id))`, [actor.studentId]);
    const summary = { paidUzs: 0, dueUzs: 0, refundedUzs: 0, paidUntil: null as string | null, nextPaymentAt: student?.nextPaymentAt ?? null };
    for (const payment of totals) {
      const status = getComputedPaymentStatus(payment.status, payment.dueAt), amount = Number(payment.amountUzs);
      if (status === 'paid') { summary.paidUzs += amount; if (payment.paidUntil && (!summary.paidUntil || payment.paidUntil > summary.paidUntil)) summary.paidUntil = payment.paidUntil; }
      else if (status === 'refunded') summary.refundedUzs += amount;
      else if (['pending', 'overdue'].includes(status)) summary.dueUzs += amount;
    }
    return {nextCursor:items.length>limit?items[limit-1].id:null,state: student?.unresolved ? 'needs_review' : 'ready', items:items.slice(0,limit), summary: student?.unresolved ? null : summary };
  }
  async notifications(accountId: number, cursor: number | null, limit: number): Promise<PortalNotificationPageDto> {
    const rows = await resourceRows<PortalNotificationDto>(this.pool, `SELECT notification.id,notification.link_id,notification.category,notification.code,notification.params,notification.href,notification.created_at,notification.read_at
      FROM portal_notifications notification WHERE notification.account_id=$1 AND ($2::bigint IS NULL OR notification.id<$2) AND ${visibleNotification} ORDER BY notification.id DESC LIMIT $3`, [accountId, cursor, limit + 1]);
    const unread = await resourceOne<{ count: number }>(this.pool, `SELECT count(*) FROM portal_notifications notification WHERE notification.account_id=$1 AND notification.read_at IS NULL AND ${visibleNotification}`, [accountId]);
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null, unreadCount: Number(unread?.count ?? 0) };
  }
  async readNotification(accountId: number, id: number | null) {
    await this.pool.query(`UPDATE portal_notifications notification SET read_at=COALESCE(read_at,now()) WHERE notification.account_id=$1 AND ($2::bigint IS NULL OR notification.id=$2) AND ${visibleNotification}`, [accountId, id]);
  }
  async preferences(accountId: number): Promise<PortalNotificationPreferencesDto> {
    const row = await resourceOne<{ categories: PortalNotificationPreferencesDto['categories']; weeklySummary: boolean }>(this.pool,
      "SELECT categories,weekly_summary FROM portal_notification_preferences WHERE account_id=$1", [accountId]);
    return row ? { ...row, categories: { ...defaultPreferences().categories, ...row.categories, security: { inApp: true } } } : defaultPreferences();
  }
  async savePreferences(accountId: number, preferences: PortalNotificationPreferencesDto) {
    const categories = { ...preferences.categories, security: { inApp: true } };
    await this.pool.query(`INSERT INTO portal_notification_preferences(account_id,categories,weekly_summary) VALUES($1,$2::jsonb,$3)
      ON CONFLICT(account_id) DO UPDATE SET categories=excluded.categories,weekly_summary=excluded.weekly_summary,updated_at=now()`, [accountId, JSON.stringify(categories), preferences.weeklySummary]);
  }
  async auditDownload(actor: PortalActorContext | null, fileId: number, shareId?: number, requestId?: string) {
    if (actor) await resourceAudit(this.pool, actor, 'file.downloaded', 'file', fileId);
    else if (shareId) await this.pool.query(`INSERT INTO portal_access_audit(actor_kind,action,request_id,details) VALUES('anonymous','portfolio.file_downloaded',$1,$2::jsonb)`, [requestId ?? null, JSON.stringify({ shareId, fileId })]);
  }
}

export const authorizeLmsFiles = async (sql: ResourceSql, actor: { portalAccountId?: number; userId?: number; studentId?: number }, fileIds: number[], context: { runId: number; recipientId?: number }) => {
  if (!fileIds.length) return;
  if (!actor.portalAccountId && !actor.userId) throw new PortalResourceError('portalAccessDenied',403);
  if (actor.userId && !await resourceOne(sql,`SELECT run.id FROM lms_group_runs run JOIN academy_groups g ON g.id=run.group_id JOIN users employee ON employee.id=$2
    WHERE run.id=$1 AND employee.is_active=true AND employee.is_archived=false AND (employee.module='administration'
    OR EXISTS(SELECT 1 FROM user_modules grant_row WHERE grant_row.user_id=employee.id AND grant_row.module='administration')
    OR EXISTS(SELECT 1 FROM academy_teachers teacher WHERE teacher.id=g.teacher_id AND teacher.user_id=employee.id AND teacher.status='active')
    OR EXISTS(SELECT 1 FROM lms_staff_permissions grant_row WHERE grant_row.user_id=employee.id AND grant_row.permission=ANY($3::text[])))`,[context.runId,actor.userId,['content.manage','assignments.manage','reviews.manage','quizzes.manage','communication.manage','announcements.manage','results.manage']])) throw new PortalResourceError('portalAccessDenied',403);
  const uniqueIds = [...new Set(fileIds)], files = await filesByIds(sql, uniqueIds);
  if (files.length !== uniqueIds.length || files.some((file) => file.state !== 'ready'
    || (actor.portalAccountId ? file.ownerAccountId !== actor.portalAccountId || file.studentId !== actor.studentId : file.ownerUserId === null)
    || (file.runId !== null && file.runId !== context.runId))) throw new PortalResourceError('portalFileNotReady', 409);
  await sql.query('UPDATE lms_files SET attached_at=COALESCE(attached_at,now()),run_id=COALESCE(run_id,$2),recipient_id=COALESCE(recipient_id,$3) WHERE id=ANY($1::bigint[])', [uniqueIds, context.runId, context.recipientId ?? null]);
};
