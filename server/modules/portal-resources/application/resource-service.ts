import type { PortalActorContext } from '../../portal-identity/domain/actor-context';
import type {
  PortalFileDto, PortalProjectDto, PortalProjectInput, PortalShareDto, PortalShareInput,
  PortalPublicProjectDto, PortalNotificationPreferencesDto, PortalPaymentAllocationInput,
  PortalFinanceQuestionInput,
  PortalProjectComparisonInput,PortalProjectComparisonDto,PortalComparisonProjectDto,
} from '@shared/contracts/portal-resources';
import type { PortalResourceRepository, ResourceFile, ResourceFileStore, ResourceTokenCodec, ShareRecord,ComparisonRecord,ComparisonSnapshot } from './ports';
import { PortalResourceError, requireFinanceRead, requireResourcePermission, requireShareCreation, type ResourceStaffActor } from '../domain/policy';

export const presentPortalFile = (file: ResourceFile, linkId?: number, staff = false): PortalFileDto => ({
  id: file.id, name: file.name, mime: file.mime, size: file.size, state: file.state, createdAt: file.createdAt,
  rejectionCode: file.rejectionCode,
  downloadUrl: file.state === 'ready' ? staff ? `/api/lms-management/files/${file.id}/download` : linkId ? `/api/portal/files/${file.id}/download?linkId=${linkId}` : null : null,
});
export class PortalResourceService {
  constructor(private readonly repository: PortalResourceRepository, private readonly store: ResourceFileStore,
    private readonly tokens: ResourceTokenCodec, private readonly options: { appUrl: string; publicPortfolioEnabled: (studentId?: number) => boolean | Promise<boolean>; maxFileBytes?: () => number }) {}
  private authorizeProjects(actor: PortalActorContext) {
    if (!actor.permissions.some((permission) => ['learning.read', 'portfolio.edit', 'portfolio.approve'].includes(permission))) throw new PortalResourceError('portalAccessDenied', 403);
  }
  private async presentComparison(record:ComparisonRecord|null,actor?:PortalActorContext):Promise<PortalProjectComparisonDto|null> {
    if (!record) return null;
    const snapshot = async (value:ComparisonSnapshot):Promise<PortalComparisonProjectDto> => ({id:value.id,title:value.title,description:value.description,links:value.links,coverFileId:value.coverFileId,version:value.version,
      teacherReview:!actor || actor.permissions.includes('feedback.read') ? value.teacherReview:null,files:(await this.repository.filesByIds(value.fileIds)).map(file => presentPortalFile(file,actor?.linkId,!actor))});
    return {firstProjectId:record.firstProjectId,latestProjectId:record.latestProjectId,runId:record.runId,selectedByName:record.selectedByName,selectedByRole:record.selectedByRole,version:record.version,updatedAt:record.updatedAt,firstProject:await snapshot(record.firstSnapshot),latestProject:await snapshot(record.latestSnapshot)};
  }
  async projectComparison(actor:PortalActorContext,runId:number|null) { requireResourcePermission(actor,'learning.read'); return this.presentComparison(await this.repository.projectComparison(actor.studentId,runId),actor); }
  async saveProjectComparison(actor:PortalActorContext,input:PortalProjectComparisonInput) { requireResourcePermission(actor,'portfolio.edit',true); return this.presentComparison(await this.repository.saveProjectComparison(actor,input),actor); }
  async staffProjectComparison(actor:ResourceStaffActor,studentId:number,runId:number) { return this.presentComparison(await this.repository.staffProjectComparison(actor,studentId,runId)); }
  async staffProjects(actor:ResourceStaffActor,studentId:number,runId:number,verified=false) {
    return Promise.all((await this.repository.staffProjects(actor,studentId,runId,verified)).map(async project => ({id:project.id,studentId:project.studentId,title:project.title,description:project.description,runId:project.runId,courseName:project.courseName,sourceSubmissionId:project.sourceSubmissionId,links:project.links,
      files:project.files.map(file=>presentPortalFile(file as ResourceFile,undefined,true)),coverFileId:project.coverFileId,teacherReview:project.teacherReview,version:project.version,createdAt:project.createdAt,updatedAt:project.updatedAt,archivedAt:project.archivedAt,
      shares:await Promise.all(project.shares.map(share=>this.presentShare(share as ShareRecord)))})));
  }
  async saveStaffProjectComparison(actor:ResourceStaffActor,studentId:number,input:PortalProjectComparisonInput) { return this.presentComparison(await this.repository.saveStaffProjectComparison(actor,studentId,input)); }
  private async presentShare(share: ShareRecord, actor?: PortalActorContext): Promise<PortalShareDto> {
    const files = await this.repository.filesByIds(share.snapshot.fileIds);
    return {
      id: share.id, projectId: share.projectId, projectVersion: share.projectVersion, version: share.version, status: share.status,
      displayName: share.snapshot.displayName, includeDescription: share.snapshot.description !== null, includeReview: share.snapshot.teacherReview !== null,
      fileIds: share.snapshot.fileIds, expiresAt: share.expiresAt, createdAt: share.createdAt, publishedAt: share.publishedAt, revokedAt: share.revokedAt,
      publicUrl: share.status === 'published' && await this.options.publicPortfolioEnabled(share.studentId) ? `${this.options.appUrl}/portfolio/p/${this.tokens.open(share.tokenEnvelope)}` : null,
      preview: { title: share.snapshot.title, description: share.snapshot.description, teacherReview: share.snapshot.teacherReview, links: share.snapshot.links,
        files: files.map((file) => presentPortalFile(file, actor?.linkId, !actor)), coverFileId: share.snapshot.coverFileId },
    };
  }
  private async presentProject(project: PortalProjectDto, actor: PortalActorContext): Promise<PortalProjectDto> {
    const shares = await Promise.all(project.shares.map(async (share) => {
      const record = await this.repository.share(actor, share.id);
      return record ? this.presentShare(record, actor) : null;
    }));
    const visibleShares = shares.filter((share): share is PortalShareDto => share !== null);
    const approvalOnly = actor.kind === 'representative' && !actor.permissions.includes('learning.read');
    const preview = approvalOnly ? visibleShares.find((share) => share.status === 'awaiting_approval')?.preview : null;
    if (approvalOnly && !preview) throw new PortalResourceError('portalNotFound', 404);
    return {
      id: project.id, studentId: actor.studentId, title: preview?.title ?? project.title, description: preview?.description ?? (approvalOnly ? '' : project.description),
      runId: approvalOnly ? null : project.runId, courseName: approvalOnly ? null : project.courseName,
      sourceSubmissionId: approvalOnly ? null : project.sourceSubmissionId, links: preview?.links ?? project.links,
      files: preview?.files ?? project.files.map((file) => presentPortalFile(file as ResourceFile, actor.linkId)),
      coverFileId: approvalOnly ? preview?.coverFileId ?? null : project.coverFileId, teacherReview: preview?.teacherReview ?? (approvalOnly || !actor.permissions.includes('feedback.read') ? null : project.teacherReview),
      version: project.version, createdAt: project.createdAt, updatedAt: project.updatedAt, archivedAt: project.archivedAt,
      shares: approvalOnly ? visibleShares.filter((share) => share.status === 'awaiting_approval') : visibleShares,
    };
  }
  async projects(actor: PortalActorContext) {
    this.authorizeProjects(actor);
    return Promise.all((await this.repository.listProjects(actor)).map((project) => this.presentProject(project, actor)));
  }
  async projectsPage(actor:PortalActorContext,cursor:number|null,limit:number) {
    this.authorizeProjects(actor);
    const values=await this.repository.listProjects(actor,cursor,limit+1);
    return {items:await Promise.all(values.slice(0,limit).map(project=>this.presentProject(project,actor))),nextCursor:values.length>limit?values[limit-1].id:null};
  }
  async project(actor: PortalActorContext, id: number) {
    this.authorizeProjects(actor);
    const project = await this.repository.project(actor, id);
    if (!project) throw new PortalResourceError('portalNotFound', 404);
    return this.presentProject(project, actor);
  }
  async projectSource(actor: PortalActorContext, id: number) {
    requireResourcePermission(actor, 'portfolio.edit', true);
    const source = await this.repository.projectSource(actor, id);
    if (!source) throw new PortalResourceError('portalNotFound', 404);
    return source;
  }
  async saveProject(actor: PortalActorContext, id: number | null, input: PortalProjectInput) {
    requireResourcePermission(actor, 'portfolio.edit', true);
    if ((id === null && input.version !== 0) || (id !== null && input.version < 1)) throw new PortalResourceError('portalVersionConflict', 409);
    return this.presentProject(await this.repository.saveProject(actor, id, input), actor);
  }
  async archiveProject(actor: PortalActorContext, id: number) { requireResourcePermission(actor, 'portfolio.edit', true); await this.repository.archiveProject(actor, id); }
  async createShare(actor: PortalActorContext, projectId: number, input: PortalShareInput) {
    requireShareCreation(actor);
    if (!await this.options.publicPortfolioEnabled(actor.studentId)) throw new PortalResourceError('portalSharingUnavailable', 409);
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) throw new PortalResourceError('portalInvalidData');
    const token = this.tokens.random();
    return this.presentShare(await this.repository.createShare(actor, projectId, input, this.tokens.hash(token), this.tokens.seal(token)), actor);
  }
  async share(actor: PortalActorContext, id: number) {
    this.authorizeProjects(actor);
    const share = await this.repository.share(actor, id);
    if (!share || (actor.kind === 'representative' && !actor.permissions.includes('learning.read') && share.status !== 'awaiting_approval')) throw new PortalResourceError('portalNotFound', 404);
    return this.presentShare(share, actor);
  }
  async approveShare(actor: PortalActorContext, id: number, version: number, approved: boolean) {
    requireResourcePermission(actor, 'portfolio.approve');
    if (actor.kind !== 'representative' || actor.studentClassification !== 'minor') throw new PortalResourceError('portalAccessDenied', 403);
    return this.presentShare(await this.repository.approveShare(actor, id, version, approved), actor);
  }
  async revokeShare(actor: PortalActorContext, id: number) {
    requireResourcePermission(actor, actor.kind === 'self' ? 'portfolio.edit' : 'portfolio.approve');
    await this.repository.revokeShare(actor, id);
  }
  private async publicRecord(token: string) {
    if (!await this.options.publicPortfolioEnabled() || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PortalResourceError('portalNotFound', 404);
    const share = await this.repository.publicShare(this.tokens.hash(token));
    if (!share || !await this.options.publicPortfolioEnabled(share.studentId)) throw new PortalResourceError('portalNotFound', 404);
    return share;
  }
  async publicProject(token: string): Promise<PortalPublicProjectDto> {
    const share = await this.publicRecord(token), files = await this.repository.filesByIds(share.snapshot.fileIds);
    const publicFiles = files.filter((file) => file.state === 'ready').map((file) => ({ name: file.name, mime: file.mime, size: file.size,
      downloadUrl: `/api/public/portfolio/${token}/files/${file.id}` }));
    return { title: share.snapshot.title, displayName: share.snapshot.displayName, description: share.snapshot.description,
      teacherReview: share.snapshot.teacherReview, links: share.snapshot.links, files: publicFiles,
      coverUrl: share.snapshot.coverFileId && files.some((file) => file.id === share.snapshot.coverFileId && file.state === 'ready' && file.mime.startsWith('image/')) ? `/api/public/portfolio/${token}/files/${share.snapshot.coverFileId}` : null,
      publishedAt: share.publishedAt! };
  }
  async publicFile(token: string, fileId: number, requestId?: string) {
    const share = await this.publicRecord(token);
    if (!share.snapshot.fileIds.includes(fileId)) throw new PortalResourceError('portalNotFound', 404);
    const file = (await this.repository.filesByIds([fileId]))[0];
    if (!file || file.state !== 'ready') throw new PortalResourceError('portalNotFound', 404);
    await this.repository.auditDownload(null, fileId, share.id, requestId);
    return { path: this.store.location(file.storageKey), file: presentPortalFile(file) };
  }
  async upload(actor: PortalActorContext, temporaryPath: string, originalName: string, runId: number | null) {
    const inspected = await this.store.inspect(temporaryPath, originalName), storageKey = this.tokens.random();
    if (inspected.size > (this.options.maxFileBytes?.() ?? 100 * 1024 ** 2)) throw new PortalResourceError('portalFileTooLarge',413);
    const file = await this.repository.registerFile(actor, { ...inspected, name: originalName, storageKey, runId });
    try { await this.store.commit(temporaryPath, storageKey); await this.repository.finishUpload(file.id); }
    catch (error) { await this.repository.removeFailedUpload(file.id); await this.store.remove(storageKey); throw error; }
    return presentPortalFile({ ...file, state: 'checking' }, actor.linkId);
  }
  async uploadStaff(actor: ResourceStaffActor, runId: number, temporaryPath: string, originalName: string) {
    const inspected = await this.store.inspect(temporaryPath, originalName), storageKey = this.tokens.random();
    if (inspected.size > (this.options.maxFileBytes?.() ?? 100 * 1024 ** 2)) throw new PortalResourceError('portalFileTooLarge',413);
    const file = await this.repository.registerStaffFile(actor, runId, { ...inspected, name: originalName, storageKey });
    try { await this.store.commit(temporaryPath, storageKey); await this.repository.finishUpload(file.id); }
    catch (error) { await this.repository.removeFailedUpload(file.id); await this.store.remove(storageKey); throw error; }
    return presentPortalFile({ ...file, state: 'checking' }, undefined, true);
  }
  async cloneStaffFiles(actor:ResourceStaffActor,fileIds:number[],sourceRunId:number,targetRunId:number,idempotencyKey = this.tokens.random()) {
    if (!fileIds.length) return {fileIds:[],discardUnused:async() => {}};
    if(!this.store.clone || fileIds.length>20)throw new PortalResourceError('portalFileNotReady',409);
    const created:ResourceFile[] = [],ids:number[] = [];
    const discardUnused = async() => { for(const item of created){const unused=await this.repository.discardUnusedFile(item.id);if(unused)await this.store.remove(unused.storageKey);} };
    try {
      for(const sourceId of [...new Set(fileIds)]) {
        const source = await this.repository.readStaffFile(actor,sourceId);
        if(!source || source.ownerUserId===null || source.runId!==sourceRunId || source.state!=='ready')throw new PortalResourceError('portalFileNotReady',409);
        if(sourceRunId===targetRunId){ids.push(sourceId);continue;}
        const cloned = await this.repository.registerStaffClone(actor,sourceId,sourceRunId,targetRunId,idempotencyKey,this.tokens.random());
        if(cloned.created){created.push(cloned.file);await this.store.clone(source.storageKey,cloned.file.storageKey);await this.repository.completeStaffClone(cloned.file.id);}
        ids.push(cloned.file.id);
      }
      return {fileIds:ids,discardUnused};
    } catch(error) { await discardUnused();throw error; }
  }
  async fileStatus(actor: PortalActorContext, id: number) {
    const file = await this.repository.readFile(actor, id);
    if (!file) throw new PortalResourceError('portalNotFound', 404);
    return presentPortalFile(file, actor.linkId);
  }
  async file(actor: PortalActorContext, id: number) {
    const file = await this.repository.readFile(actor, id);
    if (!file) throw new PortalResourceError('portalNotFound', 404);
    if (file.state !== 'ready') throw new PortalResourceError('portalFileNotReady', 409);
    await this.repository.auditDownload(actor, id);
    return { path: this.store.location(file.storageKey), file: presentPortalFile(file, actor.linkId) };
  }
  async staffFile(actor: ResourceStaffActor, id: number, download = false) {
    const file = await this.repository.readStaffFile(actor, id);
    if (!file) throw new PortalResourceError('portalNotFound', 404);
    if (download && file.state !== 'ready') throw new PortalResourceError('portalFileNotReady', 409);
    return { path: this.store.location(file.storageKey), file: presentPortalFile(file, undefined, true) };
  }
  async payments(actor: PortalActorContext,cursor:number|null=null,limit=100) { requireFinanceRead(actor); return this.repository.payments(actor,cursor,limit); }
  async financeQuestions(actor: PortalActorContext) { requireFinanceRead(actor); return this.repository.financeQuestions(actor); }
  async financeQuestionsPage(actor:PortalActorContext,cursor:number|null,limit:number) { requireFinanceRead(actor);const values=await this.repository.financeQuestions(actor,cursor,limit+1);return {items:values.slice(0,limit),nextCursor:values.length>limit?values[limit-1].id:null}; }
  async staffFinanceQuestionsPage(actor:ResourceStaffActor,cursor:number|null,limit:number) {const values=await this.repository.staffFinanceQuestions(actor,cursor,limit+1);return {items:values.slice(0,limit),nextCursor:values.length>limit?values[limit-1].id:null}; }
  async financeQuestion(actor: PortalActorContext,id:number) { requireFinanceRead(actor); return this.repository.financeQuestion(actor,id); }
  async createFinanceQuestion(actor: PortalActorContext,input:PortalFinanceQuestionInput) { requireFinanceRead(actor); return this.repository.createFinanceQuestion(actor,input); }
  async financeMessage(actor: PortalActorContext,id:number,body:string,key?:string) { requireFinanceRead(actor); return this.repository.financeMessage(actor,id,body,key); }
  async staffFinanceQuestions(actor:ResourceStaffActor) { return this.repository.staffFinanceQuestions(actor); }
  async paymentAllocation(actor:ResourceStaffActor,paymentId:number) { return this.repository.paymentAllocation(actor,paymentId); }
  async unallocatedPayments(actor:ResourceStaffActor,cursor:number|null,limit=30) { return this.repository.unallocatedPayments(actor,cursor,limit); }
  async staffFinanceQuestion(actor:ResourceStaffActor,id:number) { return this.repository.staffFinanceQuestion(actor,id); }
  async staffFinanceReply(actor:ResourceStaffActor,id:number,body:string,key?:string) { return this.repository.staffFinanceReply(actor,id,body,key); }
  async allocatePayment(actor: ResourceStaffActor, id: number, input: PortalPaymentAllocationInput) { return this.repository.allocatePayment(actor, id, input); }
  async notifications(accountId: number, cursor: number | null, limit: number) { return this.repository.notifications(accountId, cursor, limit); }
  async readNotification(accountId: number, id: number | null) { return this.repository.readNotification(accountId, id); }
  async preferences(accountId: number) { return this.repository.preferences(accountId); }
  async savePreferences(accountId: number, preferences: PortalNotificationPreferencesDto) { await this.repository.savePreferences(accountId, preferences); return this.repository.preferences(accountId); }
  async pendingShares(actor: ResourceStaffActor) {
    return Promise.all((await this.repository.pendingShares(actor)).map(async (share) => ({ ...await this.presentShare(share), studentName: share.studentName })));
  }
  async moderateShare(actor: ResourceStaffActor, id: number, version: number, approved: boolean) { return this.presentShare(await this.repository.moderateShare(actor, id, version, approved)); }
  async reviewProject(actor: ResourceStaffActor, id: number, version: number, review: string) { return this.repository.reviewProject(actor, id, version, review); }
  async validateFiles() {
    const files = await this.repository.scanningFiles();
    for (const { file, sha256, leaseToken } of files) {
      try {
        const inspected = await this.store.inspect(this.store.location(file.storageKey), file.name);
        const unchanged = inspected.sha256 === sha256 && inspected.mime === file.mime && inspected.size === file.size;
        const allowed = unchanged && inspected.size <= (this.options.maxFileBytes?.() ?? 100 * 1024 ** 2);
        await this.repository.scanned(file.id, allowed ? 'ready' : 'rejected', allowed ? undefined : 'portalFileRejected', leaseToken);
      } catch (error) {
        await this.repository.scanned(file.id, error instanceof PortalResourceError ? 'rejected' : 'retry',
          error instanceof PortalResourceError ? error.code : undefined, leaseToken);
      }
    }
    return files.length;
  }
  async cleanupFiles() {
    for (const file of await this.repository.cleanupFiles()) {
      await this.store.remove(file.storageKey);
      await this.repository.fileStorageRemoved(file.id);
    }
  }
}
