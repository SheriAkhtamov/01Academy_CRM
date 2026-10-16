// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PortalSessionDto } from '../shared/contracts/portal-identity';
import type { PortalNotificationPreferencesDto, PortalProjectDto } from '../shared/contracts/portal-resources';
import { PortalPortfolio } from '../client/src/features/portal-app/portfolio';
import { PortalPayments } from '../client/src/features/portal-app/payments';
import { FinanceQuestions } from '../client/src/features/portal-app/finance-questions';
import { PortalNotifications } from '../client/src/features/portal-app/notifications';
import { PortalProfile } from '../client/src/features/portal-identity/PortalProfile';
import { Dialog, DialogContent, DialogTitle } from '../client/src/components/ui/dialog';
import { PortalApiError } from '../client/src/features/portal-app/api';
import { PortalSessionProvider, portalSessionKey, portalSubjectKey } from '../client/src/features/portal-app/context';
import { ThemeProvider } from '../client/src/components/ux/ThemeProvider';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), sessions: vi.fn(), revokeSession: vi.fn(), representatives: vi.fn(), courses: vi.fn(), projectsPage: vi.fn(), projectSource: vi.fn(), saveProject: vi.fn(), share: vi.fn(),
  filePolicy: vi.fn(), paymentsPage: vi.fn(), financeQuestionsPage: vi.fn(), financeQuestion: vi.fn(),
  askFinance: vi.fn(), replyFinance: vi.fn(), notifications: vi.fn(), readNotification: vi.fn(), readAll: vi.fn(), preferences: vi.fn(), savePreferences: vi.fn(),
}));
vi.mock('../client/src/features/portal-app/realtime', () => ({ usePortalRealtime: vi.fn() }));
vi.mock('../client/src/features/portal-app/api', async (importActual) => {
  const actual = await importActual<typeof import('../client/src/features/portal-app/api')>();
  return { ...actual, portalIdentityApi: { ...actual.portalIdentityApi, session: mocks.session, sessions: mocks.sessions, revokeSession: mocks.revokeSession, representatives: mocks.representatives }, portalLmsApi: { ...actual.portalLmsApi, courses: mocks.courses } };
});
vi.mock('../client/src/features/portal-app/resources-api', async (importActual) => {
  const actual = await importActual<typeof import('../client/src/features/portal-app/resources-api')>();
  return { ...actual, portalResourcesApi: { ...actual.portalResourcesApi, ...mocks } };
});

