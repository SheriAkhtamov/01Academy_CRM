import { db } from '../db';
import { notifications, type Notification, type InsertNotification } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

class NotificationStorage {
    async getNotificationsByUser(userId: number, limit = 100): Promise<Notification[]> {
        return db
            .select()
            .from(notifications)
            .where(eq(notifications.userId, userId))
            .orderBy(desc(notifications.createdAt))
            .limit(limit);
    }

    async createNotification(notification: InsertNotification): Promise<Notification> {
        const result = await db.insert(notifications).values(notification).returning();
        return result[0];
    }

    async markNotificationAsRead(id: number, userId?: number): Promise<Notification> {
        const conditions = [eq(notifications.id, id)];
        if (userId) {
            conditions.push(eq(notifications.userId, userId));
        }

        const result = await db
            .update(notifications)
            .set({ isRead: true })
            .where(and(...conditions))
            .returning();
        return result[0];
    }

    async markAllNotificationsAsRead(userId: number): Promise<void> {
        await db
            .update(notifications)
            .set({ isRead: true })
            .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    }

    async deleteNotification(id: number, userId?: number): Promise<void> {
        const conditions = [eq(notifications.id, id)];
        if (userId) {
            conditions.push(eq(notifications.userId, userId));
        }
        await db.delete(notifications).where(and(...conditions));
    }
}

export const notificationStorage = new NotificationStorage();
