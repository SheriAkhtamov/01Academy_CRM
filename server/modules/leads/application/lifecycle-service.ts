import type { ActorContext } from '../domain/actor-context';
import type { LeadLifecycleRepository } from './ports';

export type LeadLifecycleService = ReturnType<typeof createLeadLifecycleService>;

export const createLeadLifecycleService = (repository: LeadLifecycleRepository) => ({
  async delete(actor: ActorContext, leadId: number) {
    if (!actor.isLeadership) {
      throw Object.assign(new Error('Admin access required'), { statusCode: 403 });
    }
    return repository.delete(leadId, actor);
  },
  async bulkDelete(actor: ActorContext, leadIds: readonly number[]) {
    if (!actor.isLeadership) {
      throw Object.assign(new Error('Admin access required'), { statusCode: 403 });
    }
    return repository.bulkDelete(leadIds, actor);
  },
});
