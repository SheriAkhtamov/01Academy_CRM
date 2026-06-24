import { db } from '../db';
import {
    users,
    savedAccounts,
    type User,
    type InsertUser,
    type SavedAccount,
} from '@shared/schema';
import { asc, desc, eq, or, and } from 'drizzle-orm';

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

    // Saved accounts (multi-account switching)
    async getSavedAccounts(ownerUserId: number): Promise<(SavedAccount & { accountUser: User })[]> {
        const rows = await db
            .select({
                id: savedAccounts.id,
                ownerUserId: savedAccounts.ownerUserId,
                accountUserId: savedAccounts.accountUserId,
                label: savedAccounts.label,
                tokenHash: savedAccounts.tokenHash,
                createdAt: savedAccounts.createdAt,
                accountUser: users,
            })
            .from(savedAccounts)
            .innerJoin(users, eq(savedAccounts.accountUserId, users.id))
            .where(eq(savedAccounts.ownerUserId, ownerUserId))
            .orderBy(asc(savedAccounts.createdAt));
        return rows;
    }

    async addSavedAccount(ownerUserId: number, accountUserId: number, label: string | null, tokenHash: string): Promise<SavedAccount> {
        const result = await db
            .insert(savedAccounts)
            .values({ ownerUserId, accountUserId, label, tokenHash })
            .returning();
        return result[0];
    }

    async findSavedAccountByTokenHash(tokenHash: string): Promise<(SavedAccount & { accountUser: User }) | undefined> {
        const rows = await db
            .select({
                id: savedAccounts.id,
                ownerUserId: savedAccounts.ownerUserId,
                accountUserId: savedAccounts.accountUserId,
                label: savedAccounts.label,
                tokenHash: savedAccounts.tokenHash,
                createdAt: savedAccounts.createdAt,
                accountUser: users,
            })
            .from(savedAccounts)
            .innerJoin(users, eq(savedAccounts.accountUserId, users.id))
            .where(eq(savedAccounts.tokenHash, tokenHash));
        return rows[0];
    }

    async deleteSavedAccount(ownerUserId: number, accountUserId: number): Promise<void> {
        await db
            .delete(savedAccounts)
            .where(
                and(
                    eq(savedAccounts.ownerUserId, ownerUserId),
                    eq(savedAccounts.accountUserId, accountUserId)
                )
            );
    }

    async deleteSavedAccountById(ownerUserId: number, savedAccountId: number): Promise<void> {
        await db
            .delete(savedAccounts)
            .where(
                and(
                    eq(savedAccounts.ownerUserId, ownerUserId),
                    eq(savedAccounts.id, savedAccountId)
                )
            );
    }
}

export const userStorage = new UserStorage();
