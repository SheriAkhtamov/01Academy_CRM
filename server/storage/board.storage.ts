import { db } from '../db';
import {
    boards,
    boardTasks,
    boardTaskComments,
    boardTaskChecklistItems,
    boardTaskAttachments,
    boardTaskActivity,
    users,
    type Board,
    type BoardTask,
    type InsertBoardTask,
    type InsertBoardTaskComment,
    type InsertBoardTaskChecklistItem,
    type InsertBoardTaskAttachment,
    type InsertBoardTaskActivity,
} from '@shared/schema';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

// Minimal user shape embedded in task payloads. Accepts the `users` table or
// any alias of it (creator/assignee/author/...), hence the loose column type.
const userMini = (prefix: { id: any; fullName: any; position: any; workspace: any }) => ({
    id: prefix.id,
    fullName: prefix.fullName,
    position: prefix.position,
    workspace: prefix.workspace,
});

const creator = alias(users, 'creator');
const assignee = alias(users, 'assignee');
const author = alias(users, 'author');
const uploader = alias(users, 'uploader');
const actor = alias(users, 'actor');

class BoardStorage {
    // -- Boards ------------------------------------------------------------
    async getBoards(): Promise<Board[]> {
        return db.select().from(boards).where(eq(boards.isArchived, false)).orderBy(asc(boards.id));
    }

    async getBoard(id: number): Promise<Board | undefined> {
        const [row] = await db.select().from(boards).where(eq(boards.id, id));
        return row;
    }

    async getDefaultBoard(): Promise<Board | undefined> {
        const [row] = await db
            .select()
            .from(boards)
            .where(and(eq(boards.isDefault, true), eq(boards.isArchived, false)))
            .orderBy(asc(boards.id));
        if (row) return row;
        // Fallback: first non-archived board.
        const [first] = await db.select().from(boards).where(eq(boards.isArchived, false)).orderBy(asc(boards.id));
        return first;
    }

    // -- Tasks (list with embedded users + counts) -------------------------
    async getTasks(boardId: number, visibleToUserId?: number) {
        const visibilityWhere = visibleToUserId
            ? and(
                eq(boardTasks.boardId, boardId),
                or(
                    eq(boardTasks.creatorId, visibleToUserId),
                    eq(boardTasks.assigneeId, visibleToUserId),
                ),
            )
            : eq(boardTasks.boardId, boardId);

        const rows = await db
            .select({
                id: boardTasks.id,
                boardId: boardTasks.boardId,
                title: boardTasks.title,
                description: boardTasks.description,
                status: boardTasks.status,
                priority: boardTasks.priority,
                position: boardTasks.position,
                dueAt: boardTasks.dueAt,
                acceptedAt: boardTasks.acceptedAt,
                createdAt: boardTasks.createdAt,
                updatedAt: boardTasks.updatedAt,
                creator: userMini(creator),
                assignee: userMini(assignee),
            })
            .from(boardTasks)
            .leftJoin(creator, eq(boardTasks.creatorId, creator.id))
            .leftJoin(assignee, eq(boardTasks.assigneeId, assignee.id))
            .where(visibilityWhere)
            .orderBy(asc(boardTasks.position), asc(boardTasks.id));

        const ids = rows.map((r) => r.id);
        const counts = await this.getTaskCounts(ids);

        return rows.map((r) => ({
            ...r,
            creator: r.creator?.id ? r.creator : null,
            assignee: r.assignee?.id ? r.assignee : null,
            ...(counts.get(r.id) ?? { commentCount: 0, attachmentCount: 0, checklistTotal: 0, checklistDone: 0 }),
        }));
    }

    private async getTaskCounts(taskIds: number[]) {
        const map = new Map<number, { commentCount: number; attachmentCount: number; checklistTotal: number; checklistDone: number }>();
        if (taskIds.length === 0) return map;
        for (const id of taskIds) {
            map.set(id, { commentCount: 0, attachmentCount: 0, checklistTotal: 0, checklistDone: 0 });
        }

        const comments = await db
            .select({ taskId: boardTaskComments.taskId, count: sql<number>`count(*)::int` })
            .from(boardTaskComments)
            .where(inArray(boardTaskComments.taskId, taskIds))
            .groupBy(boardTaskComments.taskId);
        for (const c of comments) map.get(c.taskId)!.commentCount = c.count;

        const attachments = await db
            .select({ taskId: boardTaskAttachments.taskId, count: sql<number>`count(*)::int` })
            .from(boardTaskAttachments)
            .where(inArray(boardTaskAttachments.taskId, taskIds))
            .groupBy(boardTaskAttachments.taskId);
        for (const a of attachments) map.get(a.taskId)!.attachmentCount = a.count;

        const checklist = await db
            .select({
                taskId: boardTaskChecklistItems.taskId,
                total: sql<number>`count(*)::int`,
                done: sql<number>`sum(case when ${boardTaskChecklistItems.isDone} then 1 else 0 end)::int`,
            })
            .from(boardTaskChecklistItems)
            .where(inArray(boardTaskChecklistItems.taskId, taskIds))
            .groupBy(boardTaskChecklistItems.taskId);
        for (const c of checklist) {
            const entry = map.get(c.taskId)!;
            entry.checklistTotal = c.total;
            entry.checklistDone = c.done ?? 0;
        }

        return map;
    }

