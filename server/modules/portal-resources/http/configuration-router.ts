import { Router, type Request } from 'express';
import { learningFlagUpdateSchema, type LearningCapabilitiesDto, type LearningFlagUpdateInput, type LearningRolloutDto } from '@shared/contracts/learning-rollout';
import type { ResourceStaffActor } from '../domain/policy';
import { PortalResourceError } from '../domain/policy';
import { learningSchoolSettingsUpdateSchema, type LearningSchoolSettings, type LearningSchoolSettingsDto } from '@shared/contracts/learning-settings';

type FlagPort = { capabilities(): LearningCapabilitiesDto; configuration(): Promise<LearningRolloutDto>; update(actorId: number, input: LearningFlagUpdateInput,requestId?:string): Promise<LearningRolloutDto>; settingsConfiguration(): Promise<LearningSchoolSettingsDto>; updateSettings(actorId: number, input: LearningSchoolSettings,version:number,requestId?:string): Promise<LearningSchoolSettingsDto> };
export function createLearningConfigurationRouter(flags: FlagPort, resolveStaff: (request: Request) => Promise<ResourceStaffActor>, canManageAccess: (request: Request) => Promise<boolean> = async () => false,canManageLearning:(request:Request)=>Promise<boolean>=async()=>false) {
  const router = Router();
  router.get('/school-settings', async (request,response,next) => {
    try { if (!(await resolveStaff(request)).modules.includes('administration')) return response.status(403).json({ code:'portalAccessDenied' }); response.json(await flags.settingsConfiguration()); }
    catch(error) { next(error); }
  });
  router.put('/school-settings', async (request,response,next) => {
    try {
      const actor = await resolveStaff(request);
      if (!actor.modules.includes('administration')) return response.status(403).json({ code:'portalAccessDenied' });
      const input = learningSchoolSettingsUpdateSchema.safeParse(request.body);
      if (!input.success) return response.status(400).json({ code:'portalInvalidData' });
      response.json(await flags.updateSettings(actor.userId,input.data.settings,input.data.version,actor.requestId));
    } catch(error) { if(error instanceof PortalResourceError) response.status(error.statusCode).json({ code:error.code }); else next(error); }
  });
  router.get('/status', async (request, response, next) => { try { response.json({ ...flags.capabilities(), canManageAccess: await canManageAccess(request),canManageLearning:await canManageLearning(request) }); } catch (error) { next(error); } });
  router.get('/configuration', async (request, response, next) => {
    try { if (!(await resolveStaff(request)).modules.includes('administration')) return response.status(403).json({ code: 'portalAccessDenied' }); response.json(await flags.configuration()); }
    catch (error) { next(error); }
  });
  router.put('/configuration', async (request, response, next) => {
    try {
      const actor = await resolveStaff(request);
      if (!actor.modules.includes('administration')) return response.status(403).json({ code: 'portalAccessDenied' });
      const input = learningFlagUpdateSchema.safeParse(request.body);
      if (!input.success) return response.status(400).json({ code: 'portalInvalidData' });
      response.json(await flags.update(actor.userId, input.data,actor.requestId));
    } catch (error) { if (error instanceof PortalResourceError) response.status(error.statusCode).json({ code: error.code }); else next(error); }
  });
  return router;
}
