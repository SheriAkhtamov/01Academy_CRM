import type { LeadQualification, LeadQualificationRequest, RevokeLeadQualificationRequest } from '@shared/contracts/lead-qualification';
import { actorHasModule } from '../domain/access-policy';
import type { ActorContext } from '../domain/actor-context';

export interface LeadQualificationRepository {
  get(leadId: number, actor: ActorContext): Promise<LeadQualification>;
  set(leadId: number, actor: ActorContext, input: LeadQualificationRequest | RevokeLeadQualificationRequest): Promise<LeadQualification>;
}

export const createLeadQualificationService = (repository: LeadQualificationRepository) => ({
  get: (leadId: number, actor: ActorContext) => repository.get(leadId, actor),
  set(leadId: number, actor: ActorContext, input: LeadQualificationRequest | RevokeLeadQualificationRequest) {
    if (!actorHasModule(actor, 'sales') && !actorHasModule(actor, 'marketing')) {
      throw Object.assign(new Error('accessDenied'), { statusCode: 403 });
    }
    return repository.set(leadId, actor, input);
  },
});
export type LeadQualificationService = ReturnType<typeof createLeadQualificationService>;
