import { z } from 'zod';

export const updateLeadDistributionRequestSchema = z.object({
  enabled: z.boolean(),
}).strict();

export type LeadDistributionManager = {
  id: number;
  fullName: string;
};

export type LeadDistributionSettings = {
  enabled: boolean;
  defaultFunnelId: number | null;
  defaultFunnelName: string | null;
  eligibleManagers: LeadDistributionManager[];
  unassignedNewLeadCount: number;
  distributedLeadCount?: number;
};
