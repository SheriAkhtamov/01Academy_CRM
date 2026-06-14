import express, { type Request, type Response, type NextFunction } from "express";
import morgan from 'morgan';
import { registerModularRoutes } from "./routes/index";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase, checkDatabaseConnection } from "./initDatabase";
import { globalMutationLimiter, readLimiter } from './middleware/rateLimiter';
import { logger } from './lib/logger';
import { errorHandler, requestContextMiddleware } from "./middleware/errorHandler";
import { appConfig, isDevelopmentEnvironment, isProductionEnvironment } from './config';

if (!appConfig.database.url) {
  console.error('FATAL: database URL is not configured in config/app.config.json.');
  process.exit(1);
}

const app = express();

app.set('env', appConfig.server.environment);
app.set('trust proxy', 1);

app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://localhost:5001',
    'http://127.0.0.1:5001',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    appConfig.server.appUrl,
  ].filter(Boolean);

  const origin = req.headers.origin;
  if (origin && (isDevelopmentEnvironment || allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }

  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie, x-bot-token');
  res.header('Access-Control-Expose-Headers', 'Set-Cookie');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(requestContextMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!isProductionEnvironment) {
    return next();
  }

  // Fix #79: Only apply rate limiting to API routes, not static assets
  if (!req.path.startsWith('/api')) {
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

morgan.token('response-time-ms', (req, res) => {
  const responseTime = res.getHeader('X-Response-Time');
  return typeof responseTime === 'string' ? responseTime : (req.method ? '-' : '-');
});

app.use(morgan(':method :url :status :response-time ms', {
  stream: { write: (message: string) => logger.info(message.trim()) },
  skip: (req) => !req.path.startsWith('/api'),
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

    // Fix #74/84: Explicit 404 for unknown /api/* routes before SPA fallback
    app.all('/api/*', (req: Request, res: Response) => {
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
