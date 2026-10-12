// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import UpdatesPage from '../client/src/features/updates/UpdatesPage';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';

const mocks = vi.hoisted(() => ({
  actor: { id: 1, module: 'sales', modules: ['sales'] },
  list: vi.fn(),
  find: vi.fn(),
  publish: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.actor }) }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast, useToast: () => ({ toast: mocks.toast }) }));
vi.mock('../client/src/features/updates/api', () => ({
  updateQueryKeys: {
    all: ['/api/updates'],
    list: ['/api/updates', 'feed'],
    detail: (id: number) => ['/api/updates', 'post', id],
  },
  updatesApi: { list: mocks.list, find: mocks.find, publish: mocks.publish },
}));

const post = {
  id: 5,
  publishedAt: '2026-10-12T18:00:00.000Z',
  content: {
    title: { ru: 'Группы в продажах', en: 'Groups in Sales' },
    summary: { ru: 'Работа с группами', en: 'Group management' },
    action: { href: '/sales/groups' },
    sections: [
      {
        heading: { ru: 'Как пользоваться', en: 'How to use it' },
        paragraphs: [{ ru: 'Выберите нужную группу.', en: 'Choose a group.' }],
        items: [],
        image: { src: '/api/updates/images/release/example.jpg', caption: { ru: 'Список групп', en: 'Group list' } },
      },
    ],
  },
};

const olderPost = {
  id: 4,
  publishedAt: '2026-09-15T10:00:00.000Z',
  content: {
    title: { ru: 'Новая система оплаты', en: 'New Payment System' },
    summary: { ru: 'Управление платежами и счетами', en: 'Manage invoices and payments' },
    sections: [
      {
        paragraphs: [{ ru: 'Интеграция с платежными шлюзами.', en: 'Integration with payment gateways.' }],
        items: [],
      },
    ],
  },
};

const archivePost = {
  id: 3,
  publishedAt: '2025-05-20T10:00:00.000Z',
  content: {
    title: { ru: 'Релиз 2025 года', en: 'Release 2025' },
    summary: { ru: 'Архивный релиз', en: 'Archive release' },
    sections: [
      {
        paragraphs: [{ ru: 'Старые функции платформы.', en: 'Old platform features.' }],
        items: [],
      },
    ],
  },
};

const multiSectionPost = {
  id: 7,
  publishedAt: '2026-10-13T12:00:00.000Z',
  content: {
    title: { ru: 'Большое обновление платформы', en: 'Major Platform Update' },
    summary: { ru: 'Три ключевых изменения в CRM', en: 'Three key changes in CRM' },
    sections: [
      {
        heading: { ru: 'Первый раздел', en: 'First Section' },
        paragraphs: [{ ru: 'Описание первого раздела.', en: 'First section text.' }],
        items: [],
      },
      {
        heading: { ru: 'Второй раздел', en: 'Second Section' },
        paragraphs: [{ ru: 'Описание второго раздела.', en: 'Second section text.' }],
        items: [],
      },
      {
        heading: { ru: 'Третий раздел', en: 'Third Section' },
        paragraphs: [{ ru: 'Описание третьего раздела.', en: 'Third section text.' }],
        items: [],
      },
    ],
  },
};

const featurePost = {
  id: 11,
  publishedAt: '2026-10-10T10:00:00.000Z',
  content: {
    title: { ru: 'Функция аналитики', en: 'Analytics Feature' },
    summary: { ru: 'Новый модуль аналитики', en: 'New analytics module' },
    category: 'feature' as const,
    sections: [{ paragraphs: [{ ru: 'Описание модуля.', en: 'Module description.' }], items: [] }],
  },
};

const improvementPost = {
  id: 12,
  publishedAt: '2026-10-11T10:00:00.000Z',
  content: {
    title: { ru: 'Улучшение скорости', en: 'Speed Improvement' },
    summary: { ru: 'Ускорение загрузки страниц', en: 'Page load optimization' },
    category: 'improvement' as const,
    sections: [{ paragraphs: [{ ru: 'Оптимизация рендеринга.', en: 'Render optimization.' }], items: [] }],
  },
};