    // -- Task detail (with comments, checklist, attachments, activity) -----
    async getTaskDetail(id: number) {
        const [task] = await db
            .select({
                id: boardTasks.id,
                boardId: boardTasks.boardId,
                title: boardTasks.title,
                description: boardTasks.description,
                status: boardTasks.status,
                priority: boardTasks.priority,
                position: boardTasks.position,
                creatorId: boardTasks.creatorId,
                assigneeId: boardTasks.assigneeId,
                dueAt: boardTasks.dueAt,
                acceptedAt: boardTasks.acceptedAt,
                acceptedBy: boardTasks.acceptedBy,
                createdAt: boardTasks.createdAt,
                updatedAt: boardTasks.updatedAt,
                creator: userMini(creator),
                assignee: userMini(assignee),
            })
            .from(boardTasks)
            .leftJoin(creator, eq(boardTasks.creatorId, creator.id))
            .leftJoin(assignee, eq(boardTasks.assigneeId, assignee.id))
            .where(eq(boardTasks.id, id));

        if (!task) return undefined;

        const [comments, checklist, attachments, activity] = await Promise.all([
            db
                .select({
                    id: boardTaskComments.id,
                    taskId: boardTaskComments.taskId,
                    body: boardTaskComments.body,
                    createdAt: boardTaskComments.createdAt,
                    updatedAt: boardTaskComments.updatedAt,
                    author: userMini(author),
                })
                .from(boardTaskComments)
                .leftJoin(author, eq(boardTaskComments.authorId, author.id))
                .where(eq(boardTaskComments.taskId, id))
                .orderBy(asc(boardTaskComments.createdAt)),
            db
                .select()
                .from(boardTaskChecklistItems)
                .where(eq(boardTaskChecklistItems.taskId, id))
                .orderBy(asc(boardTaskChecklistItems.position), asc(boardTaskChecklistItems.id)),
            db
                .select({
                    id: boardTaskAttachments.id,
                    taskId: boardTaskAttachments.taskId,
                    fileName: boardTaskAttachments.fileName,
                    originalName: boardTaskAttachments.originalName,
                    mimeType: boardTaskAttachments.mimeType,
                    size: boardTaskAttachments.size,
                    createdAt: boardTaskAttachments.createdAt,
                    uploadedBy: userMini(uploader),
                })
                .from(boardTaskAttachments)
                .leftJoin(uploader, eq(boardTaskAttachments.uploadedBy, uploader.id))
                .where(eq(boardTaskAttachments.taskId, id))
                .orderBy(desc(boardTaskAttachments.createdAt)),
            db
                .select({
                    id: boardTaskActivity.id,
                    taskId: boardTaskActivity.taskId,
                    type: boardTaskActivity.type,
                    fromValue: boardTaskActivity.fromValue,
                    toValue: boardTaskActivity.toValue,
                    meta: boardTaskActivity.meta,
                    createdAt: boardTaskActivity.createdAt,
                    actor: userMini(actor),
                })
                .from(boardTaskActivity)
                .leftJoin(actor, eq(boardTaskActivity.actorId, actor.id))
                .where(eq(boardTaskActivity.taskId, id))
                .orderBy(asc(boardTaskActivity.createdAt)),
        ]);

        return {
            ...task,
            creator: task.creator?.id ? task.creator : null,
            assignee: task.assignee?.id ? task.assignee : null,
            comments: comments.map((c) => ({ ...c, author: c.author?.id ? c.author : null })),
            checklist,
            attachments: attachments.map((a) => ({ ...a, uploadedBy: a.uploadedBy?.id ? a.uploadedBy : null })),
            activity: activity.map((a) => ({ ...a, actor: a.actor?.id ? a.actor : null })),
        };
    }

    async getTask(id: number): Promise<BoardTask | undefined> {
        const [row] = await db.select().from(boardTasks).where(eq(boardTasks.id, id));
        return row;
    }

    async getMaxPosition(boardId: number, status: string): Promise<number> {
        const [row] = await db
            .select({ max: sql<number>`coalesce(max(${boardTasks.position}), 0)::int` })
            .from(boardTasks)
            .where(and(eq(boardTasks.boardId, boardId), eq(boardTasks.status, status)));
        return row?.max ?? 0;
    }

