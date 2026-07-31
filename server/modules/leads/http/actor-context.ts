import type { NextFunction, Request, Response } from 'express';
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

export const attachActorContext = (
  request: Request,
  _response: Response,
  next: NextFunction,
): void => {
  try {
    request.actor = actorContextFromRequest(request);
    next();
  } catch (error) {
    next(error);
  }
};
