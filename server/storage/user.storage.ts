import { db } from '../db';
import {
    users,
    type User,
    type InsertUser,
} from '@shared/schema';
import { asc, desc, eq, or } from 'drizzle-orm';

class UserStorage {
    async getUser(id: number): Promise<User | undefined> {
        const result = await db.select().from(users).where(eq(users.id, id));
        return result[0];
    }

    async getUserByEmail(email: string): Promise<User | undefined> {
        const result = await db.select().from(users).where(eq(users.email, email));
        return result[0];
    }

    async getUserByLoginOrEmail(loginOrEmail: string): Promise<User | undefined> {
        const result = await db
            .select()
            .from(users)
            .where(or(eq(users.email, loginOrEmail), eq(users.fullName, loginOrEmail)));
        return result[0];
    }

    async getUsers(): Promise<User[]> {
        return db.select().from(users).orderBy(asc(users.id));
    }

    async getUserWithPassword(id: number): Promise<User | undefined> {
        return this.getUser(id);
    }

    async createUser(user: InsertUser): Promise<User> {
        const result = await db.insert(users).values(user).returning();
        return result[0];
    }

    async updateUser(id: number, user: Partial<InsertUser>): Promise<User> {
        const result = await db
            .update(users)
            .set({ ...user, updatedAt: new Date() })
            .where(eq(users.id, id))
            .returning();
        if (!result[0]) {
            throw new Error('User not found or access denied');
        }
        return result[0];
    }

    async deleteUser(id: number): Promise<void> {
        await db.delete(users).where(eq(users.id, id));
    }

    async updateUserOnlineStatus(userId: number, isOnline: boolean): Promise<void> {
        await db
            .update(users)
            .set({
                isOnline,
                lastSeenAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(users.id, userId));
    }

    async getUsersWithOnlineStatus(): Promise<User[]> {
        return db
            .select()
            .from(users)
            .where(eq(users.isActive, true))
            .orderBy(asc(users.fullName), desc(users.createdAt));
    }
}

export const userStorage = new UserStorage();
