import { Router } from 'express';
import { storage } from '../storage';
import { requireAuth } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        const notifications = await storage.getNotificationsByUser(req.user!.id);
        res.json(notifications);
    } catch (error) {
        logger.error('Failed to fetch notifications', { error, userId: req.user?.id });
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// Fix #8: Mark all notifications as read
router.put('/read-all', requireAuth, async (req, res) => {
    try {
        await storage.markAllNotificationsAsRead(req.user!.id);
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to mark all notifications as read', { error, userId: req.user?.id });
        res.status(500).json({ error: 'Failed to update notifications' });
    }
});

router.put('/:id/read', requireAuth, async (req, res) => {
    try {
        const notificationId = Number.parseInt(req.params.id, 10);

        if (Number.isNaN(notificationId)) {
            return res.status(400).json({ error: 'Invalid notification id' });
        }

        await storage.markNotificationAsRead(notificationId, req.user!.id);
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to mark notification as read', { error, notificationId: req.params.id });
        res.status(500).json({ error: 'Failed to update notification' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const notificationId = Number.parseInt(req.params.id, 10);

        if (Number.isNaN(notificationId)) {
            return res.status(400).json({ error: 'Invalid notification id' });
        }

        await storage.deleteNotification(notificationId, req.user!.id);
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete notification', { error, notificationId: req.params.id });
        res.status(500).json({ error: 'Failed to delete notification' });
    }
});

export default router;
