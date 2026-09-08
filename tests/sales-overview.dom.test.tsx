// @vitest-environment jsdom
import React, { useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultKpiConfig, type KpiOverviewEmployee, type KpiSaleFact } from '../shared/sales-kpi';
import { translations, type TranslationKey } from '../client/src/lib/i18n';
const request = vi.hoisted(() => vi.fn());
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: request }));
vi.mock('../client/src/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: TranslationKey) => translations[key].en, language: 'en' }) }));
vi.mock('../client/src/components/ux/sales-overview/SalesOverviewTrends', () => ({ SalesOverviewTrends: () => null }));
vi.mock('../client/src/components/ux/sales-overview/SalesOverviewFunnel', () => ({ SalesOverviewFunnel: () => null }));
vi.mock('../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { KpiSaleReviewDialog } from '../client/src/features/sales-kpi/ui/KpiSaleReviewDialog';
import { SalesOverviewMetrics } from '../client/src/components/ux/SalesOverviewMetrics';
import { SalesOverviewEmployeeFilter } from '../client/src/components/ux/SalesOverviewEmployeeFilter';
import { SalesOverviewMonthFilter, salesMonthRange } from '../client/src/components/ux/sales-overview/SalesOverviewMonthFilter';

const baseMetrics = { newLeads: 10, processedLeads: 8, reachedLeads: 6, qualifiedLeads: 4, demoBookings: 2, repeatCallLeads: 3, targetRefusals: 0, targetRefusalReasons: [] };
const metrics = { ...baseMetrics, previous: baseMetrics, previousRange: { from: '2026-07-01', to: '2026-07-31' }, daily: [] };
const employee = (id = 1): KpiOverviewEmployee => ({
  id, name: id === 1 ? 'Alice' : 'Bob', role: 'hunter', assignedAt: '2026-08-01T00:00:00Z',
  version: { id: 1, role: 'hunter', config: defaultKpiConfig('hunter'), effectiveMonth: '2026-08', createdAt: '2026-08-01T00:00:00Z', createdBy: 1 },
  calculation: {
    totalUzs: id * 3000000, baseConditions: { volume: true, crm: null, timing: null },
    metrics: [
      { id: 'bookings', value: 20, target: 30, unit: 'count', details: [{ id: 1, entity: 'student', name: 'Trial student', date: '2026-08-12T10:00:00Z', success: true }] },
      { id: 'attendance', value: null, target: 60, unit: 'percent', numerator: 0, denominator: 0, details: [] },
      { id: 'response', value: 90, target: 90, unit: 'percent', numerator: 9, denominator: 10, details: [] },
      { id: 'crm', value: 100, target: 100, unit: 'percent', details: [] },
    ],
    payLines: [{ key: 'base', quantity: 1, rateUzs: id * 3000000, amountUzs: id * 3000000, status: 'earned' }],
    unclassifiedSales: [], reviewableSales: [],
  },
});
const payments = [
  { amountUzs: 100000, status: 'paid', paidAt: '2026-07-31T19:00:00Z' },
  { amountUzs: 50000, status: 'paid', paidAt: '2026-08-31T18:59:59Z' },
  { amountUzs: 90000, status: 'paid', paidAt: '2026-08-31T19:00:00Z' },
  { amountUzs: 80000, status: 'refunded', paidAt: '2026-08-10T00:00:00Z' },
];
const students = [
  { enrolledAt: '2026-07-31T19:00:00Z', createdAt: '2026-07-12T10:00:00Z' },
  { createdAt: '2026-08-31T18:59:59Z' },
  { enrolledAt: '2026-08-31T19:00:00Z' },
];
const clients: QueryClient[] = [];
function Harness() {
  const [month, setMonth] = useState('2026-08');
  const [manager, setManager] = useState('1');
  return <>
    <SalesOverviewMonthFilter month={month} onChange={setMonth} />
    <SalesOverviewEmployeeFilter value={manager} managers={[{ id: 1, fullName: 'Alice' }, { id: 2, fullName: 'Bob' }]} canViewAllManagers onChange={setManager} />
    <SalesOverviewMetrics key={`${month}-${manager}`} month={month} reportingRange={salesMonthRange(month, '2026-09-08')} managerId={manager === 'all' ? null : Number(manager)}
      stats={{ newLeadsPeriod: 10, conversionRate: 20, conversionRatePrevious: 10, activeLeads: 8, activeLeadsPrevious: 6, totalStudents: 2, totalStudentsPrevious: 1 }}
      payments={payments} students={students} funnel={[]} leadStatusName={(value) => value} statusColor={() => ''} money={(value) => String(value)} onNavigate={() => {}} onExpandPeriod={() => setMonth('2026-09')} />
  </>;
}
function mount(children: ReactNode = <Harness />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (_method, path: string) => path.includes('/sales/metrics') ? metrics : { month: '2026-08', asOf: '2026-09-08T00:00:00Z', employees: [employee()] });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.restoreAllMocks(); });

