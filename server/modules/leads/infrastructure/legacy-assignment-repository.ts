import type {
  LeadAssignmentRepository,
  LeadRecord,
} from '../application/ports';
import type { ActorContext } from '../domain/actor-context';
import { canActorMutateLead } from '../domain/access-policy';
import {
  applyLeadVisibilityForActor,
  createAudit,
} from '../../academy/academy-core';
import {
  getActiveSalesManager,
  getLead,
  reassignLead,
} from '../../academy/academy-leads';

const datasetActor = (actor: ActorContext) => ({
  userId: actor.userId,
  module: actor.primaryModule ?? '',
  modules: [...actor.modules],
  scopeModule: 'sales' as const,
});

export class LegacyLeadAssignmentRepository implements LeadAssignmentRepository {
  async assign(
    leadId: number,
    managerId: number,
    actor: ActorContext,
    comment?: string | null,
  ): Promise<LeadRecord> {
    const previous = await getLead(leadId);
    if (!previous) {
      throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
    }
    if (!canActorMutateLead(actor, previous)) {
      throw Object.assign(new Error('Lead mutation access required'), { statusCode: 403 });
    }

    const manager = await getActiveSalesManager(managerId);
    const lead = await reassignLead(actor, previous, manager, comment);
    await createAudit(
      actor,
      'ASSIGN_ACADEMY_LEAD',
      'academy_lead',
      Number(lead.id),
      lead,
      previous,
    );
    return (await applyLeadVisibilityForActor(datasetActor(actor), [lead]))[0] as LeadRecord;
  }
}
