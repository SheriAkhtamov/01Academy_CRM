import { Router, type Request } from 'express';
import type { LearningCapabilitiesDto } from '@shared/contracts/learning-rollout';
import type { ResourceStaffActor } from '../domain/policy';

type FlagPort = { capabilities(): LearningCapabilitiesDto };
export function createLearningConfigurationRouter(flags: FlagPort, _resolveStaff: (request: Request) => Promise<ResourceStaffActor>, canManageAccess: (request: Request) => Promise<boolean> = async () => false, canManageLearning: (request: Request) => Promise<boolean> = async () => false) {
  const router = Router();
  router.get('/status', async (request, response, next) => {
    try { response.json({ ...flags.capabilities(), canManageAccess: await canManageAccess(request), canManageLearning: await canManageLearning(request) }); }
    catch (error) { next(error); }
  });
  return router;
}
