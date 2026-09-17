import { actorContextFrom, type ActorSource } from '../leads/domain/actor-context';
import { queryOne, type Row } from './academy-core';
import { handleLeadStatusEffects } from './academy-leads';

// Both attendance and the explicit continuation command use the same atomic
// transition. It never assigns the actor or clears the current manager.
export const transitionDemoLead = async (
  source: ActorSource,
  lead: Row,
  statusCode: string,
  demoAttended: boolean | null,
  demoLessonId: number | null,
  comment: string,
): Promise<Row> => {
  const actor = actorContextFrom(source);
  let updated: Row | null | undefined;
  try {
    updated = await queryOne(
      `SELECT * FROM academy_transition_demo_lead($1, $2, $3, $4, $5, $6)`,
      [lead.id, statusCode, demoAttended, demoLessonId, actor.userId || null, comment],
    );
  } catch (error) {
    const failure = error as Error & { code?: string; statusCode?: number };
    if (failure.code === 'P0001') {
      if (failure.message === 'resourceNotFound') failure.statusCode = 404;
      else if (failure.message === 'accessDenied') failure.statusCode = 403;
      else if (['invalidLeadStatus', 'salesFunnelRequired'].includes(failure.message)) failure.statusCode = 409;
    }
    throw error;
  }
  if (!updated) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
  if (String(lead.statusCode) !== String(updated.statusCode)) {
    await handleLeadStatusEffects(source, updated, String(lead.statusCode));
  }
  return updated;
};
