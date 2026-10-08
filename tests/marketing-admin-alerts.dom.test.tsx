// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MarketingModule from '../client/src/pages/marketing-module';
import AdminDashboardPage from '../client/src/pages/admin/AdminDashboardPage';
import { i18n } from '../client/src/lib/i18n';
import { reportingRangeForPreset } from '../client/src/lib/reportingDateRange';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'administration', modules: ['administration'] } }) }));
const clients: QueryClient[] = [];
beforeEach(() => {
  i18n.setLanguage('en'); localStorage.clear(); mocks.api.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-08T08:00:00Z'));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function mount(component: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  return render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}

it.each(['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'previousMonth'] as const)('refreshes persisted relative marketing dates for %s before the first request', async (preset) => {
  history.replaceState(null, '', '/marketing-module/sources');
  localStorage.setItem('academy-ui:marketing-reporting-range', JSON.stringify(reportingRangeForPreset(preset, '2026-09-07')));
  mocks.api.mockResolvedValue({ sources: [], leads: [], analytics: { bySource: [], summary: {} } });
  mount(<MarketingModule section="sources" />);
  const current = reportingRangeForPreset(preset, '2026-10-08');
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('GET', `/api/academy/modules/marketing?from=${current.from}&to=${current.to}`));
  expect(mocks.api.mock.calls.every(([, url]) => String(url).includes(`from=${current.from}&to=${current.to}`))).toBe(true);
  expect((await screen.findByLabelText(i18n.t('dateFrom')) as HTMLInputElement).value).toBe(current.from);
  expect((await screen.findByLabelText(i18n.t('dateTo')) as HTMLInputElement).value).toBe(current.to);
});

it('preserves custom marketing dates across reloads', async () => {
  history.replaceState(null, '', '/marketing-module/sources');
  localStorage.setItem('academy-ui:marketing-reporting-range', JSON.stringify({ from: '2026-08-15', to: '2026-09-04', preset: 'custom' }));
  mocks.api.mockResolvedValue({ sources: [], leads: [], analytics: { bySource: [], summary: {} } });
  mount(<MarketingModule section="sources" />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('GET', '/api/academy/modules/marketing?from=2026-08-15&to=2026-09-04'));
  expect((await screen.findByLabelText(i18n.t('dateFrom')) as HTMLInputElement).value).toBe('2026-08-15');
  expect((await screen.findByLabelText(i18n.t('dateTo')) as HTMLInputElement).value).toBe('2026-09-04');
});

it('opens payment and attendance alert records in admin dialogs without requiring sales navigation', async () => {
  history.replaceState(null, '', '/admin');
  mocks.api.mockResolvedValue({
    summary: { activeStudents: 1, newLeadsMonth: 0, revenueMonth: 0, avgAttendance: 45, attendanceMarks: 2, activeGroups: 0, activeTeachers: 0, activeUsers: 1, totalUsers: 1, onlineUsers: 1, newStudentsMonth: 0, groupLoadPercent: 0, lessonsToday: 0, lessonsTomorrow: 0, revenueChangePercent: 0, leadsChangePercent: 0, studentsChangePercent: 0, overdueAmount: 500000 },
    trends: [], courseLoad: [], alerts: { overduePayments: 1, lowAttendanceStudents: 1, overdueTasks: 0, groupsWithoutTeacher: 0 }, escalatedTasks: [],
    alertDetails: { overduePayments: [{ id: 7, studentName: 'Payment Student', leadName: 'Payment Parent', dueAt: '2026-10-01T08:00:00Z', amountUzs: 500000 }], lowAttendanceStudents: [{ id: 8, studentName: 'Attendance Student', contactName: 'Attendance Parent', courseName: 'Robotics', managerName: 'Assigned Manager', attendancePercent: 45 }] },
  });
  mount(<AdminDashboardPage />); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('overduePayments')) }));
  const payments = screen.getByRole('dialog', { name: i18n.t('overduePayments') });
  expect(within(payments).getByText('Payment Student')).toBeTruthy(); expect(within(payments).getByText('Payment Parent')).toBeTruthy();
  expect(within(payments).getByText(`500,000${i18n.t('uzs')}`)).toBeTruthy(); expect(location.pathname).toBe('/admin');
  await user.click(within(payments).getByRole('button', { name: i18n.t('close') }));
  await user.click(screen.getByRole('button', { name: new RegExp(i18n.t('adminLowAttendance')) }));
  const attendance = screen.getByRole('dialog', { name: i18n.t('adminLowAttendance') });
  expect(within(attendance).getByText('Attendance Student')).toBeTruthy(); expect(within(attendance).getByText('Robotics')).toBeTruthy();
  expect(within(attendance).getByText('45%')).toBeTruthy(); expect(location.pathname).toBe('/admin');
  expect(mocks.api.mock.calls.every(([, url]) => String(url).startsWith('/api/academy/modules/administration?'))).toBe(true);
});
