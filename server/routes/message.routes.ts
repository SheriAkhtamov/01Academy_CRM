import { Router } from 'express';
import { storage } from '../storage';
import { requireAuth } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';

const router = Router();

let broadcastToClients: (data: any) => void = () => { };

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

router.get('/conversation/:receiverId', requireAuth, async (req, res) => {
    try {
        const senderId = req.user!.id;
        const receiverId = parseInt(req.params.receiverId);
        if (Number.isNaN(receiverId)) {
            return res.status(400).json({ error: 'Invalid receiver id' });
        }

        const messages = await storage.getMessagesBetweenUsers(senderId, receiverId);
        res.json(messages);
    } catch (error) {
        logger.error('Failed to fetch messages', { error, userId: req.user?.id, otherUserId: req.params.receiverId });
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

router.get('/:receiverId', requireAuth, async (req, res) => {
    try {
        const senderId = req.user!.id;
        const receiverId = parseInt(req.params.receiverId);
        if (Number.isNaN(receiverId)) {
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
        const { receiverId, content } = req.body;

        if (!receiverId || !content) {
            return res.status(400).json({ error: 'Receiver and content are required' });
        }

        const parsedReceiverId = parseInt(receiverId, 10);
        if (Number.isNaN(parsedReceiverId)) {
            return res.status(400).json({ error: 'Invalid receiver id' });
        }

        const receiver = await storage.getUser(parsedReceiverId);
        if (!receiver) {
            return res.status(404).json({ error: 'Receiver not found' });
        }

        const message = await storage.createMessage({
            senderId: req.user!.id,
            receiverId: parsedReceiverId,
            content,
            isRead: false,
        });

        broadcastToClients({
            type: 'NEW_MESSAGE',
            data: message,
            audienceUserIds: [req.user!.id, parsedReceiverId],
        });

        res.json(message);
    } catch (error) {
        logger.error('Error sending message', { error, senderId: req.user?.id });
        res.status(500).json({ error: 'Failed to send message' });
    }
});

router.put('/:id/read', requireAuth, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);

        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid message id' });
        }

        const message = await storage.markMessageAsRead(id, req.user!.id);

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        broadcastToClients({
            type: 'MESSAGE_READ' as any,
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
