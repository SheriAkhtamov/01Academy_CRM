import { Router } from 'express';
import { leadIdParamsSchema } from '@shared/contracts/academy-leads';
import { leadQualificationRequestSchema, revokeLeadQualificationRequestSchema } from '@shared/contracts/lead-qualification';
import type { LeadQualificationService } from '../application/qualification-service';
import { actorContextFromRequest } from './actor-context';
import { getHttpErrorStatus, getPublicErrorMessage } from '../../../lib/http-errors';

export function createLeadQualificationRouter(service: LeadQualificationService) {
  const router = Router();
  router.get('/leads/:id/qualification', async (req, res) => {
    const params = leadIdParamsSchema.safeParse(req.params);
    if (!params.success) return res.status(400).json({ error: 'invalidData' });
    try {
      res.json(await service.get(params.data.id, actorContextFromRequest(req)));
    } catch (error) {
      res.status(getHttpErrorStatus(error)).json({ error: getPublicErrorMessage(error, 'failedToLoadData') });
    }
  });
  for (const method of ['post', 'delete'] as const) {
    router[method]('/leads/:id/qualification', async (req, res) => {
      const params = leadIdParamsSchema.safeParse(req.params);
      const input = (method === 'post' ? leadQualificationRequestSchema : revokeLeadQualificationRequestSchema).safeParse(req.body);
      if (!params.success || !input.success) return res.status(400).json({ error: 'invalidData' });
      try {
        res.json(await service.set(params.data.id, actorContextFromRequest(req), input.data));
      } catch (error) {
        res.status(getHttpErrorStatus(error)).json({ error: getPublicErrorMessage(error, 'leadQualificationFailed') });
      }
    });
  }
  return router;
}
