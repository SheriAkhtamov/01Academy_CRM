import 'express-session';
import type { User } from '@shared/schema';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      requestId?: string;
    }
  }
}
