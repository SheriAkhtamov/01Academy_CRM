import { Router, type Request, type Response, type RequestHandler } from 'express';
import fs from 'node:fs/promises';
import { z } from 'zod';
import {
  portalProjectSchema, portalShareSchema, portalShareApprovalSchema, portalProjectReviewSchema,
  portalNotificationPreferencesSchema, portalPaymentAllocationSchema,
  portalFinanceQuestionSchema,portalFinanceMessageSchema,
  portalProjectComparisonSchema,
} from '@shared/contracts/portal-resources';
import type { PortalActorContext } from '../../portal-identity/domain/actor-context';
import type { PortalResourceService } from '../application/resource-service';
import { PortalResourceError, type ResourceStaffActor } from '../domain/policy';
import { PortalError } from '../../portal-identity/domain/access-policy';

const page=(request:Request)=>z.object({cursor:z.coerce.number().int().positive().nullable().default(null),limit:z.coerce.number().int().min(1).max(100).default(30)}).parse(request.query);
const pageDto=<T extends {items:unknown[];nextCursor?:number|null}>(value:T)=>({...value,nextCursor:value.nextCursor ?? null,hasMore:value.nextCursor != null});
const sendPage=<T>(response:Response,value:{items:T[];nextCursor:number|null})=>response.json(pageDto(value));
const id = (value: unknown) => z.coerce.number().int().positive().parse(value);
type PortalResolvers = { actor: (request: Request, linkId: number) => Promise<PortalActorContext>; account: (request: Request) => Promise<number> };
const handler = (operation: (request: Request, response: Response) => Promise<unknown>): RequestHandler => async (request, response, next) => {
  try { await operation(request, response); }
  catch (error) {
    if (error instanceof PortalResourceError) response.status(error.statusCode).json({ code: error.code });
    else if (error instanceof PortalError) response.status(error.status).json({ code: error.code });
    else if (error instanceof z.ZodError) response.status(400).json({ code: 'portalInvalidData', fieldErrors: error.issues.map((issue) => ({ field: issue.path.join('.'), code: issue.message })) });
    else next(error);
  }
};
const cleanup = async (request: Request) => { if (request.file) await fs.unlink(request.file.path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); };
const download = (response: Response, resource: Awaited<ReturnType<PortalResourceService['file']>>, allowInline = false) => {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Type', resource.file.mime);
  if (allowInline && ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(resource.file.mime)) {
    response.attachment(resource.file.name);
    response.setHeader('Content-Disposition', String(response.getHeader('Content-Disposition')).replace(/^attachment/, 'inline'));
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'; sandbox");
    response.sendFile(resource.path);
  }
  else response.download(resource.path, resource.file.name);
};
export function createPortalResourceRouter(service: PortalResourceService, resolvers: PortalResolvers, uploadParser: RequestHandler) {
  const router = Router();
  const actor = (request: Request) => resolvers.actor(request, id(request.params.linkId));
  router.get('/subjects/:linkId/projects', handler(async(request,response)=>{const query=page(request);sendPage(response,await service.projectsPage(await actor(request),query.cursor,query.limit));}));
  router.get('/subjects/:linkId/project-comparison',handler(async(request,response)=>response.json(await service.projectComparison(await actor(request),request.query.runId ? id(request.query.runId):null))));
  router.put('/subjects/:linkId/project-comparison',handler(async(request,response)=>response.json(await service.saveProjectComparison(await actor(request),portalProjectComparisonSchema.parse(request.body)))));
  router.post('/subjects/:linkId/projects', handler(async (request, response) => response.status(201).json(await service.saveProject(await actor(request), null, portalProjectSchema.parse(request.body)))));
  router.get('/subjects/:linkId/projects/source/:submissionId', handler(async (request, response) => response.json(await service.projectSource(await actor(request), id(request.params.submissionId)))));
  router.get('/subjects/:linkId/projects/:id', handler(async (request, response) => response.json(await service.project(await actor(request), id(request.params.id)))));
  router.patch('/subjects/:linkId/projects/:id', handler(async (request, response) => response.json(await service.saveProject(await actor(request), id(request.params.id), portalProjectSchema.parse(request.body)))));
  router.delete('/subjects/:linkId/projects/:id', handler(async (request, response) => { await service.archiveProject(await actor(request), id(request.params.id)); response.json({ success: true }); }));
  router.post('/subjects/:linkId/projects/:id/shares', handler(async (request, response) => response.status(201).json(await service.createShare(await actor(request), id(request.params.id), portalShareSchema.parse(request.body)))));
  router.get('/subjects/:linkId/shares/:id', handler(async (request, response) => response.json(await service.share(await actor(request), id(request.params.id)))));
  router.post('/subjects/:linkId/shares/:id/approve', handler(async (request, response) => { const input = portalShareApprovalSchema.parse(request.body); response.json(await service.approveShare(await actor(request), id(request.params.id), input.version, input.approved)); }));
  router.post('/subjects/:linkId/shares/:id/revoke', handler(async (request, response) => { await service.revokeShare(await actor(request), id(request.params.id)); response.json({ success: true }); }));
  router.get('/subjects/:linkId/payments', handler(async(request,response)=>{const query=page(request);response.json(pageDto(await service.payments(await actor(request),query.cursor,query.limit)));}));
  router.get('/subjects/:linkId/finance-questions',handler(async(request,response)=>{const query=page(request);sendPage(response,await service.financeQuestionsPage(await actor(request),query.cursor,query.limit));}));
  router.post('/subjects/:linkId/finance-questions',handler(async(request,response)=>response.status(201).json(await service.createFinanceQuestion(await actor(request),portalFinanceQuestionSchema.parse(request.body)))));
  router.get('/subjects/:linkId/finance-questions/:id/messages',handler(async(request,response)=>response.json(await service.financeQuestion(await actor(request),id(request.params.id)))));
  router.post('/subjects/:linkId/finance-questions/:id/messages',handler(async(request,response)=>{const input=portalFinanceMessageSchema.parse(request.body);response.json(await service.financeMessage(await actor(request),id(request.params.id),input.body,input.idempotencyKey));}));
  router.post('/files', (request, _response, next) => { void resolvers.account(request).then(() => next()).catch(next); }, uploadParser,
    handler(async (request, response) => {
      try {
        if (!request.file) throw new PortalResourceError('portalFileRequired');
        const scoped = await resolvers.actor(request, id(request.body.linkId));
        response.status(201).json(await service.upload(scoped, request.file.path, request.file.originalname, request.body.runId ? id(request.body.runId) : null));
      } finally { await cleanup(request); }
    }));
  router.get('/files/:id/status', handler(async (request, response) => response.json(await service.fileStatus(await resolvers.actor(request, id(request.query.linkId)), id(request.params.id)))));
  router.get('/files/:id/download', handler(async (request, response) => download(response, await service.file(await resolvers.actor(request, id(request.query.linkId)), id(request.params.id)), request.query.preview === '1')));
  router.get('/notifications', handler(async (request, response) => {
    const query = page(request);
    response.json(pageDto(await service.notifications(await resolvers.account(request), query.cursor, query.limit)));
  }));
  router.post('/notifications/read-all', handler(async (request, response) => { await service.readNotification(await resolvers.account(request), null); response.json({ success: true }); }));
  router.delete('/notifications', handler(async (request, response) => {
    const deletedCount = await service.deleteNotification(await resolvers.account(request), null);
    response.json({ success: true, deletedCount });
  }));
  router.delete('/notifications/:id', handler(async (request, response) => {
    const deletedCount = await service.deleteNotification(await resolvers.account(request), id(request.params.id));
    response.json({ success: true, deletedCount });
  }));
  router.get('/notifications/preferences', handler(async (request, response) => response.json(await service.preferences(await resolvers.account(request)))));
  router.put('/notifications/preferences', handler(async (request, response) => response.json(await service.savePreferences(await resolvers.account(request), portalNotificationPreferencesSchema.parse(request.body)))));
  router.post('/notifications/:id/read', handler(async (request, response) => { await service.readNotification(await resolvers.account(request), id(request.params.id)); response.json({ success: true }); }));
  return router;
}
export function createPublicPortfolioRouter(service: PortalResourceService) {
  const router = Router();
  router.use((_request, response, next) => { response.setHeader('X-Robots-Tag', 'noindex, nofollow'); response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('Cache-Control', 'private, no-store'); next(); });
  router.get('/:token', handler(async (request, response) => response.json(await service.publicProject(request.params.token))));
  router.get('/:token/files/:id', handler(async (request, response) => download(response, await service.publicFile(request.params.token, id(request.params.id), request.requestId), true)));
  return router;
}
export function createStaffResourceRouter(service: PortalResourceService, resolveStaff: (request: Request) => Promise<ResourceStaffActor>, uploadParser: RequestHandler) {
  const router = Router();
  router.get('/portfolio/moderation', handler(async (request, response) => response.json(await service.pendingShares(await resolveStaff(request)))));
  router.get('/portfolio/projects',handler(async(request,response)=>response.json(await service.staffProjects(await resolveStaff(request),id(request.query.studentId),id(request.query.runId),request.query.verified==='1'))));
  router.get('/portfolio/comparison',handler(async(request,response)=>response.json(await service.staffProjectComparison(await resolveStaff(request),id(request.query.studentId),id(request.query.runId)))));
  router.put('/portfolio/comparison',handler(async(request,response)=>{const {studentId,...selection}=z.object({studentId:z.number().int().positive()}).passthrough().parse(request.body);const input=portalProjectComparisonSchema.parse(selection);if(input.runId===null)throw new PortalResourceError('portalInvalidData');response.json(await service.saveStaffProjectComparison(await resolveStaff(request),studentId,input));}));
  router.get('/finance-questions',handler(async(request,response)=>{const query=page(request);sendPage(response,await service.staffFinanceQuestionsPage(await resolveStaff(request),query.cursor,query.limit));}));
  router.get('/payments/needs-review',handler(async(request,response)=>{const query=page(request);response.json(pageDto(await service.unallocatedPayments(await resolveStaff(request),query.cursor,query.limit)));}));
  router.get('/finance-questions/:id/messages',handler(async(request,response)=>response.json(await service.staffFinanceQuestion(await resolveStaff(request),id(request.params.id)))));
  router.post('/finance-questions/:id/messages',handler(async(request,response)=>{const input=portalFinanceMessageSchema.parse(request.body);response.json(await service.staffFinanceReply(await resolveStaff(request),id(request.params.id),input.body,input.idempotencyKey));}));
  router.post('/portfolio/shares/:id/moderate', handler(async (request, response) => { const input = portalShareApprovalSchema.parse(request.body); response.json(await service.moderateShare(await resolveStaff(request), id(request.params.id), input.version, input.approved)); }));
  router.post('/portfolio/projects/:id/review', handler(async (request, response) => { const input = portalProjectReviewSchema.parse(request.body); await service.reviewProject(await resolveStaff(request), id(request.params.id), input.version, input.review); response.json({ success: true }); }));
  router.post('/payments/:id/allocations', handler(async (request, response) => { await service.allocatePayment(await resolveStaff(request), id(request.params.id), portalPaymentAllocationSchema.parse(request.body)); response.json({ success: true }); }));
  router.get('/payments/:id/allocations', handler(async(request,response) => response.json(await service.paymentAllocation(await resolveStaff(request),id(request.params.id)))));
  router.post('/files', uploadParser, handler(async (request, response) => {
    try { if (!request.file) throw new PortalResourceError('portalFileRequired'); response.status(201).json(await service.uploadStaff(await resolveStaff(request), id(request.body.runId), request.file.path, request.file.originalname)); }
    finally { await cleanup(request); }
  }));
  router.get('/files/:id/status', handler(async (request, response) => response.json((await service.staffFile(await resolveStaff(request), id(request.params.id))).file)));
  router.get('/files/:id/download', handler(async (request, response) => download(response, await service.staffFile(await resolveStaff(request), id(request.params.id), true), request.query.preview === '1')));
  return router;
}
