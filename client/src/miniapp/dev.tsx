// Development-only miniapp preview: boots with a mocked Telegram WebApp and a
// stubbed network layer so the UI can be inspected in a plain browser.
// Not part of any build — load via ?dev=1 query from miniapp.html.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { i18n } from '@/lib/i18n';
import { AuthProvider } from '@/hooks/useAuth';
import type { AuthSession } from '@shared/auth';
import { TasksApp } from './TasksApp';
import '@/index.css';
import './miniapp.css';

const session: AuthSession = {
  kind: 'user',
  user: { id: 7, fullName: 'Азиза Рахимова', role: 'teacher', module: 'teacher', email: 'dev@example.com' },
} as unknown as AuthSession;

const now = Date.now();
const day = 86_400_000;
const miniUser = (id: number, fullName: string) => ({ id, fullName });
const miniUsers = [
  miniUser(7, 'Азиза Рахимова'),
  miniUser(8, 'Дилшод Каримов'),
  miniUser(9, 'Мадина Юсупова'),
];
const task = (id: number, title: string, description: string | null, status: string, priority: string, assigneeId: number | null, creatorId: number, dueAt: string | null, color: string | null) => ({
  id, title, description, status, priority, color,
  assignee: assigneeId ? miniUsers.find((u) => u.id === assigneeId) ?? null : null,
  creator: miniUsers.find((u) => u.id === creatorId) ?? null,
  dueAt, acceptedAt: status === 'accepted' ? new Date(now - day * 2).toISOString() : null,
  lead: null, commentCount: 2, attachmentCount: 1, checklistTotal: 4, checklistDone: 1,
});
const tasks = [
  task(1, 'Подготовить отчёт по успеваемости группы CYP-VC-GRP-26-0001', 'Собрать оценки за сентябрь и оформить PDF со сравнением с прошлым месяцем.', 'todo', 'urgent', 7, 8, new Date(now + day).toISOString(), 'blue'),
  task(2, 'Позвонить родителям по пропущенным занятиям', null, 'in_progress', 'normal', 7, 9, new Date(now + day * 2).toISOString(), null),
  task(3, 'Обновить план уроков по Scratch', 'Добавить модуль про переменные и циклы, переразбить уроки на 40 минут.', 'backlog', 'low', 7, 8, null, 'emerald'),
  task(4, 'Согласовать расписание замены на следующую неделю', null, 'done', 'normal', 9, 7, new Date(now - day * 3).toISOString(), 'amber'),
];
const archived = [task(5, 'Провести родительское собрание', 'Собрать вопросы заранее, подготовить презентацию на 15 минут.', 'accepted', 'normal', 7, 8, new Date(now - day * 5).toISOString(), 'rose')];

const userById = (id: number) => miniUsers.find((u) => u.id === id) ?? miniUsers[0];
const detail = (id: number) => {
  const base = [...tasks, ...archived].find((entry) => entry.id === id) ?? tasks[0];
  return {
    ...base,
    description: base.description ?? 'Описание отсутствует.',
    comments: [
      { id: 1, body: 'Отправила черновик, посмотрите пожалуйста до пятницы.', author: userById(8), createdAt: new Date(now - day).toISOString() },
      { id: 2, body: 'Принято, проверю сегодня вечером.', author: userById(7), createdAt: new Date(now - 3 * 3600_000).toISOString() },
    ],
    checklist: [
      { id: 1, content: 'Собрать оценки за месяц', isDone: true },
      { id: 2, content: 'Сверить с журналом', isDone: false },
      { id: 3, content: 'Оформить PDF', isDone: false },
      { id: 4, content: 'Отправить руководителю', isDone: false },
    ],
    attachments: [
      { id: 1, originalName: 'отчёт-сентябрь.pdf', size: 248_320, uploadedBy: userById(8), createdAt: new Date(now - day).toISOString() },
    ],
    activity: [
      { id: 1, type: 'created', actor: userById(8), createdAt: new Date(now - day * 2).toISOString() },
      { id: 2, type: 'comment_added', actor: userById(7), createdAt: new Date(now - 3 * 3600_000).toISOString() },
    ],
  };
};

const json = async (body: unknown, delay = 300) => { await new Promise((resolve) => setTimeout(resolve, delay)); return Response.json(body); };
const board = async (url: string) => {
  if (url.startsWith('/api/board/tasks?archived=true')) return json({ board: null, tasks: archived });
  if (url.startsWith('/api/board/tasks/')) {
    const id = Number(url.split('/')[4]);
    return json(detail(id));
  }
  return json({ board: null, tasks });
};

// Stub the network before any component imports transport modules.
const originalFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  if (url.includes('/api/miniapp/auth')) return json({ token: 'dev-token', session }, 150);
  if (url.includes('/api/miniapp/users')) return json(miniUsers, 500);
  if (url.startsWith('/api/board/tasks/')) {
    if (method === 'DELETE') return json({ ok: true });
    if (method === 'PATCH') return json(detail(Number(url.split('/')[4])));
  }
  if (url.startsWith('/api/board/tasks')) {
    if (method === 'POST') return json({ id: 99 });
    if (method === 'PATCH') return json({ ok: true });
    if (method === 'GET') return board(url);
  }
  if (url.includes('/api/board/comments')) return json({ ok: true });
  if (url.includes('/api/board/checklist')) return json({ ok: true });
  if (url.includes('/api/board/attachments')) return json({ ok: true });
  return originalFetch(input, init);
}) as typeof window.fetch;

// Mock the Telegram WebApp SDK with enough surface for the UI code paths.
(window as unknown as { Telegram: unknown }).Telegram = {
  WebApp: {
    initData: 'dev',
    initDataUnsafe: { user: { id: 7, language_code: 'ru' } },
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    version: '8.0',
    ready: () => {},
    expand: () => {},
    close: () => { document.title = 'closed'; },
    isVersionAtLeast: (v: string) => ['6.1', '6.2', '8.0'].includes(v),
    onEvent: () => {},
    offEvent: () => {},
    openLink: () => {},
    setHeaderColor: () => {},
    setBackgroundColor: () => {},
    enableClosingConfirmation: () => {},
    disableClosingConfirmation: () => {},
    HapticFeedback: {
      impactOccurred: () => {},
      notificationOccurred: () => {},
      selectionChanged: () => {},
    },
    BackButton: { show: () => {}, hide: () => {}, onClick: () => {}, offClick: () => {} },
  },
};

i18n.setLanguage('ru');
document.title = 'Miniapp dev preview';
document.body.classList.add('telegram-tasks');

const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: true }, mutations: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <TooltipProvider>
      <AuthProvider api={{ fetchAuthSession: async () => session, loginUserSession: async () => session, logoutSession: async () => {} }}>
        <TasksApp />
        <Toaster />
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>,
);
