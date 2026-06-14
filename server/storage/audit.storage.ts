import { db } from '../db';
import { auditLogs, users, type AuditLog, type InsertAuditLog } from '@shared/schema';
import { count, desc, eq } from 'drizzle-orm';

export class AuditStorage {
    async getAuditLogs(
        limit: number = 50,
        offset: number = 0,
    ): Promise<{ logs: AuditLog[]; total: number }> {
        const [totalResult] = await db
            .select({ count: count() })
            .from(auditLogs);

        const logs = await db
            .select({
                id: auditLogs.id,
                userId: auditLogs.userId,
                action: auditLogs.action,
                entityType: auditLogs.entityType,
                entityId: auditLogs.entityId,
                oldValues: auditLogs.oldValues,
                newValues: auditLogs.newValues,
                createdAt: auditLogs.createdAt,
                user: {
                    id: users.id,
                    fullName: users.fullName,
                    email: users.email,
                    role: users.role,
                },
            })
            .from(auditLogs)
            .leftJoin(users, eq(auditLogs.userId, users.id))
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit)
            .offset(offset);

        return {
            logs: logs as AuditLog[],
            total: totalResult ? Number(totalResult.count) : 0,
        };
    }

    async createAuditLog(auditLog: InsertAuditLog): Promise<AuditLog> {
        const result = await db.insert(auditLogs).values(auditLog).returning();
        return result[0];
    }
}

export const auditStorage = new AuditStorage();
