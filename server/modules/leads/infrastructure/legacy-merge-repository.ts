import type { ActorContext } from '../domain/actor-context';
import type {
  LeadMergeRepository,
  LeadMergeResult,
  LeadRecord,
} from '../application/ports';
import {
  applyLeadVisibilityForActor,
  query,
  type DatasetActor,
} from '../../academy/academy-core';
import {
  getLeadMergeCandidates,
  leadMergeCandidateSelect,
  mergeLeadDraftIntoExisting,
  mergeLeadRecords,
} from '../../academy/academy-leads';

const datasetActor = (actor: ActorContext): DatasetActor => ({
  userId: actor.userId,
  module: actor.primaryModule ?? '',
  modules: [...actor.modules],
  scopeModule: 'sales' as const,
});

export class LegacyLeadMergeRepository implements LeadMergeRepository {
  async search(term: string): Promise<LeadRecord[]> {
    const like = `%${term.toLowerCase()}%`;
    return query<LeadRecord>(
      `${leadMergeCandidateSelect(`
        COALESCE(l.is_archived, false) = false
        AND (
          LOWER(l.contact_name) LIKE $1
          OR LOWER(COALESCE(l.student_name, '')) LIKE $1
          OR LOWER(COALESCE(l.phone, '')) LIKE $1
          OR LOWER(COALESCE(l.messenger, '')) LIKE $1
          OR EXISTS (
            SELECT 1
            FROM academy_lead_phones phone
            WHERE phone.lead_id = l.id AND LOWER(phone.phone) LIKE $1
          )
        )
      `)}
       ORDER BY l.updated_at DESC NULLS LAST, l.id DESC
       LIMIT 10`,
      [like],
    );
  }

  preview(firstLeadId: number, secondLeadId: number): Promise<LeadRecord[]> {
    return getLeadMergeCandidates([firstLeadId, secondLeadId]) as Promise<LeadRecord[]>;
  }

  async merge(
    retainedLeadId: number,
    duplicateLeadId: number,
    actor: ActorContext,
  ): Promise<LeadMergeResult> {
    const result = await mergeLeadRecords(actor, retainedLeadId, duplicateLeadId);
    return {
      ...result,
      retainedLead: await this.present(result.retainedLead as LeadRecord, actor),
    } as LeadMergeResult;
  }

  mergeDraft(
    retainedLeadId: number,
    draft: Record<string, unknown>,
    actor: ActorContext,
  ) {
    return mergeLeadDraftIntoExisting(actor, retainedLeadId, draft) as Promise<{
      retainedLead: LeadRecord;
      assignedManager: { id: number; fullName: string } | null;
    }>;
  }

  async present(lead: LeadRecord, actor: ActorContext): Promise<LeadRecord> {
    return (await applyLeadVisibilityForActor(datasetActor(actor), [lead]))[0] as LeadRecord;
  }
}
