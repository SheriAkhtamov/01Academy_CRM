import type { NextFunction, Request, Response } from 'express';
import { attachSalesWorkflow } from '../../../infrastructure/sales-kpi/sales-workflow-context';
import {
  actorContextFrom,
  type ActorContext,
} from '../domain/actor-context';

export const actorContextFromRequest = (request: Request): ActorContext => {
  const actor = actorContextFrom(request);
  if (!actor.userId) {
    throw Object.assign(new Error('authenticationRequired'), { statusCode: 401 });
  }
  return actor;
};

export const attachActorContext = async (
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    request.actor = await attachSalesWorkflow(actorContextFromRequest(request));
    next();
  } catch (error) {
    next(error);
  }
};
