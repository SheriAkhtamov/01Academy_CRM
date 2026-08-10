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

    const deletedTasks = await withTransaction(async () => {
      const taskRows = await query<{ id: number }>(
        `DELETE FROM academy_tasks
         WHERE entity_type = 'lead' AND entity_id = $1
         RETURNING id`,
        [leadId],
      );
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
      return taskRows;
    });

    await createAudit(actor, 'DELETE_ACADEMY_LEAD', 'academy_lead', leadId, {
      deletedTaskCount: deletedTasks.length,
    }, lead);
    return { ok: true as const, deletedTaskCount: deletedTasks.length };
  }
}