const salesPost = {
  id: 13,
  publishedAt: '2026-10-12T10:00:00.000Z',
  content: {
    title: { ru: 'Воронка продаж', en: 'Sales Pipeline' },
    summary: { ru: 'Новые этапы воронки', en: 'New pipeline stages' },
    category: 'sales' as const,
    action: { href: '/sales/groups' as const },
    sections: [{ paragraphs: [{ ru: 'Работа со сделками.', en: 'Deal management.' }], items: [] }],
  },
};

const adminPost = {
  id: 14,
  publishedAt: '2026-10-13T10:00:00.000Z',
  content: {
    title: { ru: 'Настройки ролей', en: 'Role Settings' },
    summary: { ru: 'Администрирование ролей и прав', en: 'Role and permissions admin' },
    category: 'administration' as const,
    action: { href: '/admin/academy-settings?tab=groups' as const },
    sections: [{ paragraphs: [{ ru: 'Управление доступом.', en: 'Access management.' }], items: [] }],
  },
};

let client: QueryClient;

beforeEach(() => {
  i18n.setLanguage('ru');
  window.localStorage.clear();
  mocks.actor = { id: 1, module: 'sales', modules: ['sales'] };
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([post]);
  mocks.find.mockResolvedValue(post);
  mocks.publish.mockResolvedValue(post);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(async () => {
  cleanup();
  client.clear();
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

const mount = (query = '') => {
  allowNavigation(() => history.replaceState(null, '', `/updates${query}`));
  render(
    <QueryClientProvider client={client}>
      <UpdatesPage />
    </QueryClientProvider>
  );
};

it('opens the post, enlarges a screenshot in a dialog and links to the sales section', async () => {
  mount();
  await screen.findByText(post.content.title.ru);
  expect(screen.queryByRole('button', { name: i18n.t('updatesNewPost') })).toBeNull();
  await userEvent.click(screen.getByRole('link', { name: i18n.t('updatesReadPost') }));
  await screen.findByText('Выберите нужную группу.');
  expect(location.search).toBe('?post=5');
  expect(screen.getByRole('link', { name: i18n.t('updatesOpenSection') }).getAttribute('href')).toBe('/sales/groups');
  await userEvent.click(screen.getByRole('button', { name: 'Список групп' }));
  expect(screen.getByRole('dialog', { name: 'Список групп' })).toBeTruthy();
});

it('lets teachers read the same post without presenting a sales action or publishing controls', async () => {
  mocks.actor = { id: 2, module: 'teacher', modules: ['teacher'] };
  mount('?post=5');
  await screen.findByText('Выберите нужную группу.');
  expect(screen.queryByRole('link', { name: i18n.t('updatesOpenSection') })).toBeNull();
  expect(screen.queryByRole('button', { name: i18n.t('updatesNewPost') })).toBeNull();
});

it('publishes a bilingual post from a modal with one stable publication key', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('alert')).toBeTruthy();
  for (const [tab, title, body] of [
    ['updatesRussian', 'Новый пост', 'Описание работы'],
    ['updatesEnglish', 'New post', 'How it works'],
  ] as const) {
    await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t(tab) }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesTitle') }), title);
    await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesSummary') }), body);
    await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesBody') }), body);
  }
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
  expect(mocks.publish.mock.calls[0][0]).toMatchObject({
    publicationKey: expect.any(String),
    content: { title: { ru: 'Новый пост', en: 'New post' } },
  });
  await waitFor(() => expect(location.search).toBe('?post=5'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('reports an invalid post link without issuing an unbounded or malformed request', async () => {
  mount('?post=5oops');
  expect(screen.getByRole('alert').textContent).toBe(i18n.t('updatesPostMissing'));
  expect(mocks.find).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
});

it('copies post link to clipboard and notifies with a toast in card and article view', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  mount();
  await screen.findByText(post.content.title.ru);
  const cardCopyButton = screen.getByRole('button', { name: i18n.t('updatesCopyLink') });
  await userEvent.click(cardCopyButton);
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/updates?post=5'));
  expect(mocks.toast).toHaveBeenCalledWith({ title: i18n.t('updatesLinkCopied') });

  cleanup();
  mount('?post=5');
  await screen.findByText('Выберите нужную группу.');
  const articleCopyButton = screen.getByRole('button', { name: i18n.t('updatesCopyLink') });
  await userEvent.click(articleCopyButton);
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/updates?post=5'));
  expect(mocks.toast).toHaveBeenCalledWith({ title: i18n.t('updatesLinkCopied') });
});

it('filters the feed cards by search query and year chips, and allows resetting when search is empty', async () => {
  mocks.list.mockResolvedValue([post, olderPost, archivePost]);
  mount();
  await screen.findByText(post.content.title.ru);
  expect(screen.getByText(olderPost.content.title.ru)).toBeTruthy();
  expect(screen.getByText(archivePost.content.title.ru)).toBeTruthy();

  const chip2025 = screen.getByRole('button', { name: '2025' });
  await userEvent.click(chip2025);
  expect(screen.queryByText(post.content.title.ru)).toBeNull();
  expect(screen.queryByText(olderPost.content.title.ru)).toBeNull();
  expect(screen.getByText(archivePost.content.title.ru)).toBeTruthy();

  const chip2026 = screen.getByRole('button', { name: '2026' });
  await userEvent.click(chip2026);
  expect(screen.getByText(post.content.title.ru)).toBeTruthy();
  expect(screen.getByText(olderPost.content.title.ru)).toBeTruthy();
  expect(screen.queryByText(archivePost.content.title.ru)).toBeNull();

  const allYearsButton = screen.getByRole('button', { name: i18n.t('updatesAllYears') });
  await userEvent.click(allYearsButton);
  expect(screen.getByText(post.content.title.ru)).toBeTruthy();
  expect(screen.getByText(archivePost.content.title.ru)).toBeTruthy();

  const searchInput = screen.getByRole('searchbox', { name: i18n.t('updatesSearch') });
  await userEvent.type(searchInput, 'оплаты');
  expect(screen.queryByText(post.content.title.ru)).toBeNull();
  expect(screen.getByText(olderPost.content.title.ru)).toBeTruthy();

  await userEvent.clear(searchInput);
  await userEvent.type(searchInput, 'несуществующий_запрос_123');
  expect(screen.getByText(i18n.t('updatesSearchEmpty'))).toBeTruthy();

  const resetButton = screen.getByRole('button', { name: i18n.t('updatesResetSearch') });
  await userEvent.click(resetButton);
  expect(screen.getByText(post.content.title.ru)).toBeTruthy();
  expect(screen.getByText(olderPost.content.title.ru)).toBeTruthy();
});

it('renders interactive table of contents, progress bar and scroll to top for 3+ sections, but hides TOC for short posts', async () => {
  mocks.find.mockResolvedValue(post);
  mount('?post=5');
  await screen.findByText('Выберите нужную группу.');
  expect(screen.queryByRole('navigation', { name: i18n.t('updatesTableOfContents') })).toBeNull();

  cleanup();

  mocks.find.mockResolvedValue(multiSectionPost);
  mocks.list.mockResolvedValue([multiSectionPost, post]);
  mount('?post=7');
  await screen.findByRole('heading', { level: 2, name: multiSectionPost.content.title.ru });

  const toc = await screen.findByRole('navigation', { name: i18n.t('updatesTableOfContents') });
  expect(within(toc).getByRole('link', { name: 'Первый раздел' }).getAttribute('href')).toBe('#section-1');
  expect(within(toc).getByRole('link', { name: 'Второй раздел' }).getAttribute('href')).toBe('#section-2');
  expect(within(toc).getByRole('link', { name: 'Третий раздел' }).getAttribute('href')).toBe('#section-3');

  expect(screen.getByRole('progressbar', { name: i18n.t('updatesReadingProgress') })).toBeTruthy();
  expect(screen.getByRole('button', { name: i18n.t('updatesScrollToTop') })).toBeTruthy();
});

it('shows neighboring post cards for chronological navigation', async () => {
  mocks.list.mockResolvedValue([multiSectionPost, post, olderPost]);
  mocks.find.mockResolvedValue(post);
  mount('?post=5');
  await screen.findByText(post.content.title.ru);

  expect(await screen.findByText(i18n.t('updatesPrevPost'))).toBeTruthy();
  expect(screen.getByText(olderPost.content.title.ru)).toBeTruthy();

  expect(screen.getByText(i18n.t('updatesNextPost'))).toBeTruthy();
  expect(screen.getByText(multiSectionPost.content.title.ru)).toBeTruthy();
});

it('allows previewing, selecting CRM target action and tracking character counters in publish modal', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });

  const actionSelect = within(dialog).getByRole('combobox', { name: i18n.t('updatesTargetAction') });
  await userEvent.selectOptions(actionSelect, '/admin/academy-settings?tab=groups');
  expect((actionSelect as HTMLSelectElement).value).toBe('/admin/academy-settings?tab=groups');

  const ruTitleInput = within(dialog).getByRole('textbox', { name: i18n.t('updatesTitle') });
  await userEvent.type(ruTitleInput, 'Новая структура');
  expect(within(dialog).getByText('15 / 200')).toBeTruthy();

  const ruSummaryInput = within(dialog).getByRole('textbox', { name: i18n.t('updatesSummary') });
  await userEvent.type(ruSummaryInput, 'Описание изменений');
  expect(within(dialog).getByText('18 / 600')).toBeTruthy();

  const ruBodyInput = within(dialog).getByRole('textbox', { name: i18n.t('updatesBody') });
  await userEvent.type(ruBodyInput, 'Подробности здесь.');

  await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t('updatesPreview') }));
  expect(within(dialog).getByText('Новая структура')).toBeTruthy();
  expect(within(dialog).getByText('Описание изменений')).toBeTruthy();
  expect(within(dialog).getByText('Подробности здесь.')).toBeTruthy();

  await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t('updatesEnglish') }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesTitle') }), 'New structure');
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesSummary') }), 'Change summary');
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesBody') }), 'Details here.');

  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
  expect(mocks.publish.mock.calls[0][0]).toMatchObject({
    publicationKey: expect.any(String),
    content: {
      title: { ru: 'Новая структура', en: 'New structure' },
      action: { href: '/admin/academy-settings?tab=groups' },
    },
  });
});

