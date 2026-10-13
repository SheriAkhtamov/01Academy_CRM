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
    category: 'sales',
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

it('opens the post and enlarges a screenshot in a dialog', async () => {
  mount();
  await screen.findByText(post.content.title.ru);
  expect(screen.queryByRole('button', { name: i18n.t('updatesNewPost') })).toBeNull();
  await userEvent.click(screen.getByRole('link', { name: i18n.t('updatesReadPost') }));
  await screen.findByText('Выберите нужную группу.');
  expect(location.search).toBe('?post=5');
  expect(screen.queryByRole('link', { name: 'Открыть раздел' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Список групп' }));
  expect(screen.getByRole('dialog', { name: 'Список групп' })).toBeTruthy();
});

it('lets teachers read the same post without publishing controls', async () => {
  mocks.actor = { id: 2, module: 'teacher', modules: ['teacher'] };
  mount('?post=5');
  await screen.findByText('Выберите нужную группу.');
  expect(screen.queryByRole('link', { name: 'Открыть раздел' })).toBeNull();
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
  expect(mocks.publish.mock.calls[0][0].content).not.toHaveProperty('category');
  expect(mocks.publish.mock.calls[0][0].content).not.toHaveProperty('action');
  await waitFor(() => expect(location.search).toBe('?post=5'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('reports an invalid post link without issuing an unbounded or malformed request', async () => {
  mount('?post=5oops');
  expect(screen.getByRole('alert').textContent).toBe(i18n.t('updatesPostMissing'));
  expect(mocks.find).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
});

it('omits removed controls in the feed, quick preview and reading surface for historical metadata', async () => {
  const expectRemovedControlsAbsent = () => {
    expect(screen.queryByRole('group', { name: 'Категории' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Копировать ссылку|Отметить всё как прочитанное/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Открыть раздел' })).toBeNull();
    expect(screen.queryByText('Всего релизов')).toBeNull();
    expect(screen.queryByText('Последний релиз')).toBeNull();
    expect(screen.queryByText('Продажи')).toBeNull();
  };

  mount();
  await screen.findByText(post.content.title.ru);
  expectRemovedControlsAbsent();
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesQuickView') }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expectRemovedControlsAbsent();
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: i18n.t('updatesReadPost') }));
  await screen.findByText('Выберите нужную группу.');
  expectRemovedControlsAbsent();

  const article = screen.getByRole('article');
  const surface = article.parentElement!;
  expect(surface.className).toContain('bg-card');
  expect(surface.className).toContain('rounded-xl');
  expect(surface.className).toContain('border');
  expect(surface.className).toContain('max-w-4xl');
  expect(surface.className).toContain('min-w-0');
  expect(article.className).toContain('p-4');
  expect(article.className).toContain('sm:p-6');
  expect(article.className).toContain('lg:p-8');
  expect(article.className).toContain('[overflow-wrap:anywhere]');
  expect(within(article).getByRole('img', { name: 'Список групп' }).className).toContain('max-w-full');
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

it('previews both languages, tracks character counters and publishes without removed editor fields', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  expect(within(dialog).queryByRole('combobox')).toBeNull();

  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesTitle') }), 'Новая структура');
  expect(within(dialog).getByText('15 / 200')).toBeTruthy();
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesSummary') }), 'Описание изменений');
  expect(within(dialog).getByText('18 / 600')).toBeTruthy();
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesBody') }), 'Подробности здесь.');
  await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t('updatesEnglish') }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesTitle') }), 'New structure');
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesSummary') }), 'Change summary');
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesBody') }), 'Details here.');

  await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t('updatesPreview') }));
  expect(within(dialog).getByText('Новая структура')).toBeTruthy();
  expect(within(dialog).getByText('Описание изменений')).toBeTruthy();
  expect(within(dialog).getByText('Подробности здесь.')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesEnglish') }));
  expect(within(dialog).getByText('New structure')).toBeTruthy();
  expect(within(dialog).getByText('Change summary')).toBeTruthy();
  expect(within(dialog).getByText('Details here.')).toBeTruthy();
  expect(within(dialog).queryByRole('link', { name: 'Открыть раздел' })).toBeNull();

  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
  expect(mocks.publish.mock.calls[0][0]).toMatchObject({
    publicationKey: expect.any(String),
    content: { title: { ru: 'Новая структура', en: 'New structure' } },
  });
  expect(mocks.publish.mock.calls[0][0].content).not.toHaveProperty('category');
  expect(mocks.publish.mock.calls[0][0].content).not.toHaveProperty('action');
});

it('shows historical posts without interpreting their former category or target section', async () => {
  mocks.list.mockResolvedValue([featurePost, improvementPost, salesPost, adminPost]);
  mount();
  for (const item of [featurePost, improvementPost, salesPost, adminPost]) {
    expect(await screen.findByRole('heading', { name: item.content.title.ru })).toBeTruthy();
  }
  expect(screen.queryByRole('group', { name: 'Категории' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Все категории|Новая функция|Улучшение UX|Продажи|Администрирование/ })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Открыть раздел' })).toBeNull();
});

it('marks only the opened post as read and keeps other updates unread', async () => {
  mocks.list.mockResolvedValue([featurePost, improvementPost]);
  mount();
  await screen.findByText(featurePost.content.title.ru);
  expect(screen.getAllByText(i18n.t('updatesUnread'))).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Отметить всё как прочитанное' })).toBeNull();

  await userEvent.click(screen.getAllByRole('button', { name: i18n.t('updatesQuickView') })[0]);
  expect(JSON.parse(window.localStorage.getItem('academy-updates:read-posts') || '[]')).toEqual([featurePost.id]);
  await userEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: i18n.t('updatesCloseQuickView') })[0]);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getAllByText(i18n.t('updatesUnread'))).toHaveLength(1);
  expect(mocks.toast).not.toHaveBeenCalled();
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

it.each(['ru', 'en'] as const)('does not display or access retired ratings when reading and changing posts in %s', async (language) => {
  i18n.setLanguage(language);
  const retiredKey = 'academy-updates:reactions';
  const storedRatings = JSON.stringify({
    [post.id]: { counts: { helpful: 2, awesome: 3, excited: 4 }, userReaction: 'awesome' },
    [olderPost.id]: { counts: { helpful: 7, awesome: 8, excited: 9 }, userReaction: 'helpful' },
  });
  const storagePrototype = Object.getPrototypeOf(window.localStorage) as Storage;
  const originalGetItem = storagePrototype.getItem;
  window.localStorage.setItem(retiredKey, storedRatings);
  mocks.find.mockImplementation(async (id: number) => id === post.id ? post : olderPost);
  mocks.list.mockResolvedValue([post, olderPost]);

  const getItem = vi.spyOn(storagePrototype, 'getItem');
  const setItem = vi.spyOn(storagePrototype, 'setItem');
  const removeItem = vi.spyOn(storagePrototype, 'removeItem');
  const clear = vi.spyOn(storagePrototype, 'clear');
  const labels = language === 'ru'
    ? { title: 'Как вам обновление?', feedback: 'Спасибо за ваш отклик!', buttons: ['Полезно', 'Круто', 'Ждали'] }
    : { title: 'How do you like this update?', feedback: 'Thank you for your feedback!', buttons: ['Helpful', 'Awesome', 'Excited'] };

  const expectNoRatings = (neighborTitle: string) => {
    const article = screen.getByRole('article');
    expect(within(article).queryByText(labels.title)).toBeNull();
    expect(within(article).queryByText(labels.feedback)).toBeNull();
    for (const label of labels.buttons) {
      expect(within(article).queryByRole('button', { name: label })).toBeNull();
    }
    for (const emoji of ['👍', '🔥', '🚀']) {
      expect(within(article).queryByText(emoji)).toBeNull();
    }
    const lastSection = article.querySelector('section:last-of-type')!;
    const nextBlock = lastSection.nextElementSibling as HTMLElement;
    expect(within(nextBlock).getByRole('link', { name: neighborTitle })).toBeTruthy();
    expect(article.parentElement!.className).toContain('bg-card');
    expect(within(article).getByRole('button', { name: i18n.t('updatesScrollToTop') })).toBeTruthy();
    expect(getItem).toHaveBeenCalledWith('academy-updates:read-posts');
    expect(setItem.mock.calls.some(([key]) => key === 'academy-updates:read-posts')).toBe(true);
    expect(getItem).not.toHaveBeenCalledWith(retiredKey);
    expect(setItem.mock.calls.some(([key]) => key === retiredKey)).toBe(false);
    expect(removeItem).not.toHaveBeenCalledWith(retiredKey);
    expect(clear).not.toHaveBeenCalled();
    expect(originalGetItem.call(window.localStorage, retiredKey)).toBe(storedRatings);
  };

  try {
    mount('?post=5');
    await screen.findByRole('heading', { name: post.content.title[language] });
    const olderLink = await screen.findByRole('link', { name: olderPost.content.title[language] });
    expectNoRatings(olderPost.content.title[language]);
    await userEvent.click(olderLink);
    await screen.findByRole('heading', { name: olderPost.content.title[language] });
    expect(location.search).toBe('?post=4');
    expectNoRatings(post.content.title[language]);
    expect(JSON.parse(originalGetItem.call(window.localStorage, 'academy-updates:read-posts') || '[]')).toEqual([post.id, olderPost.id]);
  } finally {
    getItem.mockRestore();
    setItem.mockRestore();
    removeItem.mockRestore();
    clear.mockRestore();
  }
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
  const savedBeforeClear = window.localStorage.getItem('academy-updates:publish-draft');
  await userEvent.click(clearButton);
  let confirmation = screen.getByRole('alertdialog', { name: i18n.t('updatesClearDraft') });
  expect(within(confirmation).getByText(i18n.t('updatesClearDraftConfirm'))).toBeTruthy();
  expect(window.localStorage.getItem('academy-updates:publish-draft')).toBe(savedBeforeClear);
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('cancel') }));
  expect((within(reDialog).getByRole('textbox', { name: i18n.t('updatesTitle') }) as HTMLInputElement).value).toBe('Черновик релиза');
  expect(window.localStorage.getItem('academy-updates:publish-draft')).toBe(savedBeforeClear);
  await userEvent.click(clearButton);
  confirmation = screen.getByRole('alertdialog', { name: i18n.t('updatesClearDraft') });
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('updatesClearDraft') }));

  expect(within(reDialog).queryByText(i18n.t('updatesDraftRestored'))).toBeNull();
  expect((within(reDialog).getByRole('textbox', { name: i18n.t('updatesTitle') }) as HTMLInputElement).value).toBe('');
  expect(window.localStorage.getItem('academy-updates:publish-draft')).toBeNull();
});