const session: PortalSessionDto = {
  account: { id: 50, login: 'learner', fullName: 'Learner', email: null, phone: null, locale: 'en', status: 'active' },
  csrfToken: 'continuity-csrf',
  subjects: [{ linkId: 10, studentId: 20, studentName: 'Learner', kind: 'self', relationship: null, status: 'active', studentClassification: 'adult', permissions: ['learning.read', 'finance.read', 'portfolio.edit'] }],
};
const project: PortalProjectDto = {
  id: 7, studentId: 20, title: 'Saved project', description: 'Saved description', runId: null,
  courseName: null, sourceSubmissionId: null, links: [], files: [], coverFileId: null,
  teacherReview: null, version: 2, createdAt: '2026-10-16T08:00:00Z', updatedAt: '2026-10-16T08:00:00Z', archivedAt: null, shares: [],
};
const preferences: PortalNotificationPreferencesDto = {
  categories: { learning: { inApp: true }, schedule: { inApp: true }, feedback: { inApp: true }, finance: { inApp: true }, family: { inApp: true }, security: { inApp: true } },
  weeklySummary: false,
};
const question = { id: 5, paymentId: 88, subject: 'Receipt', status: 'open', createdAt: '2026-10-16T08:00:00Z', updatedAt: '2026-10-16T08:00:00Z', messages: [] };
let client: QueryClient;
const page = <T,>(items: T[]) => ({ items, nextCursor: null, hasMore: false });
function mount(children: ReactNode) {
  return render(<ThemeProvider defaultTheme="light"><QueryClientProvider client={client}><PortalSessionProvider>{children}</PortalSessionProvider></QueryClientProvider></ThemeProvider>);
}
const subjectKey = (area: string, ...parts: unknown[]) => portalSubjectKey(session.account!, session.subjects[0], area, ...parts);
const refetch = (queryKey: readonly unknown[]) => act(async () => {
  await client.refetchQueries({ queryKey });
  // Query observers batch their render notification on the next timer turn.
  await new Promise((resolve) => setTimeout(resolve, 0));
});
const offline = () => new PortalApiError(0, 'portalOffline');
const serverError = () => new PortalApiError(500, 'portalLoadError');

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear(); sessionStorage.clear(); i18n.setLanguage('en');
  history.replaceState(null, '', '/student-module/portfolio');
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(portalSessionKey, session);
  mocks.session.mockResolvedValue(session);
  mocks.sessions.mockResolvedValue([{ id: 'other-session', current: false, createdAt: '2026-10-16T08:00:00Z', lastSeenAt: '2026-10-16T08:00:00Z' }]);
  mocks.representatives.mockResolvedValue([]);
  mocks.courses.mockResolvedValue([]);
  mocks.projectsPage.mockResolvedValue(page([project]));
  mocks.projectSource.mockResolvedValue({ title: 'Source project', description: 'Source description', runId: null, sourceSubmissionId: 99, links: [], fileIds: [], coverFileId: null, version: 0 });
  mocks.saveProject.mockResolvedValue(project);
  mocks.share.mockResolvedValue({});
  mocks.filePolicy.mockResolvedValue({ maxFileMiB: 10, studentQuotaGiB: 5 });
  mocks.paymentsPage.mockResolvedValue({ ...page([{ id: 88, amountUzs: 500000, status: 'paid', method: 'card', type: 'monthly', period: null, paidAt: '2026-10-16T08:00:00Z', dueAt: null, paidUntil: null }]), state: 'ready', summary: null });
  mocks.financeQuestionsPage.mockResolvedValue(page([]));
  mocks.financeQuestion.mockResolvedValue(question);
  mocks.askFinance.mockResolvedValue(question);
  mocks.replyFinance.mockResolvedValue(question);
  mocks.notifications.mockResolvedValue({ items: [], nextCursor: null, unreadCount: 0 });
  mocks.readNotification.mockResolvedValue({ success: true });
  mocks.readAll.mockResolvedValue({ success: true });
  mocks.preferences.mockResolvedValue(preferences);
  mocks.savePreferences.mockImplementation(async (values) => values);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it('keeps a project editor and its dirty close guard through a failed background list refresh', async () => {
  mount(<PortalPortfolio />);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('portalAddProject') }));
  const editor = screen.getByRole('dialog');
  const title = within(editor).getByLabelText(i18n.t('portalProjectTitle')) as HTMLInputElement;
  fireEvent.change(title, { target: { value: 'Unsubmitted title' } });
  mocks.projectsPage.mockRejectedValueOnce(serverError());
  await refetch(subjectKey('projects-list'));
  expect(screen.getByRole('dialog')).toBe(editor);
  expect(title.value).toBe('Unsubmitted title');
  await userEvent.click(within(editor).getByRole('button', { name: i18n.t('close') }));
  const confirmation = screen.getByRole('alertdialog');
  await userEvent.click(within(confirmation).getByRole('button', { name: i18n.t('portalCancel') }));
  expect(title.value).toBe('Unsubmitted title');
  await refetch(subjectKey('projects-list'));
  await userEvent.click(within(editor).getByRole('button', { name: i18n.t('portalSave') }));
  await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledWith(10, expect.objectContaining({ title: 'Unsubmitted title' }), undefined));
});

it('keeps publication choices in their Dialog when the portfolio list goes offline', async () => {
  mount(<PortalPortfolio />);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('portalOpen') }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t('portalShare') }));
  const sharing = screen.getByRole('dialog');
  const name = within(sharing).getByLabelText(i18n.t('portalDisplayName')) as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Public draft name' } });
  mocks.projectsPage.mockRejectedValueOnce(offline());
  await refetch(subjectKey('projects-list'));
  expect(screen.getByRole('dialog')).toBe(sharing);
  expect(name.value).toBe('Public draft name');
});

