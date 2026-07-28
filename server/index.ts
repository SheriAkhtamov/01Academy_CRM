import { installShutdownHandlers, startApplication } from './app/bootstrap';
import { logger } from './lib/logger';

startApplication()
  .then(installShutdownHandlers)
  .catch((error) => {
    logger.error('Fatal error during server startup', { error });
    process.exit(1);
  });
