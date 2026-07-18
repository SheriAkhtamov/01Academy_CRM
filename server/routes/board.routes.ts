import { Router } from 'express';
import fs from 'fs';
import { storage } from '../storage';
import { requireAuth } from '../middleware/auth.middleware';
import { boardAttachmentUpload, BOARD_UPLOAD_DIR } from '../middleware/upload.middleware';
import { logger } from '../lib/logger';
import path from 'path';
import {
    BOARD_TASK_STATUSES,
    BOARD_TASK_PRIORITIES,
    type BoardTask,
    type BoardTaskStatus,
} from '@shared/schema';
import { hasLeadershipAccess } from '@shared/academy';
import type { User } from '@shared/schema';

const router = Router();

let broadcastToClients: (data: any) => void = () => { };

export function setBroadcastFunction(fn: (data: any) => void) {
    broadcastToClients = fn;
}

// --- Permission helpers -----------------------------------------------------

const isTaskSupervisor = (user?: User) => hasLeadershipAccess(user);

router.use(requireAuth);

const canReadTask = (user: User, task: BoardTask | { creatorId: number | null; assigneeId: number | null }) =>
    user.id === task.creatorId || user.id === task.assigneeId || isTaskSupervisor(user);

// Can edit core fields (title, description, priority, assignee, due date).
const canManageTask = (user: User, task: BoardTask) =>
    canReadTask(user, task);

// Accepting (Done -> Accepted) and re-opening (out of Accepted) are reserved
// for the task creator. The head retains an override so orphaned tasks (whose
// creator was deactivated) never get stuck.
const canAcceptOrReopen = (user: User, task: BoardTask) =>
    user.id === task.creatorId || isTaskSupervisor(user);

