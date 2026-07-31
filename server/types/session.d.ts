import 'express-session';
import type { User } from '../db/schema';
import type { AcademyAccessModule } from '@shared/academy';
import type { ActorContext } from '../modules/leads/domain/actor-context';

type AuthenticatedUser = User & {
  modules?: AcademyAccessModule[];
};

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    instagramOAuth?: {
      state: string;
      createdAt: number;
      redirectUri?: string;
    };
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
      rawBody?: Buffer;
      actor?: ActorContext;
    }
  }
}
