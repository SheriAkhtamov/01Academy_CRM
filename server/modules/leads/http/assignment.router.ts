import { Router } from 'express';
import {
  assignLeadRequestSchema,
  leadIdParamsSchema,
} from '@shared/contracts/academy-leads';
import { getHttpErrorStatus, getPublicErrorMessage } from '../../../lib/http-errors';
import { logger } from '../../../lib/logger';
import type { LeadAssignmentService } from '../application/assignment-service';
import { actorContextFromRequest } from './actor-context';

export const createLeadAssignmentRouter = (service: LeadAssignmentService) => {
  const router = Router();

  router.post('/leads/:id/assign', async (request, response) => {
    const params = leadIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return response.status(400).json({ error: 'Invalid lead id' });
    }
    const input = assignLeadRequestSchema.safeParse(request.body);
    if (!input.success) {
      return response.status(400).json({ error: 'Active account manager is required' });
    }
    try {
      response.json(await service.assign(
        actorContextFromRequest(request),
        params.data.id,
        input.data.managerId,
        input.data.comment,
      ));
    } catch (error) {
      logger.error('Failed to assign lead', { error });
      response.status(getHttpErrorStatus(error)).json({
        error: getPublicErrorMessage(error, 'Failed to assign lead'),
      });
    }
  });

  return router;
};
