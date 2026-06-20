import { Router, type NextFunction, type Request, type Response } from 'express';
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
import type { User } from '@shared/schema';
import { canAccessAcademyWorkspace } from '@shared/academy';

const router = Router();

let broadcastToClients: (data: any) => void = () => { };

export function setBroadcastFunction(fn: (data: any) => void) {
    broadcastToClients = fn;
}

// --- Permission helpers -----------------------------------------------------

const requireBoardAccess = (req: Request, res: Response, next: NextFunction) => {
    if (!canAccessAcademyWorkspace(req.user?.role, 'management')) {
        return res.status(403).json({ error: 'Management workspace access required' });
    }
    next();
};

router.use(requireAuth, requireBoardAccess);

const isTaskSupervisor = (user?: User) => user?.role === 'head';

// Can edit core fields (title, description, priority, assignee, due date).
const canManageTask = (user: User, task: BoardTask) =>
    user.id === task.creatorId || user.id === task.assigneeId || isTaskSupervisor(user);

// Accepting (Done -> Accepted) and re-opening (out of Accepted) are reserved
// for the task creator. The head retains an override so orphaned tasks (whose
// creator was deactivated) never get stuck.
const canAcceptOrReopen = (user: User, task: BoardTask) =>
    user.id === task.creatorId || isTaskSupervisor(user);

const parseId = (raw: string) => {
    const id = Number.parseInt(raw, 10);
    return Number.isNaN(id) ? null : id;
};

const isStatus = (value: unknown): value is BoardTaskStatus =>
    typeof value === 'string' && (BOARD_TASK_STATUSES as readonly string[]).includes(value);

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
        let boardId = req.query.boardId ? parseId(String(req.query.boardId)) : null;
        if (!boardId) {
            const board = await storage.board.getDefaultBoard();
            if (!board) return res.json({ board: null, tasks: [] });
            boardId = board.id;
        }
        const [board, tasks] = await Promise.all([
            storage.board.getBoard(boardId),
            storage.board.getTasks(boardId),
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
        if (priority && !(BOARD_TASK_PRIORITIES as readonly string[]).includes(priority)) {
            return res.status(400).json({ error: 'Invalid priority' });
        }
        if (status && !isStatus(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        if (!boardId) {
            const board = await storage.board.getDefaultBoard();
            if (!board) return res.status(400).json({ error: 'No board available' });
            boardId = board.id;
        }

        const targetStatus: BoardTaskStatus = isStatus(status) ? status : 'backlog';
        const position = (await storage.board.getMaxPosition(boardId, targetStatus)) + 1;

        let assignee: number | null = null;
        if (assigneeId) {
            const parsed = parseId(String(assigneeId));
            if (parsed) {
                const exists = await storage.getUser(parsed);
                if (exists) assignee = parsed;
            }
        }

        const task = await storage.board.createTask({
            boardId,
            title: title.trim(),
            description: description ?? null,
            status: targetStatus,
            priority: priority ?? 'normal',
            position,
            creatorId: req.user!.id,
            assigneeId: assignee,
            dueAt: dueAt ? new Date(dueAt) : null,
        });

        await storage.board.createActivity({
            taskId: task.id,
            actorId: req.user!.id,
            type: 'created',
            fromValue: null,
            toValue: targetStatus,
            meta: null,
        });

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
            if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title cannot be empty' });
            updates.title = String(title).trim();
        }
        if (description !== undefined) updates.description = description ?? null;
        if (priority !== undefined) {
            if (!(BOARD_TASK_PRIORITIES as readonly string[]).includes(priority)) {
                return res.status(400).json({ error: 'Invalid priority' });
            }
            updates.priority = priority;
        }
        if (assigneeId !== undefined) {
            if (assigneeId === null) {
                updates.assigneeId = null;
            } else {
                const parsed = parseId(String(assigneeId));
                if (!parsed) return res.status(400).json({ error: 'Invalid assignee' });
                const exists = await storage.getUser(parsed);
                if (!exists) return res.status(400).json({ error: 'Assignee not found' });
                updates.assigneeId = parsed;
            }
        }
        if (dueAt !== undefined) updates.dueAt = dueAt ? new Date(dueAt) : null;

        const updated = await storage.board.updateTask(id, updates);

        if (updates.assigneeId !== undefined && updates.assigneeId !== task.assigneeId) {
            await storage.board.createActivity({
                taskId: id,
                actorId: req.user!.id,
                type: updates.assigneeId ? 'assigned' : 'unassigned',
                fromValue: task.assigneeId ? String(task.assigneeId) : null,
                toValue: updates.assigneeId ? String(updates.assigneeId) : null,
                meta: null,
            });
        }
        if (updates.priority !== undefined && updates.priority !== task.priority) {
            await storage.board.createActivity({
                taskId: id,
                actorId: req.user!.id,
                type: 'priority_changed',
                fromValue: task.priority,
                toValue: String(updates.priority),
                meta: null,
            });
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

        const task = await storage.board.getTask(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const transitionError = validateTransition(task, status, req.user!);
        if (transitionError) {
            return res.status(transitionError.code).json({ error: transitionError.error });
        }

        const updates: Record<string, unknown> = { status };
        if (typeof position === 'number') {
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

        const updated = await storage.board.updateTask(id, updates);

        const activityType = movingToAccepted ? 'accepted' : reopening ? 'reopened' : 'status_changed';
        await storage.board.createActivity({
            taskId: id,
            actorId: req.user!.id,
            type: activityType,
            fromValue: task.status,
            toValue: status,
            meta: null,
        });

        broadcastTask('BOARD_TASK_UPDATED', updated);
        res.json(updated);
    } catch (error) {
        logger.error('Failed to change task status', { error, taskId: req.params.id });
        res.status(500).json({ error: 'Failed to change status' });
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
        if (!body || !String(body).trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

        const task = await storage.board.getTask(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const comment = await storage.board.createComment({
            taskId: id,
            authorId: req.user!.id,
            body: String(body).trim(),
        });
        await storage.board.createActivity({
            taskId: id,
            actorId: req.user!.id,
            type: 'comment_added',
            fromValue: null,
            toValue: null,
            meta: null,
        });

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
        if (!body || !String(body).trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

        const comment = await storage.board.getComment(id);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        if (req.user!.id !== comment.authorId && !isTaskSupervisor(req.user!)) {
            return res.status(403).json({ error: 'You can only edit your own comments' });
        }

        const updated = await storage.board.updateComment(id, String(body).trim());
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
        if (!content || !String(content).trim()) return res.status(400).json({ error: 'Item cannot be empty' });

        const task = await storage.board.getTask(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const item = await storage.board.createChecklistItem({
            taskId: id,
            content: String(content).trim(),
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

        const updates: Record<string, unknown> = {};
        if (req.body.content !== undefined) {
            if (!String(req.body.content).trim()) return res.status(400).json({ error: 'Item cannot be empty' });
            updates.content = String(req.body.content).trim();
        }
        if (req.body.isDone !== undefined) updates.isDone = Boolean(req.body.isDone);

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
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid task id' });
        if (!req.file) return res.status(400).json({ error: 'File is required' });

        const task = await storage.board.getTask(id);
        if (!task) {
            // Clean up the orphaned upload.
            fs.unlink(req.file.path, () => { });
            return res.status(404).json({ error: 'Task not found' });
        }

        const attachment = await storage.board.createAttachment({
            taskId: id,
            fileName: req.file.filename,
            originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
            mimeType: req.file.mimetype,
            size: req.file.size,
            uploadedBy: req.user!.id,
        });
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
