import type { AcademyAccessModule } from '@shared/academy';
import type { ActorContext } from './actor-context';

export type LeadAccessRecord = {
  managerId?: number | null;
  funnelId?: number | null;
  funnelRole?: string | null;
  statusCode?: string | null;
};

export const canActorAccessFunnel = (actor: ActorContext, lead: LeadAccessRecord): boolean => {
  if (!lead.funnelId) return true;
  const assigned = actor.salesWorkflow?.assignedFunnelIds?.includes(Number(lead.funnelId)) === true;
  return actor.isLeadership || Number(lead.managerId) === actor.userId || assigned;
};

export const actorHasModule = (
  actor: ActorContext,
  module: AcademyAccessModule,
): boolean => actor.isLeadership || actor.modules.includes(module);

export const canActorViewLead = (
  actor: ActorContext,
  lead?: LeadAccessRecord | null,
): boolean => {
  if (!lead) return false;
  if (actor.isLeadership || actorHasModule(actor, 'marketing')) return true;
  if (!actorHasModule(actor, 'sales') || !canActorAccessFunnel(actor, lead)) return false;
  if (lead.managerId) return Number(lead.managerId) === actor.userId;

  const hidesSharedNewLead = actor.salesWorkflow?.autoLeadDistributionEnabled === true
    && lead.statusCode === actor.salesWorkflow.defaultInitialStageCode
    && Number(lead.funnelId) === Number(actor.salesWorkflow.defaultFunnelId);
  return !hidesSharedNewLead;
};

export const canActorMutateLead = (actor: ActorContext, lead?: LeadAccessRecord | null): boolean =>
  canActorViewLead(actor, lead);

// Taking a free lead is not editing an already-owned lead. Repeat assignment
// to oneself is harmless, but employees may never transfer or take another's lead.
export const canActorAssignLead = (
  actor: ActorContext,
  lead: LeadAccessRecord | null | undefined,
  managerId: number,
): boolean => Boolean(lead && (actor.isLeadership || (
  actorHasModule(actor, 'sales')
  && managerId === actor.userId
  && canActorViewLead(actor, lead)
  && (lead.managerId == null || Number(lead.managerId) === actor.userId)
)));

export type DuplicateLeadRecord = LeadAccessRecord & {
  entityType?: unknown;
  isArchived?: unknown;
  [key: string]: unknown;
};

export const duplicateHintForActor = (
  actor: ActorContext,
  duplicate: DuplicateLeadRecord | null | undefined,
) => {
  if (!duplicate) return duplicate;
  return {
    ...duplicate,
    canMerge: duplicate.entityType === 'lead'
      && duplicate.isArchived !== true
      && canActorMutateLead(actor, duplicate),
  };
};