it('supports multi-section authoring with bullet items and live preview', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  mount();
  await screen.findByText(post.content.title.ru);

  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });

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
  expect(within(dialog).queryByRole('combobox')).toBeNull();
  expect(within(dialog).getByText('Улучшение интерфейса')).toBeTruthy();
  expect(within(dialog).getByText('Детали улучшения')).toBeTruthy();
  expect(within(dialog).getByText('Второй блок текста')).toBeTruthy();
  expect(within(dialog).getByText('Первый пункт списка')).toBeTruthy();
});


it('restores and publishes a historical bilingual draft without its former category or action', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  window.localStorage.setItem('academy-updates:publish-draft', JSON.stringify({
    titleRu: 'Прежний черновик', titleEn: 'Historical draft',
    summaryRu: 'Сохранённое описание', summaryEn: 'Saved summary',
    category: 'sales', actionHref: '/sales/groups',
    sectionsRu: [{ heading: 'Раздел', paragraphs: ['Сохранённый текст'], items: ['Пункт'] }],
    sectionsEn: [{ heading: 'Section', paragraphs: ['Saved text'], items: ['Item'] }],
  }));
  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  expect(within(dialog).getByText(i18n.t('updatesDraftRestored'))).toBeTruthy();
  expect(within(dialog).queryByRole('combobox')).toBeNull();
  await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t('updatesPreview') }));
  expect(within(dialog).getByText('Прежний черновик')).toBeTruthy();
  expect(within(dialog).getByText('Сохранённый текст')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesEnglish') }));
  expect(within(dialog).getByText('Historical draft')).toBeTruthy();
  expect(within(dialog).getByText('Saved text')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
  expect(mocks.publish.mock.calls[0][0].content).toEqual({
    title: { ru: 'Прежний черновик', en: 'Historical draft' },
    summary: { ru: 'Сохранённое описание', en: 'Saved summary' },
    sections: [{
      heading: { ru: 'Раздел', en: 'Section' },
      paragraphs: [{ ru: 'Сохранённый текст', en: 'Saved text' }],
      items: [{ ru: 'Пункт', en: 'Item' }],
    }],
  });
});

