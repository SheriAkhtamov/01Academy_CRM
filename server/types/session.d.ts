import 'express-session';
import type { User } from '@shared/schema';
import type { AcademyWorkspace } from '@shared/academy';

type AuthenticatedUser = User & {
  workspaces?: AcademyWorkspace[];
};

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    instagramOAuth?: {
      state: string;
      createdAt: number;
    };
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
      rawBody?: Buffer;
    }
  }
}
