import type { BoardTaskPriority } from '../db/schema';
import { boardStorage } from '../storage/board.storage';

const TASK_LIST_FETCH_LIMIT = 16;

export type TelegramTaskAgentEmployee = {
  id: number;
  fullName: string;
};

export type TelegramTaskAgentOpenTask = {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueAt: Date | null;
};

type CreateOwnTaskInput = {
  actorId: number;
  assigneeId: number;
  title: string;
  description: string | null;
  priority: BoardTaskPriority;
  dueAt: Date | null;
  requestKey: string;
};

/**
 * Deliberately narrow persistence boundary for the Telegram agent. It exposes
 * only task creation, the current actor's assigned tasks, and the minimum
 * employee identity needed to select an assignee. The model never receives
 * this object and cannot issue queries or choose a creator ID.
 */
export const telegramTaskAgentData = {
  async getAssignableEmployees(): Promise<TelegramTaskAgentEmployee[]> {
    return boardStorage.getActiveTaskAssignees();
  },

  async getOwnOpenTasks(actorId: number): Promise<TelegramTaskAgentOpenTask[]> {
    return boardStorage.getOpenAssignedTasks(actorId, TASK_LIST_FETCH_LIMIT);
  },

  async createTaskAsActor(input: CreateOwnTaskInput) {
    const board = await boardStorage.getDefaultBoard();
    if (!board) throw new Error('No board available');
    const status = 'backlog' as const;
    const position = (await boardStorage.getMaxPosition(board.id, status)) + 1;
    return boardStorage.createTaskWithActivity({
      boardId: board.id,
      title: input.title,
      description: input.description,
      status,
      priority: input.priority,
      color: null,
      position,
      creatorId: input.actorId,
      assigneeId: input.assigneeId,
      leadId: null,
      dueAt: input.dueAt,
    }, {
      actorId: input.actorId,
      type: 'created',
      fromValue: null,
      toValue: status,
      meta: null,
    }, input.requestKey);
  },
};
