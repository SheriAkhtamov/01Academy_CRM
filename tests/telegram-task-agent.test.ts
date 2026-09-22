import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  employees: vi.fn(),
  ownTasks: vi.fn(),
  createTaskAsActor: vi.fn(),
  publish: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../server/services/telegram-task-agent-data', () => ({
  telegramTaskAgentData: {
    getAssignableEmployees: mocks.employees,
    getOwnOpenTasks: mocks.ownTasks,
    createTaskAsActor: mocks.createTaskAsActor,
  },
}));
vi.mock('../server/realtime/realtime-hub', () => ({ publishRealtimeEvent: mocks.publish }));

import {
  processTelegramTaskAgentMessage,
  resetTelegramTaskAgentMemoryForTests,
} from '../server/services/telegram-task-agent';

const actor = {
  id: 7,
  fullName: 'Шерзод Ахтамов',
  email: 'sherzod@example.test',
  password: 'not-used',
  module: 'administration',
  isActive: true,
  isArchived: false,
} as any;
const employees = [
  { id: 7, fullName: 'Шерзод Ахтамов' },
  { id: 9, fullName: 'Хонзода Каримова' },
];
const now = new Date('2026-09-22T05:00:00.000Z');

const baseMessage = (updateId = 1) => ({
  botId: '12345',
  botToken: '12345:test-only-token',
  apiKey: ['sk', 'or', 'v1-test-only-not-a-real-key'].join('-'),
  appUrl: 'https://crm.example.test/miniapp/tasks',
  updateId,
  telegramUserId: '654321',
  chatId: 654321,
  language: 'ru' as const,
  actor,
});

