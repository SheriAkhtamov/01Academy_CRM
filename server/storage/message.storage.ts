import { db } from '../db';
import { messages, users, type Message, type InsertMessage, type User } from '@shared/schema';
import { eq, or, and, asc, sql } from 'drizzle-orm';

export class MessageStorage {
    async getConversations(userId: number): Promise<User[]> {
        const result = await db.execute(sql`
      SELECT DISTINCT
        ${users.id} as id,
        ${users.fullName} as "fullName",
        ${users.position} as position,
        ${users.email} as email,
        MAX(${messages.createdAt}) as last_message_time
      FROM ${messages}
      INNER JOIN ${users} ON ${users.id} = CASE
        WHEN ${messages.senderId} = ${userId} THEN ${messages.receiverId}
        ELSE ${messages.senderId}
      END
      WHERE (${messages.senderId} = ${userId} OR ${messages.receiverId} = ${userId})
      GROUP BY ${users.id}, ${users.fullName}, ${users.position}, ${users.email}
      ORDER BY last_message_time DESC
    `);

        return (result.rows as any[]).map(({ last_message_time, ...user }) => user) as User[];
    }

    async getMessagesBetweenUsers(senderId: number, receiverId: number): Promise<Message[]> {
        const results = await db
            .select({
                id: messages.id,
                senderId: messages.senderId,
                receiverId: messages.receiverId,
                content: messages.content,
                isRead: messages.isRead,
                createdAt: messages.createdAt,
                updatedAt: messages.updatedAt,
                senderId_user: users.id,
                senderFullName: users.fullName,
                senderPosition: users.position,
            })
            .from(messages)
            .leftJoin(users, eq(messages.senderId, users.id))
            .where(
                or(
                    and(eq(messages.senderId, senderId), eq(messages.receiverId, receiverId)),
                    and(eq(messages.senderId, receiverId), eq(messages.receiverId, senderId))
                ),
            )
            .orderBy(asc(messages.createdAt));

        return results.map((row: any) => ({
            id: row.id,
            senderId: row.senderId,
            receiverId: row.receiverId,
            content: row.content,
            isRead: row.isRead,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            sender: row.senderId_user ? {
                id: row.senderId_user,
                fullName: row.senderFullName || '',
                position: row.senderPosition || '',
            } : undefined,
        })) as Message[];
    }

    async createMessage(message: InsertMessage): Promise<Message> {
        const result = await db.insert(messages).values(message).returning();
        const newMessage = result[0];

        const [messageWithSender] = await db
            .select({
                id: messages.id,
                senderId: messages.senderId,
                receiverId: messages.receiverId,
                content: messages.content,
                isRead: messages.isRead,
                createdAt: messages.createdAt,
                updatedAt: messages.updatedAt,
                senderId_user: users.id,
                senderFullName: users.fullName,
                senderPosition: users.position,
            })
            .from(messages)
            .leftJoin(users, eq(messages.senderId, users.id))
            .where(eq(messages.id, newMessage.id));

        return {
            id: messageWithSender.id,
            senderId: messageWithSender.senderId,
            receiverId: messageWithSender.receiverId,
            content: messageWithSender.content,
            isRead: messageWithSender.isRead,
            createdAt: messageWithSender.createdAt,
            updatedAt: messageWithSender.updatedAt,
            sender: messageWithSender.senderId_user ? {
                id: messageWithSender.senderId_user,
                fullName: messageWithSender.senderFullName || '',
                position: messageWithSender.senderPosition || '',
            } : undefined,
        } as Message;
    }

    async updateMessage(id: number, updates: Partial<InsertMessage>): Promise<Message> {
        const result = await db
            .update(messages)
            .set(updates)
            .where(eq(messages.id, id))
            .returning();
        if (!result[0]) {
            throw new Error('Message not found');
        }
        return result[0];
    }

    async deleteMessage(id: number): Promise<void> {
        await db.delete(messages).where(eq(messages.id, id));
    }

    async markMessagesAsRead(senderId: number, receiverId: number): Promise<void> {
        await db
            .update(messages)
            .set({ isRead: true })
            .where(
                and(
                    eq(messages.senderId, senderId),
                    eq(messages.receiverId, receiverId),
                    eq(messages.isRead, false)
                )
            );
    }

    async markMessageAsRead(messageId: number, userId: number): Promise<Message> {
        const [updatedMessage] = await db
            .update(messages)
            .set({ isRead: true })
            .where(and(eq(messages.id, messageId), eq(messages.receiverId, userId)))
            .returning();

        if (!updatedMessage) {
            throw new Error('Message not found or access denied');
        }

        return updatedMessage;
    }
}

export const messageStorage = new MessageStorage();
