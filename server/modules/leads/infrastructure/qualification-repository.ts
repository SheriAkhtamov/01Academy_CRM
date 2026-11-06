import {
  LEAD_QUALIFIED_ACTION, LEAD_QUALIFICATION_REVOKED_ACTION,
  type LeadQualification, type LeadQualificationRequest, type RevokeLeadQualificationRequest,
} from '@shared/contracts/lead-qualification';
import type { LeadQualificationRepository } from '../application/qualification-service';
import { canActorMutateLead, canActorViewLead } from '../domain/access-policy';
import type { ActorContext } from '../domain/actor-context';
import { queryOne, withTransaction, type Row } from '../../academy/academy-core';
import { enqueueMetaLeadQualifiedSafely } from '../../../services/meta-marketing';

/** The lead row holds the current qualification; audit facts keep its history. */
const present = (lead: Row): LeadQualification => ({
  funnelId: Number(lead.funnelId),
  qualifiedAt: lead.isQualified && lead.qualifiedAt ? new Date(lead.qualifiedAt).toISOString() : null,
  qualifiedBy: lead.isQualified ? lead.qualifiedBy ?? null : null,
});

export class LegacyLeadQualificationRepository implements LeadQualificationRepository {
  async get(leadId: number, actor: ActorContext) {
    const lead = await queryOne<Row>('SELECT * FROM academy_leads WHERE id = $1', [leadId]);
    if (!lead) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
    if (!canActorViewLead(actor, lead)) throw Object.assign(new Error('accessDenied'), { statusCode: 403 });
    return present(lead);
  }

  async set(leadId: number, actor: ActorContext, input: LeadQualificationRequest | RevokeLeadQualificationRequest) {
    return withTransaction(async () => {
      const lead = await queryOne<Row>('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE', [leadId]);
      if (!lead) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
      if (!canActorMutateLead(actor, lead)) throw Object.assign(new Error('accessDenied'), { statusCode: 403 });
      if (lead.isArchived || Number(lead.funnelId) !== input.funnelId) {
        throw Object.assign(new Error('leadQualificationChanged'), { statusCode: 409 });
      }
      const qualify = 'locationFits' in input;
      if (Boolean(lead.isQualified) === qualify) return present(lead);
      if (!qualify && present(lead).qualifiedAt !== input.qualifiedAt) {
        throw Object.assign(new Error('leadQualificationChanged'), { statusCode: 409 });
      }
      // This is a business fact, so persist it in the same transaction under the
      // lead lock, rather than using the best-effort after-commit audit helper.
      const fact = await queryOne<Row>(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
         VALUES ($1, $2, 'academy_lead', $3, $4::jsonb) RETURNING id, created_at`,
        [actor.userId, qualify ? LEAD_QUALIFIED_ACTION : LEAD_QUALIFICATION_REVOKED_ACTION, leadId, JSON.stringify([{
          ...input, managerId: lead.managerId ?? actor.userId,
        }])],
      );
      // The button records a fact; it does not edit the deal, so the card's version stays.
      const updated = await queryOne<Row>(
        `UPDATE academy_leads
         SET is_qualified = $2, qualified_at = $3, qualified_by = $4
         WHERE id = $1 RETURNING *`,
        [leadId, qualify, qualify ? fact!.createdAt : null, qualify ? actor.userId : null],
      );
      if (qualify) {
        await enqueueMetaLeadQualifiedSafely(leadId, fact!.createdAt);
      }
      return present(updated!);
    });
  }
}
