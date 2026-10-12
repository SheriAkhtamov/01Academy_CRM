import { z } from 'zod';
export const LEARNING_FLAG_KEYS = ['learning', 'invitations', 'public_portfolio'] as const;
export type LearningFlagKey = (typeof LEARNING_FLAG_KEYS)[number];
export type LearningFlagDto = { key: LearningFlagKey; enabled: boolean; allGroups: boolean; groupIds: number[]; updatedAt: string | null; version: number };
export type LearningCapabilitiesDto = { portalEnabled: boolean; learningEnabled: boolean; invitationsEnabled: boolean; publicPortfolioEnabled: boolean; canManageAccess?: boolean;canManageLearning?:boolean };
export type LearningRolloutDto = { capabilities: LearningCapabilitiesDto; flags: LearningFlagDto[]; groups: { id: number; name: string }[]; };
export const learningFlagUpdateSchema = z.object({
  key: z.enum(LEARNING_FLAG_KEYS), enabled: z.boolean(), allGroups: z.boolean(),
  groupIds: z.array(z.number().int().positive()).max(1000),
  version: z.number().int().nonnegative().default(0),
}).strict().refine((value) => !value.enabled || value.allGroups || value.groupIds.length > 0, 'portalPilotGroupsRequired')
  .refine((value) => new Set(value.groupIds).size === value.groupIds.length, 'portalInvalidData');
export type LearningFlagUpdateInput = z.infer<typeof learningFlagUpdateSchema>;
