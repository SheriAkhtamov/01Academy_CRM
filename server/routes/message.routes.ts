import { Router } from 'express';
import { storage } from '../storage';
import { requireAuth } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';

const router = Router();

let broadcastToClients: (data: any) => void = () => { };

const parsePositiveId = (value: unknown): number | null => {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const id = Number(text);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export function setBroadcastFunction(fn: (data: any) => void) {
    broadcastToClients = fn;
}

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

router.post('/', requireAuth, async (req, res) => {
    try {
        const receiverId = parsePositiveId(req.body.receiverId);
        const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
        if (!receiverId || !content) {
            return res.status(400).json({ error: 'Receiver and content are required' });
        }
        if (content.length > 10_000) {
            return res.status(400).json({ error: 'Message is too long' });
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
        });

        broadcastToClients({
            type: 'NEW_MESSAGE',
            data: message,
            audienceUserIds: [req.user!.id, receiverId],
        });

        res.json(message);
    } catch (error) {
        logger.error('Error sending message', { error, senderId: req.user?.id });
        res.status(500).json({ error: 'Failed to send message' });
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
            broadcastToClients({
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

        broadcastToClients({
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
