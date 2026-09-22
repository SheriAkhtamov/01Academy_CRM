import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveTaskAssignees: vi.fn(),
  getOpenAssignedTasks: vi.fn(),
  getOpenTaskTeamSummaryRows: vi.fn(),
  getDefaultBoard: vi.fn(),
  getMaxPosition: vi.fn(),
  createTaskWithActivity: vi.fn(),
}));

vi.mock('../server/storage/board.storage', () => ({
  boardStorage: {
    getActiveTaskAssignees: mocks.getActiveTaskAssignees,
    getOpenAssignedTasks: mocks.getOpenAssignedTasks,
    getOpenTaskTeamSummaryRows: mocks.getOpenTaskTeamSummaryRows,
    getDefaultBoard: mocks.getDefaultBoard,
    getMaxPosition: mocks.getMaxPosition,
    createTaskWithActivity: mocks.createTaskWithActivity,
  },
}));

import { telegramTaskAgentData } from '../server/services/telegram-task-agent-data';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveTaskAssignees.mockResolvedValue([
    { id: 7, fullName: 'Шерзод Ахтамов' },
    { id: 9, fullName: 'Хонзода Каримова' },
  ]);
  mocks.getDefaultBoard.mockResolvedValue({ id: 3 });
  mocks.getMaxPosition.mockResolvedValue(4);
  mocks.createTaskWithActivity.mockResolvedValue({ id: 81, boardId: 3 });
});

describe('Telegram task agent data boundary', () => {
  it('exposes only minimal active employee identity to the model-facing service', async () => {
    expect(await telegramTaskAgentData.getAssignableEmployees()).toEqual([
      { id: 7, fullName: 'Шерзод Ахтамов' },
      { id: 9, fullName: 'Хонзода Каримова' },
    ]);
    expect(mocks.getActiveTaskAssignees).toHaveBeenCalledOnce();
  });

  it('always scopes task listing to the verified actor and a fixed bounded result size', async () => {
    mocks.getOpenAssignedTasks.mockResolvedValue([{ id: 1, title: 'Задача' }]);
    await expect(telegramTaskAgentData.getOwnOpenTasks(7)).resolves.toEqual([{ id: 1, title: 'Задача' }]);
    expect(mocks.getOpenAssignedTasks).toHaveBeenCalledWith(7, 16);
  });

  it('keeps another employee task list scoped to the actor unless administration was verified', async () => {
    mocks.getOpenAssignedTasks.mockResolvedValue([]);
    await telegramTaskAgentData.getEmployeeOpenTasks({ id: 7, canViewTeamTasks: false }, 9);
    expect(mocks.getOpenAssignedTasks).toHaveBeenLastCalledWith(7, 16);

    await telegramTaskAgentData.getEmployeeOpenTasks({ id: 7, canViewTeamTasks: true }, 9);
    expect(mocks.getOpenAssignedTasks).toHaveBeenLastCalledWith(9, 16);
  });

  it('returns a bounded team summary only for a verified administration actor', async () => {
    await expect(telegramTaskAgentData.getTeamTaskSummary({ canViewTeamTasks: false })).resolves.toBeNull();
    expect(mocks.getOpenTaskTeamSummaryRows).not.toHaveBeenCalled();

    mocks.getOpenTaskTeamSummaryRows.mockResolvedValue([
      {
        id: 21,
        title: 'Позвонить клиенту',
        status: 'todo',
        priority: 'normal',
        dueAt: null,
        employeeId: 9,
        employeeName: 'Хонзода Каримова',
        employeeTaskCount: 4,
        totalTaskCount: 7,
        employeeCount: 2,
      },
    ]);
    await expect(telegramTaskAgentData.getTeamTaskSummary({ canViewTeamTasks: true })).resolves.toEqual({
      totalTaskCount: 7,
      employeeCount: 2,
      employees: [{
        id: 9,
        fullName: 'Хонзода Каримова',
        taskCount: 4,
        tasks: [{ id: 21, title: 'Позвонить клиенту', status: 'todo', priority: 'normal', dueAt: null }],
      }],
    });
    expect(mocks.getOpenTaskTeamSummaryRows).toHaveBeenCalledWith(20, 3);
  });

  it('sets creator and activity actor from the authenticated actor argument', async () => {
    await telegramTaskAgentData.createTaskAsActor({
      actorId: 7,
      assigneeId: 9,
      title: 'Подготовить отчёт',
      description: null,
      priority: 'normal',
      dueAt: null,
      requestKey: 'request-key',
    });
    expect(mocks.createTaskWithActivity).toHaveBeenCalledWith(expect.objectContaining({
      creatorId: 7,
      assigneeId: 9,
      boardId: 3,
      position: 5,
    }), expect.objectContaining({ actorId: 7, type: 'created' }), 'request-key');
  });

  it('depends on the task-board storage boundary rather than the general CRM storage', () => {
    const source = readFileSync(new URL('../server/services/telegram-task-agent-data.ts', import.meta.url), 'utf8');
    expect(source).toContain("from '../storage/board.storage'");
    expect(source).not.toMatch(/from ['"]\.\.\/storage['"]/);
  });
});
