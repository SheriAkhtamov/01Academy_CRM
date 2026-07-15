import { db } from '../db';
import {
    users,
    userWorkspaces,
    savedAccounts,
    type User,
    type InsertUser,
    type SavedAccount,
} from '@shared/schema';
import { ACADEMY_ACCESS_MODULES, type AcademyAccessModule } from '@shared/academy';
import { asc, desc, eq, or, and, inArray } from 'drizzle-orm';

export type UserWithWorkspaces = User & { workspaces: AcademyAccessModule[] };
type SavedAccountWithUser = SavedAccount & { accountUser: UserWithWorkspaces };

const workspaceSet = new Set<string>(ACADEMY_ACCESS_MODULES);

const normalizeWorkspaceList = (
    primaryWorkspace: string,
    assignedWorkspaces: readonly string[] = [],
): AcademyAccessModule[] => {
    const normalized = [primaryWorkspace, ...assignedWorkspaces]
        .map((workspace) => String(workspace))
        .filter((workspace): workspace is AcademyAccessModule => workspaceSet.has(workspace));

    return [...new Set(normalized)];
};

class UserStorage {
    private attachWorkspaces(user: User, assignedWorkspaces: readonly string[] = []): UserWithWorkspaces {
        return {
            ...user,
            workspaces: normalizeWorkspaceList(user.workspace, assignedWorkspaces),
        };
    }

    private async attachWorkspacesToUsers(userRows: User[]): Promise<UserWithWorkspaces[]> {
        if (userRows.length === 0) return [];

        const assignments = await db
            .select({
                userId: userWorkspaces.userId,
                workspace: userWorkspaces.workspace,
            })
            .from(userWorkspaces)
            .where(inArray(userWorkspaces.userId, userRows.map((user) => user.id)))
            .orderBy(asc(userWorkspaces.userId), asc(userWorkspaces.workspace));

        const workspacesByUser = new Map<number, string[]>();
        for (const assignment of assignments) {
            const existing = workspacesByUser.get(assignment.userId) ?? [];
            existing.push(assignment.workspace);
            workspacesByUser.set(assignment.userId, existing);
        }

        return userRows.map((user) => this.attachWorkspaces(user, workspacesByUser.get(user.id) ?? []));
    }

    async getUser(id: number): Promise<UserWithWorkspaces | undefined> {
        const result = await db.select().from(users).where(eq(users.id, id));
        return result[0] ? (await this.attachWorkspacesToUsers(result))[0] : undefined;
    }

    async getUserByEmail(email: string): Promise<UserWithWorkspaces | undefined> {
        const result = await db.select().from(users).where(eq(users.email, email));
        return result[0] ? (await this.attachWorkspacesToUsers(result))[0] : undefined;
    }

    async getUserByLoginOrEmail(loginOrEmail: string): Promise<UserWithWorkspaces | undefined> {
        const result = await db
            .select()
            .from(users)
            .where(or(eq(users.email, loginOrEmail), eq(users.fullName, loginOrEmail)));
        return result[0] ? (await this.attachWorkspacesToUsers(result))[0] : undefined;
    }

    async getUsers(): Promise<UserWithWorkspaces[]> {
        const result = await db.select().from(users).orderBy(asc(users.id));
        return this.attachWorkspacesToUsers(result);
    }

    async getUserWithPassword(id: number): Promise<UserWithWorkspaces | undefined> {
        return this.getUser(id);
    }

    async createUser(user: InsertUser): Promise<UserWithWorkspaces> {
        const result = await db.insert(users).values(user).returning();
        await this.setUserWorkspaces(result[0].id, [result[0].workspace]);
        return this.attachWorkspaces(result[0], [result[0].workspace]);
    }

    async updateUser(id: number, user: Partial<InsertUser>): Promise<UserWithWorkspaces> {
        const result = await db
            .update(users)
            .set({ ...user, updatedAt: new Date() })
            .where(eq(users.id, id))
            .returning();
        if (!result[0]) {
            throw new Error('User not found or access denied');
        }
        if (user.workspace) {
            await this.ensureUserWorkspace(id, user.workspace);
        }
        return (await this.attachWorkspacesToUsers(result))[0];
    }

    async deleteUser(id: number): Promise<void> {
        await db.delete(users).where(eq(users.id, id));
    }

    async getUserWorkspaces(userId: number): Promise<AcademyAccessModule[]> {
        const user = await this.getUser(userId);
        return user?.workspaces ?? [];
    }

    async setUserWorkspaces(userId: number, workspaces: readonly string[]): Promise<AcademyAccessModule[]> {
        const normalized = normalizeWorkspaceList('', workspaces);
        if (normalized.length === 0) {
            throw new Error('At least one workspace is required');
        }

        await db.transaction(async (tx) => {
            await tx.delete(userWorkspaces).where(eq(userWorkspaces.userId, userId));
            await tx.insert(userWorkspaces).values(
                normalized.map((workspace) => ({
                    userId,
                    workspace,
                })),
            );
        });

        return normalized;
    }

    async ensureUserWorkspace(userId: number, workspace: string): Promise<void> {
        const [normalized] = normalizeWorkspaceList(workspace);
        if (!normalized) return;

        await db
            .insert(userWorkspaces)
            .values({ userId, workspace: normalized })
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

    async getUsersWithOnlineStatus(): Promise<UserWithWorkspaces[]> {
        const result = await db
            .select()
            .from(users)
            .where(eq(users.isActive, true))
            .orderBy(asc(users.fullName), desc(users.createdAt));
        return this.attachWorkspacesToUsers(result);
    }

    private async attachWorkspacesToSavedAccounts(
        accounts: (SavedAccount & { accountUser: User })[],
    ): Promise<SavedAccountWithUser[]> {
        const accountUsers = await this.attachWorkspacesToUsers(accounts.map((account) => account.accountUser));
        const usersById = new Map(accountUsers.map((user) => [user.id, user]));

        return accounts.map((account) => ({
            ...account,
            accountUser: usersById.get(account.accountUser.id) ?? this.attachWorkspaces(account.accountUser),
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
        return this.attachWorkspacesToSavedAccounts(rows);
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
        const linkedAccounts = await this.attachWorkspacesToSavedAccounts(linkedRows);

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
        return (await this.attachWorkspacesToSavedAccounts(rows))[0];
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
