// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import UpdatesPage from '../client/src/features/updates/UpdatesPage';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';

const mocks = vi.hoisted(() => ({
  actor: { id: 1, module: 'sales', modules: ['sales'] }, list: vi.fn(), find: vi.fn(), publish: vi.fn(),
}));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.actor }) }));
vi.mock('../client/src/features/updates/api', () => ({
  updateQueryKeys: { all: ['/api/updates'], list: ['/api/updates', 'feed'], detail: (id: number) => ['/api/updates', 'post', id] },
  updatesApi: { list: mocks.list, find: mocks.find, publish: mocks.publish },
}));
const post = { id: 5, publishedAt: '2026-10-12T18:00:00.000Z', content: {
  title: { ru: 'Группы в продажах', en: 'Groups in Sales' }, summary: { ru: 'Работа с группами', en: 'Group management' },
  action: { href: '/sales/groups' }, sections: [{ heading: { ru: 'Как пользоваться', en: 'How to use it' },
    paragraphs: [{ ru: 'Выберите нужную группу.', en: 'Choose a group.' }], items: [],
    image: { src: '/api/updates/images/release/example.jpg', caption: { ru: 'Список групп', en: 'Group list' } } }],
} };
let client: QueryClient;
beforeEach(() => {
  i18n.setLanguage('ru'); localStorage.clear(); mocks.actor = { id: 1, module: 'sales', modules: ['sales'] };
  vi.clearAllMocks(); mocks.list.mockResolvedValue([post]); mocks.find.mockResolvedValue(post); mocks.publish.mockResolvedValue(post);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { cleanup(); client.clear(); await new Promise((resolve) => setTimeout(resolve, 0)); vi.unstubAllGlobals(); });
const mount = (query = '') => { allowNavigation(() => history.replaceState(null, '', `/updates${query}`)); render(<QueryClientProvider client={client}><UpdatesPage /></QueryClientProvider>); };
it('opens the post, enlarges a screenshot in a dialog and links to the sales section', async () => {
  mount(); await screen.findByText(post.content.title.ru);
  expect(screen.queryByRole('button', { name: i18n.t('updatesNewPost') })).toBeNull();
  await userEvent.click(screen.getByRole('link', { name: i18n.t('updatesReadPost') }));
  await screen.findByText('Выберите нужную группу.'); expect(location.search).toBe('?post=5');
  expect(screen.getByRole('link', { name: i18n.t('updatesOpenSection') }).getAttribute('href')).toBe('/sales/groups');
  await userEvent.click(screen.getByRole('button', { name: 'Список групп' }));
  expect(screen.getByRole('dialog', { name: 'Список групп' })).toBeTruthy();
});
it('lets teachers read the same post without presenting a sales action or publishing controls', async () => {
  mocks.actor = { id: 2, module: 'teacher', modules: ['teacher'] }; mount('?post=5');
  await screen.findByText('Выберите нужную группу.');
  expect(screen.queryByRole('link', { name: i18n.t('updatesOpenSection') })).toBeNull();
  expect(screen.queryByRole('button', { name: i18n.t('updatesNewPost') })).toBeNull();
});
it('publishes a bilingual post from a modal with one stable publication key', async () => {
  mocks.actor = { id: 1, module: 'administration', modules: ['administration'] }; mount();
  await screen.findByText(post.content.title.ru);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('updatesNewPost') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('updatesNewPost') });
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  expect(mocks.publish).not.toHaveBeenCalled(); expect(within(dialog).getByRole('alert')).toBeTruthy();
  for (const [tab, title, body] of [['updatesRussian', 'Новый пост', 'Описание работы'], ['updatesEnglish', 'New post', 'How it works']] as const) {
    await userEvent.click(within(dialog).getByRole('tab', { name: i18n.t(tab) }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesTitle') }), title);
    await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesSummary') }), body);
    await userEvent.type(within(dialog).getByRole('textbox', { name: i18n.t('updatesBody') }), body);
  }
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('updatesPublish') }));
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
  expect(mocks.publish.mock.calls[0][0]).toMatchObject({ publicationKey: expect.any(String), content: { title: { ru: 'Новый пост', en: 'New post' } } });
  await waitFor(() => expect(location.search).toBe('?post=5'));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('reports an invalid post link without issuing an unbounded or malformed request', async () => {
  mount('?post=5oops'); expect(screen.getByRole('alert').textContent).toBe(i18n.t('updatesPostMissing'));
  expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
});
