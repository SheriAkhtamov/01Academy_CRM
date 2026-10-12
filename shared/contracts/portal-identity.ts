import { z } from "zod";

export const PORTAL_PERMISSIONS = [
  "learning.read",
  "attendance.read",
  "feedback.read",
  "finance.read",
  "communication.create",
  "portfolio.approve",
  "child_credentials.manage",
  "assignments.submit",
  "quizzes.attempt",
  "portfolio.edit",
] as const;
export const portalPermissionSchema = z.enum(PORTAL_PERMISSIONS);
export type PortalPermission = z.infer<typeof portalPermissionSchema>;
export const REPRESENTATIVE_PERMISSIONS: readonly PortalPermission[] =
  PORTAL_PERMISSIONS.filter(
    (permission) =>
      !["assignments.submit", "quizzes.attempt", "portfolio.edit"].includes(
        permission,
      ),
  );
export const portalLoginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{4,32}$/);
export const portalPasswordSchema = z
  .string()
  .min(12)
  .refine(
    (password) => new TextEncoder().encode(password).length <= 72,
    "portalPasswordTooLong",
  );
export const portalClassificationSchema = z.enum([
  "adult",
  "minor",
  "unverified",
]);
export type PortalClassification = z.infer<typeof portalClassificationSchema>;
export const portalRelationshipSchema = z.enum([
  "parent",
  "guardian",
  "payer",
  "other",
]);
export const portalAccountSchema = z.object({
  id: z.number().int().positive(),
  login: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  locale: z.enum(["ru", "en"]),
  status: z.enum(["pending", "active", "suspended", "archived"]),
});
export type PortalAccountDto = z.infer<typeof portalAccountSchema>;
export const portalSubjectSchema = z.object({
  linkId: z.number().int().positive(),
  studentId: z.number().int().positive(),
  studentName: z.string(),
  kind: z.enum(["self", "representative"]),
  relationship: portalRelationshipSchema.nullable(),
  permissions: z.array(portalPermissionSchema),
  status: z.literal("active"),
  studentClassification: portalClassificationSchema,
});
export type PortalSubjectDto = z.infer<typeof portalSubjectSchema>;
export const portalSessionSchema = z.object({
  account: portalAccountSchema.nullable(),
  subjects: z.array(portalSubjectSchema),
  csrfToken: z.string().min(1),
});
export type PortalSessionDto = z.infer<typeof portalSessionSchema>;
export const portalLoginCommandSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(256),
  })
  .strict();
export const portalInvitationAcceptSchema = z
  .object({
    token: z.string().min(32).max(256),
    password: portalPasswordSchema.optional(),
    fullName: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export const portalReauthenticateSchema = z
  .object({ password: z.string().min(1).max(256) })
  .strict();
export const portalPasswordChangeSchema = z
  .object({
    password: z.string().min(1).max(256),
    newPassword: portalPasswordSchema,
  })
  .strict();
export const portalProfileUpdateSchema = z
  .object({
    fullName: z.string().trim().min(1).max(255).optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    locale: z.enum(["ru", "en"]).optional(),
  })
  .strict();
export const portalChildCredentialsSchema = z
  .object({
    login: portalLoginSchema.optional(),
    password: portalPasswordSchema,
  })
  .strict();
export const portalClassificationCommandSchema = z
  .object({
    classification: portalClassificationSchema,
    verificationMethod: z.string().trim().min(3).max(120),
    verifiedBirthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return (
          !Number.isNaN(date.getTime()) &&
          date.toISOString().slice(0, 10) === value
        );
      }, "portalBirthDateInvalid")
      .nullable()
      .optional(),
  })
  .strict();
export const portalInvitationCreateSchema = z
  .object({
    accountId: z.number().int().positive().optional(),
    account: z
      .object({
        login: portalLoginSchema,
        fullName: z.string().trim().min(1).max(255),
        email: z
          .string()
          .trim()
          .toLowerCase()
          .email()
          .max(254)
          .nullable()
          .optional(),
        phone: z.string().trim().max(50).nullable().optional(),
        locale: z.enum(["ru", "en"]).default("ru"),
      })
      .strict()
      .optional(),
    kind: z.enum(["self", "representative"]),
    relationship: portalRelationshipSchema.nullable().optional(),
    permissions: z
      .array(portalPermissionSchema)
      .max(PORTAL_PERMISSIONS.length)
      .default([]),
    verificationMethod: z.string().trim().min(3).max(120),
    verificationBasis: z.string().trim().min(3).max(500),
    adultConsent: z
      .object({
        method: z.enum(["in_person", "portal"]),
        confirmed: z.boolean(),
      })
      .optional(),
    channel: z.literal("manual").default("manual"),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .refine(
    (command) => Boolean(command.accountId) !== Boolean(command.account),
    "portalAccountRequired",
  );
export type PortalInvitationCreateCommand = z.infer<
  typeof portalInvitationCreateSchema
>;
export type PortalAccessLinkDto = {
  id: number;
  account: PortalAccountDto;
  kind: "self" | "representative";
  relationship: z.infer<typeof portalRelationshipSchema> | null;
  permissions: PortalPermission[];
  status: "pending" | "active" | "suspended" | "revoked";
  verifiedAt: string | null;
  invitation: {
    id: number;
    status:
      | "created"
      | "sent"
      | "delivery_failed"
      | "accepted"
      | "expired"
      | "revoked";
    expiresAt: string;
    channel: "manual";
  } | null;
};
export type PortalStudentAccessDto = {
  studentId: number;
  studentName: string;
  classification: PortalClassification;
  links: PortalAccessLinkDto[];
};
export type PortalInvitationResultDto = {
  invitationId: number;
  linkId: number;
  accountId: number;
  expiresAt: string;
  activationUrl: string | null;
  status: "created" | "sent";
  replayed: boolean;
};
export type PortalDeviceSessionDto = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};
export const portalPermissionUpdateSchema = z
  .object({
    permissions: z.array(portalPermissionSchema).max(PORTAL_PERMISSIONS.length),
    verificationMethod: z.string().trim().min(3).max(120),
    verificationBasis: z.string().trim().min(3).max(500),
    adultConsent: z
      .object({ method: z.literal("in_person"), confirmed: z.literal(true) })
      .optional(),
  })
  .strict();
export const portalStaffRecoverySchema = z
  .object({
    password: portalPasswordSchema,
    verificationMethod: z.string().trim().min(3).max(120),
    verificationBasis: z.string().trim().min(3).max(500),
  })
  .strict();
export const portalConsentSchema = z
  .object({
    linkId: z.number().int().positive(),
    permissions: z.array(portalPermissionSchema),
    approved: z.boolean(),
  })
  .strict();

export const portalAccountStatusSchema = z
  .object({ status: z.enum(["suspended", "active"]) })
  .strict();