it('keeps a source-based project draft when the saved source fails to refresh', async () => {
  history.replaceState(null, '', '/student-module/portfolio?submission=99');
  mount(<PortalPortfolio />);
  const title = await screen.findByLabelText(i18n.t('portalProjectTitle')) as HTMLInputElement;
  fireEvent.change(title, { target: { value: 'Changed source title' } });
  mocks.projectSource.mockRejectedValueOnce(serverError());
  await refetch(subjectKey('project-source', 99));
  expect(screen.getByLabelText(i18n.t('portalProjectTitle'))).toBe(title);
  expect(title.value).toBe('Changed source title');
  await refetch(subjectKey('project-source', 99));
  expect(title.value).toBe('Changed source title');
});

it('keeps a payment question inside its nested Dialog through a failed history refresh', async () => {
  mount(<PortalPayments />);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('portalOpen') }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t('portalPaymentQuestion') }));
  const editor = screen.getByRole('dialog', { name: i18n.t('portalPaymentQuestion') });
  fireEvent.change(within(editor).getByLabelText(i18n.t('portalQuestionTitle')), { target: { value: 'Receipt' } });
  const body = within(editor).getByLabelText(i18n.t('portalQuestionText')) as HTMLTextAreaElement;
  fireEvent.change(body, { target: { value: 'Please send a receipt' } });
  mocks.paymentsPage.mockRejectedValueOnce(offline());
  await refetch(subjectKey('payments-history'));
  expect(screen.getByRole('dialog', { name: i18n.t('portalPaymentQuestion') })).toBe(editor);
  expect(body.value).toBe('Please send a receipt');
  await userEvent.click(within(editor).getByRole('button', { name: i18n.t('portalSend') }));
  await waitFor(() => expect(mocks.askFinance).toHaveBeenCalledWith(10, expect.objectContaining({ paymentId: 88, body: 'Please send a receipt' })));
});

it('removes the finance question editor immediately when the question list denies access', async () => {
  mount(<FinanceQuestions />);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('portalPaymentQuestion') }));
  const title = await screen.findByLabelText(i18n.t('portalQuestionTitle'));
  fireEvent.change(title, { target: { value: 'Private question' } });
  mocks.financeQuestionsPage.mockRejectedValueOnce(new PortalApiError(403, 'portalForbidden'));
  await refetch(subjectKey('finance-questions-list'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByLabelText(i18n.t('portalQuestionTitle'))).toBeNull();
  expect(mocks.askFinance).not.toHaveBeenCalled();
});

it('keeps a finance reply editable after a background conversation failure', async () => {
  history.replaceState(null, '', '/student-module/payments?question=5');
  mount(<FinanceQuestions />);
  const body = await screen.findByLabelText(i18n.t('portalComment')) as HTMLTextAreaElement;
  fireEvent.change(body, { target: { value: 'Unsent reply' } });
  mocks.financeQuestion.mockRejectedValueOnce(serverError());
  await refetch(subjectKey('finance-question', 5));
  expect(screen.getByLabelText(i18n.t('portalComment'))).toBe(body);
  expect(body.value).toBe('Unsent reply');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('portalSend') }));
  await waitFor(() => expect(mocks.replyFinance).toHaveBeenCalledWith(10, 5, expect.objectContaining({ body: 'Unsent reply' })));
});

it('preserves notification preferences through both list and preference background failures', async () => {
  mount(<PortalNotifications />);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('portalNotificationSettings') }));
  const weekly = await screen.findByRole('switch', { name: i18n.t('portalWeeklySummary') });
  await userEvent.click(weekly);
  mocks.notifications.mockRejectedValueOnce(offline());
  await refetch(['portal-account', 50, 'notifications']);
  expect(screen.getByRole('switch', { name: i18n.t('portalWeeklySummary') })).toBe(weekly);
  mocks.preferences.mockRejectedValueOnce(serverError());
  await refetch(['portal-account', 50, 'preferences']);
  expect(screen.getByRole('switch', { name: i18n.t('portalWeeklySummary') })).toBe(weekly);
  expect(weekly.getAttribute('aria-checked')).toBe('true');
  await refetch(['portal-account', 50, 'preferences']);
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t('portalSave') }));
  await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ weeklySummary: true })));
});

