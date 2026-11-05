import type { LeadLifecycleRepository } from '../application/ports';
import type { ActorContext } from '../domain/actor-context';
import {
  createAudit,
  query,
  queryOne,
  withTransaction,
} from '../../academy/academy-core';
import { getLead } from '../../academy/academy-leads';

export class LegacyLeadLifecycleRepository implements LeadLifecycleRepository {
  async delete(leadId: number, actor: ActorContext) {
    const lead = await getLead(leadId);
    if (!lead) {
      throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
    }

    await withTransaction(async () => {
      // Board cards outlive the lead: the foreign key only clears their link.
      const deletedLead = await queryOne(
        `DELETE FROM academy_leads WHERE id = $1 RETURNING id`,
        [leadId],
      );
      if (!deletedLead) {
        throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      }
      await query(
        `DELETE FROM academy_lead_tags tag
         WHERE NOT EXISTS (
           SELECT 1
           FROM academy_lead_tag_assignments assignment
           WHERE assignment.tag_id = tag.id
         )`,
      );
    });

    await createAudit(actor, 'DELETE_ACADEMY_LEAD', 'academy_lead', leadId, {}, lead);
    return { ok: true as const };
  }

  async bulkDelete(leadIds: readonly number[], actor: ActorContext) {
    const uniqueLeadIds = [...new Set(leadIds)];
    const result = await withTransaction(async () => {
      const leads = await query(
        `SELECT *
         FROM academy_leads
         WHERE id = ANY($1::int[])
         ORDER BY id
         FOR UPDATE`,
        [uniqueLeadIds],
      );
      if (leads.length !== uniqueLeadIds.length) {
        throw Object.assign(new Error('One or more leads were not found'), { statusCode: 404 });
      }

      const deletedLeads = await query<{ id: number }>(
        `DELETE FROM academy_leads
         WHERE id = ANY($1::int[])
         RETURNING id`,
        [uniqueLeadIds],
      );
      if (deletedLeads.length !== uniqueLeadIds.length) {
        throw Object.assign(new Error('One or more leads were not found'), { statusCode: 404 });
      }
      await query(
        `DELETE FROM academy_lead_tags tag
         WHERE NOT EXISTS (
           SELECT 1
           FROM academy_lead_tag_assignments assignment
           WHERE assignment.tag_id = tag.id
         )`,
      );
      return { leads };
    });

    await Promise.all(result.leads.map((lead) => createAudit(
      actor,
      'DELETE_ACADEMY_LEAD',
      'academy_lead',
      Number(lead.id),
      { deletedInBulk: true },
      lead,
    )));

    return {
      ok: true as const,
      deletedCount: result.leads.length,
    };
  }
}