it('filters the feed cards by category filter chips with accessible aria-pressed state', async () => {
  mocks.list.mockResolvedValue([featurePost, improvementPost, salesPost, adminPost]);
  mount();
  await screen.findByText(featurePost.content.title.ru);
  expect(screen.getByText(improvementPost.content.title.ru)).toBeTruthy();
  expect(screen.getByText(salesPost.content.title.ru)).toBeTruthy();
  expect(screen.getByText(adminPost.content.title.ru)).toBeTruthy();

  const allCatButton = screen.getByRole('button', { name: i18n.t('updatesCategoryAll') });
  const featureCatButton = screen.getByRole('button', { name: i18n.t('updatesCategoryFeature') });
  const salesCatButton = screen.getByRole('button', { name: i18n.t('updatesCategorySales') });

  expect(allCatButton.getAttribute('aria-pressed')).toBe('true');
  expect(featureCatButton.getAttribute('aria-pressed')).toBe('false');

  await userEvent.click(featureCatButton);
  expect(allCatButton.getAttribute('aria-pressed')).toBe('false');
  expect(featureCatButton.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(featurePost.content.title.ru)).toBeTruthy();
  expect(screen.queryByText(improvementPost.content.title.ru)).toBeNull();
  expect(screen.queryByText(salesPost.content.title.ru)).toBeNull();
  expect(screen.queryByText(adminPost.content.title.ru)).toBeNull();

  await userEvent.click(salesCatButton);
  expect(salesCatButton.getAttribute('aria-pressed')).toBe('true');
  expect(featureCatButton.getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByText(featurePost.content.title.ru)).toBeNull();
  expect(screen.getByText(salesPost.content.title.ru)).toBeTruthy();

  await userEvent.click(allCatButton);
  expect(allCatButton.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(featurePost.content.title.ru)).toBeTruthy();
  expect(screen.getByText(improvementPost.content.title.ru)).toBeTruthy();
  expect(screen.getByText(salesPost.content.title.ru)).toBeTruthy();
  expect(screen.getByText(adminPost.content.title.ru)).toBeTruthy();
});

