import { pool } from '../db';
import { requireAuth, requireAdministration } from '../middleware/auth.middleware';
import { publishRealtimeEvent } from '../realtime/realtime-hub';
import { logger } from '../lib/logger';
import { PlatformUpdateService } from '../modules/platform-updates/application/update-service';
import { PostgresUpdateRepository } from '../modules/platform-updates/infrastructure/postgres-repository';
import { createUpdateRouter } from '../modules/platform-updates/http/router';
import { updateImagePath } from '../modules/platform-updates/infrastructure/images';
import { releasePosts } from '../modules/platform-updates/release-posts';

const repository = new PostgresUpdateRepository(pool);
const service = new PlatformUpdateService(repository, (recipientIds, postId) => {
  try { publishRealtimeEvent({ type: 'NEW_NOTIFICATION', data: { postId }, audienceUserIds: recipientIds }); }
  catch (error) { logger.error('Failed to announce platform update', { error, postId }); }
});
export const updatesRouter = createUpdateRouter(service, requireAuth, requireAdministration, updateImagePath);
export async function publishReleaseUpdates() {
  for (const command of releasePosts) {
    if (!await repository.findByKey(command.publicationKey)) await service.publish(command, null);
  }
}