const parseId = (raw: unknown) => {
    const text = String(raw ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const id = Number(text);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const parseDateInput = (value: unknown): { date: Date | null; valid: boolean } => {
    if (value === undefined || value === null || value === '') return { date: null, valid: true };
    if (typeof value !== 'string') return { date: null, valid: false };
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? { date: null, valid: false } : { date, valid: true };
};

const normalizeOptionalText = (value: unknown): { value: string | null; valid: boolean } => {
    if (value === undefined || value === null) return { value: null, valid: true };
    return typeof value === 'string'
        ? { value: value.trim() || null, valid: true }
        : { value: null, valid: false };
};

const removeUploadedFile = async (filePath?: string) => {
    if (!filePath) return;
    try {
        await fs.promises.unlink(filePath);
    } catch (error: any) {
        if (error?.code !== 'ENOENT') logger.error('Failed to remove orphaned board upload', { error, filePath });
    }
};

const isStatus = (value: unknown): value is BoardTaskStatus =>
    typeof value === 'string' && (BOARD_TASK_STATUSES as readonly string[]).includes(value);

const hasAssigneeValue = (value: unknown) => value !== undefined && value !== null && value !== '';

const parseAssigneeId = (value: unknown) => {
    if (!hasAssigneeValue(value)) return null;
    return parseId(String(value));
};

type AssigneeResolution =
    | { assigneeId: number | null; error?: never }
    | { assigneeId?: never; error: { code: number; message: string } };

const resolveAssignee = async (
    rawAssigneeId: unknown,
    actor: User,
    options: { forceSelfForStaff: boolean },
): Promise<AssigneeResolution> => {
    if (!hasAssigneeValue(rawAssigneeId) && options.forceSelfForStaff) {
        return { assigneeId: actor.id };
    }

    const requestedAssigneeId = parseAssigneeId(rawAssigneeId);
    if (hasAssigneeValue(rawAssigneeId) && requestedAssigneeId === null) {
        return { error: { code: 400, message: 'Invalid assignee' } };
    }
    if (requestedAssigneeId !== null) {
        const assignee = await storage.getUser(requestedAssigneeId);
        if (!assignee || assignee.isActive === false) {
            return { error: { code: 400, message: 'Assignee not found' } };
        }
    }

    return { assigneeId: requestedAssigneeId };
};

// Validates a status transition and returns an error tuple or null when allowed.
function validateTransition(
    task: BoardTask,
    toStatus: BoardTaskStatus,
    user: User,
): { code: number; error: string } | null {
    if (task.status === toStatus) return null;

    if (toStatus === 'accepted') {
        if (task.status !== 'done') {
            return { code: 400, error: 'Task must be in Done before it can be accepted' };
        }
        if (!canAcceptOrReopen(user, task)) {
            return { code: 403, error: 'Only the task creator can accept this task' };
        }
    }

    if (task.status === 'accepted') {
        // Leaving Accepted == re-open.
        if (!canAcceptOrReopen(user, task)) {
            return { code: 403, error: 'Only the task creator can re-open this task' };
        }
    }

    return null;
}

const broadcastTask = (type: string, task: { id: number; boardId: number }) => {
    // Read access remains enforced when each client refreshes the board.
    broadcastToClients({ type, data: { id: task.id, boardId: task.boardId } });
};

// --- Boards -----------------------------------------------------------------

router.get('/boards', async (_req, res) => {
    try {
        const boards = await storage.board.getBoards();
        res.json(boards);
    } catch (error) {
        logger.error('Failed to fetch boards', { error });
        res.status(500).json({ error: 'Failed to fetch boards' });
    }
});

// --- Tasks ------------------------------------------------------------------

// List tasks for a board (defaults to the shared board when boardId is omitted).
router.get('/tasks', async (req, res) => {
    try {
        const hasBoardId = req.query.boardId !== undefined && req.query.boardId !== '';
        let boardId = hasBoardId ? parseId(req.query.boardId) : null;
        if (hasBoardId && !boardId) {
            return res.status(400).json({ error: 'Invalid board id' });
        }
        if (boardId === null) {
            const board = await storage.board.getDefaultBoard();
            if (!board) return res.json({ board: null, tasks: [] });
            boardId = board.id;
        }
        const visibleToUserId = isTaskSupervisor(req.user!) ? undefined : req.user!.id;
        const [board, tasks] = await Promise.all([
            storage.board.getBoard(boardId),
            storage.board.getTasks(boardId, visibleToUserId),
        ]);
        if (!board) return res.status(404).json({ error: 'Board not found' });
        res.json({ board, tasks });
    } catch (error) {
        logger.error('Failed to fetch board tasks', { error });
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

router.get('/tasks/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid task id' });
        const task = await storage.board.getTaskDetail(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canReadTask(req.user!, task)) return res.status(403).json({ error: 'accessDenied' });
        res.json(task);
    } catch (error) {
        logger.error('Failed to fetch task detail', { error, taskId: req.params.id });
        res.status(500).json({ error: 'Failed to fetch task' });
    }
});

router.post('/tasks', async (req, res) => {
    try {
        const { title, description, priority, status, assigneeId, dueAt } = req.body;
        let { boardId } = req.body;

        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ error: 'Title is required' });
        }
        if (title.trim().length > 255) {
            return res.status(400).json({ error: 'Title is too long' });
        }
        const normalizedDescription = normalizeOptionalText(description);
        if (!normalizedDescription.valid) {
            return res.status(400).json({ error: 'Invalid description' });
        }
        if (priority !== undefined && !(BOARD_TASK_PRIORITIES as readonly string[]).includes(priority)) {
            return res.status(400).json({ error: 'Invalid priority' });
        }
        if (status !== undefined && !isStatus(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        if (boardId !== undefined && boardId !== null && boardId !== '') {
            boardId = parseId(boardId);
            if (!boardId) return res.status(400).json({ error: 'Invalid board id' });
            if (!await storage.board.getBoard(boardId)) {
                return res.status(404).json({ error: 'Board not found' });
            }
        } else {
            const board = await storage.board.getDefaultBoard();
            if (!board) return res.status(400).json({ error: 'No board available' });
            boardId = board.id;
        }

        const parsedDueAt = parseDateInput(dueAt);
        if (!parsedDueAt.valid) return res.status(400).json({ error: 'Invalid due date' });

        const targetStatus: BoardTaskStatus = isStatus(status) ? status : 'backlog';
        // `accepted` is not an initial state. It records the creator's approval
        // of work that has already reached `done`, and therefore must only be
        // entered through the guarded status-transition endpoint below.
        if (targetStatus === 'accepted') {
            return res.status(400).json({ error: 'Task must be in Done before it can be accepted' });
        }
        const position = (await storage.board.getMaxPosition(boardId, targetStatus)) + 1;

        const resolvedAssignee = await resolveAssignee(assigneeId, req.user!, { forceSelfForStaff: true });
        if (resolvedAssignee.error) {
            return res.status(resolvedAssignee.error.code).json({ error: resolvedAssignee.error.message });
        }

        const taskValues = {
            boardId,
            title: title.trim(),
            description: normalizedDescription.value,
            status: targetStatus,
            priority: priority ?? 'normal',
            position,
            creatorId: req.user!.id,
            assigneeId: resolvedAssignee.assigneeId,
            dueAt: parsedDueAt.date,
        };
        const activityValues = {
            actorId: req.user!.id,
            type: 'created',
            fromValue: null,
            toValue: targetStatus,
            meta: null,
        };
        const atomicCreate = (storage.board as any).createTaskWithActivity;
        const task = atomicCreate
            ? await atomicCreate.call(storage.board, taskValues, activityValues)
            : await storage.board.createTask(taskValues);
        if (!atomicCreate) {
            await storage.board.createActivity({ taskId: task.id, ...activityValues });
        }

        broadcastTask('BOARD_TASK_CREATED', task);
        res.json(task);
    } catch (error) {
        logger.error('Failed to create task', { error });
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// Update core fields (title, description, priority, assignee, due date).
router.patch('/tasks/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid task id' });

        const task = await storage.board.getTask(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canManageTask(req.user!, task)) {
            return res.status(403).json({ error: 'You are not allowed to edit this task' });
        }

        const updates: Record<string, unknown> = {};
        const { title, description, priority, assigneeId, dueAt } = req.body;

        if (title !== undefined) {
            if (typeof title !== 'string' || !title.trim()) {
                return res.status(400).json({ error: 'Title cannot be empty' });
            }
            if (title.trim().length > 255) return res.status(400).json({ error: 'Title is too long' });
            updates.title = title.trim();
        }
        if (description !== undefined) {
            const normalizedDescription = normalizeOptionalText(description);
            if (!normalizedDescription.valid) return res.status(400).json({ error: 'Invalid description' });
            updates.description = normalizedDescription.value;
        }
        if (priority !== undefined) {
            if (!(BOARD_TASK_PRIORITIES as readonly string[]).includes(priority)) {
                return res.status(400).json({ error: 'Invalid priority' });
            }
            updates.priority = priority;
        }
        if (assigneeId !== undefined) {
            const resolvedAssignee = await resolveAssignee(assigneeId, req.user!, { forceSelfForStaff: false });
            if (resolvedAssignee.error) {
                return res.status(resolvedAssignee.error.code).json({ error: resolvedAssignee.error.message });
            }
            updates.assigneeId = resolvedAssignee.assigneeId;
        }
        if (dueAt !== undefined) {
            const parsedDueAt = parseDateInput(dueAt);
            if (!parsedDueAt.valid) return res.status(400).json({ error: 'Invalid due date' });
            updates.dueAt = parsedDueAt.date;
        }

        const activities: Array<Record<string, unknown>> = [];
        if (updates.assigneeId !== undefined && updates.assigneeId !== task.assigneeId) {
            activities.push({
                actorId: req.user!.id,
                type: updates.assigneeId ? 'assigned' : 'unassigned',
                fromValue: task.assigneeId ? String(task.assigneeId) : null,
                toValue: updates.assigneeId ? String(updates.assigneeId) : null,
                meta: null,
            });
        }
        if (updates.priority !== undefined && updates.priority !== task.priority) {
            activities.push({
                actorId: req.user!.id,
                type: 'priority_changed',
                fromValue: task.priority,
                toValue: String(updates.priority),
                meta: null,
            });
        }
        const atomicUpdate = (storage.board as any).updateTaskWithActivities;
        const updated = atomicUpdate
            ? await atomicUpdate.call(storage.board, id, task.status, updates, activities)
            : await storage.board.updateTask(id, updates);
        if (!atomicUpdate) {
            for (const activity of activities) {
                await storage.board.createActivity({ taskId: id, ...activity } as any);
            }
        }

        broadcastTask('BOARD_TASK_UPDATED', updated);
        res.json(updated);
    } catch (error) {
        logger.error('Failed to update task', { error, taskId: req.params.id });
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// Move a task to another column (with the creator-only accept/reopen rules).
router.patch('/tasks/:id/status', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid task id' });

        const { status, position } = req.body;
        if (!isStatus(status)) return res.status(400).json({ error: 'Invalid status' });
        if (
            position !== undefined
            && (!Number.isSafeInteger(position) || position < 0)
        ) {
            return res.status(400).json({ error: 'Invalid position' });
        }

        const task = await storage.board.getTask(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canManageTask(req.user!, task)) {
            return res.status(403).json({ error: 'accessDenied' });
        }

        const transitionError = validateTransition(task, status, req.user!);
        if (transitionError) {
            return res.status(transitionError.code).json({ error: transitionError.error });
        }

        const updates: Record<string, unknown> = { status };
        if (position !== undefined) {
            updates.position = position;
        } else {
            updates.position = (await storage.board.getMaxPosition(task.boardId, status)) + 1;
        }

        const movingToAccepted = status === 'accepted' && task.status !== 'accepted';
        const reopening = task.status === 'accepted' && status !== 'accepted';
        if (movingToAccepted) {
            updates.acceptedAt = new Date();
            updates.acceptedBy = req.user!.id;
        }
        if (reopening) {
            updates.acceptedAt = null;
            updates.acceptedBy = null;
        }

        const activityType = movingToAccepted ? 'accepted' : reopening ? 'reopened' : 'status_changed';
        const activity = {
            actorId: req.user!.id,
            type: activityType,
            fromValue: task.status,
            toValue: status,
            meta: null,
        };
        const atomicUpdate = (storage.board as any).updateTaskWithActivities;
        const updated = atomicUpdate
            ? await atomicUpdate.call(storage.board, id, task.status, updates, [activity])
            : await storage.board.updateTask(id, updates);
        if (!atomicUpdate) {
            await storage.board.createActivity({ taskId: id, ...activity });
        }

        broadcastTask('BOARD_TASK_UPDATED', updated);
        res.json(updated);
    } catch (error: any) {
        logger.error('Failed to change task status', { error, taskId: req.params.id });
        res.status(error?.statusCode ?? 500).json({ error: error?.message ?? 'Failed to change status' });
    }
});

