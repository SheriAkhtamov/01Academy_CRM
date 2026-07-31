import { Router, type Response } from 'express';
import {
  leadCommentRequestSchema,
  leadIdParamsSchema,
  leadTagRequestSchema,
} from '@shared/contracts/academy-leads';
import { getHttpErrorStatus, getPublicErrorMessage } from '../../../lib/http-errors';
import { logger } from '../../../lib/logger';
import type { LeadRelationsService } from '../application/relations-service';
import { actorContextFromRequest } from './actor-context';

const assignmentParamsSchema = leadIdParamsSchema.extend({
  assignmentId: leadIdParamsSchema.shape.id,
});

const sendError = (response: Response, error: unknown, fallback: string) => (
  response.status(getHttpErrorStatus(error)).json({
    error: getPublicErrorMessage(error, fallback),
  })
);

export const createLeadRelationsRouter = (service: LeadRelationsService) => {
  const router = Router();

  router.post('/leads/:id/tags', async (request, response) => {
    const params = leadIdParamsSchema.safeParse(request.params);
    const input = leadTagRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) {
      return response.status(400).json({ error: 'leadTagNameInvalid' });
    }
    try {
      const result = await service.addTag(
        actorContextFromRequest(request),
        params.data.id,
        input.data,
      ) as { created?: boolean };
      response.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      logger.error('Failed to add lead tag', { error, leadId: request.params.id });
      sendError(response, error, 'leadTagAddFailed');
    }
  });

  router.delete('/leads/:id/tags/:assignmentId', async (request, response) => {
    const params = assignmentParamsSchema.safeParse(request.params);
    if (!params.success) {
      return response.status(400).json({ error: 'invalidData' });
    }
    try {
      response.json(await service.removeTag(
        actorContextFromRequest(request),
        params.data.id,
        params.data.assignmentId,
      ));
    } catch (error) {
      logger.error('Failed to remove lead tag', { error, leadId: request.params.id });
      sendError(response, error, 'leadTagRemoveFailed');
    }
  });

  router.post('/leads/:id/comments', async (request, response) => {
    const params = leadIdParamsSchema.safeParse(request.params);
    const input = leadCommentRequestSchema.safeParse(request.body);
    if (!params.success) {
      return response.status(400).json({ error: 'Invalid lead id' });
    }
    if (!input.success) {
      return response.status(400).json({ error: 'leadCommentRequired' });
    }
    try {
      response.status(201).json(await service.addComment(
        actorContextFromRequest(request),
        params.data.id,
        input.data.body,
      ));
    } catch (error) {
      logger.error('Failed to add lead comment', { error, leadId: request.params.id });
      sendError(response, error, 'leadCommentAddFailed');
    }
  });

  return router;
};
