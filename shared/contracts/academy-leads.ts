import { z } from 'zod';
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
