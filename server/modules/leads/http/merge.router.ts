import { Router, type Response } from 'express';
import {
  mergeLeadDraftRequestSchema,
  mergeLeadIdsSchema,
  mergeLeadPreviewQuerySchema,
} from '@shared/contracts/academy-leads';
import { logger } from '../../../lib/logger';
import { getPublicErrorMessage, getHttpErrorStatus } from '../../../lib/http-errors';
import { duplicateHintForActor } from '../domain/access-policy';
import type { LeadMergeService } from '../application/merge-service';
import { actorContextFromRequest } from './actor-context';

const sendError = (
  response: Response,
  error: unknown,
  fallback: string,
) => response.status(getHttpErrorStatus(error)).json({
  error: getPublicErrorMessage(error, fallback),
});

export const createLeadMergeRouter = (service: LeadMergeService) => {
  const router = Router();

  router.get('/leads/merge-candidates', async (request, response) => {
    try {
      const actor = actorContextFromRequest(request);
      response.json(await service.search(actor, String(request.query.q ?? '')));
    } catch (error) {
      logger.error('Failed to search lead merge candidates', { error });
      sendError(response, error, 'leadMergeSearchFailed');
    }
  });

  router.get('/leads/merge-preview', async (request, response) => {
    const parsed = mergeLeadPreviewQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return response.status(400).json({ error: 'leadMergeRequiresDifferentLeads' });
    }
    try {
      const actor = actorContextFromRequest(request);
      response.json(await service.preview(actor, parsed.data.firstLeadId, parsed.data.secondLeadId));
    } catch (error) {
      logger.error('Failed to preview lead merge', { error });
      sendError(response, error, 'leadMergePreviewFailed');
    }
  });

  router.post('/leads/merge', async (request, response) => {
    const parsed = mergeLeadIdsSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'leadMergeRequiresDifferentLeads' });
    }
    try {
      const actor = actorContextFromRequest(request);
      response.json(await service.merge(
        actor,
        parsed.data.retainedLeadId,
        parsed.data.duplicateLeadId,
      ));
    } catch (error) {
      logger.error('Failed to merge leads', { error });
      sendError(response, error, 'leadMergeFailed');
    }
  });

  router.post('/leads/merge-draft', async (request, response) => {
    const parsed = mergeLeadDraftRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'invalidData' });
    }
    const actor = actorContextFromRequest(request);
    try {
      response.json(await service.mergeDraft(
        actor,
        parsed.data.retainedLeadId,
        parsed.data.draft,
      ));
    } catch (error: unknown) {
      logger.error('Failed to merge lead draft', { error });
      const typed = error as { duplicate?: Record<string, unknown> };
      response.status(getHttpErrorStatus(error)).json({
        error: getPublicErrorMessage(error, 'leadMergeFailed'),
        ...(typed.duplicate
          ? { duplicate: duplicateHintForActor(actor, typed.duplicate) }
          : {}),
      });
    }
  });

  return router;
};
