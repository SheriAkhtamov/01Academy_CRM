import { Router } from 'express';
import { leadIdParamsSchema } from '@shared/contracts/academy-leads';
import { getHttpErrorStatus, getPublicErrorMessage } from '../../../lib/http-errors';
import { logger } from '../../../lib/logger';
import type { LeadLifecycleService } from '../application/lifecycle-service';
import { actorContextFromRequest } from './actor-context';

export const createLeadLifecycleRouter = (service: LeadLifecycleService) => {
  const router = Router();

  router.delete('/leads/:id', async (request, response) => {
    const params = leadIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return response.status(400).json({ error: 'Invalid lead id' });
    }
    try {
      response.json(await service.delete(
        actorContextFromRequest(request),
        params.data.id,
      ));
    } catch (error: unknown) {
      logger.error('Failed to delete lead', { error });
      const isForeignKeyConflict = (error as { code?: unknown })?.code === '23503';
      response.status(isForeignKeyConflict ? 409 : getHttpErrorStatus(error)).json({
        error: isForeignKeyConflict
          ? 'resourceInUse'
          : getPublicErrorMessage(error, 'Failed to delete lead'),
      });
    }
  });

  return router;
};
