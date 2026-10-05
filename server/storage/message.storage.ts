import type { MessageAttachment } from '@shared/contracts/messages';
import { db } from '../db';
import { messages, users, type Message, type InsertMessage, type User } from '../db/schema';
import { eq, or, and, asc, sql } from 'drizzle-orm';

type ConversationUser = Pick<User, 'id' | 'fullName' | 'position' | 'email' | 'avatarUrl'> & {
    unreadCount: number;
    isOnline: boolean | null;
    lastSeenAt: Date | null;
};

class MessageStorage {
    async getConversations(userId: number): Promise<ConversationUser[]> {
        const result = await db.execute(sql`
      SELECT
        ${users.id} as id,
        ${users.fullName} as "fullName",
        ${users.avatarUrl} as "avatarUrl",
        ${users.position} as position,
        ${users.email} as email,
        ${users.isOnline} as "isOnline", ${users.lastSeenAt} as "lastSeenAt",
        MAX(${messages.createdAt}) as last_message_time,
        COUNT(*) FILTER (
          WHERE ${messages.receiverId} = ${userId}
            AND ${messages.isRead} IS NOT TRUE
        )::int AS "unreadCount"
      FROM ${messages}
      INNER JOIN ${users} ON ${users.id} = CASE
        WHEN ${messages.senderId} = ${userId} THEN ${messages.receiverId}
        ELSE ${messages.senderId}
      END
      WHERE (${messages.senderId} = ${userId} OR ${messages.receiverId} = ${userId})
      GROUP BY ${users.id}, ${users.fullName}, ${users.position}, ${users.email}
      ORDER BY last_message_time DESC
    `);

        return (result.rows as any[]).map(({ last_message_time, unreadCount, ...user }) => ({
            ...user,
            unreadCount: Number(unreadCount ?? 0),
        })) as ConversationUser[];
    }

    async getMessagesBetweenUsers(senderId: number, receiverId: number): Promise<Message[]> {
        const results = await db
            .select({
                id: messages.id,
                senderId: messages.senderId,
                receiverId: messages.receiverId,
                content: messages.content,
                attachments: messages.attachments,
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
            attachments: row.attachments,
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
        return db.transaction(async (tx) => {
            const result = await tx.insert(messages).values(message).returning();
            const newMessage = result[0];

            const [messageWithSender] = await tx
                .select({
                    id: messages.id,
                    senderId: messages.senderId,
                    receiverId: messages.receiverId,
                    content: messages.content,
                    attachments: messages.attachments,
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
                attachments: messageWithSender.attachments,
                isRead: messageWithSender.isRead,
                createdAt: messageWithSender.createdAt,
                updatedAt: messageWithSender.updatedAt,
                sender: messageWithSender.senderId_user ? {
                    id: messageWithSender.senderId_user,
                    fullName: messageWithSender.senderFullName || '',
                    position: messageWithSender.senderPosition || '',
                } : undefined,
            } as Message;
        });
    }

    async getMessageAttachment(fileId: string, userId: number): Promise<MessageAttachment | null> {
        const result = await db.execute(sql`
          SELECT attachment AS file FROM ${messages}
          CROSS JOIN LATERAL jsonb_array_elements(${messages.attachments}) attachment
          WHERE (${messages.senderId} = ${userId} OR ${messages.receiverId} = ${userId})
            AND attachment->>'id' = ${fileId} LIMIT 1
        `);
        return (result.rows[0]?.file as MessageAttachment | undefined) ?? null;
    }

    async createMessages(items: InsertMessage[]): Promise<Message[]> {
        if (items.length === 0) return [];
        return db.insert(messages).values(items).returning();
    }

    async markMessageAsRead(messageId: number, userId: number): Promise<Message | null> {
        const [updatedMessage] = await db
            .update(messages)
            .set({ isRead: true })
            .where(and(eq(messages.id, messageId), eq(messages.receiverId, userId)))
            .returning();

        return updatedMessage ?? null;
    }

    async markConversationAsRead(otherUserId: number, userId: number): Promise<Message[]> {
        return db
            .update(messages)
            .set({ isRead: true, updatedAt: new Date() })
            .where(and(
                eq(messages.senderId, otherUserId),
                eq(messages.receiverId, userId),
                sql`${messages.isRead} IS NOT TRUE`,
            ))
            .returning();
    }
}

export const messageStorage = new MessageStorage();
