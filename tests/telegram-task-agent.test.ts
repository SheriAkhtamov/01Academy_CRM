import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  employees: vi.fn(),
  ownTasks: vi.fn(),
  employeeTasks: vi.fn(),
  teamSummary: vi.fn(),
  createTaskAsActor: vi.fn(),
  publish: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../server/services/telegram-task-agent-data', () => ({
  telegramTaskAgentData: {
    getAssignableEmployees: mocks.employees,
    getOwnOpenTasks: mocks.ownTasks,
    getEmployeeOpenTasks: mocks.employeeTasks,
    getTeamTaskSummary: mocks.teamSummary,
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
  canViewTeamTasks: false,
};
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
  transcript: null,
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
  mocks.employeeTasks.mockResolvedValue([]);
  mocks.teamSummary.mockResolvedValue(null);
  mocks.createTaskAsActor.mockResolvedValue({ id: 81, boardId: 3, title: 'Подготовить отчёт' });
});

describe('Telegram task agent', () => {
  it('sends Telegram voice directly to the configured multimodal model and creates an idempotent task', async () => {
    const transport = installFetch([decision({ transcript: 'Создай задачу для Хонзоды подготовить отчёт до завтра.' })]);
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

  it('keeps a structured draft and merges the employee reply', async () => {
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

  it('uses voice transcripts and clarification questions across several text and voice replies', async () => {
    const transcript = 'Поручи Хонзоде подготовить отчёт по новым заявкам к встрече.';
    const partial = {
      title: 'Подготовить отчёт по новым заявкам',
      description: 'Включить заявки за октябрь',
      dueAt: null,
      priority: 'urgent',
    };
    const transport = installFetch([
      decision({ ...partial, action: 'clarify', transcript, title: null, clarification: 'title' }),
      decision({ ...partial, action: 'clarify', clarification: 'deadline' }),
      decision({ ...partial, transcript: 'Завтра к одиннадцати.', dueAt: '2026-09-23T11:00:00+05:00' }),
    ]);

    await processTelegramTaskAgentMessage({
      ...baseMessage(10), voice: { fileId: 'initial-voice', duration: 10 },
    }, { fetchImpl: mocks.fetch, now: () => now });
    const titleQuestion = transport.sentMessages.at(-1).text;
    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();

    await processTelegramTaskAgentMessage({
      ...baseMessage(11), text: 'Подготовить отчёт по новым заявкам',
    }, { fetchImpl: mocks.fetch, now: () => new Date(now.getTime() + 60_000) });
    const deadlineQuestion = transport.sentMessages.at(-1).text;
    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();
    expect(transport.openRouterBodies[1].messages.slice(1)).toEqual([
      { role: 'user', content: expect.stringContaining(transcript) },
      { role: 'assistant', content: titleQuestion },
      { role: 'user', content: expect.stringContaining('Подготовить отчёт по новым заявкам') },
    ]);
    expect(JSON.stringify(transport.openRouterBodies[1])).not.toContain('input_audio');
    expect(transport.openRouterBodies[1].messages[1].content).toContain(now.toISOString());

    await processTelegramTaskAgentMessage({
      ...baseMessage(12), voice: { fileId: 'deadline-voice', duration: 5 },
    }, { fetchImpl: mocks.fetch, now: () => new Date(now.getTime() + 120_000) });
    expect(transport.openRouterBodies[2].messages.slice(1, -1)).toEqual([
      { role: 'user', content: expect.stringContaining(transcript) },
      { role: 'assistant', content: titleQuestion },
      { role: 'user', content: expect.stringContaining('Подготовить отчёт по новым заявкам') },
      { role: 'assistant', content: deadlineQuestion },
    ]);
    expect(mocks.createTaskAsActor).toHaveBeenCalledOnce();
    expect(mocks.createTaskAsActor).toHaveBeenCalledWith(expect.objectContaining({
      title: partial.title,
      description: partial.description,
      assigneeId: 9,
      dueAt: new Date('2026-09-23T06:00:00.000Z'),
      priority: 'urgent',
    }));
  });

  it('bounds the conversation to 10 messages including the newest input and clears it after creation', async () => {
    const transport = installFetch([
      ...Array.from({ length: 6 }, () => decision({ action: 'clarify', dueAt: null, clarification: 'deadline' })),
      decision(),
      decision({ title: 'Другая задача', assigneeRequested: false, assigneeId: null, deadlineRequested: false, dueAt: null }),
    ]);
    for (let index = 0; index < 6; index += 1) {
      await processTelegramTaskAgentMessage({ ...baseMessage(index + 1), text: `Деталь-${index}` }, {
        fetchImpl: mocks.fetch,
        now: () => now,
      });
    }
    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();
    await processTelegramTaskAgentMessage({ ...baseMessage(7), text: 'Завтра к 18:00' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    const messages = transport.openRouterBodies[6].messages;
    expect(messages).toHaveLength(11); // One system message plus 10 conversation messages.
    expect(messages.slice(1).map((entry: any) => entry.role)).toEqual([
      'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user',
    ]);
    expect(JSON.stringify(messages)).not.toContain('Деталь-0');
    expect(JSON.stringify(messages)).not.toContain('Деталь-1');
    expect(JSON.stringify(messages)).toContain('Деталь-2');
    expect(messages[0].content).toContain('"title":"Подготовить отчёт"');

    await processTelegramTaskAgentMessage({ ...baseMessage(8), text: 'Создай другую задачу' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    expect(transport.openRouterBodies[7].messages).toHaveLength(2);
    expect(transport.openRouterBodies[7].messages[0].content).toContain('Pending task draft, if any: null');
    expect(JSON.stringify(transport.openRouterBodies[7])).not.toContain('Деталь-');
  });

  it('keeps an incomplete task after a long pause', async () => {
    const transport = installFetch([
      decision({ action: 'clarify', dueAt: null, clarification: 'deadline' }),
      decision(),
    ]);
    await processTelegramTaskAgentMessage({ ...baseMessage(10), text: 'Подготовить отчёт к встрече' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    await processTelegramTaskAgentMessage({ ...baseMessage(11), text: 'Завтра в 18:00' }, {
      fetchImpl: mocks.fetch, now: () => new Date(now.getTime() + 3 * 60 * 60_000),
    });
    expect(transport.openRouterBodies[1].messages).toHaveLength(4);
    expect(transport.openRouterBodies[1].messages[0].content).toContain('"title":"Подготовить отчёт"');
    expect(transport.openRouterBodies[1].messages[1].content).toContain('Подготовить отчёт к встрече');
    expect(mocks.createTaskAsActor).toHaveBeenCalledOnce();
  });

  it.each(['/cancel', 'Отмени создание'])('clears the task dialogue on cancellation via %s', async (text) => {
    const transport = installFetch([
      decision({ action: 'clarify', dueAt: null, clarification: 'deadline' }),
      ...(text === '/cancel' ? [] : [decision({ action: 'cancel' })]),
      decision(),
    ]);
    await processTelegramTaskAgentMessage({ ...baseMessage(10), text: 'Первоначальная задача' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    await processTelegramTaskAgentMessage({ ...baseMessage(11), text }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();
    await processTelegramTaskAgentMessage({ ...baseMessage(12), text: 'Новая задача' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    const request = transport.openRouterBodies.at(-1);
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0].content).toContain('Pending task draft, if any: null');
    expect(JSON.stringify(request)).not.toContain('Первоначальная задача');
  });

  it.each([
    { botId: 'other-bot' },
    { telegramUserId: 'another-account', chatId: 123456 },
    { actor: { ...actor, id: 9 } },
  ])('isolates task dialogue by bot, Telegram account and verified CRM actor: %j', async (otherIdentity) => {
    const transport = installFetch([
      decision({ action: 'clarify', title: 'Конфиденциальный отчёт', dueAt: null, clarification: 'deadline' }),
      decision(),
    ]);
    await processTelegramTaskAgentMessage({ ...baseMessage(10), text: 'Конфиденциальный отчёт' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    await processTelegramTaskAgentMessage({ ...baseMessage(11), ...otherIdentity, text: 'Моя задача' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    expect(transport.openRouterBodies[1].messages).toHaveLength(2);
    expect(transport.openRouterBodies[1].messages[0].content).toContain('Pending task draft, if any: null');
    expect(JSON.stringify(transport.openRouterBodies[1])).not.toContain('Конфиденциальный отчёт');
  });

  it('preserves the pending dialogue through task listing and unrelated messages without leaking task data', async () => {
    mocks.ownTasks.mockResolvedValue([
      { id: 21, title: 'Существующая секретная задача', status: 'todo', priority: 'normal', dueAt: null },
    ]);
    const transport = installFetch([
      decision({ action: 'clarify', dueAt: null, clarification: 'deadline' }),
      decision({ action: 'out_of_scope' }),
      decision(),
    ]);
    for (const [index, text] of ['Нужно подготовить отчёт к встрече', '/tasks', 'Расскажи анекдот', 'Завтра к 18:00'].entries()) {
      await processTelegramTaskAgentMessage({ ...baseMessage(index + 1), text }, {
        fetchImpl: mocks.fetch, now: () => now,
      });
    }
    const finalRequest = transport.openRouterBodies[2];
    expect(finalRequest.messages).toHaveLength(4);
    expect(finalRequest.messages[1].content).toContain('Нужно подготовить отчёт к встрече');
    expect(JSON.stringify(finalRequest)).not.toContain('Существующая секретная задача');
    expect(JSON.stringify(finalRequest)).not.toContain('Расскажи анекдот');
    expect(mocks.createTaskAsActor).toHaveBeenCalledOnce();
  });

  it('retains the draft and completed reply when task creation fails', async () => {
    mocks.createTaskAsActor.mockRejectedValueOnce(new Error('Storage unavailable'));
    const transport = installFetch([
      decision({ action: 'clarify', dueAt: null, clarification: 'deadline' }),
      decision(),
      decision(),
    ]);
    await processTelegramTaskAgentMessage({ ...baseMessage(10), text: 'Подготовить отчёт к встрече' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    await expect(processTelegramTaskAgentMessage({ ...baseMessage(11), text: 'Завтра к 18:00' }, {
      fetchImpl: mocks.fetch, now: () => now,
    })).rejects.toThrow('Storage unavailable');
    await processTelegramTaskAgentMessage({ ...baseMessage(12), text: 'Попробуй ещё' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    expect(transport.openRouterBodies[2].messages).toHaveLength(5);
    expect(transport.openRouterBodies[2].messages[0].content).toContain('"dueAt":"2026-09-23T18:00:00+05:00"');
    expect(transport.openRouterBodies[2].messages[3].content).toContain('Завтра к 18:00');
    expect(mocks.createTaskAsActor).toHaveBeenCalledTimes(2);
    expect(mocks.publish).toHaveBeenCalledOnce();
  });

  it('retains the pending dialogue after an invalid model response', async () => {
    const transport = installFetch([
      decision({ action: 'clarify', dueAt: null, clarification: 'deadline' }),
      { action: 'invalid' },
      decision(),
    ]);
    await processTelegramTaskAgentMessage({ ...baseMessage(10), text: 'Подготовить отчёт к встрече' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    await expect(processTelegramTaskAgentMessage({ ...baseMessage(11), text: 'Завтра к 18:00' }, {
      fetchImpl: mocks.fetch, now: () => now,
    })).rejects.toThrow();
    await processTelegramTaskAgentMessage({ ...baseMessage(12), text: 'Завтра к 18:00' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    expect(transport.openRouterBodies[2].messages).toHaveLength(4);
    expect(transport.openRouterBodies[2].messages[1].content).toContain('Подготовить отчёт к встрече');
    expect(mocks.createTaskAsActor).toHaveBeenCalledOnce();
  });

  it('does not create a task while the model still requests command clarification', async () => {
    const transport = installFetch([decision({ clarification: 'command' })]);
    await processTelegramTaskAgentMessage({ ...baseMessage(), text: 'Сделай это' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();
    expect(transport.sentMessages.at(-1).reply_markup).toEqual({ force_reply: true });
  });

  it('does not overwrite the pending draft or create a task from an unintelligible voice message', async () => {
    const transport = installFetch([
      decision({ action: 'clarify', title: 'Подготовить исходный отчёт', dueAt: null, clarification: 'deadline' }),
      decision({ title: 'Выдуманное действие', transcript: null }),
      decision({ title: 'Подготовить исходный отчёт' }),
    ]);
    await processTelegramTaskAgentMessage({ ...baseMessage(10), text: 'Подготовить исходный отчёт к встрече' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    await processTelegramTaskAgentMessage({ ...baseMessage(11), voice: { fileId: 'unintelligible-voice' } }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();
    expect(transport.sentMessages.at(-1).reply_markup).toEqual({ force_reply: true });
    await processTelegramTaskAgentMessage({ ...baseMessage(12), text: 'Завтра к 18:00' }, {
      fetchImpl: mocks.fetch, now: () => now,
    });
    expect(transport.openRouterBodies[2].messages[0].content).toContain('"title":"Подготовить исходный отчёт"');
    expect(JSON.stringify(transport.openRouterBodies[2])).not.toContain('Выдуманное действие');
    expect(JSON.stringify(transport.openRouterBodies[2])).not.toContain('input_audio');
    expect(mocks.createTaskAsActor).toHaveBeenCalledOnce();
  });

  it('accepts ordinary text, defaults the assignee to the sender and allows an omitted deadline', async () => {
    const transport = installFetch([decision({
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
    expect(transport.openRouterBodies[0].messages[1].content).toContain('Создай задачу подготовить отчёт');
    expect(JSON.stringify(transport.openRouterBodies[0])).not.toContain('input_audio');
  });

  it('returns a fixed task-only response instead of chatting about other topics', async () => {
    const transport = installFetch([decision({
      action: 'out_of_scope',
      title: null,
      description: null,
      assigneeRequested: false,
      assigneeId: null,
      assigneeQuery: null,
      deadlineRequested: false,
      dueAt: null,
      priority: null,
      clarification: 'none',
    })]);

    await processTelegramTaskAgentMessage({ ...baseMessage(), text: 'Расскажи анекдот' }, {
      fetchImpl: mocks.fetch,
      now: () => now,
    });

    expect(mocks.createTaskAsActor).not.toHaveBeenCalled();
    expect(mocks.ownTasks).not.toHaveBeenCalled();
    expect(transport.sentMessages.at(-1).text)
      .toBe('Я работаю только с задачами: могу создать задачу или показать ваши текущие задачи.');
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

  it('lets a verified administration employee request a team task summary', async () => {
    mocks.teamSummary.mockResolvedValue({
      totalTaskCount: 7,
      employeeCount: 2,
      employees: [{
        id: 9,
        fullName: 'Хонзода Каримова',
        taskCount: 4,
        tasks: [{
          id: 21,
          title: 'Позвонить клиенту',
          status: 'in_progress',
          priority: 'normal',
          dueAt: new Date('2026-09-22T13:00:00.000Z'),
        }],
      }],
    });
    const transport = installFetch([decision({
      action: 'team_summary',
      title: null,
      description: null,
      assigneeRequested: false,
      assigneeId: null,
      assigneeQuery: null,
      deadlineRequested: false,
      dueAt: null,
      priority: null,
    })]);
    const adminActor = { ...actor, canViewTeamTasks: true };

    await processTelegramTaskAgentMessage({
      ...baseMessage(),
      actor: adminActor,
      text: 'Сделай сводку, у каких сотрудников сколько осталось задач',
    }, { fetchImpl: mocks.fetch, now: () => now });

    expect(mocks.teamSummary).toHaveBeenCalledWith(adminActor);
    expect(mocks.ownTasks).not.toHaveBeenCalled();
    expect(transport.sentMessages.at(-1).text).toContain('Текущих задач: 7');
    expect(transport.sentMessages.at(-1).text).toContain('Хонзода Каримова — 4');
    expect(transport.sentMessages.at(-1).text).toContain('[В работе]');
    expect(JSON.stringify(transport.openRouterBodies[0])).not.toContain('Позвонить клиенту');
  });

  it('lets administration inspect one employee but never broadens a regular employee request', async () => {
    mocks.employeeTasks.mockResolvedValue([
      { id: 22, title: 'Подготовить договор', status: 'todo', priority: 'normal', dueAt: null },
    ]);
    mocks.ownTasks.mockResolvedValue([
      { id: 23, title: 'Собственная задача', status: 'todo', priority: 'normal', dueAt: null },
    ]);
    const targetDecision = decision({
      action: 'employee_tasks',
      title: null,
      description: null,
      deadlineRequested: false,
      dueAt: null,
      priority: null,
    });
    const adminTransport = installFetch([targetDecision]);
    const adminActor = { ...actor, canViewTeamTasks: true };
    await processTelegramTaskAgentMessage({
      ...baseMessage(30),
      actor: adminActor,
      text: 'Какие задачи остались у Хонзоды?',
    }, { fetchImpl: mocks.fetch, now: () => now });

    expect(mocks.employeeTasks).toHaveBeenCalledWith(adminActor, 9);
    expect(adminTransport.sentMessages.at(-1).text).toContain('Текущие задачи: Хонзода Каримова');
    expect(adminTransport.sentMessages.at(-1).text).toContain('Подготовить договор');
    expect(adminTransport.sentMessages.at(-1).text).toContain('[К выполнению]');

    const regularTransport = installFetch([targetDecision]);
    await processTelegramTaskAgentMessage({
      ...baseMessage(31),
      text: 'Какие задачи остались у Хонзоды?',
    }, { fetchImpl: mocks.fetch, now: () => now });

    expect(mocks.employeeTasks).toHaveBeenCalledOnce();
    expect(mocks.ownTasks).toHaveBeenCalledWith(7);
    expect(regularTransport.sentMessages.at(-1).text).toContain('Собственная задача');
    expect(regularTransport.sentMessages.at(-1).text).not.toContain('Подготовить договор');
  });

  it('keeps the requested employee-list intent while asking administration for an exact name', async () => {
    const transport = installFetch([
      decision({
        action: 'employee_tasks',
        title: null,
        description: null,
        assigneeId: null,
        assigneeQuery: 'Хонзода или Хонзодахон',
        deadlineRequested: false,
        dueAt: null,
        priority: null,
        clarification: 'assignee',
      }),
      decision({
        action: 'employee_tasks',
        title: null,
        description: null,
        assigneeId: 9,
        assigneeQuery: 'Хонзода Каримова',
        deadlineRequested: false,
        dueAt: null,
        priority: null,
      }),
    ]);
    const adminActor = { ...actor, canViewTeamTasks: true };
    await processTelegramTaskAgentMessage({
      ...baseMessage(40), actor: adminActor, text: 'Покажи задачи Хонзоды',
    }, { fetchImpl: mocks.fetch, now: () => now });
    expect(transport.sentMessages.at(-1).text).toContain('Чьи задачи показать');

    await processTelegramTaskAgentMessage({
      ...baseMessage(41), actor: adminActor, text: 'Хонзода Каримова',
    }, { fetchImpl: mocks.fetch, now: () => new Date(now.getTime() + 60_000) });
    expect(transport.openRouterBodies[1].messages[0].content)
      .toContain('Pending request to identify an employee whose tasks should be listed: true');
    expect(mocks.employeeTasks).toHaveBeenCalledWith(adminActor, 9);
  });

  it('downgrades a forged team-summary decision for a regular employee to their own tasks', async () => {
    mocks.ownTasks.mockResolvedValue([
      { id: 24, title: 'Только моя задача', status: 'todo', priority: 'normal', dueAt: null },
    ]);
    const transport = installFetch([decision({
      action: 'team_summary',
      title: null,
      description: null,
      assigneeRequested: false,
      assigneeId: null,
      assigneeQuery: null,
      deadlineRequested: false,
      dueAt: null,
      priority: null,
    })]);

    await processTelegramTaskAgentMessage({ ...baseMessage(), text: 'Покажи задачи всех сотрудников' }, {
      fetchImpl: mocks.fetch,
      now: () => now,
    });

    expect(mocks.teamSummary).not.toHaveBeenCalled();
    expect(mocks.ownTasks).toHaveBeenCalledWith(7);
    expect(transport.sentMessages.at(-1).text).toContain('Только моя задача');
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
