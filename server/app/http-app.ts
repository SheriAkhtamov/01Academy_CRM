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
import { privateRequestPath } from '../lib/private-request-path';
import { isPortalRateLimitRealm } from '../infrastructure/portal-rate-limiters';
import { isLearningModulePath, isLegacyLearningPath, isPlatformAccountPath } from '@shared/platform-routes';

export const createHttpApp = ({ beforeBodyParser }: { beforeBodyParser?: express.RequestHandler } = {}) => {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestContextMiddleware);
  app.use(securityHeadersMiddleware);
  app.use((request,response,next) => {
    if (isLearningModulePath(request.path) || isLegacyLearningPath(request.path) || isPlatformAccountPath(request.path) || request.path.startsWith('/portfolio/p/')) {
      response.setHeader('Referrer-Policy','no-referrer');
      response.setHeader('Cache-Control','private, no-store');
      response.setHeader('X-Robots-Tag','noindex, nofollow');
    }
    next();
  });
  app.use(corsMiddleware);
  app.use(browserMutationProtectionMiddleware);
  if (beforeBodyParser) app.use(beforeBodyParser);

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isProductionEnvironment || !req.path.startsWith('/api') || isPortalRateLimitRealm(req.path)) {
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
      if (
        request.originalUrl.startsWith('/api/incoming/instagram')
        || request.originalUrl.startsWith('/api/incoming/meta-leads')
      ) {
        request.rawBody = Buffer.from(buffer);
      }
    },
  }));
  app.use(express.urlencoded({
    extended: false,
    limit: '64kb',
    parameterLimit: 100,
  }));

  morgan.token('safe-path', req=>privateRequestPath((req as Request).originalUrl || req.url));
  app.use(morgan(':method :safe-path :status :response-time ms', {
    stream: { write: (message: string) => logger.info(message.trim()) },
    skip: (req) => !req.originalUrl.startsWith('/api') || req.originalUrl.split('?')[0] === '/api/telephony/webhook',
  }));

  return app;
};

export type HttpApp = ReturnType<typeof createHttpApp>;
