import { db } from '../db';
import { auditLogs, type AuditLog, type InsertAuditLog } from '@shared/schema';

class AuditStorage {
    async createAuditLog(auditLog: InsertAuditLog): Promise<AuditLog> {
        const result = await db.insert(auditLogs).values(auditLog).returning();
        return result[0];
    }
}

export const auditStorage = new AuditStorage();
