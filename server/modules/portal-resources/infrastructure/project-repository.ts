import type { Pool } from 'pg';
import type { PortalActorContext } from '../../portal-identity/domain/actor-context';
import type { PortalProjectDto, PortalProjectInput, PortalShareDto, PortalShareInput,PortalProjectComparisonInput } from '@shared/contracts/portal-resources';
import type { ResourceFile, ShareRecord,ComparisonRecord,ComparisonSnapshot } from '../application/ports';
import { PortalResourceError, requireResourceVersion, type ResourceStaffActor } from '../domain/policy';
import { resourceRows, resourceOne, resourceTransaction, resourceAudit, resourceCreationReceipt, checkResourceLink, type ResourceSql } from './sql';

type ProjectRow = Omit<PortalProjectDto, 'files' | 'shares'> & { fileIds: number[]; url: string | null;courseId:number|null };
type ShareRow = ShareRecord & { projectId: number; runId: number | null };
const projectColumns = `project.id,project.student_id,project.title,project.description,project.lms_run_id AS run_id,
  course.name AS course_name,course.id AS course_id,project.source_submission_id,project.links,project.file_ids,project.cover_file_id,
  project.teacher_review,project.portal_version AS version,project.created_at,project.updated_at,project.archived_at,project.url`;
const projectJoins = `FROM academy_portfolio_projects project LEFT JOIN lms_group_runs run ON run.id=project.lms_run_id
  LEFT JOIN academy_groups g ON g.id=COALESCE(run.group_id,project.group_id) LEFT JOIN academy_courses course ON course.id=COALESCE(g.course_id,project.course_id)`;
const shareColumns = `share.*, project.student_id,project.lms_run_id AS run_id`;
export const fileDto = (file: { id: number; name: string; mime: string; sizeBytes: number; state: ResourceFile['state']; storageKey: string; ownerAccountId: number | null; ownerUserId: number | null; studentId: number | null; runId: number | null; createdAt: string; rejectionCode: string | null; courseId?: number | null; purpose?: 'learning' | 'course_material' }): ResourceFile => ({
  ...file, size: file.sizeBytes, downloadUrl: file.state === 'ready' ? `/api/portal/files/${file.id}/download` : null,
});
export const filesByIds = async (sql: ResourceSql, ids: number[]): Promise<ResourceFile[]> => {
  if (!ids.length) return [];
  const values = await resourceRows<Parameters<typeof fileDto>[0]>(sql, 'SELECT * FROM lms_files WHERE id=ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id', [ids]);
  return values.map(fileDto);
};
const shareDto = (row: ShareRow): ShareRecord => ({ ...row, displayName: row.snapshot.displayName,
  includeDescription: row.snapshot.description !== null, includeReview: row.snapshot.teacherReview !== null,
  fileIds: row.snapshot.fileIds, publicUrl: null,
  preview: { title: row.snapshot.title, description: row.snapshot.description, teacherReview: row.snapshot.teacherReview, links: row.snapshot.links, files: [], coverFileId: row.snapshot.coverFileId } });