router.delete('/tasks/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid task id' });

        const task = await storage.board.getTask(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (req.user!.id !== task.creatorId && !isTaskSupervisor(req.user!)) {
            return res.status(403).json({ error: 'Only the creator can delete this task' });
        }

        await storage.board.deleteTask(id);
        broadcastTask('BOARD_TASK_DELETED', task);
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete task', { error, taskId: req.params.id });
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// --- Comments ---------------------------------------------------------------

router.post('/tasks/:id/comments', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid task id' });
        const { body } = req.body;
        if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

        const task = await storage.board.getTask(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canReadTask(req.user!, task)) return res.status(403).json({ error: 'accessDenied' });

        const commentValues = {
            taskId: id,
            authorId: req.user!.id,
            body: body.trim(),
        };
        const activityValues = {
            actorId: req.user!.id,
            type: 'comment_added',
            fromValue: null,
            toValue: null,
            meta: null,
        };
        const atomicComment = (storage.board as any).createCommentWithActivity;
        const comment = atomicComment
            ? await atomicComment.call(storage.board, commentValues, activityValues)
            : await storage.board.createComment(commentValues);
        if (!atomicComment) {
            await storage.board.createActivity({ taskId: id, ...activityValues });
        }

        broadcastTask('BOARD_TASK_UPDATED', task);
        res.json(comment);
    } catch (error) {
        logger.error('Failed to add comment', { error, taskId: req.params.id });
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

router.patch('/comments/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid comment id' });
        const { body } = req.body;
        if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

        const comment = await storage.board.getComment(id);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        const task = await storage.board.getTask(comment.taskId);
        if (!task || !canReadTask(req.user!, task)) return res.status(403).json({ error: 'accessDenied' });
        if (req.user!.id !== comment.authorId && !isTaskSupervisor(req.user!)) {
            return res.status(403).json({ error: 'You can only edit your own comments' });
        }

        const updated = await storage.board.updateComment(id, body.trim());
        broadcastTask('BOARD_TASK_UPDATED', { id: comment.taskId, boardId: 0 });
        res.json(updated);
    } catch (error) {
        logger.error('Failed to edit comment', { error, commentId: req.params.id });
        res.status(500).json({ error: 'Failed to edit comment' });
    }
});