it('shows unread badges and allows marking all updates as read in one click', async () => {
  mocks.list.mockResolvedValue([featurePost, improvementPost]);
  mount();
  await screen.findByText(featurePost.content.title.ru);

  const unreadBadges = screen.getAllByText(i18n.t('updatesUnread'));
  expect(unreadBadges.length).toBe(2);

  const markAllButton = screen.getByRole('button', { name: i18n.t('updatesMarkAllAsRead') });
  await userEvent.click(markAllButton);

  expect(mocks.toast).toHaveBeenCalledWith({ title: i18n.t('updatesAllMarkedAsRead') });
  expect(screen.queryByRole('button', { name: i18n.t('updatesMarkAllAsRead') })).toBeNull();
  expect(screen.queryByText(i18n.t('updatesUnread'))).toBeNull();

  const stored = JSON.parse(window.localStorage.getItem('academy-updates:read-posts') || '[]');
  expect(stored).toContain(featurePost.id);
  expect(stored).toContain(improvementPost.id);
});

it('opens quick preview in a Dialog without route changes and marks post as read', async () => {
  mocks.list.mockResolvedValue([salesPost]);
  mount();
  await screen.findByText(salesPost.content.title.ru);
  expect(screen.getByText(i18n.t('updatesUnread'))).toBeTruthy();

  const quickViewButton = screen.getByRole('button', { name: i18n.t('updatesQuickView') });
  await userEvent.click(quickViewButton);

  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(salesPost.content.title.ru)).toBeTruthy();
  expect(within(dialog).getByText(salesPost.content.summary.ru)).toBeTruthy();
  expect(within(dialog).getByText('Работа со сделками.')).toBeTruthy();

  expect(location.search).toBe('');

  const stored = JSON.parse(window.localStorage.getItem('academy-updates:read-posts') || '[]');
  expect(stored).toContain(salesPost.id);

  const closeButtons = within(dialog).getAllByRole('button', { name: i18n.t('updatesCloseQuickView') });
  await userEvent.click(closeButtons[0]);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('supports hotkey / to focus search and Escape to clear search or return from article', async () => {
  mocks.list.mockResolvedValue([post]);
  mount();
  await screen.findByText(post.content.title.ru);

  const searchInput = screen.getByRole('searchbox', { name: i18n.t('updatesSearch') });
  expect(document.activeElement).not.toBe(searchInput);

  await userEvent.keyboard('/');
  expect(document.activeElement).toBe(searchInput);

  await userEvent.type(searchInput, 'тест');
  expect((searchInput as HTMLInputElement).value).toBe('тест');

  await userEvent.keyboard('{Escape}');
  expect((searchInput as HTMLInputElement).value).toBe('');
  expect(document.activeElement).not.toBe(searchInput);

  cleanup();

  mocks.find.mockResolvedValue(post);
  mocks.list.mockResolvedValue([post]);
  mount('?post=5');
  await screen.findByText('Выберите нужную группу.');

  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(location.search).toBe(''));
});

