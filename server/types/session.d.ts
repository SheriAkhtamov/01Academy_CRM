import 'express-session';
import type { User } from '@shared/schema';

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
      user?: User;
      requestId?: string;
      rawBody?: Buffer;
    }
  }
}
