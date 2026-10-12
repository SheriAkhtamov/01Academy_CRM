import { MAX_UPLOAD_BYTES } from '@shared/upload-policy';
import { z } from 'zod';

export const PORTAL_MAX_FILE_BYTES = MAX_UPLOAD_BYTES;
export const PORTAL_FILE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
const id = z.coerce.number().int().positive();
const safeLink = z.string().trim().max(2000).url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'portalInvalidLink');
export const portalProjectSchema = z.object({
  title: z.string().trim().min(1).max(255), description: z.string().trim().max(10000).default(''),
  runId: id.nullable().default(null), sourceSubmissionId: id.nullable().default(null),
  links: z.array(safeLink).max(10).default([]), fileIds: z.array(id).max(5).default([]),
  coverFileId: id.nullable().default(null), version: z.number().int().nonnegative(), idempotencyKey: z.string().uuid().optional(),
}).strict();
export type PortalProjectInput = z.infer<typeof portalProjectSchema>;
export const portalShareSchema = z.object({
  projectVersion: z.number().int().positive(), displayName: z.string().trim().min(1).max(100),
  includeDescription: z.boolean(), includeReview: z.boolean(), fileIds: z.array(id).max(5),
  expiresAt: z.string().datetime().nullable().default(null), consent: z.literal(true), idempotencyKey: z.string().uuid().optional(),
}).strict();
export type PortalShareInput = z.infer<typeof portalShareSchema>;
export const portalShareApprovalSchema = z.object({ version: z.number().int().positive(), approved: z.boolean() }).strict();
export const portalProjectReviewSchema = z.object({ version: z.number().int().positive(), review: z.string().trim().min(1).max(10000) }).strict();
export type PortalFileDto = {
  id: number; name: string; mime: string; size: number;
  state: 'uploading' | 'checking' | 'ready' | 'rejected'; createdAt: string;
  downloadUrl: string | null; rejectionCode: string | null;
};
export type PortalProjectDto = {
  id: number; studentId: number; title: string; description: string; runId: number | null;
  courseName: string | null; sourceSubmissionId: number | null; links: string[];
  files: PortalFileDto[]; coverFileId: number | null; teacherReview: string | null;
  version: number; createdAt: string; updatedAt: string; archivedAt: string | null;
  shares: PortalShareDto[];
};
export const portalProjectComparisonSchema = z.object({ runId:id.nullable().default(null),firstProjectId:id,latestProjectId:id,version:z.number().int().nonnegative() }).strict().refine(value => value.firstProjectId !== value.latestProjectId,'portalInvalidData');
export type PortalProjectComparisonInput = z.infer<typeof portalProjectComparisonSchema>;
export type PortalComparisonProjectDto = { id:number; title:string;description:string;links:string[];files:PortalFileDto[];teacherReview:string|null;coverFileId:number|null;version:number };
export type PortalProjectComparisonDto = { firstProjectId:number;latestProjectId:number;runId:number|null;selectedByName:string;selectedByRole:'student'|'teacher'|'staff';version:number;updatedAt:string;firstProject:PortalComparisonProjectDto;latestProject:PortalComparisonProjectDto };
export type PortalShareDto = {
  id: number; projectId: number; projectVersion: number; version: number;
  status: 'awaiting_approval' | 'awaiting_moderation' | 'published' | 'rejected' | 'revoked';
  displayName: string; includeDescription: boolean; includeReview: boolean; fileIds: number[];
  expiresAt: string | null; createdAt: string; publishedAt: string | null; revokedAt: string | null;
  publicUrl: string | null;
  preview: { title: string; description: string | null; teacherReview: string | null; links: string[]; files: PortalFileDto[]; coverFileId: number | null };
};
export type PortalPublicProjectDto = {
  title: string; displayName: string; description: string | null; teacherReview: string | null;
  links: string[]; files: { name: string; mime: string; size: number; downloadUrl: string }[];
  coverUrl: string | null; publishedAt: string;
};
export type PortalPaymentDto = {
  id: number; amountUzs: number; status: string; method: string; type: string;
  period: string | null; paidAt: string | null; dueAt: string | null; paidUntil: string | null;
};
export type PortalResourcePageDto<T> = { items: T[]; nextCursor: number | null; hasMore: boolean };
export const portalResourcePageSchema = z.object({
  items: z.array(z.unknown()),
  nextCursor: id.nullable(),
  hasMore: z.boolean(),
}).passthrough().refine((page) => page.hasMore === (page.nextCursor !== null), 'portalInvalidData');
export type PortalProjectPageDto = PortalResourcePageDto<PortalProjectDto>;
export type PortalPaymentsDto = {
  state: 'ready' | 'needs_review'; items: PortalPaymentDto[];nextCursor?:number|null;
  summary: { paidUzs: number; dueUzs: number; refundedUzs: number; paidUntil: string | null; nextPaymentAt: string | null } | null;
};
export type PortalPaymentsPageDto = Omit<PortalPaymentsDto, 'items' | 'nextCursor'> & PortalResourcePageDto<PortalPaymentDto>;
export const portalFinanceQuestionSchema = z.object({ paymentId: id.nullable().default(null), subject: z.string().trim().min(1).max(255), body: z.string().trim().min(1).max(10000), idempotencyKey: z.string().uuid().optional() }).strict();
export const portalFinanceMessageSchema = z.object({ body: z.string().trim().min(1).max(10000), idempotencyKey: z.string().uuid().optional() }).strict();
export type PortalFinanceQuestionInput = z.infer<typeof portalFinanceQuestionSchema>;
export type PortalFinanceQuestionDto = { id: number; paymentId: number | null; subject: string; status: 'open' | 'answered' | 'resolved'; createdAt: string; updatedAt: string; studentName?: string };
export type PortalFinanceQuestionPageDto = PortalResourcePageDto<PortalFinanceQuestionDto>;
export type PortalFinanceMessageDto = { id: number; body: string; author: 'account' | 'staff'; createdAt: string };
export type PortalFinanceQuestionDetailDto = PortalFinanceQuestionDto & { messages: PortalFinanceMessageDto[] };
export const PORTAL_NOTIFICATION_CATEGORIES = ['learning', 'schedule', 'feedback', 'finance', 'family', 'security'] as const;
export type PortalNotificationCategory = (typeof PORTAL_NOTIFICATION_CATEGORIES)[number];
export type PortalNotificationDto = {
  id: number; linkId: number | null; category: PortalNotificationCategory; code: string;
  params: Record<string, string | number>; href: string | null; createdAt: string; readAt: string | null;
};
export type PortalNotificationPageDto = { items: PortalNotificationDto[]; nextCursor: number | null; unreadCount: number };
export type PortalNotificationCollectionDto = PortalNotificationPageDto & PortalResourcePageDto<PortalNotificationDto>;
export type PortalNotificationPreferencesDto = {
  categories: Record<PortalNotificationCategory, { inApp: boolean }>;
  weeklySummary: boolean;
};
export const portalNotificationPreferencesSchema = z.object({
  categories: z.object(Object.fromEntries(PORTAL_NOTIFICATION_CATEGORIES.map((category) => [category,
    z.object({ inApp: z.boolean() }).strict(),
  ])) as Record<PortalNotificationCategory, z.ZodObject<{ inApp: z.ZodBoolean }>>).strict(),
  weeklySummary: z.boolean(),
}).strict();
export const portalPaymentAllocationSchema = z.object({
  version: z.number().int().nonnegative(),
  allocations: z.array(z.object({ studentId: id, amountUzs: z.number().int().positive() }).strict()).min(1).max(50),
  reason: z.string().trim().min(3).max(2000),
}).strict().refine((value) => new Set(value.allocations.map((allocation) => allocation.studentId)).size === value.allocations.length, 'portalDuplicateAllocation');
export type PortalPaymentAllocationInput = z.infer<typeof portalPaymentAllocationSchema>;
export type PortalPaymentAllocationDto = {
  paymentId: number; amountUzs: number; version: number;
  students: { id: number; name: string; amountUzs: number }[];
};
export type PortalUnallocatedPaymentsDto = { items: { id:number;amountUzs:number;name:string|null }[];nextCursor:number|null };
export type PortalUnallocatedPaymentsPageDto = PortalUnallocatedPaymentsDto & PortalResourcePageDto<PortalUnallocatedPaymentsDto['items'][number]>;
