import {
  LEAD_QUALIFIED_ACTION, LEAD_QUALIFICATION_REVOKED_ACTION,
  type LeadQualification, type LeadQualificationRequest, type RevokeLeadQualificationRequest,
} from '@shared/contracts/lead-qualification';
import type { LeadQualificationRepository } from '../application/qualification-service';
import { canActorMutateLead, canActorViewLead } from '../domain/access-policy';
import type { ActorContext } from '../domain/actor-context';
import { queryOne, withTransaction, type Row } from '../../academy/academy-core';

const readFact = (leadId: number, funnelId: number) => queryOne<Row>(
  `SELECT id, action, created_at, user_id FROM audit_logs
   WHERE entity_type = 'academy_lead' AND entity_id = $1
     AND action IN ($2, $3) AND new_values->0->>'funnelId' = $4::text
   ORDER BY created_at DESC, id DESC LIMIT 1`,
  [leadId, LEAD_QUALIFIED_ACTION, LEAD_QUALIFICATION_REVOKED_ACTION, String(funnelId)],
);

const present = (funnelId: number, fact?: Row): LeadQualification => ({
  funnelId,
  qualifiedAt: fact?.action === LEAD_QUALIFIED_ACTION ? new Date(fact.createdAt).toISOString() : null,
  qualifiedBy: fact?.action === LEAD_QUALIFIED_ACTION ? fact.userId : null,
});

export class LegacyLeadQualificationRepository implements LeadQualificationRepository {
  async get(leadId: number, actor: ActorContext) {
    const lead = await queryOne<Row>('SELECT * FROM academy_leads WHERE id = $1', [leadId]);
    if (!lead) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
    if (!canActorViewLead(actor, lead)) throw Object.assign(new Error('accessDenied'), { statusCode: 403 });
    return present(lead.funnelId, await readFact(leadId, lead.funnelId));
  }

  async set(leadId: number, actor: ActorContext, input: LeadQualificationRequest | RevokeLeadQualificationRequest) {
    return withTransaction(async () => {
      const lead = await queryOne<Row>('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE', [leadId]);
      if (!lead) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
      if (!canActorMutateLead(actor, lead)) throw Object.assign(new Error('accessDenied'), { statusCode: 403 });
      if (lead.isArchived || Number(lead.funnelId) !== input.funnelId) {
        throw Object.assign(new Error('leadQualificationChanged'), { statusCode: 409 });
      }
      const action = 'locationFits' in input ? LEAD_QUALIFIED_ACTION : LEAD_QUALIFICATION_REVOKED_ACTION;
      const previous = await readFact(leadId, lead.funnelId);
      if (previous?.action === action || (!previous && action === LEAD_QUALIFICATION_REVOKED_ACTION)) {
        return present(lead.funnelId, previous);
      }
      if ('qualifiedAt' in input && previous?.action === LEAD_QUALIFIED_ACTION
        && new Date(previous.createdAt).toISOString() !== input.qualifiedAt) {
        throw Object.assign(new Error('leadQualificationChanged'), { statusCode: 409 });
      }
      // This is a business fact, so persist it in the same transaction under the
      // lead lock, rather than using the best-effort after-commit audit helper.
      const fact = await queryOne<Row>(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
         VALUES ($1, $2, 'academy_lead', $3, $4::jsonb) RETURNING *`,
        [actor.userId, action, leadId, JSON.stringify([{
          ...input, managerId: lead.managerId ?? actor.userId,
          ...(action === LEAD_QUALIFICATION_REVOKED_ACTION ? { revokedFactId: previous?.id } : {}),
        }])],
      );
      return present(lead.funnelId, fact);
    });
  }
}
