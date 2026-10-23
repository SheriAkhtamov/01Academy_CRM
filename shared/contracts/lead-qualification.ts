import { z } from 'zod';

export const leadQualificationRequestSchema = z.object({
  funnelId: z.number().int().positive(),
  locationFits: z.literal(true),
  ageFits: z.literal(true),
  budgetFits: z.literal(true),
}).strict();

export const revokeLeadQualificationRequestSchema = z.object({
  funnelId: z.number().int().positive(),
  qualifiedAt: z.string().datetime(),
}).strict();
export type RevokeLeadQualificationRequest = z.infer<typeof revokeLeadQualificationRequestSchema>;

export type LeadQualificationRequest = z.infer<typeof leadQualificationRequestSchema>;
export type LeadQualification = {
  qualifiedAt: string | null;
  qualifiedBy: number | null;
  funnelId: number;
};

export const LEAD_QUALIFIED_ACTION = 'QUALIFY_ACADEMY_LEAD_BY_CRITERIA';
export const LEAD_QUALIFICATION_REVOKED_ACTION = 'REVOKE_ACADEMY_LEAD_QUALIFICATION';
