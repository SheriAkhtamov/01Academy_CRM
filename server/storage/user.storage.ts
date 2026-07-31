import { db } from '../db';
import {
    users,
    userModules,
    savedAccounts,
    type User,
    type InsertUser,
    type SavedAccount,
} from '../db/schema';
import { ACADEMY_ACCESS_MODULES, type AcademyAccessModule } from '@shared/academy';
import { asc, desc, eq, or, and, inArray } from 'drizzle-orm';

export type UserWithModules = User & { modules: AcademyAccessModule[] };
type SavedAccountWithUser = SavedAccount & { accountUser: UserWithModules };

const moduleSet = new Set<string>(ACADEMY_ACCESS_MODULES);

const normalizeModuleList = (
    primaryModule: string,
    assignedModules: readonly string[] = [],
): AcademyAccessModule[] => {
    const normalized = [primaryModule, ...assignedModules]
        .map((module) => String(module))
        .filter((module): module is AcademyAccessModule => moduleSet.has(module));

    return [...new Set(normalized)];
};

class UserStorage {
    private attachModules(user: User, assignedModules: readonly string[] = []): UserWithModules {
        return {
            ...user,
            modules: normalizeModuleList(user.module, assignedModules),
        };
    }

    private async attachModulesToUsers(userRows: User[]): Promise<UserWithModules[]> {
        if (userRows.length === 0) return [];

        const assignments = await db
            .select({
                userId: userModules.userId,
                module: userModules.module,
            })
            .from(userModules)
            .where(inArray(userModules.userId, userRows.map((user) => user.id)))
            .orderBy(asc(userModules.userId), asc(userModules.module));

        const modulesByUser = new Map<number, string[]>();
        for (const assignment of assignments) {
            const existing = modulesByUser.get(assignment.userId) ?? [];
            existing.push(assignment.module);
            modulesByUser.set(assignment.userId, existing);
        }

        return userRows.map((user) => this.attachModules(user, modulesByUser.get(user.id) ?? []));
    }

    async getUser(id: number): Promise<UserWithModules | undefined> {
        const result = await db.select().from(users).where(eq(users.id, id));
        return result[0] ? (await this.attachModulesToUsers(result))[0] : undefined;
    }

    async getUserByEmail(email: string): Promise<UserWithModules | undefined> {
        const result = await db.select().from(users).where(eq(users.email, email));
        return result[0] ? (await this.attachModulesToUsers(result))[0] : undefined;
    }

    async getUserByLoginOrEmail(loginOrEmail: string): Promise<UserWithModules | undefined> {
        const result = await db
            .select()
            .from(users)
            .where(or(eq(users.email, loginOrEmail), eq(users.fullName, loginOrEmail)));
        return result[0] ? (await this.attachModulesToUsers(result))[0] : undefined;
    }

    async getUsers(): Promise<UserWithModules[]> {
        const result = await db.select().from(users).orderBy(asc(users.id));
        return this.attachModulesToUsers(result);
    }

    async getUserWithPassword(id: number): Promise<UserWithModules | undefined> {
        return this.getUser(id);
    }

    async createUser(user: InsertUser): Promise<UserWithModules> {
        const result = await db.insert(users).values(user).returning();
        await this.setUserModules(result[0].id, [result[0].module]);
        return this.attachModules(result[0], [result[0].module]);
    }

    async updateUser(id: number, user: Partial<InsertUser>): Promise<UserWithModules> {
        const result = await db
            .update(users)
            .set({ ...user, updatedAt: new Date() })
            .where(eq(users.id, id))
            .returning();
        if (!result[0]) {
            throw new Error('User not found or access denied');
        }
        if (user.module) {
            await this.ensureUserModule(id, user.module);
        }
        return (await this.attachModulesToUsers(result))[0];
    }

    async deleteUser(id: number): Promise<void> {
        await db.delete(users).where(eq(users.id, id));
    }

    async getUserModules(userId: number): Promise<AcademyAccessModule[]> {
        const user = await this.getUser(userId);
        return user?.modules ?? [];
    }

    async setUserModules(userId: number, modules: readonly string[]): Promise<AcademyAccessModule[]> {
        const normalized = normalizeModuleList('', modules);
        if (normalized.length === 0) {
            throw new Error('At least one module is required');
        }

        await db.transaction(async (tx) => {
            await tx.delete(userModules).where(eq(userModules.userId, userId));
            await tx.insert(userModules).values(
                normalized.map((module) => ({
                    userId,
                    module,
                })),
            );
        });

        return normalized;
    }

    async ensureUserModule(userId: number, module: string): Promise<void> {
        const [normalized] = normalizeModuleList(module);
        if (!normalized) return;

        await db
            .insert(userModules)
            .values({ userId, module: normalized })
            .onConflictDoNothing();
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

    async getUsersWithOnlineStatus(): Promise<UserWithModules[]> {
        const result = await db
            .select()
            .from(users)
            .where(eq(users.isActive, true))
            .orderBy(asc(users.fullName), desc(users.createdAt));
        return this.attachModulesToUsers(result);
    }

    private async attachModulesToSavedAccounts(
        accounts: (SavedAccount & { accountUser: User })[],
    ): Promise<SavedAccountWithUser[]> {
        const accountUsers = await this.attachModulesToUsers(accounts.map((account) => account.accountUser));
        const usersById = new Map(accountUsers.map((user) => [user.id, user]));

        return accounts.map((account) => ({
            ...account,
            accountUser: usersById.get(account.accountUser.id) ?? this.attachModules(account.accountUser),
        }));
    }

    // Saved accounts (multi-account switching)
    async getSavedAccounts(ownerUserId: number): Promise<SavedAccountWithUser[]> {
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
        return this.attachModulesToSavedAccounts(rows);
    }

    /**
     * Saved-account links are shared by both participants. This keeps the
     * original account available after switching into a linked account.
     */
    async getSavedAccountsForUser(userId: number): Promise<SavedAccountWithUser[]> {
        const [ownedAccounts, linkedRows] = await Promise.all([
            this.getSavedAccounts(userId),
            db
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
                .innerJoin(users, eq(savedAccounts.ownerUserId, users.id))
                .where(eq(savedAccounts.accountUserId, userId))
                .orderBy(asc(savedAccounts.createdAt)),
        ]);
        const linkedAccounts = await this.attachModulesToSavedAccounts(linkedRows);

        return [...ownedAccounts, ...linkedAccounts]
            .sort((left, right) => (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0));
    }

    async addSavedAccount(ownerUserId: number, accountUserId: number, label: string | null, tokenHash: string): Promise<SavedAccount> {
        const result = await db
            .insert(savedAccounts)
            .values({ ownerUserId, accountUserId, label, tokenHash })
            .returning();
        return result[0];
    }

    async findSavedAccountByTokenHash(tokenHash: string): Promise<SavedAccountWithUser | undefined> {
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
        return (await this.attachModulesToSavedAccounts(rows))[0];
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

    async deleteSavedAccountByIdForUser(userId: number, savedAccountId: number): Promise<SavedAccount | undefined> {
        const result = await db
            .delete(savedAccounts)
            .where(
                and(
                    eq(savedAccounts.id, savedAccountId),
                    or(
                        eq(savedAccounts.ownerUserId, userId),
                        eq(savedAccounts.accountUserId, userId),
                    ),
                ),
            )
            .returning();

        return result[0];
    }
}

export const userStorage = new UserStorage();