it('allows toggling employee reactions with accessible aria-pressed and localStorage sync', async () => {
  mocks.find.mockResolvedValue(post);
  mocks.list.mockResolvedValue([post]);
  mount('?post=5');
  await screen.findByText('Выберите нужную группу.');

  const helpfulButton = screen.getByRole('button', { name: i18n.t('updatesReactionHelpful') });
  const awesomeButton = screen.getByRole('button', { name: i18n.t('updatesReactionAwesome') });
  const excitedButton = screen.getByRole('button', { name: i18n.t('updatesReactionExcited') });

  expect(helpfulButton.getAttribute('aria-pressed')).toBe('false');
  expect(awesomeButton.getAttribute('aria-pressed')).toBe('false');
  expect(excitedButton.getAttribute('aria-pressed')).toBe('false');

  await userEvent.click(helpfulButton);
  expect(helpfulButton.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(i18n.t('updatesReactionFeedback'))).toBeTruthy();

  let raw = window.localStorage.getItem('academy-updates:reactions');
  let data = JSON.parse(raw || '{}');
  expect(data['5']?.userReaction).toBe('helpful');
  expect(data['5']?.counts?.helpful).toBe(1);

  await userEvent.click(awesomeButton);
  expect(helpfulButton.getAttribute('aria-pressed')).toBe('false');
  expect(awesomeButton.getAttribute('aria-pressed')).toBe('true');

  raw = window.localStorage.getItem('academy-updates:reactions');
  data = JSON.parse(raw || '{}');
  expect(data['5']?.userReaction).toBe('awesome');
  expect(data['5']?.counts?.helpful).toBe(0);
  expect(data['5']?.counts?.awesome).toBe(1);

  await userEvent.click(awesomeButton);
  expect(awesomeButton.getAttribute('aria-pressed')).toBe('false');
  raw = window.localStorage.getItem('academy-updates:reactions');
  data = JSON.parse(raw || '{}');
  expect(data['5']?.userReaction).toBeNull();
  expect(data['5']?.counts?.awesome).toBe(0);
});

