import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { academyPortalQuerySchema, academyPortalLeadRoleSchema, academyPortalCredentialChangeSchema, academyPortalCredentialShowSchema } from '@shared/contracts/academy-portal-access';
import type { AcademyPortalAccessService } from '../application/academy-access-service';
import type { PortalStaffActor } from '../domain/actor-context';
import { PortalError } from '../domain/access-policy';

export function createAcademyPortalAccessRouter(service: AcademyPortalAccessService, resolveActor: (request: Request) => PortalStaffActor | Promise<PortalStaffActor>) {
  const router = Router();
  const route = (work: (request: Request, response: Response, actor: PortalStaffActor) => Promise<unknown>): RequestHandler => async (request, response, next) => {
    try {
      const actor = await resolveActor(request);
      response.setHeader('Cache-Control', 'private, no-store');
      await work(request, response, actor);
    } catch (error) {
      if (error instanceof PortalError) response.status(error.status).json({ code: error.code, error: error.code });
      else if (error instanceof z.ZodError) response.status(400).json({ code: 'portalInvalidData', error: 'portalInvalidData' });
      else next(error);
    }
  };
  const id = (value: string) => z.coerce.number().int().positive().parse(value);
  router.get('/academy-access', route(async (request, response, actor) => response.json(await service.directory(actor, academyPortalQuerySchema.parse(request.query)))));
  router.post('/academy-access/leads/:leadId/role', route(async (request, response, actor) => response.json(await service.chooseLeadRole(actor, id(request.params.leadId), academyPortalLeadRoleSchema.parse(request.body)))));
  router.post('/academy-access/leads/:leadId/accounts/:accountId/credentials/show', route(async (request, response, actor) => {
    const command = academyPortalCredentialShowSchema.parse(request.body);
    response.json(await service.showCredentials(actor, id(request.params.leadId), id(request.params.accountId), command.version));
  }));
  router.patch('/academy-access/leads/:leadId/accounts/:accountId/credentials', route(async (request, response, actor) => response.json(await service.changeCredentials(actor, id(request.params.leadId), id(request.params.accountId), academyPortalCredentialChangeSchema.parse(request.body)))));
  return router;
}
