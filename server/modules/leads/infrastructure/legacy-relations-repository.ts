import {
  leadTagNameKey,
  normalizeLeadTagName,
} from '@shared/lead-tags';
import type { LeadRelationsRepository } from '../application/ports';
import { canActorMutateLead } from '../domain/access-policy';
import type { ActorContext } from '../domain/actor-context';
import {
  createAudit,
  insertRow,
  query,
  queryOne,
  updateRow,
  withTransaction,
  type Row,
} from '../../academy/academy-core';
import { getLockedLeadWithSource } from '../../academy/academy-leads';

type TagMutationResult = {
  automatic: boolean;
  created: boolean;
  tag: { id: number | null; tagId: number | null; name: string };
};

const requireMutableLead = async (leadId: number, actor: ActorContext) => {
  const lead = await getLockedLeadWithSource(leadId);
  if (!lead) {
    throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  }
  if (!canActorMutateLead(actor, lead)) {
    throw Object.assign(new Error('Lead mutation access required'), { statusCode: 403 });
  }
  return lead;
};

export class LegacyLeadRelationsRepository implements LeadRelationsRepository {
  async addTag(
    leadId: number,
    input: Record<string, unknown>,
    actor: ActorContext,
  ): Promise<TagMutationResult> {
    const usesExistingTag = input.tagId !== undefined;
    const tagId = usesExistingTag ? Number(input.tagId) : null;
    const normalizedTag = usesExistingTag ? null : normalizeLeadTagName(input.name);
    if (!usesExistingTag && !normalizedTag) {
      throw Object.assign(new Error('leadTagNameInvalid'), { statusCode: 400 });
    }

    const result = await withTransaction<TagMutationResult>(async () => {
      const lead = await requireMutableLead(leadId, actor);
      let tag: Row | undefined;

      if (tagId) {
        tag = await queryOne(
          `SELECT * FROM academy_lead_tags WHERE id = $1 FOR SHARE`,
          [tagId],
        );
        if (!tag) {
          throw Object.assign(new Error('leadTagNotFound'), { statusCode: 404 });
        }
      } else if (normalizedTag) {
        if (leadTagNameKey(lead.sourceName) === normalizedTag.normalizedName) {
          return {
            automatic: true,
            created: false,
            tag: { id: null, tagId: null, name: String(lead.sourceName) },
          };
        }

        tag = await queryOne(
          `INSERT INTO academy_lead_tags (name, normalized_name, created_by)
           VALUES ($1, public.academy_normalize_lead_tag_name($1), $2)
           ON CONFLICT (normalized_name) DO NOTHING
           RETURNING *`,
          [normalizedTag.name, actor.userId],
        );
        tag ??= await queryOne(
          `SELECT *
           FROM academy_lead_tags
           WHERE normalized_name = public.academy_normalize_lead_tag_name($1)
           FOR SHARE`,
          [normalizedTag.name],
        );
      }

      if (!tag) {
        throw Object.assign(new Error('leadTagNotFound'), { statusCode: 404 });
      }
      if (leadTagNameKey(lead.sourceName) === leadTagNameKey(tag.name)) {
        return {
          automatic: true,
          created: false,
          tag: { id: null, tagId: null, name: String(lead.sourceName) },
        };
      }

      const inserted = await queryOne(
        `INSERT INTO academy_lead_tag_assignments (lead_id, tag_id, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (lead_id, tag_id) DO NOTHING
         RETURNING *`,
        [leadId, tag.id, actor.userId],
      );
      const assignment = inserted ?? await queryOne(
        `SELECT * FROM academy_lead_tag_assignments
         WHERE lead_id = $1 AND tag_id = $2 FOR SHARE`,
        [leadId, tag.id],
      );
      if (!assignment) {
        throw Object.assign(new Error('leadTagAddFailed'), { statusCode: 409 });
      }

      return {
        automatic: false,
        created: Boolean(inserted),
        tag: {
          id: Number(assignment.id),
          tagId: Number(tag.id),
          name: String(tag.name),
        },
      };
    });

    if (result.created) {
      await createAudit(actor, 'ADD_ACADEMY_LEAD_TAG', 'academy_lead', leadId, result.tag);
    }
    return result;
  }

  async removeTag(leadId: number, assignmentId: number, actor: ActorContext) {
    const removedTag = await withTransaction(async () => {
      await requireMutableLead(leadId, actor);
      const assignment = await queryOne(
        `SELECT assignment.id, tag.id AS tag_id, tag.name
         FROM academy_lead_tag_assignments assignment
         JOIN academy_lead_tags tag ON tag.id = assignment.tag_id
         WHERE assignment.id = $1 AND assignment.lead_id = $2
         FOR UPDATE OF assignment`,
        [assignmentId, leadId],
      );
      if (!assignment) {
        throw Object.assign(new Error('leadTagNotFound'), { statusCode: 404 });
      }

      // Automatic tags are derived from academy_leads.source_id and never
      // create an assignment row, so only a manual link reaches this delete.
      await query(
        `DELETE FROM academy_lead_tag_assignments WHERE id = $1 AND lead_id = $2`,
        [assignmentId, leadId],
      );
      await query(
        `DELETE FROM academy_lead_tags tag
         WHERE tag.id = $1
           AND NOT EXISTS (
             SELECT 1
             FROM academy_lead_tag_assignments assignment
             WHERE assignment.tag_id = tag.id
           )`,
        [assignment.tagId],
      );
      return {
        id: Number(assignment.id),
        tagId: Number(assignment.tagId),
        name: String(assignment.name),
      };
    });

    await createAudit(
      actor,
      'REMOVE_ACADEMY_LEAD_TAG',
      'academy_lead',
      leadId,
      undefined,
      removedTag,
    );
    return { success: true, tag: removedTag };
  }

  async addComment(leadId: number, body: string, actor: ActorContext) {
    const comment = await withTransaction<Row & { authorName: string | null }>(async () => {
      const lead = await queryOne(
        `SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`,
        [leadId],
      );
      if (!lead) {
        throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      }
      if (!canActorMutateLead(actor, lead)) {
        throw Object.assign(new Error('Lead mutation access required'), { statusCode: 403 });
      }
      const created = await insertRow('academy_lead_comments', {
        leadId,
        authorId: actor.userId,
        body,
      });
      await updateRow('academy_leads', leadId, { comment: body });
      return { ...created, authorName: actor.displayName ?? null };
    });

    await createAudit(actor, 'ADD_ACADEMY_LEAD_COMMENT', 'academy_lead', leadId, {
      commentId: comment.id,
    });
    return comment;
  }
}
