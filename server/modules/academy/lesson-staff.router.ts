import type { Request, RequestHandler, Router } from 'express';
import { z } from 'zod';
import { lessonAssistantSchema } from '@shared/contracts/lesson-staff';
import { actorContextFrom } from '../leads/domain/actor-context';
import { logger } from '../../lib/logger';
import { LessonStaffError, LessonStaffService } from './lesson-staff';

type StaffService = Pick<LessonStaffService, 'get' | 'add' | 'remove'>;
const id = (value: string) => {
  const parsed = z.coerce.number().int().positive().max(2_147_483_647).safeParse(value);
  if (!parsed.success) throw new LessonStaffError('lessonStaffNotFound', 404);
  return parsed.data;
};
const actor = (request: Request) => request.actor ?? actorContextFrom(request.user);
const handled = (operation: RequestHandler): RequestHandler => async (request, response, next) => {
  try {
    response.setHeader('Cache-Control', 'private, no-store');
    await operation(request, response, next);
  } catch (error) {
    if (error instanceof LessonStaffError) response.status(error.statusCode).json({ error: error.code });
    else {
      logger.error('Lesson staff request failed', { error });
      response.status(500).json({ error: 'lessonStaffSaveFailed' });
    }
  }
};

export function registerLessonStaffRoutes(router: Router, service: StaffService = new LessonStaffService()) {
  router.get('/lessons/:id/staff', handled(async (request, response) => {
    response.json(await service.get(actor(request), id(request.params.id)));
  }));
  router.post('/lessons/:id/assistants', handled(async (request, response) => {
    const input = lessonAssistantSchema.safeParse(request.body);
    if (!input.success) throw new LessonStaffError('lessonAssistantUnavailable');
    response.json(await service.add(actor(request), id(request.params.id), input.data.teacherId));
  }));
  router.delete('/lessons/:id/assistants/:teacherId', handled(async (request, response) => {
    response.json(await service.remove(actor(request), id(request.params.id), id(request.params.teacherId)));
  }));
}
