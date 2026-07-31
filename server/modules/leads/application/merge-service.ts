import type { ActorContext } from '../domain/actor-context';
import { actorHasModule } from '../domain/access-policy';
import type { LeadMergeRepository, LeadRecord } from './ports';

export type LeadAssignmentNotification = {
  managerId: number;
  leadId: number;
  lead: LeadRecord;
};

export type LeadMergeService = ReturnType<typeof createLeadMergeService>;

const requireLeadership = (actor: ActorContext) => {
  if (!actor.isLeadership) {
    throw Object.assign(new Error('Admin access required'), { statusCode: 403 });
  }
};

const requireLeadWriteAccess = (actor: ActorContext) => {
  if (
    !actor.isLeadership
    && !actorHasModule(actor, 'sales')
    && !actorHasModule(actor, 'marketing')
  ) {
    throw Object.assign(new Error('Lead write access required'), { statusCode: 403 });
  }
};

export const createLeadMergeService = (
  repository: LeadMergeRepository,
  notifyAssignment: (input: LeadAssignmentNotification) => Promise<void>,
) => ({
  async search(actor: ActorContext, term: string) {
    requireLeadership(actor);
    const normalizedTerm = term.trim();
    return normalizedTerm.length < 2 ? [] : repository.search(normalizedTerm);
  },

  async preview(actor: ActorContext, firstLeadId: number, secondLeadId: number) {
    requireLeadership(actor);
    const leads = await repository.preview(firstLeadId, secondLeadId, actor);
    if (leads.length !== 2) {
      throw Object.assign(new Error('leadMergeLeadNotFound'), { statusCode: 404 });
    }
    return { leads };
  },

  async merge(actor: ActorContext, retainedLeadId: number, duplicateLeadId: number) {
    requireLeadWriteAccess(actor);
    return repository.merge(retainedLeadId, duplicateLeadId, actor);
  },

  async mergeDraft(
    actor: ActorContext,
    retainedLeadId: number,
    draft: Record<string, unknown>,
  ) {
    requireLeadWriteAccess(actor);
    const result = await repository.mergeDraft(retainedLeadId, draft, actor);
    if (result.assignedManager) {
      await notifyAssignment({
        managerId: result.assignedManager.id,
        leadId: retainedLeadId,
        lead: result.retainedLead,
      });
    }
    return repository.present(result.retainedLead, actor);
  },
});
