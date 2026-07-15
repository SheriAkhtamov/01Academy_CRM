import 'express-session';
import type { User } from '@shared/schema';
import type { AcademyAccessModule } from '@shared/academy';

type AuthenticatedUser = User & {
  workspaces?: AcademyAccessModule[];
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
    }
  }
}
