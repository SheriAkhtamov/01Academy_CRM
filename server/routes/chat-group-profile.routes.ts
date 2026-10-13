import type { Router, Response } from 'express';
import { hasLeadershipAccess } from '@shared/academy';
import { updateChatGroupProfileSchema } from '@shared/contracts/chat-groups';
import { safeChatGroupPhotoUrl } from '@shared/chat-group-photo';
import { USER_PHOTO_MIME_TYPES } from '@shared/user-photo';
import type { ChatGroupRepository } from '../modules/chat/application/ports';
import { chatGroupPhotoPath, cleanupChatGroupPhoto, parseChatGroupPhotoUpload } from '../middleware/chat-group-photo.middleware';
import { readFileMimeType } from '../lib/file-media';
import { removeCommittedUpload } from '../lib/retained-uploads';
import { logger } from '../lib/logger';

export function registerChatGroupProfileRoutes(router: Router, storage: ChatGroupRepository,
  announce: (groupId: number, members: number[]) => void, failure: (res: Response, error: unknown) => unknown) {
  router.get('/:id/photos/:fileId', async (req, res) => {
    try {
      const filePath = chatGroupPhotoPath(req.params.fileId);
      if (!filePath) return res.status(404).json({ error: 'resourceNotFound' });
      const group = await storage.detail(res.locals.groupId, req.user!.id, false);
      if (safeChatGroupPhotoUrl(group?.avatarUrl, res.locals.groupId) !== `/api/chat-groups/${res.locals.groupId}/photos/${req.params.fileId}`) return res.status(404).json({ error: 'resourceNotFound' });
      const mimeType = await readFileMimeType(filePath);
      if (!USER_PHOTO_MIME_TYPES.some(type => type === mimeType)) return res.status(404).json({ error: 'resourceNotFound' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, no-store');
      res.type(mimeType).sendFile(filePath, error => { if (error && !res.headersSent) res.status(404).json({ error: 'resourceNotFound' }); });
    } catch { if (!res.headersSent) res.status(404).json({ error: 'resourceNotFound' }); }
  });
  router.patch('/:id', async (req, res, next) => {
    // Reject ordinary members before accepting any multipart bytes; recheck under the transaction lock when saving.
    if (!req.is('multipart/form-data') && req.body?.removePhoto === undefined) return next();
    try {
      const group = await storage.detail(res.locals.groupId, req.user!.id, hasLeadershipAccess(req.user));
      if (!group) return res.status(404).json({ error: 'resourceNotFound' });
      if (!group.canManage) return res.status(403).json({ error: 'chatGroupManagementDenied' });
      next();
    } catch (error) { failure(res, error); }
  }, parseChatGroupPhotoUpload, async (req, res, next) => {
    if (!req.is('multipart/form-data') && req.body?.removePhoto === undefined) return next();
    let saved = false;
    try {
      const input = updateChatGroupProfileSchema.safeParse(req.body);
      if (!input.success || (req.file && input.data.removePhoto)) return res.status(400).json({ error: 'invalidData' });
      const avatarUrl = req.file ? `/api/chat-groups/${res.locals.groupId}/photos/${req.file.filename}` : input.data.removePhoto ? null : undefined;
      const result = await storage.updateProfile(res.locals.groupId, req.user!.id, hasLeadershipAccess(req.user), { name: input.data.name, avatarUrl });
      saved = true;
      if (result.previousAvatarUrl && result.previousAvatarUrl !== avatarUrl && avatarUrl !== undefined) {
        const previous = safeChatGroupPhotoUrl(result.previousAvatarUrl, res.locals.groupId);
        const filePath = previous && chatGroupPhotoPath(previous.split('/').at(-1)!);
        if (filePath) await removeCommittedUpload(filePath).catch(error => logger.error('Failed to retain replaced group photo', { error }));
      }
      announce(res.locals.groupId, result.audienceUserIds);
      res.json({ success: true });
    } catch (error) { failure(res, error); }
    finally { if (!saved) await cleanupChatGroupPhoto(req).catch(error => logger.error('Failed to remove unsaved group photo', { error })); }
  });
}