const decorate = async (sql: ResourceSql, rows: ProjectRow[]): Promise<PortalProjectDto[]> => Promise.all(rows.map(async (row) => ({
  ...row, links: row.links.length ? row.links : row.url?.startsWith('https://') ? [row.url] : [],
  files: await filesByIds(sql, row.fileIds), shares: (await resourceRows<ShareRow>(sql, `SELECT ${shareColumns} FROM lms_portfolio_shares share JOIN academy_portfolio_projects project ON project.id=share.project_id WHERE share.project_id=$1 ORDER BY share.id DESC`, [row.id])).map(shareDto),
})));
const requireStaffProject = async (sql: ResourceSql, actor: ResourceStaffActor, projectId: number) => {
  const granted = await resourceOne(sql,"SELECT user_id FROM lms_staff_permissions WHERE user_id=$1 AND permission='portfolio.moderate'",[actor.userId]);
  if (!actor.isLeadership && !actor.modules.includes('teacher') && !granted) throw new PortalResourceError('portalAccessDenied', 403);
  const project = await resourceOne<{ id: number; studentId: number }>(sql, `SELECT project.id,project.student_id FROM academy_portfolio_projects project
    WHERE project.id=$1 AND ($2 OR EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment
    JOIN academy_groups g ON g.id=enrollment.group_id JOIN academy_teachers teacher ON teacher.id=g.teacher_id
    WHERE enrollment.student_id=project.student_id AND teacher.user_id=$3 AND teacher.status='active' AND enrollment.status='active'
    AND (project.lms_run_id IS NULL OR g.id=(SELECT group_id FROM lms_group_runs WHERE id=project.lms_run_id))
    AND (project.group_id IS NULL OR g.id=project.group_id)))`, [projectId, actor.isLeadership || Boolean(granted), actor.userId]);
  if (!project) throw new PortalResourceError('portalNotFound', 404);
  return project;
};
export class ProjectRepository {
  constructor(protected readonly pool: Pool, private readonly enabledForGroup: (groupId: number) => Promise<boolean> = async () => false,
    private readonly verifiedProject?: (sql: ResourceSql, studentId: number, runId: number, projectId: number) => Promise<void>) {}
  protected async runEnabled(runId: number | null, sql: ResourceSql = this.pool): Promise<boolean> {
    if (runId === null) return true;
    const run = await resourceOne<{ groupId: number }>(sql, 'SELECT group_id FROM lms_group_runs WHERE id=$1', [runId]);
    return Boolean(run && await this.enabledForGroup(run.groupId));
  }
  protected async requireEnabledRun(runId: number | null, sql: ResourceSql = this.pool) {
    if (!await this.runEnabled(runId, sql)) throw new PortalResourceError('portalNotFound', 404);
  }
  async projectComparison(studentId:number,runId:number|null):Promise<ComparisonRecord|null> {
    await this.requireEnabledRun(runId);
    return resourceOne<ComparisonRecord>(this.pool,'SELECT first_project_id,latest_project_id,run_id,selected_by_name,selected_by_role,version,updated_at,first_snapshot,latest_snapshot FROM lms_project_comparisons WHERE student_id=$1 AND run_id IS NOT DISTINCT FROM $2',[studentId,runId]);
  }
  private async comparisonProjects(sql:ResourceSql,studentId:number,input:PortalProjectComparisonInput) {
    const values = await resourceRows<ProjectRow>(sql,`SELECT ${projectColumns} ${projectJoins} WHERE project.id=ANY($1::integer[]) AND project.student_id=$2 AND project.archived_at IS NULL AND ($3::bigint IS NULL OR project.lms_run_id=$3)`,[[input.firstProjectId,input.latestProjectId],studentId,input.runId]);
    if (values.length !== 2) throw new PortalResourceError('portalNotFound',404);
    if (values[0].courseId===null || values[0].courseId!==values[1].courseId) throw new PortalResourceError('portalInvalidData');
    for (const value of values) await this.requireEnabledRun(value.runId, sql);
    const snapshot = (value:ProjectRow):ComparisonSnapshot => ({id:value.id,title:value.title,description:value.description,links:value.links,fileIds:value.fileIds,teacherReview:value.teacherReview,coverFileId:value.coverFileId,version:value.version});
    return {first:snapshot(values.find(value => value.id===input.firstProjectId)!),latest:snapshot(values.find(value => value.id===input.latestProjectId)!)};
  }
  private async saveComparison(sql:ResourceSql,studentId:number,input:PortalProjectComparisonInput,author:{accountId:number|null;userId:number|null;name:string;role:ComparisonRecord['selectedByRole'];requestId?:string}) {
    await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`project-comparison:${studentId}:${input.runId ?? 'all'}`]);
    const existing = await resourceOne<{version:number}>(sql,'SELECT version FROM lms_project_comparisons WHERE student_id=$1 AND run_id IS NOT DISTINCT FROM $2 FOR UPDATE',[studentId,input.runId]);
    if ((existing?.version ?? 0)!==input.version) throw new PortalResourceError('portalVersionConflict',409);
    const selected = await this.comparisonProjects(sql,studentId,input);
    await sql.query(`INSERT INTO lms_project_comparisons(student_id,run_id,first_project_id,latest_project_id,first_snapshot,latest_snapshot,selected_by_account,selected_by_user,selected_by_name,selected_by_role)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10) ON CONFLICT(student_id,run_id) DO UPDATE SET first_project_id=EXCLUDED.first_project_id,latest_project_id=EXCLUDED.latest_project_id,first_snapshot=EXCLUDED.first_snapshot,latest_snapshot=EXCLUDED.latest_snapshot,selected_by_account=EXCLUDED.selected_by_account,selected_by_user=EXCLUDED.selected_by_user,selected_by_name=EXCLUDED.selected_by_name,selected_by_role=EXCLUDED.selected_by_role,version=lms_project_comparisons.version+1,updated_at=now()`,[studentId,input.runId,input.firstProjectId,input.latestProjectId,JSON.stringify(selected.first),JSON.stringify(selected.latest),author.accountId,author.userId,author.name,author.role]);
    await resourceAudit(sql,{studentId,portalAccountId:author.accountId ?? undefined,userId:author.userId ?? undefined,requestId:author.requestId},'project.comparison_selected','student',studentId,{runId:input.runId,firstProjectId:input.firstProjectId,latestProjectId:input.latestProjectId});
  }
  async saveProjectComparison(actor:PortalActorContext,input:PortalProjectComparisonInput) {
    await this.requireEnabledRun(input.runId);
    await resourceTransaction(this.pool,async sql => {
      await checkResourceLink(sql,actor,'portfolio.edit');
      const author = await resourceOne<{fullName:string}>(sql,'SELECT full_name FROM portal_accounts WHERE id=$1',[actor.portalAccountId]);
      await this.saveComparison(sql,actor.studentId,input,{accountId:actor.portalAccountId,userId:null,name:author!.fullName,role:'student',requestId:actor.requestId});
    }); return (await this.projectComparison(actor.studentId,input.runId))!;
  }
  private async comparisonStaffScope(actor:ResourceStaffActor,studentId:number,runId:number) {
    await this.requireEnabledRun(runId);
    const granted = await resourceOne(this.pool,"SELECT user_id FROM lms_staff_permissions WHERE user_id=$1 AND permission='results.manage'",[actor.userId]);
    if (!await resourceOne(this.pool,`SELECT enrollment.id FROM academy_student_group_enrollments enrollment JOIN lms_group_runs run ON run.group_id=enrollment.group_id JOIN academy_groups g ON g.id=run.group_id LEFT JOIN academy_teachers teacher ON teacher.id=g.teacher_id WHERE run.id=$1 AND enrollment.student_id=$2 AND ($3 OR (teacher.user_id=$4 AND teacher.status='active'))`,[runId,studentId,actor.isLeadership || Boolean(granted),actor.userId])) throw new PortalResourceError('portalNotFound',404);
  }
  async staffProjectComparison(actor:ResourceStaffActor,studentId:number,runId:number) { await this.comparisonStaffScope(actor,studentId,runId); return this.projectComparison(studentId,runId); }
  async staffProjects(actor:ResourceStaffActor,studentId:number,runId:number,verified=false) {
    await this.comparisonStaffScope(actor,studentId,runId);
    return decorate(this.pool,await resourceRows<ProjectRow>(this.pool,`SELECT ${projectColumns} ${projectJoins} WHERE project.student_id=$1 AND project.lms_run_id=$2 AND project.archived_at IS NULL AND (NOT $3 OR project.teacher_review IS NOT NULL OR EXISTS(SELECT 1 FROM lms_reviews review JOIN lms_submissions submission ON submission.id=review.submission_id WHERE submission.id=project.source_submission_id AND submission.withdrawn_at IS NULL AND review.decision='accepted' AND review.id=(SELECT max(latest.id) FROM lms_reviews latest WHERE latest.submission_id=submission.id))) ORDER BY project.id DESC LIMIT 100`,[studentId,runId,verified]));
  }
  async saveStaffProjectComparison(actor:ResourceStaffActor,studentId:number,input:PortalProjectComparisonInput) {
    if (input.runId === null) throw new PortalResourceError('portalInvalidData');
    await this.comparisonStaffScope(actor,studentId,input.runId);
    await resourceTransaction(this.pool,async sql => {
      const author = await resourceOne<{fullName:string}>(sql,'SELECT full_name FROM users WHERE id=$1',[actor.userId]);
      await this.saveComparison(sql,studentId,input,{accountId:null,userId:actor.userId,name:author!.fullName,role:actor.modules.includes('teacher') ? 'teacher':'staff',requestId:actor.requestId});
    }); return (await this.projectComparison(studentId,input.runId))!;
  }
  async listProjects(actor:PortalActorContext,cursor:number|null=null,limit=100) {
    const allowed:ProjectRow[]=[];
    let after=cursor;
    while(allowed.length<limit){
      const rows=await resourceRows<ProjectRow>(this.pool,`SELECT ${projectColumns} ${projectJoins} WHERE project.student_id=$1 AND project.archived_at IS NULL
        AND ($2 OR EXISTS(SELECT 1 FROM lms_portfolio_shares share WHERE share.project_id=project.id AND share.status='awaiting_approval'))
        AND ($3::integer IS NULL OR project.id<$3) ORDER BY project.id DESC LIMIT 100`,[actor.studentId,actor.kind==='self' || actor.permissions.includes('learning.read'),after]);
      for(const row of rows){if(await this.runEnabled(row.runId))allowed.push(row);if(allowed.length===limit)break;}
      if(rows.length<100 || allowed.length===limit)break;
      after=rows[rows.length-1].id;
    }
    return decorate(this.pool,allowed);
  }
  async project(actor: PortalActorContext, projectId: number) {
    const row = await resourceOne<ProjectRow>(this.pool, `SELECT ${projectColumns} ${projectJoins} WHERE project.id=$1 AND project.student_id=$2 AND project.archived_at IS NULL`, [projectId, actor.studentId]);
    return row && await this.runEnabled(row.runId) ? (await decorate(this.pool, [row]))[0] : null;
  }
  async saveProject(actor: PortalActorContext, projectId: number | null, input: PortalProjectInput): Promise<PortalProjectDto> {
    await this.requireEnabledRun(input.runId);
    const savedId = await resourceTransaction(this.pool, async (sql) => {
      await checkResourceLink(sql, actor, 'portfolio.edit');
      const receipt = projectId === null ? await resourceCreationReceipt(sql, actor, 'project.created', input.idempotencyKey, input) : { entityId: null, changes: {} };
      if (receipt.entityId !== null) {
        if (!await resourceOne(sql, 'SELECT id FROM academy_portfolio_projects WHERE id=$1 AND student_id=$2 AND archived_at IS NULL', [receipt.entityId, actor.studentId])) throw new PortalResourceError('portalNotFound', 404);
        return receipt.entityId;
      }
      if (input.runId && !await resourceOne(sql, `SELECT run.id FROM lms_group_runs run JOIN academy_student_group_enrollments enrollment ON enrollment.group_id=run.group_id WHERE run.id=$1 AND enrollment.student_id=$2`, [input.runId, actor.studentId])) throw new PortalResourceError('portalNotFound', 404);
      if (input.sourceSubmissionId && !await resourceOne(sql, `SELECT submission.id FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id
        JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE submission.id=$1 AND recipient.student_id=$2 AND submission.withdrawn_at IS NULL
        AND ($3::bigint IS NULL OR assignment.run_id=$3) AND EXISTS(SELECT 1 FROM lms_reviews review WHERE review.submission_id=submission.id AND review.decision='accepted'
        AND review.id=(SELECT max(latest.id) FROM lms_reviews latest WHERE latest.submission_id=submission.id))`, [input.sourceSubmissionId, actor.studentId, input.runId])) throw new PortalResourceError('portalNotFound', 404);
      const fileIds = [...new Set([...input.fileIds, ...(input.coverFileId ? [input.coverFileId] : [])])];
      const files = await filesByIds(sql, fileIds);
      if (files.length !== fileIds.length || files.some((file) => file.state !== 'ready' || file.studentId !== actor.studentId || file.ownerAccountId !== actor.portalAccountId || (file.runId!==null && input.runId!==null && file.runId!==input.runId))) throw new PortalResourceError('portalFileNotReady', 409);
      if (input.coverFileId && !files.some((file) => file.id === input.coverFileId && ['image/png', 'image/jpeg', 'image/webp'].includes(file.mime))) throw new PortalResourceError('portalInvalidData');
      const values = [input.title, input.description, input.runId, input.sourceSubmissionId, JSON.stringify(input.links), JSON.stringify(input.fileIds), input.coverFileId];
      const record = projectId === null
        ? await resourceOne<{ id: number }>(sql, `INSERT INTO academy_portfolio_projects(student_id,title,description,lms_run_id,source_submission_id,links,file_ids,cover_file_id,group_id,course_id,url,portal_created)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,(SELECT group_id FROM lms_group_runs WHERE id=$4),(SELECT g.course_id FROM lms_group_runs run JOIN academy_groups g ON g.id=run.group_id WHERE run.id=$4),$9,true) RETURNING id`, [actor.studentId, ...values, input.links[0] ?? null])
        : await resourceOne<{ id: number }>(sql, `UPDATE academy_portfolio_projects SET title=$1,description=$2,lms_run_id=$3,source_submission_id=$4,links=$5::jsonb,file_ids=$6::jsonb,cover_file_id=$7,portal_version=portal_version+1,updated_at=now(),url=$11,portal_created=true,
          group_id=COALESCE((SELECT group_id FROM lms_group_runs WHERE id=$3),group_id),course_id=COALESCE((SELECT g.course_id FROM lms_group_runs run JOIN academy_groups g ON g.id=run.group_id WHERE run.id=$3),course_id)
          WHERE id=$8 AND student_id=$9 AND portal_version=$10 AND archived_at IS NULL RETURNING id`, [...values, projectId, actor.studentId, input.version, input.links[0] ?? null]);
      if (!record) throw new PortalResourceError('portalVersionConflict', 409);
      await sql.query('UPDATE lms_files SET attached_at=COALESCE(attached_at,now()),run_id=COALESCE(run_id,$2) WHERE id=ANY($1::bigint[])', [fileIds,input.runId]);
      await resourceAudit(sql, actor, projectId === null ? 'project.created' : 'project.updated', 'project', record.id, receipt.changes);
      if (input.sourceSubmissionId && input.runId) await this.verifiedProject?.(sql,actor.studentId,input.runId,record.id);
      return record.id;
    });
    return (await this.project(actor, savedId))!;
  }
  async projectSource(actor: PortalActorContext, submissionId: number): Promise<PortalProjectInput | null> {
    const source = await resourceOne<{ title: string; text: string; links: string[]; fileIds: number[]; runId: number }>(this.pool, `SELECT version.title,submission.text,submission.links,submission.file_ids,assignment.run_id
      FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id
      JOIN lms_assignment_versions version ON version.id=submission.assignment_version_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id
      WHERE submission.id=$1 AND recipient.student_id=$2 AND submission.withdrawn_at IS NULL
      AND EXISTS(SELECT 1 FROM lms_reviews review WHERE review.submission_id=submission.id AND review.decision='accepted' AND review.id=(SELECT max(latest.id) FROM lms_reviews latest WHERE latest.submission_id=submission.id))`, [submissionId, actor.studentId]);
    return source && await this.runEnabled(source.runId) ? { title: source.title, description: source.text, runId: source.runId, sourceSubmissionId: submissionId, links: source.links, fileIds: source.fileIds, coverFileId: null, version: 0 } : null;
  }
  async archiveProject(actor: PortalActorContext, projectId: number) {
    if (!await this.project(actor, projectId)) throw new PortalResourceError('portalNotFound', 404);
    await resourceTransaction(this.pool, async (sql) => {
      await checkResourceLink(sql, actor, 'portfolio.edit');
      const project = await resourceOne(sql, `UPDATE academy_portfolio_projects SET archived_at=now(),portal_created=true,portal_version=portal_version+1 WHERE id=$1 AND student_id=$2 AND archived_at IS NULL RETURNING id`, [projectId, actor.studentId]);
      if (!project) throw new PortalResourceError('portalNotFound', 404);
      await sql.query("UPDATE lms_portfolio_shares SET status='revoked',revoked_at=now(),version=version+1 WHERE project_id=$1 AND status<>'revoked'", [projectId]);
      await resourceAudit(sql, actor, 'project.archived', 'project', projectId);
    });
  }
  async createShare(actor: PortalActorContext, projectId: number, input: PortalShareInput, tokenHash: string, tokenEnvelope: string): Promise<ShareRecord> {
    if (!await this.project(actor, projectId)) throw new PortalResourceError('portalNotFound', 404);
    const shareId = await resourceTransaction(this.pool, async (sql) => {
      await checkResourceLink(sql, actor, 'portfolio.edit');
      const receipt = await resourceCreationReceipt(sql, actor, 'portfolio.share_requested', input.idempotencyKey, { ...input, projectId });
      if (receipt.entityId !== null) return receipt.entityId;
      const project = await resourceOne<ProjectRow>(sql, `SELECT ${projectColumns} ${projectJoins} WHERE project.id=$1 AND project.student_id=$2 AND project.archived_at IS NULL FOR UPDATE OF project`, [projectId, actor.studentId]);
      if (!project) throw new PortalResourceError('portalNotFound', 404);
      requireResourceVersion(project.version, input.projectVersion);
      if (input.fileIds.some((id) => !project.fileIds.includes(id))) throw new PortalResourceError('portalInvalidData');
      const files = await filesByIds(sql, input.fileIds);
      if (files.length !== input.fileIds.length || files.some((file) => file.state !== 'ready')) throw new PortalResourceError('portalFileNotReady', 409);
      const snapshot: ShareRecord['snapshot'] = { title: project.title, displayName: input.displayName, description: input.includeDescription ? project.description : null,
        teacherReview: input.includeReview ? project.teacherReview : null, links: project.links, fileIds: input.fileIds,
        coverFileId: project.coverFileId && input.fileIds.includes(project.coverFileId) ? project.coverFileId : null };
      const published = actor.studentClassification === 'adult';
      const share = await resourceOne<{ id: number }>(sql, `INSERT INTO lms_portfolio_shares(project_id,project_version,token_hash,token_envelope,status,snapshot,requested_by,expires_at,published_at,student_classification)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,CASE WHEN $9 THEN now() END,$10) RETURNING id`, [projectId, project.version, tokenHash, tokenEnvelope, published ? 'published' : 'awaiting_approval', JSON.stringify(snapshot), actor.portalAccountId, input.expiresAt, published, actor.studentClassification]);
      await resourceAudit(sql, actor, 'portfolio.share_requested', 'share', share!.id, { projectVersion: project.version, ...receipt.changes });
      return share!.id;
    });
    return (await this.share(actor, shareId))!;
  }
  async share(actor: PortalActorContext, shareId: number): Promise<ShareRecord | null> {
    const row = await resourceOne<ShareRow>(this.pool, `SELECT ${shareColumns} FROM lms_portfolio_shares share JOIN academy_portfolio_projects project ON project.id=share.project_id WHERE share.id=$1 AND project.student_id=$2`, [shareId, actor.studentId]);
    return row && await this.runEnabled(row.runId) ? shareDto(row) : null;
  }
  async approveShare(actor: PortalActorContext, shareId: number, version: number, approved: boolean): Promise<ShareRecord> {
    if (!await this.share(actor, shareId)) throw new PortalResourceError('portalNotFound', 404);
    await resourceTransaction(this.pool, async (sql) => {
      await checkResourceLink(sql, actor, 'portfolio.approve');
      const result = await resourceOne(sql, `UPDATE lms_portfolio_shares share SET status=$1,approved_by=$2,approved_at=now(),version=version+1
        FROM academy_portfolio_projects project WHERE share.project_id=project.id AND project.student_id=$3 AND share.id=$4 AND share.version=$5 AND share.status='awaiting_approval' RETURNING share.id`, [approved ? 'awaiting_moderation' : 'rejected', actor.portalAccountId, actor.studentId, shareId, version]);
      if (!result) throw new PortalResourceError('portalVersionConflict', 409);
      await resourceAudit(sql, actor, approved ? 'portfolio.approved' : 'portfolio.rejected', 'share', shareId);
    });
    return (await this.share(actor, shareId))!;
  }
  async revokeShare(actor: PortalActorContext, shareId: number) {
    if (!await this.share(actor, shareId)) throw new PortalResourceError('portalNotFound', 404);
    await resourceTransaction(this.pool, async (sql) => {
      await checkResourceLink(sql, actor, actor.kind === 'self' ? 'portfolio.edit' : 'portfolio.approve');
      const result = await resourceOne(sql, `UPDATE lms_portfolio_shares share SET status='revoked',revoked_at=now(),version=version+1 FROM academy_portfolio_projects project
        WHERE share.project_id=project.id AND project.student_id=$1 AND share.id=$2 AND share.status<>'revoked' RETURNING share.id`, [actor.studentId, shareId]);
      if (!result) throw new PortalResourceError('portalNotFound', 404);
      await resourceAudit(sql, actor, 'portfolio.revoked', 'share', shareId);
    });
  }
  async publicShare(tokenHash: string): Promise<ShareRecord | null> {
    const row = await resourceOne<ShareRow>(this.pool, `SELECT ${shareColumns} FROM lms_portfolio_shares share JOIN academy_portfolio_projects project ON project.id=share.project_id
      JOIN portal_student_identity identity ON identity.student_id=project.student_id
      WHERE share.token_hash=$1 AND share.status='published' AND (share.expires_at IS NULL OR share.expires_at>now()) AND project.archived_at IS NULL
      AND identity.classification=share.student_classification
      AND EXISTS(SELECT 1 FROM portal_student_links owner_link JOIN portal_accounts owner_account ON owner_account.id=owner_link.account_id
        WHERE owner_link.account_id=share.requested_by AND owner_link.student_id=project.student_id AND owner_link.kind='self' AND owner_link.status='active' AND owner_account.status='active'
        AND (owner_link.expires_at IS NULL OR owner_link.expires_at>now()))
      AND (share.student_classification='adult' OR EXISTS(SELECT 1 FROM portal_student_links guardian_link JOIN portal_accounts guardian_account ON guardian_account.id=guardian_link.account_id
        WHERE guardian_link.account_id=share.approved_by AND guardian_link.student_id=project.student_id AND guardian_link.status='active' AND guardian_account.status='active'
        AND guardian_link.permissions ? 'portfolio.approve' AND (guardian_link.expires_at IS NULL OR guardian_link.expires_at>now())))`, [tokenHash]);
    return row && await this.runEnabled(row.runId) ? shareDto(row) : null;
  }
  async pendingShares(actor: ResourceStaffActor): Promise<(ShareRecord & { studentName: string })[]> {
    const granted = await resourceOne(this.pool,"SELECT user_id FROM lms_staff_permissions WHERE user_id=$1 AND permission='portfolio.moderate'",[actor.userId]);
    if (!actor.isLeadership && !actor.modules.includes('teacher') && !granted) throw new PortalResourceError('portalAccessDenied', 403);
    const values = await resourceRows<ShareRow & { studentName: string }>(this.pool, `SELECT ${shareColumns},COALESCE(student.student_name,student.contact_name) AS student_name FROM lms_portfolio_shares share
      JOIN academy_portfolio_projects project ON project.id=share.project_id JOIN academy_students student ON student.id=project.student_id
      WHERE share.status='awaiting_moderation' AND ($1 OR EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment JOIN academy_groups g ON g.id=enrollment.group_id
      JOIN academy_teachers teacher ON teacher.id=g.teacher_id WHERE enrollment.student_id=project.student_id AND enrollment.status='active' AND teacher.user_id=$2 AND teacher.status='active'
      AND (project.lms_run_id IS NULL OR g.id=(SELECT group_id FROM lms_group_runs WHERE id=project.lms_run_id)) AND (project.group_id IS NULL OR g.id=project.group_id))) ORDER BY share.created_at LIMIT 100`, [actor.isLeadership || Boolean(granted), actor.userId]);
    const allowed: (ShareRecord & { studentName: string })[] = [];
    for (const value of values) if (await this.runEnabled(value.runId)) allowed.push({ ...shareDto(value), studentName: value.studentName });
    return allowed;
  }
  async moderateShare(actor: ResourceStaffActor, shareId: number, version: number, approved: boolean): Promise<ShareRecord> {
    return resourceTransaction(this.pool, async (sql) => {
      const existing = await resourceOne<ShareRow>(sql, `SELECT ${shareColumns} FROM lms_portfolio_shares share JOIN academy_portfolio_projects project ON project.id=share.project_id WHERE share.id=$1 FOR UPDATE OF share`, [shareId]);
      if (!existing) throw new PortalResourceError('portalNotFound', 404);
      await this.requireEnabledRun(existing.runId, sql);
      await requireStaffProject(sql, actor, existing.projectId);
      requireResourceVersion(existing.version, version);
      if (existing.status !== 'awaiting_moderation') throw new PortalResourceError('portalVersionConflict', 409);
      const row = await resourceOne<ShareRow>(sql, `UPDATE lms_portfolio_shares SET status=$1,moderated_by=$2,moderated_at=now(),published_at=CASE WHEN $3 THEN now() END,version=version+1 WHERE id=$4 RETURNING *, $5::integer AS student_id`, [approved ? 'published' : 'rejected', actor.userId, approved, shareId, existing.studentId]);
      await resourceAudit(sql, { ...actor, studentId: existing.studentId }, approved ? 'portfolio.published' : 'portfolio.rejected', 'share', shareId);
      return shareDto(row!);
    });
  }
  async reviewProject(actor: ResourceStaffActor, projectId: number, version: number, review: string) {
    const context = await resourceOne<{ runId: number | null }>(this.pool, 'SELECT lms_run_id AS run_id FROM academy_portfolio_projects WHERE id=$1', [projectId]);
    if (!context) throw new PortalResourceError('portalNotFound', 404);
    await this.requireEnabledRun(context.runId);
    await resourceTransaction(this.pool, async (sql) => {
      const project = await requireStaffProject(sql, actor, projectId);
      const result = await resourceOne(sql, `UPDATE academy_portfolio_projects SET teacher_review=$1,reviewed_by=$2,portal_version=portal_version+1,updated_at=now() WHERE id=$3 AND portal_version=$4 RETURNING id`, [review, actor.userId, projectId, version]);
      if (!result) throw new PortalResourceError('portalVersionConflict', 409);
      await resourceAudit(sql, { ...actor, studentId: project.studentId }, 'project.reviewed', 'project', projectId);
    });
  }
}

