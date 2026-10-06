import { Router } from 'express';
import { storage } from '../storage';
import { requireAuth, requireAdministration } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';
import { publishRealtimeEvent } from '../realtime/realtime-hub';
import { employeeBroadcastRequestSchema } from '@shared/contracts/employee-broadcast';

const router = Router();

const parsePositiveId = (value: unknown): number | null => {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

router.get('/', requireAuth, async (req, res) => {
    try {
        const notifications = await storage.getNotificationsByUser(req.user!.id);
        res.json(notifications);
    } catch (error) {
        logger.error('Failed to fetch notifications', { error, userId: req.user?.id });
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

router.get('/page', requireAuth, async (req, res) => {
    const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit) || 25), 1), 100);
    const offset = Math.min(Math.max(Math.trunc(Number(req.query.offset) || 0), 0), 1_000_000);
    try {
        const [items, total] = await Promise.all([
            storage.getNotificationsByUser(req.user!.id, limit, offset),
            storage.getNotificationCount(req.user!.id),
        ]);
        res.json({ items, total, nextOffset: items.length > 0 && offset + items.length < total ? offset + items.length : null });
    } catch (error) {
        logger.error('Failed to fetch notification page', { error, userId: req.user?.id });
        res.status(500).json({ error: 'failedToLoadData' });
    }
});

router.get('/unread-count', requireAuth, async (req, res) => {
    try {
        res.json({ count: await storage.getNotificationCount(req.user!.id, true) });
    } catch (error) {
        logger.error('Failed to count unread notifications', { error, userId: req.user?.id });
        res.status(500).json({ error: 'failedToLoadData' });
    }
});

router.post('/broadcast', requireAdministration, async (req, res) => {
    try {
        const input = employeeBroadcastRequestSchema.safeParse(req.body);
        if (!input.success) {
            return res.status(400).json({ error: 'employeeBroadcastInvalidRequest' });
        }

        const broadcast = input.data;
        const { channel, recipientIds, content } = broadcast;
        if (channel === 'message' && recipientIds.includes(req.user!.id)) {
            return res.status(400).json({ error: 'employeeBroadcastRecipientsUnavailable' });
        }

        const recipientIdSet = new Set(recipientIds);
        const recipients = (await storage.getUsers()).filter((user) => (
            recipientIdSet.has(user.id)
            && user.isActive === true
            && user.isArchived !== true
        ));
        if (recipients.length !== recipientIds.length) {
            return res.status(400).json({ error: 'employeeBroadcastRecipientsUnavailable' });
        }

        if (broadcast.channel === 'notification') {
            const created = await storage.createNotifications(recipients.map((recipient) => ({
                userId: recipient.id,
                type: 'employee_broadcast',
                title: broadcast.title,
                message: content,
                isRead: false,
            })));
            publishRealtimeEvent({
                type: 'NEW_NOTIFICATION',
                data: { count: created.length },
                audienceUserIds: recipientIds,
            });
        } else {
            const created = await storage.createMessages(recipients.map((recipient) => ({
                senderId: req.user!.id,
                receiverId: recipient.id,
                content,
                isRead: false,
            })));
            for (const message of created) {
                publishRealtimeEvent({
                    type: 'NEW_MESSAGE',
                    data: message,
                    audienceUserIds: [req.user!.id, message.receiverId],
                });
            }
        }

        await storage.createAuditLog({
            userId: req.user!.id,
            action: channel === 'notification'
                ? 'BROADCAST_EMPLOYEE_NOTIFICATION'
                : 'BROADCAST_EMPLOYEE_MESSAGE',
            entityType: 'employee_broadcast',
            entityId: null,
            newValues: [{ channel, recipientIds }],
        }).catch((error) => logger.error('Failed to audit employee broadcast', {
            error,
            senderId: req.user?.id,
            channel,
            recipientCount: recipientIds.length,
        }));

        res.json({ channel, sentCount: recipientIds.length });
    } catch (error) {
        logger.error('Failed to broadcast to employees', {
            error,
            senderId: req.user?.id,
        });
        res.status(500).json({ error: 'employeeBroadcastFailed' });
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
        const notificationId = parsePositiveId(req.params.id);

        if (!notificationId) {
            return res.status(400).json({ error: 'Invalid notification id' });
        }

        const notification = await storage.markNotificationAsRead(notificationId, req.user!.id);
        if (!notification) return res.status(404).json({ error: 'Notification not found' });
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to mark notification as read', { error, notificationId: req.params.id });
        res.status(500).json({ error: 'Failed to update notification' });
    }
});

router.delete('/', requireAuth, async (req, res) => {
    try {
        const deletedCount = await storage.clearNotifications(req.user!.id);
        publishRealtimeEvent({ type: 'NOTIFICATIONS_CLEARED', data: {}, audienceUserIds: [req.user!.id] });
        res.json({ success: true, deletedCount });
    } catch (error) {
        logger.error('Failed to clear notifications', { error, userId: req.user?.id });
        res.status(500).json({ error: 'deleteFailed' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const notificationId = parsePositiveId(req.params.id);

        if (!notificationId) {
            return res.status(400).json({ error: 'Invalid notification id' });
        }

        const deleted = await storage.deleteNotification(notificationId, req.user!.id);
        if (!deleted) return res.status(404).json({ error: 'Notification not found' });
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete notification', { error, notificationId: req.params.id });
        res.status(500).json({ error: 'Failed to delete notification' });
    }
});

export default router;
