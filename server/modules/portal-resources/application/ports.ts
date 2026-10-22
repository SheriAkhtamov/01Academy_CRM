import type { PortalActorContext } from '../../portal-identity/domain/actor-context';
import type { ResourceStaffActor } from '../domain/policy';
import type {
  PortalFileDto, PortalNotificationPageDto, PortalNotificationPreferencesDto, PortalPaymentAllocationInput,
  PortalPaymentsDto, PortalProjectDto, PortalProjectInput, PortalShareDto, PortalShareInput,
  PortalFinanceQuestionDto, PortalFinanceQuestionDetailDto, PortalFinanceQuestionInput,
  PortalProjectComparisonInput,PortalProjectComparisonDto,
  PortalPaymentAllocationDto,PortalUnallocatedPaymentsDto,
} from '@shared/contracts/portal-resources';

export type ResourceFile = PortalFileDto & { storageKey: string; ownerAccountId: number | null; ownerUserId: number | null; studentId: number | null; runId: number | null; courseId?: number | null; purpose?: 'learning' | 'course_material' };
export type ResourceScanClaim = { file: ResourceFile; sha256: string; leaseToken: string };
export type ShareRecord = PortalShareDto & {
  studentId: number; tokenHash: string; tokenEnvelope: string;
  snapshot: { title: string; displayName: string; description: string | null; teacherReview: string | null; links: string[]; fileIds: number[]; coverFileId: number | null };
  studentClassification: 'adult' | 'minor';
};
export type ComparisonRecord = Omit<PortalProjectComparisonDto,'firstProject'|'latestProject'> & { firstSnapshot:ComparisonSnapshot;latestSnapshot:ComparisonSnapshot };
export type ComparisonSnapshot = { id:number;title:string;description:string;links:string[];fileIds:number[];teacherReview:string|null;coverFileId:number|null;version:number };
export interface PortalResourceRepository {
  listProjects(actor: PortalActorContext,cursor?:number|null,limit?:number): Promise<PortalProjectDto[]>;
  project(actor: PortalActorContext, projectId: number): Promise<PortalProjectDto | null>;
  saveProject(actor: PortalActorContext, projectId: number | null, input: PortalProjectInput): Promise<PortalProjectDto>;
  projectSource(actor: PortalActorContext, submissionId: number): Promise<PortalProjectInput | null>;
  projectComparison(studentId:number,runId:number|null):Promise<ComparisonRecord|null>;
  saveProjectComparison(actor:PortalActorContext,input:PortalProjectComparisonInput):Promise<ComparisonRecord>;
  staffProjectComparison(actor:ResourceStaffActor,studentId:number,runId:number):Promise<ComparisonRecord|null>;
  staffProjects(actor:ResourceStaffActor,studentId:number,runId:number,verified?:boolean):Promise<PortalProjectDto[]>;
  saveStaffProjectComparison(actor:ResourceStaffActor,studentId:number,input:PortalProjectComparisonInput):Promise<ComparisonRecord>;
  archiveProject(actor: PortalActorContext, projectId: number, version: number): Promise<void>;
  createShare(actor: PortalActorContext, projectId: number, input: PortalShareInput, tokenHash: string, tokenEnvelope: string): Promise<ShareRecord>;
  share(actor: PortalActorContext, shareId: number): Promise<ShareRecord | null>;
  approveShare(actor: PortalActorContext, shareId: number, version: number, approved: boolean): Promise<ShareRecord>;
  revokeShare(actor: PortalActorContext, shareId: number): Promise<void>;
  publicShare(tokenHash: string): Promise<ShareRecord | null>;
  filesByIds(fileIds: number[]): Promise<ResourceFile[]>;
  readFile(actor: PortalActorContext, fileId: number): Promise<ResourceFile | null>;
  registerFile(actor: PortalActorContext, file: { name: string; mime: string; size: number; storageKey: string; sha256: string; runId: number | null }): Promise<ResourceFile>;
  registerStaffFile(actor: ResourceStaffActor, runId: number, file: { name: string; mime: string; size: number; storageKey: string; sha256: string }): Promise<ResourceFile>;
  registerStaffClone(actor:ResourceStaffActor,sourceId:number,sourceRunId:number,targetRunId:number,requestKey:string,storageKey:string):Promise<{file:ResourceFile;created:boolean}>;
  completeStaffClone(fileId:number):Promise<void>;
  discardUnusedFile(fileId:number):Promise<ResourceFile|null>;
  readStaffFile(actor: ResourceStaffActor, fileId: number): Promise<ResourceFile | null>;
  finishUpload(fileId: number): Promise<void>;
  removeFailedUpload(fileId: number): Promise<void>;
  scanningFiles(): Promise<ResourceScanClaim[]>;
  scanned(fileId: number, result: 'ready' | 'rejected' | 'retry', rejectionCode: string | undefined, leaseToken: string): Promise<void>;
  cleanupFiles(): Promise<ResourceFile[]>;
  fileStorageRemoved(fileId: number): Promise<void>;
  payments(actor: PortalActorContext,cursor?:number|null,limit?:number): Promise<PortalPaymentsDto>;
  financeQuestions(actor: PortalActorContext,cursor?:number|null,limit?:number): Promise<PortalFinanceQuestionDto[]>;
  financeQuestion(actor: PortalActorContext, id: number): Promise<PortalFinanceQuestionDetailDto>;
  createFinanceQuestion(actor: PortalActorContext, input: PortalFinanceQuestionInput): Promise<PortalFinanceQuestionDetailDto>;
  financeMessage(actor: PortalActorContext, id: number, body: string, requestKey?: string): Promise<PortalFinanceQuestionDetailDto>;
  staffFinanceQuestions(actor: ResourceStaffActor,cursor?:number|null,limit?:number): Promise<PortalFinanceQuestionDto[]>;
  staffFinanceQuestion(actor: ResourceStaffActor, id: number): Promise<PortalFinanceQuestionDetailDto>;
  staffFinanceReply(actor: ResourceStaffActor, id: number, body: string, requestKey?: string): Promise<PortalFinanceQuestionDetailDto>;
  allocatePayment(actor: ResourceStaffActor, paymentId: number, input: PortalPaymentAllocationInput): Promise<void>;
  paymentAllocation(actor: ResourceStaffActor, paymentId: number): Promise<PortalPaymentAllocationDto>;
  unallocatedPayments(actor:ResourceStaffActor,cursor:number|null,limit?:number):Promise<PortalUnallocatedPaymentsDto>;
  notifications(accountId: number, cursor: number | null, limit: number): Promise<PortalNotificationPageDto>;
  readNotification(accountId: number, id: number | null): Promise<void>;
  deleteNotification(accountId: number, id: number | null): Promise<number>;
  preferences(accountId: number): Promise<PortalNotificationPreferencesDto>;
  savePreferences(accountId: number, preferences: PortalNotificationPreferencesDto): Promise<void>;
  pendingShares(actor: ResourceStaffActor): Promise<(ShareRecord & { studentName: string })[]>;
  moderateShare(actor: ResourceStaffActor, shareId: number, version: number, approved: boolean): Promise<ShareRecord>;
  reviewProject(actor: ResourceStaffActor, projectId: number, version: number, review: string): Promise<void>;
  auditDownload(actor: PortalActorContext | null, fileId: number, shareId?: number, requestId?: string): Promise<void>;
}
export interface ResourceFileStore {
  commit(temporaryPath: string, storageKey: string): Promise<void>;
  remove(storageKey: string): Promise<void>;
  location(storageKey: string): string;
  clone?(sourceKey:string,targetKey:string):Promise<void>;
  inspect(temporaryPath: string, name: string): Promise<{ mime: string; size: number; sha256: string }>;
}
export interface ResourceTokenCodec { random(): string; hash(token: string): string; seal(token: string): string; open(envelope: string): string }
