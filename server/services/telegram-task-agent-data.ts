import type { BoardTaskPriority } from '../db/schema';
import { boardStorage } from '../storage/board.storage';

const TASK_LIST_FETCH_LIMIT = 16;
const TEAM_SUMMARY_EMPLOYEE_LIMIT = 20;
const TEAM_SUMMARY_TASK_LIMIT = 3;

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

export type TelegramTaskAgentTeamSummary = {
  totalTaskCount: number;
  employeeCount: number;
  employees: Array<{
    id: number;
    fullName: string;
    taskCount: number;
    tasks: TelegramTaskAgentOpenTask[];
  }>;
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

  async getEmployeeOpenTasks(
    actor: { id: number; canViewTeamTasks: boolean },
    employeeId: number,
  ): Promise<TelegramTaskAgentOpenTask[]> {
    const scopedEmployeeId = actor.canViewTeamTasks ? employeeId : actor.id;
    return boardStorage.getOpenAssignedTasks(scopedEmployeeId, TASK_LIST_FETCH_LIMIT);
  },

  async getTeamTaskSummary(
    actor: { canViewTeamTasks: boolean },
  ): Promise<TelegramTaskAgentTeamSummary | null> {
    if (!actor.canViewTeamTasks) return null;
    const rows = await boardStorage.getOpenTaskTeamSummaryRows(
      TEAM_SUMMARY_EMPLOYEE_LIMIT,
      TEAM_SUMMARY_TASK_LIMIT,
    );
    if (rows.length === 0) return { totalTaskCount: 0, employeeCount: 0, employees: [] };

    const employees = new Map<number, TelegramTaskAgentTeamSummary['employees'][number]>();
    for (const row of rows) {
      const employee = employees.get(row.employeeId) ?? {
        id: row.employeeId,
        fullName: row.employeeName,
        taskCount: row.employeeTaskCount,
        tasks: [],
      };
      employee.tasks.push({
        id: row.id,
        title: row.title,
        status: row.status,
        priority: row.priority,
        dueAt: row.dueAt,
      });
      employees.set(row.employeeId, employee);
    }
    return {
      totalTaskCount: rows[0].totalTaskCount,
      employeeCount: rows[0].employeeCount,
      employees: [...employees.values()],
    };
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