it('restores an English-only historical section rather than replacing it with an empty draft', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  window.localStorage.setItem('academy-updates:publish-draft', JSON.stringify({
    titleRu: '', titleEn: '', summaryRu: '', summaryEn: '',
    category: 'feature', actionHref: '/sales/groups',
    sectionsEn: [{ paragraphs: ['English-only saved section'], items: ['English-only item'] }],
  }));
  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  expect(within(dialog).getByText(i18n.t('updatesDraftRestored'))).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t('updatesEnglish') }));
  expect((within(dialog).getByRole('textbox', { name: i18n.t('updatesBody') }) as HTMLTextAreaElement).value).toBe('English-only saved section');
  expect((within(dialog).getByPlaceholderText(i18n.t('updatesAddItem')) as HTMLInputElement).value).toBe('English-only item');
  const saved = JSON.parse(window.localStorage.getItem('academy-updates:publish-draft') || '{}');
  expect(saved).not.toHaveProperty('category');
  expect(saved).not.toHaveProperty('actionHref');
  expect(saved.sectionsEn[0].items).toEqual(['English-only item']);
});

it('keeps sparse bullet translations aligned after saving and restoring, and rejects incomplete items', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  let dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  for (const tab of ['updatesRussian', 'updatesEnglish'] as const) {
    await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t(tab) }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesTitle') }), tab === 'updatesRussian' ? 'Черновик' : 'Draft');
    await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesSummary') }), tab === 'updatesRussian' ? 'Описание' : 'Summary');
    await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesBody') }), tab === 'updatesRussian' ? 'Текст' : 'Body');
  }
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesAddItem') }));
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesAddItem') }));
  await userEvent.type(within(dialog).getAllByPlaceholderText(i18n.t('updatesAddItem'))[1], 'Second item');
  await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t('updatesRussian') }));
  await userEvent.type(within(dialog).getAllByPlaceholderText(i18n.t('updatesAddItem'))[0], 'Первый пункт');
  const saved = JSON.parse(window.localStorage.getItem('academy-updates:publish-draft') || '{}');
  expect(saved.sectionsRu[0].items).toEqual(['Первый пункт', '']);
  expect(saved.sectionsEn[0].items).toEqual(['', 'Second item']);

  cleanup();
  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  expect(within(dialog).getAllByPlaceholderText(i18n.t('updatesAddItem')).map((input) => (input as HTMLInputElement).value)).toEqual(['Первый пункт', '']);
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('alert').textContent).toBe(i18n.t('updatesInvalidContent'));
  await userEvent.type(within(dialog).getAllByPlaceholderText(i18n.t('updatesAddItem'))[1], 'Второй пункт');
  await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t('updatesEnglish') }));
  expect(within(dialog).getAllByPlaceholderText(i18n.t('updatesAddItem')).map((input) => (input as HTMLInputElement).value)).toEqual(['', 'Second item']);
  await userEvent.type(within(dialog).getAllByPlaceholderText(i18n.t('updatesAddItem'))[0], 'First item');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesAddItem') }));
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
  expect(mocks.publish.mock.calls[0][0].content.sections[0].items).toEqual([
    { ru: 'Первый пункт', en: 'First item' },
    { ru: 'Второй пункт', en: 'Second item' },
  ]);
});

