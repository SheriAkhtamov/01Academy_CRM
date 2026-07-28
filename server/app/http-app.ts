import express, { type NextFunction, type Request, type Response } from 'express';
import morgan from 'morgan';
import { globalMutationLimiter, readLimiter } from '../middleware/rateLimiter';
import {
  browserMutationProtectionMiddleware,
  corsMiddleware,
  securityHeadersMiddleware,
} from '../middleware/security.middleware';
import { requestContextMiddleware } from '../middleware/errorHandler';
import { isProductionEnvironment } from '../config';
import { logger } from '../lib/logger';

export const createHttpApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestContextMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(corsMiddleware);
  app.use(browserMutationProtectionMiddleware);

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isProductionEnvironment || !req.path.startsWith('/api')) {
      return next();
    }

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      return globalMutationLimiter(req, res, next);
    }

    if (req.method === 'GET') {
      return readLimiter(req, res, next);
    }

    next();
  });

  app.use(express.json({
    limit: '512kb',
    verify: (req, _res, buffer) => {
      const request = req as Request;
      if (request.originalUrl.startsWith('/api/incoming/instagram')) {
        request.rawBody = Buffer.from(buffer);
      }
    },
  }));
  app.use(express.urlencoded({
    extended: false,
    limit: '64kb',
    parameterLimit: 100,
  }));

  morgan.token('safe-path', (req) => (
    req.url?.split(/[?#]/, 1)[0] || '/'
  ));
  app.use(morgan(':method :safe-path :status :response-time ms', {
    stream: { write: (message: string) => logger.info(message.trim()) },
    skip: (req) => !req.path.startsWith('/api') || req.path === '/api/telephony/webhook',
  }));

  return app;
};

export type HttpApp = ReturnType<typeof createHttpApp>;