it.each([401, 403, 404])('removes a cached project editor immediately after access error %s', async (status) => {
  mount(<PortalPortfolio />);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('portalAddProject') }));
  fireEvent.change(screen.getByLabelText(i18n.t('portalProjectTitle')), { target: { value: 'Private draft' } });
  mocks.projectsPage.mockRejectedValueOnce(new PortalApiError(status, 'portalUnavailable'));
  await refetch(subjectKey('projects-list'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByLabelText(i18n.t('portalProjectTitle'))).toBeNull();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(mocks.saveProject).not.toHaveBeenCalled();
});

it('removes a cached preferences form after its access is revoked', async () => {
  mount(<PortalNotifications />);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('portalNotificationSettings') }));
  await userEvent.click(await screen.findByRole('switch', { name: i18n.t('portalWeeklySummary') }));
  mocks.preferences.mockRejectedValueOnce(new PortalApiError(403, 'portalUnavailable'));
  await refetch(['portal-account', 50, 'preferences']);
  expect(screen.queryByRole('switch', { name: i18n.t('portalWeeklySummary') })).toBeNull();
  expect(within(screen.getByRole('dialog')).queryByRole('button', { name: i18n.t('portalSave') })).toBeNull();
  expect(mocks.savePreferences).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function discardDialog(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('close') }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('portalLeave') }));
}

it('guards a pending unchanged source project and ignores its late close callback after a replacement opens', async () => {
  const pending = deferred<PortalProjectDto>();
  mocks.saveProject.mockReturnValueOnce(pending.promise);
  history.replaceState(null, '', '/student-module/portfolio?submission=99');
  mount(<PortalPortfolio />);
  await screen.findByLabelText(i18n.t('portalProjectTitle'));
  await userEvent.click(screen.getByRole('button', { name: i18n.t('portalSave') }));
  await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledOnce());
  await discardDialog(screen.getByRole('dialog'));
  await userEvent.click(screen.getByRole('button', { name: i18n.t('portalAddProject') }));
  const replacement = screen.getByRole('dialog');
  const title = await within(replacement).findByLabelText(i18n.t('portalProjectTitle')) as HTMLInputElement;
  fireEvent.change(title, { target: { value: 'Replacement project draft' } });
  await act(async () => pending.resolve(project));
  expect(screen.getByRole('dialog')).toBe(replacement);
  expect(title.value).toBe('Replacement project draft');
});

it('guards publishing an unchanged minor project while the request is pending', async () => {
  const pending = deferred<unknown>();
  mocks.share.mockReturnValueOnce(pending.promise);
  const minor = { ...session, subjects: [{ ...session.subjects[0], studentClassification: 'minor' as const }] };
  client.setQueryData(portalSessionKey, minor); mocks.session.mockResolvedValue(minor);
  mount(<PortalPortfolio />);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('portalOpen') }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t('portalShare') }));
  const sharing = screen.getByRole('dialog');
  await userEvent.click(within(sharing).getByRole('button', { name: i18n.t('portalSharePreview') }));
  await userEvent.click(within(sharing).getByRole('button', { name: i18n.t('portalPublish') }));
  await waitFor(() => expect(mocks.share).toHaveBeenCalledOnce());
  await userEvent.click(within(sharing).getByRole('button', { name: i18n.t('close') }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('portalCancel') }));
  expect(screen.getByRole('dialog')).toBe(sharing);
  await act(async () => pending.resolve({}));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('guards saving unchanged preferences and preserves a replacement draft after the old request completes', async () => {
  const pending = deferred<PortalNotificationPreferencesDto>();
  mocks.savePreferences.mockReturnValueOnce(pending.promise);
  mount(<PortalNotifications />);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('portalNotificationSettings') }));
  await screen.findByRole('switch', { name: i18n.t('portalWeeklySummary') });
  await userEvent.click(screen.getByRole('button', { name: i18n.t('portalSave') }));
  await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalledOnce());
  await discardDialog(screen.getByRole('dialog'));
  await userEvent.click(screen.getByRole('button', { name: i18n.t('portalNotificationSettings') }));
  const replacement = screen.getByRole('dialog');
  const weekly = await within(replacement).findByRole('switch', { name: i18n.t('portalWeeklySummary') });
  await userEvent.click(weekly);
  await act(async () => pending.resolve(preferences));
  expect(screen.getByRole('dialog')).toBe(replacement);
  expect(weekly.getAttribute('aria-checked')).toBe('true');
});