it.each(['item', 'section'] as const)('confirms %s removal and preserves bilingual draft content on cancellation', async (kind) => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  window.localStorage.setItem('academy-updates:publish-draft', JSON.stringify({
    titleRu: 'Черновик', titleEn: 'Draft', summaryRu: 'Описание', summaryEn: 'Summary',
    sectionsRu: [
      { paragraphs: ['Первый текст'], items: ['Первый пункт'] },
      { heading: 'Второй раздел', paragraphs: ['Второй текст'], items: ['Второй пункт'] },
    ],
    sectionsEn: [
      { paragraphs: ['First body'], items: ['First item'] },
      { heading: 'Second section', paragraphs: ['Second body'], items: ['Second item'] },
    ],
  }));
  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  const actionKey = kind === 'item' ? 'updatesRemoveItem' : 'updatesRemoveSection';
  const descriptionKey = kind === 'item' ? 'updatesRemoveItemConfirm' : 'updatesRemoveSectionConfirm';
  const trigger = within(dialog).getAllByRole('button', { name: i18n.t(actionKey) }).at(-1)!;
  const savedBefore = window.localStorage.getItem('academy-updates:publish-draft');
  await userEvent.click(trigger);
  let confirmation = screen.getByRole('alertdialog', { name: i18n.t(actionKey) });
  expect(within(confirmation).getByText(i18n.t(descriptionKey))).toBeTruthy();
  expect(window.localStorage.getItem('academy-updates:publish-draft')).toBe(savedBefore);
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('cancel') }));
  expect(window.localStorage.getItem('academy-updates:publish-draft')).toBe(savedBefore);
  expect((within(dialog).getByRole('textbox', { name: i18n.t('updatesSectionBody') }) as HTMLTextAreaElement).value).toBe('Второй текст');
  await userEvent.click(trigger);
  confirmation = screen.getByRole('alertdialog', { name: i18n.t(actionKey) });
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t(actionKey) }));
  const savedAfter = JSON.parse(window.localStorage.getItem('academy-updates:publish-draft') || '{}');
  expect(savedAfter.sectionsRu[0]).toEqual({ heading: '', paragraphs: ['Первый текст'], items: ['Первый пункт'] });
  expect(savedAfter.sectionsEn[0]).toEqual({ heading: '', paragraphs: ['First body'], items: ['First item'] });
  if (kind === 'section') {
    expect(savedAfter.sectionsRu).toHaveLength(1);
    expect(savedAfter.sectionsEn).toHaveLength(1);
    expect(within(dialog).queryByRole('textbox', { name: i18n.t('updatesSectionBody') })).toBeNull();
  } else {
    expect(savedAfter.sectionsRu[1].items).toEqual([]);
    expect(savedAfter.sectionsEn[1].items).toEqual([]);
    expect(savedAfter.sectionsRu[1].paragraphs).toEqual(['Второй текст']);
    expect(savedAfter.sectionsEn[1].paragraphs).toEqual(['Second body']);
  }
});

