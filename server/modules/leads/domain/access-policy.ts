import type { AcademyAccessModule } from '@shared/academy';
import type { ActorContext } from './actor-context';

export type LeadAccessRecord = {
  managerId?: number | null;
};

export const actorHasModule = (
  actor: ActorContext,
  module: AcademyAccessModule,
): boolean => actor.isLeadership || actor.modules.includes(module);

export const canActorViewLead = (
  actor: ActorContext,
  lead?: LeadAccessRecord | null,
): boolean => Boolean(
  lead
  && (
    actor.isLeadership
    || actorHasModule(actor, 'marketing')
    || (
      actorHasModule(actor, 'sales')
      && (!lead.managerId || Number(lead.managerId) === actor.userId)
    )
  ),
);

export const canActorMutateLead = canActorViewLead;

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
