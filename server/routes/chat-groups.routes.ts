import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';
import type { ChatGroupRepository } from '../modules/chat/application/ports';
import { publishRealtimeEvent } from '../realtime/realtime-hub';
import { createChatGroupSchema, sendGroupMessageSchema } from '@shared/contracts/chat-groups';
import { positiveIdSchema } from '@shared/contracts/messages';
import { messageFilePath, parseMessageUpload, removeMessageFiles, uploadedMessageAttachment } from '../middleware/message-upload.middleware';

export const createChatGroupRouter = (chatGroupStorage: ChatGroupRepository) => {
const router = Router();
router.use(requireAuth);
router.get('/', async (req, res) => {
  try { res.json(await chatGroupStorage.list(req.user!.id)); }
  catch (error) { logger.error('Failed to list chat groups', { error }); res.status(500).json({ error: 'failedToLoadData' }); }
});
router.post('/', async (req, res) => {
  const input = createChatGroupSchema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'invalidData' });
  try {
    const group = await chatGroupStorage.create(req.user!.id, input.data);
    const members = await chatGroupStorage.memberIds(group.id, req.user!.id);
    publishRealtimeEvent({ type: 'GROUP_CHAT_UPDATED', data: { groupId: group.id }, audienceUserIds: members ?? [req.user!.id] });
    res.status(201).json(group);
  } catch (error: any) {
    logger.error('Failed to create chat group', { error });
    res.status(error.statusCode || 500).json({ error: error.statusCode === 400 ? error.message : 'chatGroupCreateFailed' });
  }
});
router.get('/attachments/:fileId', async (req, res) => {
  try {
    const filePath = messageFilePath(req.params.fileId);
    if (!filePath) return res.status(404).json({ error: 'resourceNotFound' });
    const file = await chatGroupStorage.attachment(req.params.fileId, req.user!.id);
    if (!file) return res.status(404).json({ error: 'resourceNotFound' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.query.download === '1' || !['image/png','image/jpeg','image/gif','image/webp','image/avif','video/mp4','video/webm','video/quicktime'].includes(file.mimeType)) {
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.download(filePath, file.name, (error) => { if (error && !res.headersSent) res.status(404).json({ error: 'attachmentDownloadFailed' }); });
    }
    res.setHeader('Content-Type', file.mimeType);
    const name = encodeURIComponent(file.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${name}`);
    res.sendFile(filePath, (error) => { if (error && !res.headersSent) res.status(404).json({ error: 'attachmentDownloadFailed' }); });
  } catch (error) { logger.error('Failed to download group attachment', { error }); if (!res.headersSent) res.status(500).json({ error: 'attachmentDownloadFailed' }); }
});
router.use('/:id', async (req, res, next) => {
  const id = positiveIdSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'invalidData' });
  try {
    const members = await chatGroupStorage.memberIds(id.data, req.user!.id);
    if (!members) return res.status(404).json({ error: 'resourceNotFound' });
    res.locals.groupId = id.data;
    res.locals.memberIds = members;
    next();
  } catch (error) { logger.error('Failed to check chat group access', { error }); res.status(500).json({ error: 'failedToLoadData' }); }
});
router.get('/:id/messages', async (_req, res) => {
  try { res.json(await chatGroupStorage.messages(res.locals.groupId)); }
  catch (error) { logger.error('Failed to load group messages', { error }); res.status(500).json({ error: 'failedToLoadData' }); }
});
router.post('/:id/messages', parseMessageUpload, async (req, res) => {
  const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
  let saved = false;
  try {
    const input = sendGroupMessageSchema.safeParse(req.body);
    if (!input.success || (!input.data.content && files.length === 0)) return res.status(400).json({ error: 'invalidData' });
    const attachments = await Promise.all(files.map(uploadedMessageAttachment));
    for (const file of attachments) file.url = `/api/chat-groups/attachments/${file.id}`;
    const message = await chatGroupStorage.send(res.locals.groupId, req.user!.id, input.data.content, attachments);
    saved = true;
    publishRealtimeEvent({ type: 'GROUP_CHAT_UPDATED', data: { groupId: res.locals.groupId }, audienceUserIds: res.locals.memberIds });
    res.status(201).json(message);
  } catch (error) { logger.error('Failed to send group message', { error }); res.status(500).json({ error: 'messageSendFailed' }); }
  finally { if (!saved) await removeMessageFiles(files).catch((error) => logger.error('Failed to remove unsent group files', { error })); }
});
router.put('/:id/read', async (req, res) => {
  const messageId = positiveIdSchema.safeParse(req.body.messageId);
  if (!messageId.success) return res.status(400).json({ error: 'invalidData' });
  try {
    await chatGroupStorage.markRead(res.locals.groupId, req.user!.id, messageId.data);
    publishRealtimeEvent({ type: 'GROUP_CHAT_UPDATED', data: { groupId: res.locals.groupId }, audienceUserIds: [req.user!.id] });
    res.json({ success: true });
  } catch (error) { logger.error('Failed to read group messages', { error }); res.status(500).json({ error: 'updateFailed' }); }
});
return router;
};