router.delete('/comments/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid comment id' });

        const comment = await storage.board.getComment(id);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        const task = await storage.board.getTask(comment.taskId);
        if (!task || !canReadTask(req.user!, task)) return res.status(403).json({ error: 'accessDenied' });
        if (req.user!.id !== comment.authorId && !isTaskSupervisor(req.user!)) {
            return res.status(403).json({ error: 'You can only delete your own comments' });
        }

        await storage.board.deleteComment(id);
        broadcastTask('BOARD_TASK_UPDATED', { id: comment.taskId, boardId: 0 });
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete comment', { error, commentId: req.params.id });
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

// --- Checklist --------------------------------------------------------------

router.post('/tasks/:id/checklist', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid task id' });
        const { content } = req.body;
        if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'Item cannot be empty' });
        if (content.trim().length > 500) return res.status(400).json({ error: 'Item is too long' });

        const task = await storage.board.getTask(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canReadTask(req.user!, task)) return res.status(403).json({ error: 'accessDenied' });

        const item = await storage.board.createChecklistItem({
            taskId: id,
            content: content.trim(),
            isDone: false,
            position: 0,
            createdBy: req.user!.id,
        });
        broadcastTask('BOARD_TASK_UPDATED', task);
        res.json(item);
    } catch (error) {
        logger.error('Failed to add checklist item', { error, taskId: req.params.id });
        res.status(500).json({ error: 'Failed to add checklist item' });
    }
});

