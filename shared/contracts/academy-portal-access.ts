import { z } from 'zod';
import { portalLoginSchema, portalPasswordSchema, portalClassificationSchema, portalRelationshipSchema } from './portal-identity';

const id = z.number().int().positive();
export const academyPortalQuerySchema = z.object({
  q: z.string().trim().max(254).default(''),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type AcademyPortalQuery = z.infer<typeof academyPortalQuerySchema>;
export type AcademyPortalAccount = {
  id: number; login: string; fullName: string; status: 'pending' | 'active' | 'suspended' | 'archived';
  version: number; hasInitialPassword: boolean;
};
export type AcademyPortalStudent = {
  id: number; name: string; classification: z.infer<typeof portalClassificationSchema>;
  account: AcademyPortalAccount | null;
};
export type AcademyPortalLead = {
  id: number; name: string; phone: string; role: 'self' | 'representative' | null;
  account: AcademyPortalAccount | null; students: AcademyPortalStudent[];
};
export type AcademyPortalPage = { items: AcademyPortalLead[]; total: number; page: number; pageSize: number };
export const academyPortalLeadRoleSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('self'), studentId: id }).strict(),
  z.object({
    role: z.literal('representative'), relationship: portalRelationshipSchema,
    relationshipConfirmed: z.literal(true),
    students: z.array(z.object({
      studentId: id, classification: z.enum(['adult', 'minor']), adultConsent: z.boolean().default(false),
    }).strict()).min(1).max(50),
  }).strict(),
]);
export type AcademyPortalLeadRole = z.infer<typeof academyPortalLeadRoleSchema>;
export const academyPortalCredentialChangeSchema = z.object({
  version: z.number().int().positive(), login: portalLoginSchema.optional(),
  password: portalPasswordSchema.optional(),
  generateLogin: z.boolean().default(false), generatePassword: z.boolean().default(false),
}).strict().refine(value => Boolean(value.login || value.password || value.generateLogin || value.generatePassword), 'portalInvalidData')
  .refine(value => !(value.login && value.generateLogin) && !(value.password && value.generatePassword), 'portalInvalidData');
export type AcademyPortalCredentialChange = z.infer<typeof academyPortalCredentialChangeSchema>;
export const academyPortalCredentialShowSchema = z.object({ version: z.number().int().positive() }).strict();
export type AcademyPortalCredentialResult = { account: AcademyPortalAccount; password: string | null };