it('automatically saves draft to localStorage, shows restored banner, and clears on demand', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  mount();
  await screen.findByText(post.content.title.ru);

  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });

  const titleInput = within(dialog).getByRole('textbox', { name: i18n.t('updatesTitle') });
  await userEvent.type(titleInput, 'Черновик релиза');
  const summaryInput = within(dialog).getByRole('textbox', { name: i18n.t('updatesSummary') });
  await userEvent.type(summaryInput, 'Краткое саммари черновика');

  await waitFor(() => {
    const rawDraft = window.localStorage.getItem('academy-updates:publish-draft');
    expect(rawDraft).toBeTruthy();
    const parsed = JSON.parse(rawDraft || '{}');
    expect(parsed.titleRu).toBe('Черновик релиза');
    expect(parsed.summaryRu).toBe('Краткое саммари черновика');
  });

  cleanup();

  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const reDialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });

  expect(within(reDialog).getByText(i18n.t('updatesDraftRestored'))).toBeTruthy();
  expect((within(reDialog).getByRole('textbox', { name: i18n.t('updatesTitle') }) as HTMLInputElement).value).toBe('Черновик релиза');

  const clearButton = within(reDialog).getByRole('button', { name: i18n.t('updatesClearDraft') });
  await userEvent.click(clearButton);

  expect(within(reDialog).queryByText(i18n.t('updatesDraftRestored'))).toBeNull();
  expect((within(reDialog).getByRole('textbox', { name: i18n.t('updatesTitle') }) as HTMLInputElement).value).toBe('');
  expect(window.localStorage.getItem('academy-updates:publish-draft')).toBeNull();
});

it('supports category selection and multi-section authoring with bullet items and live preview', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  mount();
  await screen.findByText(post.content.title.ru);

  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });

  const categorySelect = within(dialog).getByRole('combobox', { name: i18n.t('updatesCategory') });
  await userEvent.selectOptions(categorySelect, 'improvement');
  expect((categorySelect as HTMLSelectElement).value).toBe('improvement');

  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesTitle') }), 'Улучшение интерфейса');
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesSummary') }), 'Обновленный UI');
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesBody') }), 'Основной текст');

  const addSectionButton = within(dialog).getByRole('button', { name: i18n.t('updatesAddSection') });
  await userEvent.click(addSectionButton);

  const sectionHeading = within(dialog).getByRole('textbox', { name: i18n.t('updatesSectionHeading') });
  await userEvent.type(sectionHeading, 'Детали улучшения');

  const sectionBody = within(dialog).getByRole('textbox', { name: i18n.t('updatesSectionBody') });
  await userEvent.type(sectionBody, 'Второй блок текста');

  const addItemButtons = within(dialog).getAllByRole('button', { name: i18n.t('updatesAddItem') });
  await userEvent.click(addItemButtons[1]);

  const bulletInput = within(dialog).getByPlaceholderText(i18n.t('updatesAddItem'));
  await userEvent.type(bulletInput, 'Первый пункт списка');

  await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t('updatesPreview') }));
  expect(within(dialog).getAllByText(i18n.t('updatesCategoryImprovement')).length).toBeGreaterThanOrEqual(2);
  expect(within(dialog).getByText('Улучшение интерфейса')).toBeTruthy();
  expect(within(dialog).getByText('Детали улучшения')).toBeTruthy();
  expect(within(dialog).getByText('Второй блок текста')).toBeTruthy();
  expect(within(dialog).getByText('Первый пункт списка')).toBeTruthy();
});
