import type { AcademyAccessModule } from '@shared/academy';
import { isFullCycleKpiRole } from '@shared/sales-kpi';
import type { ActorContext } from './actor-context';

export type LeadAccessRecord = {
  managerId?: number | null;
  funnelId?: number | null;
  funnelRole?: string | null;
};

export const leadWorkflowRole = (actor: ActorContext, lead: LeadAccessRecord) => lead.funnelRole
  ?? (lead.funnelId && Number(lead.funnelId) === actor.salesWorkflow?.closerFunnelId ? 'closer'
    : lead.funnelId && Number(lead.funnelId) === actor.salesWorkflow?.hunterFunnelId ? 'hunter' : null);

export const canActorAccessFunnel = (actor: ActorContext, lead: LeadAccessRecord): boolean => {
  if (!lead.funnelId) return true;
  const role = leadWorkflowRole(actor, lead);
  const employeeRole = actor.salesWorkflow?.role;
  const assigned = actor.salesWorkflow?.assignedFunnelIds?.includes(Number(lead.funnelId)) === true;
  return actor.isLeadership || Number(lead.managerId) === actor.userId || (assigned && (!role || (role === 'closer'
    ? employeeRole === 'closer' || isFullCycleKpiRole(employeeRole) : employeeRole !== 'closer')));
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
      && canActorAccessFunnel(actor, lead)
      && (!lead.managerId || Number(lead.managerId) === actor.userId)
    )
  ),
);

export const canActorMutateLead = (actor: ActorContext, lead?: LeadAccessRecord | null): boolean =>
  canActorViewLead(actor, lead) && Boolean(lead && (actor.isLeadership
    || leadWorkflowRole(actor, lead) !== 'closer' || Number(lead.managerId) === actor.userId));

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
