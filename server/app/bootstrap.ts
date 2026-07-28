import { createServer, type Server } from 'node:http';
import { pool } from '../db';
import {
  appConfig,
  isDevelopmentEnvironment,
  trustedProxyConfig,
} from '../config';
import { logger } from '../lib/logger';
import { errorHandler } from '../middleware/errorHandler';
import { registerApiRoutes } from '../routes';
import { serveStatic, setupVite, log } from '../vite';
import { startScheduler, stopScheduler } from '../services/scheduler';
import { assertDatabaseConnection } from '../infrastructure/database-health';
import { createSessionMiddleware } from '../infrastructure/session';
import { attachWebSocketGateway } from '../realtime/websocket-gateway';
import { createHttpApp } from './http-app';

export type ApplicationRuntime = {
  server: Server;
  stop: () => Promise<void>;
};

export const startApplication = async (): Promise<ApplicationRuntime> => {
  log('Checking database connection...');
  await assertDatabaseConnection();
  log('Database connection successful');

  const app = createHttpApp();
  app.set('env', appConfig.server.environment);
  app.set('trust proxy', trustedProxyConfig);

  const sessionMiddleware = createSessionMiddleware();
  app.use(sessionMiddleware);
  registerApiRoutes(app);

  const server = createServer(app);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  const websocketGateway = await attachWebSocketGateway(server, sessionMiddleware);

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (isDevelopmentEnvironment) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  app.use(errorHandler);

  startScheduler();

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off('error', handleError);
      resolve();
    };
    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen({
      port: appConfig.server.port,
      host: appConfig.server.host,
    });
  });

  log(`Server running on http://${appConfig.server.host}:${appConfig.server.port}`);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await websocketGateway.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await stopScheduler();
    await pool.end();
  };

  return { server, stop };
};

export const installShutdownHandlers = (runtime: ApplicationRuntime) => {
  const shutdown = (signal: NodeJS.Signals) => {
    logger.info('Graceful shutdown started', { signal });
    void runtime.stop()
      .then(() => {
        logger.info('Graceful shutdown completed', { signal });
        process.exit(0);
      })
      .catch((error) => {
        logger.error('Graceful shutdown failed', { signal, error });
        process.exit(1);
      });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};
