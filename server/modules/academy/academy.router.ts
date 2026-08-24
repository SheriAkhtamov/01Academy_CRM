import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { createLeadMergeService } from '../leads/application/merge-service';
import { createLeadRelationsService } from '../leads/application/relations-service';
import { createLeadAssignmentService } from '../leads/application/assignment-service';
import { createLeadLifecycleService } from '../leads/application/lifecycle-service';
import { attachActorContext } from '../leads/http/actor-context';
import { createLeadMergeRouter } from '../leads/http/merge.router';
import { createLeadRelationsRouter } from '../leads/http/relations.router';
import { createLeadAssignmentRouter } from '../leads/http/assignment.router';
import { createLeadLifecycleRouter } from '../leads/http/lifecycle.router';
import { LegacyLeadMergeRepository } from '../leads/infrastructure/legacy-merge-repository';
import { LegacyLeadRelationsRepository } from '../leads/infrastructure/legacy-relations-repository';
import { LegacyLeadAssignmentRepository } from '../leads/infrastructure/legacy-assignment-repository';
import { LegacyLeadLifecycleRepository } from '../leads/infrastructure/legacy-lifecycle-repository';
import { createNotification } from './academy-core';
import { leadContactSummary } from './academy-leads';
import { registerAcademyModuleRoutes } from './module.router';
import { registerAcademyLeadRoutes } from './leads.router';
import { registerAcademyLearningRoutes } from './learning.router';
import { registerAcademyOperationsRoutes } from './operations.router';
import { registerAcademyResourceRoutes } from './resources.router';
import { registerAcademyDemoLessonRoutes } from './demo-lessons.router';
import { registerAcademyBulkLeadActionRoutes } from './bulk-lead-actions.router';
import { registerAcademyLeadSocialAccountRoutes } from './lead-social-accounts.router';

const router = Router();
router.use(requireAuth);
router.use(attachActorContext);

const leadMergeService = createLeadMergeService(
  new LegacyLeadMergeRepository(),
  async ({ managerId, leadId, lead }) => {
    await createNotification(
      managerId,
      'Вам назначен лид',
      leadContactSummary(lead),
      'lead',
      leadId,
    );
  },
);
router.use(createLeadMergeRouter(leadMergeService));
router.use(createLeadRelationsRouter(
  createLeadRelationsService(new LegacyLeadRelationsRepository()),
));
router.use(createLeadAssignmentRouter(
  createLeadAssignmentService(new LegacyLeadAssignmentRepository()),
));
router.use(createLeadLifecycleRouter(
  createLeadLifecycleService(new LegacyLeadLifecycleRepository()),
));

registerAcademyBulkLeadActionRoutes(router);
registerAcademyLeadSocialAccountRoutes(router);
registerAcademyModuleRoutes(router);
registerAcademyLeadRoutes(router);
registerAcademyLearningRoutes(router);
registerAcademyOperationsRoutes(router);
registerAcademyResourceRoutes(router);
registerAcademyDemoLessonRoutes(router);

export default router;