    async createTask(data: InsertBoardTask): Promise<BoardTask> {
        const [row] = await db.insert(boardTasks).values(data).returning();
        return row;
    }

    async createTaskWithActivity(
        data: InsertBoardTask,
        activity: Omit<InsertBoardTaskActivity, 'taskId'>,
    ): Promise<BoardTask> {
        return db.transaction(async (tx) => {
            const [row] = await tx.insert(boardTasks).values(data).returning();
            await tx.insert(boardTaskActivity).values({ ...activity, taskId: row.id });
            return row;
        });
    }

    async updateTask(id: number, data: Partial<InsertBoardTask> & { acceptedAt?: Date | null; acceptedBy?: number | null }): Promise<BoardTask> {
        const [row] = await db
            .update(boardTasks)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(boardTasks.id, id))
            .returning();
        return row;
    }

    async updateTaskWithActivities(
        id: number,
        expectedStatus: string,
        data: Partial<InsertBoardTask> & { acceptedAt?: Date | null; acceptedBy?: number | null },
        activities: Omit<InsertBoardTaskActivity, 'taskId'>[],
    ): Promise<BoardTask> {
        return db.transaction(async (tx) => {
            const [row] = await tx
                .update(boardTasks)
                .set({ ...data, updatedAt: new Date() })
                .where(and(eq(boardTasks.id, id), eq(boardTasks.status, expectedStatus)))
                .returning();
            if (!row) {
                throw Object.assign(new Error('Task changed concurrently'), { statusCode: 409 });
            }
            if (activities.length > 0) {
                await tx.insert(boardTaskActivity).values(
                    activities.map((activity) => ({ ...activity, taskId: id })),
                );
            }
            return row;
        });
    }

    async deleteTask(id: number): Promise<void> {
        await db.delete(boardTasks).where(eq(boardTasks.id, id));
    }

    // -- Comments ----------------------------------------------------------
    async createComment(data: InsertBoardTaskComment) {
        const [row] = await db.insert(boardTaskComments).values(data).returning();
        return row;
    }

    async createCommentWithActivity(
        data: InsertBoardTaskComment,
        activity: Omit<InsertBoardTaskActivity, 'taskId'>,
    ) {
        return db.transaction(async (tx) => {
            const [row] = await tx.insert(boardTaskComments).values(data).returning();
            await tx.insert(boardTaskActivity).values({ ...activity, taskId: data.taskId });
            return row;
        });
    }

    async getComment(id: number) {
        const [row] = await db.select().from(boardTaskComments).where(eq(boardTaskComments.id, id));
        return row;
    }

    async updateComment(id: number, body: string) {
        const [row] = await db
            .update(boardTaskComments)
            .set({ body, updatedAt: new Date() })
            .where(eq(boardTaskComments.id, id))
            .returning();
        return row;
    }

    async deleteComment(id: number): Promise<void> {
        await db.delete(boardTaskComments).where(eq(boardTaskComments.id, id));
    }

    // -- Checklist ---------------------------------------------------------
    async createChecklistItem(data: InsertBoardTaskChecklistItem) {
        const [row] = await db.insert(boardTaskChecklistItems).values(data).returning();
        return row;
    }

    async getChecklistItem(id: number) {
        const [row] = await db.select().from(boardTaskChecklistItems).where(eq(boardTaskChecklistItems.id, id));
        return row;
    }

    async updateChecklistItem(id: number, data: Partial<InsertBoardTaskChecklistItem>) {
        const [row] = await db
            .update(boardTaskChecklistItems)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(boardTaskChecklistItems.id, id))
            .returning();
        return row;
    }

    async deleteChecklistItem(id: number): Promise<void> {
        await db.delete(boardTaskChecklistItems).where(eq(boardTaskChecklistItems.id, id));
    }

    // -- Attachments -------------------------------------------------------
    async createAttachment(data: InsertBoardTaskAttachment) {
        const [row] = await db.insert(boardTaskAttachments).values(data).returning();
        return row;
    }

    async getAttachment(id: number) {
        const [row] = await db.select().from(boardTaskAttachments).where(eq(boardTaskAttachments.id, id));
        return row;
    }

    async deleteAttachment(id: number): Promise<void> {
        await db.delete(boardTaskAttachments).where(eq(boardTaskAttachments.id, id));
    }

    // -- Activity ----------------------------------------------------------
    async createActivity(data: InsertBoardTaskActivity) {
        const [row] = await db.insert(boardTaskActivity).values(data).returning();
        return row;
    }
}

export const boardStorage = new BoardStorage();