it('does not replace a new finance question with a late creation response from a discarded dialog', async () => {
  const pending = deferred<typeof question>();
  mocks.askFinance.mockReturnValueOnce(pending.promise);
  mount(<FinanceQuestions />);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('portalPaymentQuestion') }));
  const first = screen.getByRole('dialog');
  fireEvent.change(within(first).getByLabelText(i18n.t('portalQuestionTitle')), { target: { value: 'First question' } });
  fireEvent.change(within(first).getByLabelText(i18n.t('portalQuestionText')), { target: { value: 'First body' } });
  await userEvent.click(within(first).getByRole('button', { name: i18n.t('portalSend') }));
  await waitFor(() => expect(mocks.askFinance).toHaveBeenCalledOnce());
  await discardDialog(first);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('portalPaymentQuestion') }));
  const replacement = screen.getByRole('dialog');
  const title = within(replacement).getByLabelText(i18n.t('portalQuestionTitle')) as HTMLInputElement;
  fireEvent.change(title, { target: { value: 'Replacement question' } });
  await act(async () => pending.resolve(question));
  expect(screen.getByRole('dialog')).toBe(replacement);
  expect(title.value).toBe('Replacement question');
  expect(mocks.financeQuestion).not.toHaveBeenCalled();
});

it('does not refetch account-scoped sessions after the profile owning a pending revocation is unmounted', async () => {
  const pending = deferred<{ success: boolean }>();
  mocks.revokeSession.mockReturnValueOnce(pending.promise);
  const first = mount(<Dialog open><DialogContent><DialogTitle>{i18n.t('portalProfile')}</DialogTitle><PortalProfile embedded /></DialogContent></Dialog>);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('portalRevokeSession') }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('portalRevokeSession') }));
  await waitFor(() => expect(mocks.revokeSession).toHaveBeenCalledOnce());
  expect(mocks.sessions).toHaveBeenCalledOnce();
  first.unmount();
  client.setQueryData(portalSessionKey, { ...session, account: { ...session.account!, id: 99, fullName: 'Another account' } });
  await act(async () => pending.resolve({ success: true }));
  expect(mocks.sessions).toHaveBeenCalledOnce();
  expect(mocks.session).not.toHaveBeenCalled();
  expect(client.getQueryData<PortalSessionDto>(portalSessionKey)?.account?.id).toBe(99);
});

it.each([
  ['readNotification', 'portalMarkRead'],
  ['readAll', 'portalMarkAllRead'],
] as const)('does not refetch account-scoped notices after an unmounted %s completes', async (operation, label) => {
  const pending = deferred<{ success: boolean }>();
  mocks[operation].mockReturnValueOnce(pending.promise);
  mocks.notifications.mockResolvedValue({ items: [{ id: 1, linkId: 10, category: 'learning', code: 'portalNoticeAssignmentPublished', params: { title: 'Practice' }, href: '/learn/assignments/9', createdAt: '2026-10-16T08:00:00Z', readAt: null }], nextCursor: null, unreadCount: 1 });
  const first = mount(<PortalNotifications />);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t(label) }));
  await waitFor(() => expect(mocks[operation]).toHaveBeenCalledOnce());
  expect(mocks.notifications).toHaveBeenCalledOnce();
  first.unmount();
  client.setQueryData(portalSessionKey, { ...session, account: { ...session.account!, id: 99 } });
  await act(async () => pending.resolve({ success: true }));
  expect(mocks.notifications).toHaveBeenCalledOnce();
});

