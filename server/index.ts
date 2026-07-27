import express, { type Request, type Response, type NextFunction } from "express";
import morgan from 'morgan';
import { registerModularRoutes } from "./routes/index";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase, checkDatabaseConnection } from "./initDatabase";
import { globalMutationLimiter, readLimiter } from './middleware/rateLimiter';
import { logger } from './lib/logger';
import { errorHandler, requestContextMiddleware } from "./middleware/errorHandler";
import {
  appConfig,
  isDevelopmentEnvironment,
  isProductionEnvironment,
  trustedProxyConfig,
} from './config';
import {
  browserMutationProtectionMiddleware,
  corsMiddleware,
  securityHeadersMiddleware,
} from './middleware/security.middleware';

if (!appConfig.database.url) {
  console.error('FATAL: database URL is not configured in config/app.config.json.');
  process.exit(1);
}

const app = express();

app.disable('x-powered-by');
app.set('env', appConfig.server.environment);
app.set('trust proxy', trustedProxyConfig);

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

(async () => {
  try {
    log("Checking database connection...");
    const isConnected = await checkDatabaseConnection();

    if (isConnected) {
      log("Database connection successful");
      log("Initializing database schema and data...");
      await initializeDatabase();
    } else {
      log("Database connection failed. Check config/app.config.json and database accessibility.");
      process.exit(1);
    }

    const server = await registerModularRoutes(app);

    // Start background scheduler (outbox worker, daily automations, weekly report).
    const { startScheduler } = await import('./services/scheduler');
    startScheduler();

    // Fix #74/84: Explicit 404 for unknown /api/* routes before SPA fallback
    app.all('/api/*', (_req: Request, res: Response) => {
      res.status(404).json({ error: 'API endpoint not found' });
    });

    if (isDevelopmentEnvironment) {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // Fix #75/85: errorHandler must come after Vite/static middleware
    app.use(errorHandler);

    const port = appConfig.server.port;
    const host = appConfig.server.host;

    server.listen({ port, host }, () => {
      log(`Server running on http://${host}:${port}`);
      if (host === "0.0.0.0") {
        log(`Accessible from network on port ${port}`);
      }
    });
  } catch (error) {
    logger.error('Fatal error during server startup', { error });
    process.exit(1);
  }
})();