router.patch('/checklist/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid item id' });

        const item = await storage.board.getChecklistItem(id);
        if (!item) return res.status(404).json({ error: 'Item not found' });
        const task = await storage.board.getTask(item.taskId);
        if (!task || !canReadTask(req.user!, task)) return res.status(403).json({ error: 'accessDenied' });

        const updates: Record<string, unknown> = {};
        if (req.body.content !== undefined) {
            if (typeof req.body.content !== 'string' || !req.body.content.trim()) {
                return res.status(400).json({ error: 'Item cannot be empty' });
            }
            if (req.body.content.trim().length > 500) return res.status(400).json({ error: 'Item is too long' });
            updates.content = req.body.content.trim();
        }
        if (req.body.isDone !== undefined) {
            if (typeof req.body.isDone !== 'boolean') return res.status(400).json({ error: 'Invalid completion state' });
            updates.isDone = req.body.isDone;
        }

        const updated = await storage.board.updateChecklistItem(id, updates);
        broadcastTask('BOARD_TASK_UPDATED', { id: item.taskId, boardId: 0 });
        res.json(updated);
    } catch (error) {
        logger.error('Failed to update checklist item', { error, itemId: req.params.id });
        res.status(500).json({ error: 'Failed to update checklist item' });
    }
});

router.delete('/checklist/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid item id' });

        const item = await storage.board.getChecklistItem(id);
        if (!item) return res.status(404).json({ error: 'Item not found' });
        const task = await storage.board.getTask(item.taskId);
        if (!task || !canReadTask(req.user!, task)) return res.status(403).json({ error: 'accessDenied' });

        await storage.board.deleteChecklistItem(id);
        broadcastTask('BOARD_TASK_UPDATED', { id: item.taskId, boardId: 0 });
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete checklist item', { error, itemId: req.params.id });
        res.status(500).json({ error: 'Failed to delete checklist item' });
    }
});

