import { actorHasModule } from '../domain/access-policy';
import type { ActorContext } from '../domain/actor-context';
import type { LeadRelationsRepository } from './ports';

const requireLeadWriteAccess = (actor: ActorContext) => {
  if (
    !actor.isLeadership
    && !actorHasModule(actor, 'sales')
    && !actorHasModule(actor, 'marketing')
  ) {
    throw Object.assign(new Error('Lead write access required'), { statusCode: 403 });
  }
};

export type LeadRelationsService = ReturnType<typeof createLeadRelationsService>;

export const createLeadRelationsService = (repository: LeadRelationsRepository) => ({
  async addTag(actor: ActorContext, leadId: number, input: Record<string, unknown>) {
    requireLeadWriteAccess(actor);
    return repository.addTag(leadId, input, actor);
  },

  async removeTag(actor: ActorContext, leadId: number, assignmentId: number) {
    requireLeadWriteAccess(actor);
    return repository.removeTag(leadId, assignmentId, actor);
  },

  async addComment(actor: ActorContext, leadId: number, body: string) {
    requireLeadWriteAccess(actor);
    return repository.addComment(leadId, body, actor);
  },
});
