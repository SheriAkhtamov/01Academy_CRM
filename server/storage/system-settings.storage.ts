import { db } from '../db';
import { systemSettings, type InsertSystemSetting, type SystemSetting } from '@shared/schema';
import { eq } from 'drizzle-orm';

export class SystemSettingsStorage {
    async getSystemSettings(): Promise<SystemSetting[]> {
        return db.select().from(systemSettings);
    }

    async getSystemSetting(key: string): Promise<SystemSetting | undefined> {
        const [setting] = await db
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, key))
            .limit(1);
        return setting;
    }

    async setSystemSetting(setting: InsertSystemSetting): Promise<SystemSetting> {
        const [savedSetting] = await db
            .insert(systemSettings)
            .values(setting)
            .onConflictDoUpdate({
                target: [systemSettings.key],
                set: {
                    value: setting.value,
                    description: setting.description,
                    updatedAt: new Date(),
                },
            })
            .returning();
        return savedSetting;
    }
}

export const systemSettingsStorage = new SystemSettingsStorage();