export async function reportProjectSnapshots(sql:ResourceSql,_actor:ResourceStaffActor,runId:number,studentId:number,ids:number[]) {
  if(!ids.length)return [];
  const projects = await resourceRows<ProjectRow>(sql,`SELECT ${projectColumns} ${projectJoins} WHERE project.id=ANY($1::integer[]) AND project.student_id=$2 AND project.lms_run_id=$3 AND project.archived_at IS NULL
    AND (project.teacher_review IS NOT NULL OR EXISTS(SELECT 1 FROM lms_reviews review JOIN lms_submissions submission ON submission.id=review.submission_id WHERE submission.id=project.source_submission_id AND submission.withdrawn_at IS NULL AND review.decision='accepted' AND review.id=(SELECT max(latest.id) FROM lms_reviews latest WHERE latest.submission_id=submission.id)))`,[ids,studentId,runId]);
  if(projects.length!==new Set(ids).size)throw new PortalResourceError('portalNotFound',404);
  for(const project of projects){const files=await filesByIds(sql,project.fileIds);if(files.length!==project.fileIds.length || files.some(file => file.state!=='ready'))throw new PortalResourceError('portalFileNotReady',409);}
  return projects.map(project=>({id:project.id,title:project.title,description:project.description,fileIds:project.fileIds,links:project.links,review:project.teacherReview ?? ''}));
}