it('does not restore the last draft text after confirmed removal of its bullet', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  window.localStorage.setItem('academy-updates:publish-draft', JSON.stringify({
    titleRu: '', titleEn: '', summaryRu: '', summaryEn: '',
    sectionsRu: [{ items: ['Последний текст'] }],
    sectionsEn: [{ items: ['Last text'] }],
  }));
  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  let dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesRemoveItem') }));
  const confirmation = screen.getByRole('alertdialog', { name: i18n.t('updatesRemoveItem') });
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('updatesRemoveItem') }));
  expect(window.localStorage.getItem('academy-updates:publish-draft')).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('cancel') }));
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  expect(within(dialog).queryByText(i18n.t('updatesDraftRestored'))).toBeNull();
  expect(within(dialog).queryByPlaceholderText(i18n.t('updatesAddItem'))).toBeNull();
});

it.each(['body', 'heading'] as const)('rejects a one-sided %s despite completed bilingual bullets', async (field) => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  window.localStorage.setItem('academy-updates:publish-draft', JSON.stringify({
    titleRu: 'Черновик', titleEn: 'Draft', summaryRu: 'Описание', summaryEn: 'Summary',
    sectionsRu: [{
      heading: field === 'heading' ? 'Заголовок' : '',
      paragraphs: field === 'body' ? ['Русский текст'] : [],
      items: ['Пункт'],
    }],
    sectionsEn: [{ items: ['Item'] }],
  }));
  mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('alert').textContent).toBe(i18n.t('updatesInvalidContent'));
  const saved = JSON.parse(window.localStorage.getItem('academy-updates:publish-draft') || '{}');
  if (field === 'heading') expect(saved.sectionsRu[0].heading).toBe('Заголовок');
  else expect(saved.sectionsRu[0].paragraphs).toEqual(['Русский текст']);
  await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t('updatesEnglish') }));
  const fieldLabel = field === 'heading' ? 'updatesSectionHeading' : 'updatesBody';
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t(fieldLabel) }), field === 'heading' ? 'Heading' : 'English text');
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
  const publishedSection = mocks.publish.mock.calls[0][0].content.sections[0];
  expect(publishedSection.items).toEqual([{ ru: 'Пункт', en: 'Item' }]);
  if (field === 'heading') expect(publishedSection.heading).toEqual({ ru: 'Заголовок', en: 'Heading' });
  else expect(publishedSection.paragraphs).toEqual([{ ru: 'Русский текст', en: 'English text' }]);
});

it('keeps article shortcuts from navigating while the publisher or a confirmation is open', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] };
  mocks.list.mockResolvedValue([multiSectionPost, post, olderPost]);
  mount('?post=5');
  await screen.findByText('Выберите нужную группу.');
  await screen.findByText(multiSectionPost.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesTitle') }), 'Текст');
  within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }).focus();
  await userEvent.keyboard('{ArrowRight}{ArrowLeft}jk');
  expect(location.search).toBe('?post=5');
  await userEvent.keyboard('{Escape}');
  const unsaved = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
  expect(location.search).toBe('?post=5');
  await userEvent.click(within(unsaved).getByRole('button', { name: i18n.t('keepEditing') }));
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesAddItem') }));
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesRemoveItem') }));
  const confirmation = screen.getByRole('alertdialog', { name: i18n.t('updatesRemoveItem') });
  within(confirmation).getByRole('button', { name: i18n.t('updatesRemoveItem') }).focus();
  await userEvent.keyboard('jk{ArrowRight}{Escape}');
  expect(location.search).toBe('?post=5');
  expect(screen.getByRole('dialog', { name: i18n.t('updatesNewPost') })).toBeTruthy();
  expect(window.localStorage.getItem('academy-updates:publish-draft')).toContain('Текст');
});