describe('unified sales overview', () => {
  it('uses the same calendar month and employee for results and compensation', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: translations.salesAllMetrics.en });
    expect(request).toHaveBeenCalledWith('GET', '/api/academy/modules/sales/metrics?from=2026-08-01&to=2026-08-31&managerId=1');
    expect(request).toHaveBeenCalledWith('GET', '/api/academy/sales-kpi/overview?month=2026-08&managerId=1');
    await user.click(screen.getByRole('button', { name: translations.previousMonth.en }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('GET', '/api/academy/sales-kpi/overview?month=2026-07&managerId=1'));
    expect(request).toHaveBeenCalledWith('GET', '/api/academy/modules/sales/metrics?from=2026-07-01&to=2026-07-31&managerId=1');
    expect(screen.getAllByLabelText(translations.calendarViewMonth.en)).toHaveLength(1);
  });

  it('does not retain another employee’s targets while their replacement is loading', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: translations.salesAllMetrics.en });
    expect(screen.getByRole('button', { name: `${translations.kpiDetailsTitle.en}: ${translations.kpiBookingsMetric.en}` })).toBeTruthy();
    let finish!: (value: unknown) => void;
    request.mockImplementation((_method, path: string) => path.includes('/sales/metrics') ? Promise.resolve(metrics) : new Promise((resolve) => { finish = resolve; }));
    await user.selectOptions(screen.getByRole('combobox', { name: translations.salesOverviewManager.en }), '2');
    expect(screen.queryByRole('button', { name: `${translations.kpiDetailsTitle.en}: ${translations.kpiBookingsMetric.en}` })).toBeNull();
    await act(async () => { finish({ month: '2026-08', asOf: '2026-09-08', employees: [employee(2)] }); });
    await screen.findByRole('button', { name: translations.salesAllMetrics.en });
    expect(request).toHaveBeenCalledWith('GET', '/api/academy/sales-kpi/overview?month=2026-08&managerId=2');
  });

  it('labels payments correctly and excludes refunds and the next Tashkent month', async () => {
    mount();
    await screen.findByRole('button', { name: translations.salesAllMetrics.en });
    expect(within(screen.getByRole('region', { name: translations.revenue.en })).getByText('150000')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: translations.openInStudents.en })).getByText('2')).toBeTruthy();
    expect(screen.queryByText(translations.paidCustomersForPeriod.en)).toBeNull();
  });

  it('lets keyboard users inspect actual daily revenue and enrolments inside the headline cards', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: translations.salesAllMetrics.en });
    const revenue = within(screen.getByRole('region', { name: translations.revenue.en })).getByRole('slider');
    act(() => revenue.focus());
    await user.keyboard('{Home}');
    expect(revenue.getAttribute('aria-valuetext')).toBe('Aug 1: 100000');
    await user.keyboard('{ArrowRight}');
    expect(revenue.getAttribute('aria-valuetext')).toBe('Aug 2: 0');
    await user.keyboard('{End}');
    expect(revenue.getAttribute('aria-valuetext')).toBe('Aug 31: 50000');
    const enrolled = within(screen.getByRole('region', { name: translations.adminNewStudents.en })).getByRole('slider');
    act(() => enrolled.focus());
    await user.keyboard('{Home}');
    expect(enrolled.getAttribute('aria-valuetext')).toBe('Aug 1: 1');
    await user.keyboard('{End}');
    expect(enrolled.getAttribute('aria-valuetext')).toBe('Aug 31: 1');
  });

  it('shows the measured percentage on a rate ring and target completion separately on a count chart', async () => {
    mount();
    await screen.findByRole('button', { name: translations.salesAllMetrics.en });
    const response = within(screen.getByRole('button', { name: `${translations.kpiDetailsTitle.en}: ${translations.kpiResponseMetric.en}` }));
    expect(response.getByRole('img').getAttribute('aria-label')).toContain('90%; Target: 90%');
    expect(response.getByText('90%')).toBeTruthy();
    const bookings = within(screen.getByRole('button', { name: `${translations.kpiDetailsTitle.en}: ${translations.kpiBookingsMetric.en}` }));
    expect(bookings.getByRole('img').getAttribute('aria-label')).toContain('20; Target: 30');
    expect(bookings.getByText('66.7% of target')).toBeTruthy();
  });

  it('keeps full results and underlying records in nested modals and restores page scrolling on close', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: translations.salesAllMetrics.en }));
    const details = screen.getByRole('dialog', { name: 'Employee results · Alice' });
    expect(document.body.style.overflow).toBe('hidden');
    const bookingsName = `${translations.kpiDetailsTitle.en}: ${translations.kpiBookingsMetric.en}`;
    await user.click(within(details).getByRole('button', { name: bookingsName }));
    const records = screen.getByRole('dialog', { name: translations.kpiBookingsMetric.en });
    expect(within(records).getByText('Trial student')).toBeTruthy();
    fireEvent(records, new Event('cancel', { bubbles: false, cancelable: true }));
    expect(screen.queryByRole('dialog', { name: translations.kpiBookingsMetric.en })).toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    await user.click(within(details).getByRole('button', { name: translations.close.en }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(screen.queryByText('3,000,000')).toBeNull();
  });

  it('shows an unmeasured attendance rate as pending rather than zero performance', async () => {
    mount();
    await screen.findByRole('button', { name: translations.salesAllMetrics.en });
    const attendance = screen.getByRole('button', { name: `${translations.kpiDetailsTitle.en}: ${translations.kpiAttendanceMetric.en}` });
    expect(within(attendance).getByText(translations.kpiNoData.en)).toBeTruthy();
    expect(within(attendance).queryByText(translations.kpiNotMet.en)).toBeNull();
    expect(within(attendance).queryByText('0%')).toBeNull();
  });

  it('does not display payroll amounts or setup instructions in the overview or its details', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: translations.salesAllMetrics.en });
    expect(screen.queryByText(/3,000,000|Salary|compensation|\bversion\b|\btracking\b/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: translations.salesAllMetrics.en }));
    expect(within(screen.getByRole('dialog')).queryByText(/3,000,000|Salary|compensation|\bversion\b|\btracking\b/i)).toBeNull();
  });

  it('omits unconfigured targets instead of displaying setup instructions', async () => {
    request.mockImplementation(async (_method, path: string) => path.includes('/sales/metrics') ? metrics : { month: '2026-08', asOf: '2026-09-08', employees: [] });
    mount();
    await waitFor(() => expect(screen.queryByRole('region', { name: translations.salesMonthPlan.en })).toBeNull());
    expect(screen.queryByText(/KPI system|administrator|assigned/i)).toBeNull();
    expect(screen.getByRole('region', { name: translations.revenue.en })).toBeTruthy();
  });

  const sale = (): KpiSaleFact => ({ id: 17, leadId: 2, studentId: 2, groupId: 1, name: 'Student', closerId: 1, paidAt: new Date().toISOString(), paidUntil: null, amountUzs: 100000, status: 'paid', kind: 'unclassified', cycleKey: null, referralInitiated: false });

  it('saves an explicitly classified payment with its learning period and audit reason', async () => {
    const user = userEvent.setup();
    mount(<KpiSaleReviewDialog sales={[sale()]} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: translations.edit.en }));
    const editor = screen.getByRole('dialog', { name: `${translations.kpiSalesReview.en} · Student` });
    await user.selectOptions(within(editor).getByRole('combobox', { name: translations.kpiSaleKind.en }), 'upsell');
    await user.type(within(editor).getByLabelText(translations.kpiCycleKey.en), '2026-09');
    await user.type(within(editor).getByLabelText(translations.kpiReviewReason.en), 'Additional course confirmed');
    await user.click(within(editor).getByRole('button', { name: translations.save.en }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('PATCH', '/api/academy/sales-kpi/payments/17', { kind: 'upsell', cycleKey: '2026-09', referralInitiated: false, reason: 'Additional course confirmed' }));
    expect(screen.queryByRole('dialog', { name: `${translations.kpiSalesReview.en} · Student` })).toBeNull();
  });

  it('requires confirmation to discard a payment draft and preserves it when editing continues', async () => {
    const user = userEvent.setup();
    mount(<KpiSaleReviewDialog sales={[sale()]} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: translations.edit.en }));
    const editor = screen.getByRole('dialog', { name: `${translations.kpiSalesReview.en} · Student` });
    const reason = within(editor).getByLabelText(translations.kpiReviewReason.en);
    await user.type(reason, 'Draft reason');
    await user.click(within(editor).getByRole('button', { name: translations.cancel.en }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: translations.keepEditing.en }));
    expect((reason as HTMLTextAreaElement).value).toBe('Draft reason');
    await user.click(within(editor).getByRole('button', { name: translations.cancel.en }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: translations.discardChanges.en }));
    expect(screen.queryByRole('dialog', { name: `${translations.kpiSalesReview.en} · Student` })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('uses a complete past month, leap day and the current month only up to today', () => {
    expect(salesMonthRange('2024-02', '2026-09-08')).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
    expect(salesMonthRange('2025-12', '2026-01-01')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    expect(salesMonthRange('2026-09', '2026-09-08')).toMatchObject({ from: '2026-09-01', to: '2026-09-08' });
  });
});