it('does not refresh another account when a notice read completes in the still-open sheet', async () => {
  const pending = deferred<{ success: boolean }>();
  mocks.readNotification.mockReturnValueOnce(pending.promise);
  mocks.notifications.mockResolvedValue({ items: [{ id: 1, linkId: 10, category: 'learning', code: 'portalNoticeAssignmentPublished', params: { title: 'Practice' }, href: '/learn/assignments/9', createdAt: '2026-10-16T08:00:00Z', readAt: null }], nextCursor: null, unreadCount: 1 });
  mount(<PortalNotifications embedded />);
  await userEvent.click(await screen.findByRole('button', { name: i18n.t('portalMarkRead') }));
  await waitFor(() => expect(mocks.readNotification).toHaveBeenCalledOnce());
  await act(async () => client.setQueryData(portalSessionKey, { ...session, account: { ...session.account!, id: 99 } }));
  await waitFor(() => expect(mocks.notifications).toHaveBeenCalledTimes(2));
  await act(async () => pending.resolve({ success: true }));
  expect(mocks.notifications).toHaveBeenCalledTimes(2);
});

it.each([
  ['self', ['learning.read'], '/student-module/assignments/9?existing=1&linkId=10#answer'],
  ['representative', ['feedback.read'], '/parent-module/progress?linkId=10'],
  ['representative', ['finance.read'], null],
] as const)('opens a legacy assignment notice only in an allowed %s module', async (kind, permissions, expected) => {
  const current = {
    ...session,
    subjects: [{ ...session.subjects[0], kind, relationship: kind === 'representative' ? 'parent' as const : null, permissions: [...permissions] }],
  };
  const base = kind === 'self' ? '/student-module' : '/parent-module';
  history.replaceState(null, '', `${base}/notifications`);
  client.setQueryData(portalSessionKey, current); mocks.session.mockResolvedValue(current);
  mocks.notifications.mockResolvedValue({ items: [{ id: 1, linkId: 10, category: 'learning', code: 'portalNoticeAssignmentPublished', params: { title: 'Practice' }, href: '/learn/assignments/9?existing=1#answer', createdAt: '2026-10-16T08:00:00Z', readAt: null }], nextCursor: null, unreadCount: 1 });
  mount(<PortalNotifications />);
  await screen.findByText('New assignment: Practice');
  const open = screen.queryByRole('button', { name: i18n.t('portalOpen') });
  if (expected) {
    expect(open).toBeTruthy();
    fireEvent.click(open!);
    await waitFor(() => expect(location.pathname + location.search + location.hash).toBe(expected));
  } else {
    expect(open).toBeNull();
    expect(screen.getByRole('button', { name: i18n.t('portalMarkRead') })).toBeTruthy();
    expect(location.pathname).toBe(`${base}/notifications`);
  }
});

it.each([
  ['/student-module/assignments/9?linkId=10', 10],
  ['/parent-module/progress?linkId=10', 999],
] as const)('does not offer a notice with a mismatched module or revoked target: %s', async (href, linkId) => {
  const current: PortalSessionDto = {
    ...session,
    subjects: [{ ...session.subjects[0], kind: 'representative', relationship: 'parent', permissions: ['feedback.read'] }],
  };
  history.replaceState(null, '', '/parent-module/notifications');
  client.setQueryData(portalSessionKey, current); mocks.session.mockResolvedValue(current);
  mocks.notifications.mockResolvedValue({ items: [{ id: 1, linkId, category: 'learning', code: 'portalNoticeAssignmentPublished', params: { title: 'Practice' }, href, createdAt: '2026-10-16T08:00:00Z', readAt: null }], nextCursor: null, unreadCount: 1 });
  mount(<PortalNotifications />);
  await screen.findByText('New assignment: Practice');
  expect(screen.queryByRole('button', { name: i18n.t('portalOpen') })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: i18n.t('portalMarkRead') }));
  await waitFor(() => expect(mocks.readNotification).toHaveBeenCalledWith(1, expect.anything()));
  expect(location.pathname).toBe('/parent-module/notifications');
});
