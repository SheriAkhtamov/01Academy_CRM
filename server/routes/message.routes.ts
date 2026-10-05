import { Router } from 'express';
import { storage } from '../storage';
import { requireAuth } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';
import { publishRealtimeEvent } from '../realtime/realtime-hub';
import { messageFilePath, parseMessageUpload, removeMessageFiles, uploadedMessageAttachment } from '../middleware/message-upload.middleware';
import {
    positiveIdSchema,
    sendMessageRequestSchema,
} from '@shared/contracts/messages';

const router = Router();

const parsePositiveId = (value: unknown): number | null => {
    const result = positiveIdSchema.safeParse(value);
    return result.success ? result.data : null;
};

router.get('/conversations', requireAuth, async (req, res) => {
    try {
        const userId = req.user!.id;
        const conversations = await storage.getConversationsByUser(userId);
        res.json(conversations);
    } catch (error) {
        logger.error('Failed to fetch conversations', { error, userId: req.user?.id });
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

router.get('/:receiverId', requireAuth, async (req, res) => {
    try {
        const senderId = req.user!.id;
        const receiverId = parsePositiveId(req.params.receiverId);
        if (!receiverId) {
            return res.status(400).json({ error: 'Invalid receiver id' });
        }

        const messages = await storage.getMessagesBetweenUsers(senderId, receiverId);
        res.json(messages);
    } catch (error) {
        logger.error('Failed to fetch messages', { error, userId: req.user?.id, otherUserId: req.params.receiverId });
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

router.get('/attachments/:fileId', requireAuth, async (req, res) => {
    try {
        const filePath = messageFilePath(req.params.fileId);
        if (!filePath) return res.status(404).json({ error: 'resourceNotFound' });
        const attachment = await storage.getMessageAttachment(req.params.fileId, req.user!.id);
        if (!attachment) return res.status(404).json({ error: 'resourceNotFound' });
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cache-Control', 'private, no-store');
        const inline = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'video/quicktime'].includes(attachment.mimeType);
        if (!inline || req.query.download === '1') {
            res.setHeader('Content-Type', 'application/octet-stream');
            return res.download(filePath, attachment.name, (error) => {
                if (error && !res.headersSent) res.status(404).json({ error: 'attachmentDownloadFailed' });
            });
        }
        res.setHeader('Content-Type', attachment.mimeType);
        const name = encodeURIComponent(attachment.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${name}`);
        res.sendFile(filePath, { acceptRanges: true }, (error) => {
            if (error && !res.headersSent) res.status(404).json({ error: 'attachmentDownloadFailed' });
        });
    } catch (error) {
        logger.error('Failed to download message attachment', { error, userId: req.user?.id });
        if (!res.headersSent) res.status(500).json({ error: 'attachmentDownloadFailed' });
    }
});

router.post('/', requireAuth, parseMessageUpload, async (req, res) => {
    const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
    let saved = false;
    try {
        const input = sendMessageRequestSchema.safeParse(req.body);
        if (!input.success) {
            const contentTooLong = input.error.issues.some(
                (issue) => issue.path[0] === 'content' && issue.code === 'too_big',
            );
            if (contentTooLong) {
                return res.status(400).json({ error: 'Message is too long' });
            }
            return res.status(400).json({ error: 'Receiver and content are required' });
        }
        const { receiverId, content } = input.data;
        if (!content && files.length === 0) {
            return res.status(400).json({ error: 'Receiver and content are required' });
        }
        if (receiverId === req.user!.id) {
            return res.status(400).json({ error: 'Cannot send a message to yourself' });
        }

        const receiver = await storage.getUser(receiverId);
        if (!receiver || receiver.isActive === false) {
            return res.status(404).json({ error: 'Receiver not found' });
        }

        const message = await storage.createMessage({
            senderId: req.user!.id,
            receiverId,
            content,
            isRead: false,
            attachments: await Promise.all(files.map(uploadedMessageAttachment)),
        });
        saved = true;

        publishRealtimeEvent({
            type: 'NEW_MESSAGE',
            data: message,
            audienceUserIds: [req.user!.id, receiverId],
        });

        res.json(message);
    } catch (error) {
        logger.error('Error sending message', { error, senderId: req.user?.id });
        res.status(500).json({ error: 'Failed to send message' });
    } finally {
        if (!saved) await removeMessageFiles(files).catch((error) => logger.error('Failed to remove unsent message files', { error }));
    }
});

router.put('/conversations/:otherUserId/read', requireAuth, async (req, res) => {
    try {
        const otherUserId = parsePositiveId(req.params.otherUserId);
        if (!otherUserId || otherUserId === req.user!.id) {
            return res.status(400).json({ error: 'Invalid conversation user id' });
        }

        const messages = await storage.markConversationAsRead(otherUserId, req.user!.id);
        const messageIds = messages.map((message) => message.id);
        if (messageIds.length > 0) {
            publishRealtimeEvent({
                type: 'MESSAGE_READ',
                data: { messageIds, senderId: otherUserId, receiverId: req.user!.id },
                audienceUserIds: [otherUserId, req.user!.id],
            });
        }
        res.json({ updated: messageIds.length, messageIds });
    } catch (error) {
        logger.error('Error marking conversation as read', {
            error,
            userId: req.user?.id,
            otherUserId: req.params.otherUserId,
        });
        res.status(500).json({ error: 'Failed to mark conversation as read' });
    }
});

router.put('/:id/read', requireAuth, async (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) {
            return res.status(400).json({ error: 'Invalid message id' });
        }

        const message = await storage.markMessageAsRead(id, req.user!.id);

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        publishRealtimeEvent({
            type: 'MESSAGE_READ',
            data: { messageId: id, senderId: message.senderId, receiverId: message.receiverId },
            audienceUserIds: [message.senderId, message.receiverId],
        });

        res.json(message);
    } catch (error) {
        logger.error('Error marking message as read', { error, messageId: req.params.id });
        res.status(500).json({ error: 'Failed to mark message as read' });
    }
});

export default router;
