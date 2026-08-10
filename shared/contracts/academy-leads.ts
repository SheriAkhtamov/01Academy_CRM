import { z } from 'zod';
import { normalizeLeadTagName } from '../lead-tags';
import { positiveIdSchema } from './messages';

const optionalPositiveIdInput = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  positiveIdSchema.optional(),
);

const optionalTextInput = z.string().trim().max(5_000).optional().nullable();

/**
 * This contract covers the public shape accepted by POST /api/academy/leads.
 * It remains passthrough while legacy optional acquisition fields are migrated
 * into explicit contracts one vertical slice at a time.
 */
export const createAcademyLeadRequestSchema = z.object({
  contactName: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(80).optional().nullable(),
  phoneNumbers: z.array(z.string().trim().max(80)).max(10).optional(),
  messenger: z.string().trim().max(255).optional().nullable(),
  sourceId: optionalPositiveIdInput,
  sourceCode: z.string().trim().max(80).optional().nullable(),
  managerId: optionalPositiveIdInput,
  courseId: optionalPositiveIdInput,
  enrolledGroupId: optionalPositiveIdInput,
  referrerStudentId: optionalPositiveIdInput,
  studentName: z.string().trim().max(255).optional().nullable(),
  studentAge: z.coerce.number().int().min(1).max(120).optional().nullable(),
  statusCode: z.string().trim().max(80).optional().nullable(),
  language: z.enum(['ru', 'uz', 'en']).optional(),
  comment: optionalTextInput,
  advertisingCampaign: optionalTextInput,
  referralCode: z.string().trim().max(120).optional().nullable(),
  demoAt: z.unknown().optional(),
}).passthrough();

export type CreateAcademyLeadRequest = z.infer<typeof createAcademyLeadRequestSchema>;

export const leadIdParamsSchema = z.object({
  id: positiveIdSchema,
});

export const leadListQuerySchema = z.object({
  managerId: optionalPositiveIdInput,
  statusCode: z.string().trim().max(80).optional(),
  archived: z.enum(['true', 'false']).optional(),
}).passthrough();

export const bulkAssignLeadsRequestSchema = z.object({
  leadIds: z.array(positiveIdSchema).min(1).max(500),
  managerId: positiveIdSchema,
  comment: optionalTextInput,
});

export const mergeLeadIdsSchema = z.object({
  retainedLeadId: positiveIdSchema,
  duplicateLeadId: positiveIdSchema,
}).refine(
  ({ retainedLeadId, duplicateLeadId }) => retainedLeadId !== duplicateLeadId,
  { message: 'leadMergeRequiresDifferentLeads' },
);

export const mergeLeadPreviewQuerySchema = z.object({
  firstLeadId: positiveIdSchema,
  secondLeadId: positiveIdSchema,
}).refine(
  ({ firstLeadId, secondLeadId }) => firstLeadId !== secondLeadId,
  { message: 'leadMergeRequiresDifferentLeads' },
);

export const mergeLeadDraftRequestSchema = z.object({
  retainedLeadId: positiveIdSchema,
  // The legacy endpoint accepts a partial creation draft. Keep the wire
  // contract permissive while the nested fields are made explicit one by one.
  draft: z.record(z.unknown()),
});

export const assignLeadRequestSchema = z.object({
  managerId: positiveIdSchema,
  comment: optionalTextInput,
});

export const archiveLeadRequestSchema = z.object({
  reason: z.string().trim().min(1).max(80),
  customReason: optionalTextInput,
  assignToSelf: z.boolean().optional(),
});

export const restoreLeadRequestSchema = z.object({
  statusCode: z.string().trim().min(1).max(80),
});

const normalizedLeadTagNameSchema = z.string().transform((value, context) => {
  const normalized = normalizeLeadTagName(value);
  if (!normalized) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'leadTagNameInvalid',
    });
    return z.NEVER;
  }
  return normalized.name;
});

export const leadTagRequestSchema = z.union([
  z.object({ tagId: positiveIdSchema }),
  z.object({ name: normalizedLeadTagNameSchema }),
]);

export const leadCommentRequestSchema = z.object({
  body: z.string().trim().min(1).max(5_000),
});

export const leadGroupRequestSchema = z.object({
  groupId: positiveIdSchema,
});

export const leadContactRequestSchema = z.object({
  channel: z.string().trim().min(1).max(120).optional(),
  result: optionalTextInput,
  comment: optionalTextInput,
});

export const leadDemoAttendanceRequestSchema = z.object({
  attended: z.boolean().optional(),
  demoResult: optionalTextInput,
});

export const createLeadStudentRequestSchema = z.object({
  studentName: z.string().trim().min(1).max(255),
  studentAge: z.coerce.number().int().min(1).max(120).optional().nullable(),
  phone: z.string().trim().max(80).optional().nullable(),
  groupIds: z.array(positiveIdSchema).min(1),
  primaryGroupId: positiveIdSchema,
  enrolledAt: z.coerce.date(),
  marketingConsent: z.boolean().optional(),
});

// Update remains passthrough during the compatibility phase because the
// legacy endpoint accepts acquisition, assignment and optimistic-lock fields.
export const updateAcademyLeadRequestSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional().nullable(),
  contactName: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(80).optional().nullable(),
  phoneNumbers: z.array(z.string().trim().max(80)).max(10).optional(),
  messenger: z.string().trim().max(255).optional().nullable(),
  sourceId: optionalPositiveIdInput,
  managerId: optionalPositiveIdInput,
  courseId: optionalPositiveIdInput,
  enrolledGroupId: optionalPositiveIdInput,
  statusCode: z.string().trim().max(80).optional(),
  comment: optionalTextInput,
}).passthrough();

export const academyLeadDtoSchema = z.object({
  id: positiveIdSchema,
  contactName: z.string(),
  statusCode: z.string(),
  managerId: positiveIdSchema.optional().nullable(),
  createdAt: z.union([z.string(), z.date()]),
}).passthrough();

export const academyLeadErrorSchema = z.object({
  error: z.string(),
  duplicate: z.record(z.unknown()).optional(),
}).passthrough();

export type BulkAssignLeadsRequest = z.infer<typeof bulkAssignLeadsRequestSchema>;
export type MergeLeadIds = z.infer<typeof mergeLeadIdsSchema>;
export type MergeLeadDraftRequest = z.infer<typeof mergeLeadDraftRequestSchema>;
export type AssignLeadRequest = z.infer<typeof assignLeadRequestSchema>;
export type ArchiveLeadRequest = z.infer<typeof archiveLeadRequestSchema>;
export type RestoreLeadRequest = z.infer<typeof restoreLeadRequestSchema>;
export type LeadTagRequest = z.infer<typeof leadTagRequestSchema>;
export type LeadCommentRequest = z.infer<typeof leadCommentRequestSchema>;
export type CreateLeadStudentRequest = Omit<
  z.infer<typeof createLeadStudentRequestSchema>,
  'enrolledAt'
> & { enrolledAt: string | Date };
export type UpdateAcademyLeadRequest = z.infer<typeof updateAcademyLeadRequestSchema>;
export type AcademyLeadDto = z.infer<typeof academyLeadDtoSchema>;
