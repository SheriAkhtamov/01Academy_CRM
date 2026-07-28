import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { registerAcademyWorkspaceRoutes } from './workspace.router';
import { registerAcademyLeadRoutes } from './leads.router';
import { registerAcademyLearningRoutes } from './learning.router';
import { registerAcademyOperationsRoutes } from './operations.router';
import { registerAcademyResourceRoutes } from './resources.router';

const router = Router();
router.use(requireAuth);

registerAcademyWorkspaceRoutes(router);
registerAcademyLeadRoutes(router);
registerAcademyLearningRoutes(router);
registerAcademyOperationsRoutes(router);
registerAcademyResourceRoutes(router);

export default router;