// --- Attachments ------------------------------------------------------------

router.post('/tasks/:id/attachments', boardAttachmentUpload.single('file'), async (req, res) => {
    let persistedAttachmentId: number | null = null;
    try {
        const id = parseId(req.params.id);
        if (!id) {
            await removeUploadedFile(req.file?.path);
            return res.status(400).json({ error: 'Invalid task id' });
        }
        if (!req.file) return res.status(400).json({ error: 'File is required' });

        const task = await storage.board.getTask(id);
        if (!task) {
            await removeUploadedFile(req.file.path);
            return res.status(404).json({ error: 'Task not found' });
        }
        if (!canReadTask(req.user!, task)) {
            await removeUploadedFile(req.file.path);
            return res.status(403).json({ error: 'accessDenied' });
        }

        const attachment = await storage.board.createAttachment({
            taskId: id,
            fileName: req.file.filename,
            originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
            mimeType: req.file.mimetype,
            size: req.file.size,
            uploadedBy: req.user!.id,
        });
        persistedAttachmentId = attachment.id;
        await storage.board.createActivity({
            taskId: id,
            actorId: req.user!.id,
            type: 'attachment_added',
            fromValue: null,
            toValue: attachment.originalName,
            meta: null,
        });

        broadcastTask('BOARD_TASK_UPDATED', task);
        res.json(attachment);
    } catch (error) {
        if (persistedAttachmentId !== null) {
            await storage.board.deleteAttachment(persistedAttachmentId).catch((cleanupError) => {
                logger.error('Failed to roll back attachment metadata', {
                    cleanupError,
                    attachmentId: persistedAttachmentId,
                });
            });
        }
        await removeUploadedFile(req.file?.path);
        logger.error('Failed to upload attachment', { error, taskId: req.params.id });
        res.status(500).json({ error: 'Failed to upload attachment' });
    }
});

router.get('/attachments/:id/download', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid attachment id' });

        const attachment = await storage.board.getAttachment(id);
        if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
        const task = await storage.board.getTask(attachment.taskId);
        if (!task || !canReadTask(req.user!, task)) return res.status(403).json({ error: 'accessDenied' });

        const filePath = path.join(BOARD_UPLOAD_DIR, attachment.fileName);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });

        res.download(filePath, attachment.originalName);
    } catch (error) {
        logger.error('Failed to download attachment', { error, attachmentId: req.params.id });
        res.status(500).json({ error: 'Failed to download attachment' });
    }
});

router.delete('/attachments/:id', async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid attachment id' });

        const attachment = await storage.board.getAttachment(id);
        if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

        const task = await storage.board.getTask(attachment.taskId);
        if (!task || !canReadTask(req.user!, task)) return res.status(403).json({ error: 'accessDenied' });
        const canDelete =
            req.user!.id === attachment.uploadedBy ||
            (task && req.user!.id === task.creatorId) ||
            isTaskSupervisor(req.user!);
        if (!canDelete) return res.status(403).json({ error: 'Not allowed to delete this attachment' });

        await storage.board.deleteAttachment(id);
        fs.unlink(path.join(BOARD_UPLOAD_DIR, attachment.fileName), () => { });
        if (task) broadcastTask('BOARD_TASK_UPDATED', task);
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete attachment', { error, attachmentId: req.params.id });
        res.status(500).json({ error: 'Failed to delete attachment' });
    }
});

export default router;