const decision = (overrides: Record<string, unknown> = {}) => ({
  action: 'create',
  title: 'Подготовить отчёт',
  description: null,
  assigneeRequested: true,
  assigneeId: 9,
  assigneeQuery: 'Хонзода',
  deadlineRequested: true,
  dueAt: '2026-09-23T18:00:00+05:00',
  priority: 'normal',
  clarification: 'none',
  ...overrides,
});

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const installFetch = (decisions: unknown[]) => {
  const openRouterBodies: any[] = [];
  const sentMessages: any[] = [];
  mocks.fetch.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.endsWith('/sendChatAction')) return jsonResponse({ ok: true, result: true });
    if (url.endsWith('/getFile')) {
      return jsonResponse({ ok: true, result: { file_path: 'voice/file_1.oga', file_size: 1024 } });
    }
    if (url.includes('/file/bot')) {
      return new Response(Buffer.from('fake-ogg-audio'), { status: 200, headers: { 'Content-Length': '14' } });
    }
    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      openRouterBodies.push(body);
      const next = decisions.shift();
      return jsonResponse({ choices: [{ message: { content: JSON.stringify(next) } }] });
    }
    if (url.endsWith('/sendMessage')) {
      sentMessages.push(body);
      return jsonResponse({ ok: true, result: { message_id: sentMessages.length } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  return { openRouterBodies, sentMessages };
};

beforeEach(() => {
  vi.clearAllMocks();
  resetTelegramTaskAgentMemoryForTests();
  mocks.employees.mockResolvedValue(employees);
  mocks.ownTasks.mockResolvedValue([]);
  mocks.createTaskAsActor.mockResolvedValue({ id: 81, boardId: 3, title: 'Подготовить отчёт' });
});

describe('Telegram task agent', () => {
  it('sends Telegram voice directly to the configured multimodal model and creates an idempotent task', async () => {
    const transport = installFetch([decision()]);
    await processTelegramTaskAgentMessage({
      ...baseMessage(),
      voice: { fileId: 'voice-file', fileSize: 1024, duration: 300 },
    }, { fetchImpl: mocks.fetch, now: () => now });

    expect(transport.openRouterBodies).toHaveLength(1);
    expect(transport.openRouterBodies[0]).toMatchObject({
      model: 'google/gemini-3.1-flash-lite',
      provider: { data_collection: 'deny', zdr: true },
      response_format: { type: 'json_schema' },
    });
    expect(transport.openRouterBodies[0].messages[1].content[1]).toMatchObject({
      type: 'input_audio', input_audio: { format: 'ogg' },
    });
    expect(mocks.createTaskAsActor).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 7,
      title: 'Подготовить отчёт',
      assigneeId: 9,
      dueAt: new Date('2026-09-23T13:00:00.000Z'),
      requestKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
    }));
    expect(mocks.publish).toHaveBeenCalledWith({ type: 'BOARD_TASK_CREATED', data: { id: 81, boardId: 3 } });
    expect(transport.sentMessages.at(-1).text).toContain('Постановщик: Шерзод Ахтамов');
    expect(transport.sentMessages.at(-1).text).toContain('Хонзода Каримова');
    expect(transport.sentMessages.at(-1).reply_markup.inline_keyboard[0][0].web_app.url)
      .toBe('https://crm.example.test/miniapp/tasks');
  });

  it('keeps a short-lived structured draft and merges the employee reply', async () => {
    const transport = installFetch([
      decision({ action: 'clarify', title: null, deadlineRequested: false, dueAt: null, clarification: 'title' }),
      decision({ deadlineRequested: false, dueAt: null }),
    ]);
    await processTelegramTaskAgentMessage({ ...baseMessage(10), text: 'Создай задачу для Хонзоды' }, {
      fetchImpl: mocks.fetch,
      now: () => now,
    });
    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();
    expect(transport.sentMessages.at(-1).text).toContain('Что именно');

    await processTelegramTaskAgentMessage({ ...baseMessage(11), text: 'Подготовить отчёт' }, {
      fetchImpl: mocks.fetch,
      now: () => new Date(now.getTime() + 60_000),
    });
    expect(mocks.createTaskAsActor).toHaveBeenCalledOnce();
    expect(transport.openRouterBodies[1].messages[0].content).toContain('"assigneeId":9');
  });

  it('defaults the assignee to the current employee and allows an omitted deadline', async () => {
    installFetch([decision({
      assigneeRequested: false,
      assigneeId: null,
      assigneeQuery: null,
      deadlineRequested: false,
      dueAt: null,
    })]);
    await processTelegramTaskAgentMessage({ ...baseMessage(), text: 'Создай задачу подготовить отчёт' }, {
      fetchImpl: mocks.fetch,
      now: () => now,
    });
    expect(mocks.createTaskAsActor).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 7,
      assigneeId: 7,
      dueAt: null,
    }));
  });

  it('asks for an exact employee instead of accepting a hallucinated assignee id', async () => {
    const transport = installFetch([decision({ assigneeId: 999 })]);
    await processTelegramTaskAgentMessage({ ...baseMessage(), text: 'Создай задачу для Хонзоды' }, {
      fetchImpl: mocks.fetch,
      now: () => now,
    });
    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();
    expect(transport.sentMessages.at(-1).text).toContain('точное имя');
  });

  it('rejects oversized voice messages before download or AI processing', async () => {
    const transport = installFetch([]);
    await processTelegramTaskAgentMessage({
      ...baseMessage(),
      voice: { fileId: 'large-file', fileSize: 1024, duration: 301 },
    }, { fetchImpl: mocks.fetch, now: () => now });
    expect(transport.openRouterBodies).toHaveLength(0);
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith('/getFile'))).toBe(false);
    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();
    expect(transport.sentMessages.at(-1).text).toContain('короче 5 минут');
  });

  it('lists only the verified employee own open tasks without sending task data to the model', async () => {
    mocks.ownTasks.mockResolvedValue([
      { id: 21, title: 'Позвонить\nклиенту', status: 'todo', priority: 'normal', dueAt: new Date('2026-09-22T13:00:00.000Z') },
      { id: 22, title: 'Подготовить договор', status: 'in_progress', priority: 'urgent', dueAt: null },
    ]);
    const transport = installFetch([decision({
      action: 'list',
      title: null,
      description: null,
      assigneeRequested: false,
      assigneeId: null,
      assigneeQuery: null,
      deadlineRequested: false,
      dueAt: null,
      priority: null,
    })]);
    await processTelegramTaskAgentMessage({ ...baseMessage(), text: 'Какие задачи сейчас стоят у Хонзоды?' }, {
      fetchImpl: mocks.fetch,
      now: () => now,
    });

    expect(mocks.ownTasks).toHaveBeenCalledWith(7);
    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();
    expect(transport.sentMessages.at(-1).text).toContain('Ваши текущие задачи');
    expect(transport.sentMessages.at(-1).text).toContain('Позвонить клиенту — 22 сент. 2026 г., 18:00');
    expect(transport.sentMessages.at(-1).text).toContain('Подготовить договор — без срока');
    expect(JSON.stringify(transport.openRouterBodies[0])).not.toContain('Позвонить');
  });

  it('serves the /tasks command for the verified employee without an AI call', async () => {
    mocks.ownTasks.mockResolvedValue([
      { id: 23, title: 'Проверить расписание', status: 'done', priority: 'normal', dueAt: null },
    ]);
    const transport = installFetch([]);

    await processTelegramTaskAgentMessage({ ...baseMessage(), text: '/tasks' }, {
      fetchImpl: mocks.fetch,
      now: () => now,
    });

    expect(mocks.ownTasks).toHaveBeenCalledWith(7);
    expect(mocks.employees).not.toHaveBeenCalled();
    expect(transport.openRouterBodies).toHaveLength(0);
    expect(transport.sentMessages.at(-1).text).toContain('Проверить расписание — без срока');
  });

  it('has no direct database or general storage dependency in the model-facing service', () => {
    const source = readFileSync(new URL('../server/services/telegram-task-agent.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]\.\.\/(?:db|storage)(?:\/|['"])/);
    expect(source).toContain("from './telegram-task-agent-data'");
    expect(source).not.toContain('creatorId');
  });
});
