import { z } from "zod";
import { portalClassificationSchema, portalPermissionSchema, portalRelationshipSchema } from "./portal-identity";

export const PORTAL_DIRECTORY_FILTERS = ["all", "without_access", "pending", "unverified", "blocked"] as const;
export const portalDirectoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  filter: z.enum(PORTAL_DIRECTORY_FILTERS).default("all"),
  q: z.string().trim().max(120).default(""),
  groupId: z.coerce.number().int().positive().optional(),
}).strict();
export type PortalDirectoryQuery = z.infer<typeof portalDirectoryQuerySchema>;
const iso = z.string().datetime({ offset: true });
export const portalDirectoryStudentSchema = z.object({
  id: z.number().int().positive(), studentName: z.string().nullable(), contactName: z.string(),
  status: z.string(), managerName: z.string().nullable(), leadId: z.number().int().positive().nullable(),
  updatedAt: iso.nullable(), classification: portalClassificationSchema,
  groups: z.array(z.object({ id: z.number().int().positive(), name: z.string() })),
});
export type PortalDirectoryStudent = z.infer<typeof portalDirectoryStudentSchema>;
export const portalDirectoryAccountSchema = z.object({
  accountId: z.number().int().positive(), linkId: z.number().int().positive(),
  fullName: z.string(), login: z.string(), accountStatus: z.enum(["pending", "active", "suspended", "archived"]),
  linkStatus: z.enum(["pending", "active", "suspended", "revoked"]),
  relationship: portalRelationshipSchema.nullable(), permissions: z.array(portalPermissionSchema),
  invitationStatus: z.enum(["created", "sent", "delivery_failed", "accepted", "expired", "revoked"]).nullable(),
  lastSeenAt: iso.nullable(),
});
export type PortalDirectoryAccount = z.infer<typeof portalDirectoryAccountSchema>;
export const portalDirectoryRowSchema = z.object({
  student: portalDirectoryStudentSchema,
  selfAccount: portalDirectoryAccountSchema.nullable(),
  representatives: z.array(portalDirectoryAccountSchema),
  lastSeenAt: iso.nullable(),
  hasAccess: z.boolean(), needsVerification: z.boolean(), pendingActivation: z.boolean(), blocked: z.boolean(),
});
export type PortalDirectoryRow = z.infer<typeof portalDirectoryRowSchema>;
export const portalDirectoryStatsSchema = z.object({
  students: z.number().int().nonnegative(), accounts: z.number().int().nonnegative(),
  activatedAccounts: z.number().int().nonnegative(), activationPercent: z.number().min(0).max(100),
  active7Days: z.number().int().nonnegative(), active30Days: z.number().int().nonnegative(),
  periodEnd: iso,
});
export type PortalDirectoryStats = z.infer<typeof portalDirectoryStatsSchema>;
export const portalDirectoryPageSchema = z.object({
  items: z.array(portalDirectoryRowSchema), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive(),
  stats: portalDirectoryStatsSchema,
  groups: z.array(z.object({ id: z.number().int().positive(), name: z.string() })),
});
export type PortalDirectoryPage = z.infer<typeof portalDirectoryPageSchema>;
export const portalRepresentativeRowSchema = z.object({
  accountId: z.number().int().positive(), fullName: z.string(), login: z.string(), accountStatus: z.enum(["pending", "active", "suspended", "archived"]),
  lastSeenAt: iso.nullable(), students: z.array(z.object({ student: portalDirectoryStudentSchema, access: portalDirectoryAccountSchema })),
});
export type PortalRepresentativeRow = z.infer<typeof portalRepresentativeRowSchema>;
export const portalRepresentativePageSchema = z.object({
  items: z.array(portalRepresentativeRowSchema), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive(),
  groups: z.array(z.object({ id: z.number().int().positive(), name: z.string() })),
});
export type PortalRepresentativePage = z.infer<typeof portalRepresentativePageSchema>;
