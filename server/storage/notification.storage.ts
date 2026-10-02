import { db } from '../db';
import { notifications, type Notification, type InsertNotification } from '../db/schema';
import { eq, and, desc, count, isNull, or } from 'drizzle-orm';

class NotificationStorage {
    async getNotificationsByUser(userId: number, limit = 100, offset = 0): Promise<Notification[]> {
        return db
            .select()
            .from(notifications)
            .where(eq(notifications.userId, userId))
            .orderBy(desc(notifications.createdAt), desc(notifications.id))
            .limit(limit)
            .offset(offset);
    }

    async getNotificationCount(userId: number, unreadOnly = false): Promise<number> {
        const rows = await db.select({ value: count() }).from(notifications).where(and(
            eq(notifications.userId, userId),
            unreadOnly ? or(eq(notifications.isRead, false), isNull(notifications.isRead)) : undefined,
        ));
        return Number(rows[0]?.value ?? 0);
    }

    async createNotification(notification: InsertNotification): Promise<Notification> {
        const result = await db.insert(notifications).values(notification).returning();
        return result[0];
    }

    async createNotifications(items: InsertNotification[]): Promise<Notification[]> {
        if (items.length === 0) return [];
        return db.insert(notifications).values(items).returning();
    }

    async markNotificationAsRead(id: number, userId: number): Promise<Notification | undefined> {
        const result = await db
            .update(notifications)
            .set({ isRead: true })
            .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
            .returning();
        return result[0];
    }

    async markAllNotificationsAsRead(userId: number): Promise<void> {
        await db
            .update(notifications)
            .set({ isRead: true })
            .where(and(eq(notifications.userId, userId), or(eq(notifications.isRead, false), isNull(notifications.isRead))));
    }

    async deleteNotification(id: number, userId: number): Promise<boolean> {
        const deleted = await db
            .delete(notifications)
            .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
            .returning({ id: notifications.id });
        return deleted.length > 0;
    }
}

export const notificationStorage = new NotificationStorage();
