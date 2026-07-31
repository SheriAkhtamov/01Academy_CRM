import { actorHasModule } from '../domain/access-policy';
import type { ActorContext } from '../domain/actor-context';
import type { LeadAssignmentRepository } from './ports';

export type LeadAssignmentService = ReturnType<typeof createLeadAssignmentService>;

export const createLeadAssignmentService = (repository: LeadAssignmentRepository) => ({
  async assign(
    actor: ActorContext,
    leadId: number,
    managerId: number,
    comment?: string | null,
  ) {
    if (!actor.isLeadership && !actorHasModule(actor, 'sales')) {
      throw Object.assign(new Error('Lead assignment access required'), { statusCode: 403 });
    }
    if (!actor.isLeadership && managerId !== actor.userId) {
      throw Object.assign(
        new Error('Only leadership can assign a lead to another manager'),
        { statusCode: 403 },
      );
    }
    return repository.assign(leadId, managerId, actor, comment);
  },
});
