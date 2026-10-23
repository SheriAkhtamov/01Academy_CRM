// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations, type TranslationKey } from '../client/src/lib/i18n';
const request = vi.hoisted(() => vi.fn());
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: request }));
vi.mock('../client/src/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: TranslationKey) => translations[key].en, language: 'en' }) }));
import { SalesOverviewMetrics } from '../client/src/components/ux/SalesOverviewMetrics';
import { SalesOverviewEmployeeFilter } from '../client/src/components/ux/SalesOverviewEmployeeFilter';
import { SalesOverviewPeriodFilter } from '../client/src/components/ux/sales-overview/SalesOverviewPeriodFilter';
import { useSalesReportingRange } from '../client/src/features/sales/useSalesReportingRange';

const report = { newLeads: 10, processedLeads: 8, reachedCalls: 12, qualifiedLeads: 6, demoBookings: 5, demoAttendees: 4,
  successfulStudents: 3, closedLeads: 2, closedReasons: [{ reason: 'no_budget', count: 1 }, { reason: 'Moving away', count: 1 }] };
let client: QueryClient;
function Harness() {
  const [range, setRange] = useSalesReportingRange();
  const [manager, setManager] = useState('1');
  const [funnel, setFunnel] = useState<number | null>(null);
  return <>
    <SalesOverviewPeriodFilter value={range} onChange={setRange} />
    <SalesOverviewEmployeeFilter value={manager} managers={[{ id: 1, fullName: 'Alice' }, { id: 2, fullName: 'Bob' }]} canViewAllManagers onChange={setManager} />
    <button onClick={() => setFunnel(2)}>Funnel B</button>
    <SalesOverviewMetrics reportingRange={range} managerId={manager === 'all' ? null : Number(manager)} funnelId={funnel} />
  </>;
}
const mount = () => render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-08T10:00:00Z'));
  localStorage.clear();
  localStorage.setItem('academy-ui:sales-overview-month', JSON.stringify('2026-08'));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  request.mockReset().mockResolvedValue(report);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); client.clear(); localStorage.clear(); vi.useRealTimers(); });

describe('factual sales report', () => {
  it('shows exactly seven requested metrics and a separate reasons table', async () => {
    mount();
    await screen.findByRole('button', { name: 'Meetings attended · students: 4' });
    expect(screen.getAllByRole('article')).toHaveLength(7);
    expect(within(screen.getByRole('article', { name: 'Connected calls' })).getByText('12')).toBeTruthy();
    const closed = within(screen.getByRole('region', { name: 'Closed leads by reason' }));
    expect(closed.getByText(translations.archiveReasonNoBudget.en)).toBeTruthy();
    expect(closed.getByText('Moving away')).toBeTruthy();
    expect(screen.queryByText(translations.revenue.en)).toBeNull();
    expect(request.mock.calls.every(([, url]) => url.includes('/sales/metrics'))).toBe(true);
  });
  it('updates arbitrary dates, manager, and funnel together', async () => {
    const user = userEvent.setup(); mount();
    await screen.findByRole('button', { name: 'Meetings attended · students: 4' });
    fireEvent.change(screen.getByLabelText(translations.dateFrom.en), { target: { value: '2026-08-15' } });
    fireEvent.change(screen.getByLabelText(translations.dateTo.en), { target: { value: '2026-09-02' } });
    await user.click(screen.getByRole('combobox', { name: translations.salesOverviewManager.en }));
    await user.click(screen.getByRole('option', { name: 'Bob' }));
    await user.click(screen.getByRole('button', { name: 'Funnel B' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('GET', '/api/academy/modules/sales/metrics?from=2026-08-15&to=2026-09-02&managerId=2&funnelId=2'));
  });
  it('keeps invalid period drafts out of requests', async () => {
    mount(); await screen.findByRole('button', { name: 'Meetings attended · students: 4' }); request.mockClear();
    fireEvent.change(screen.getByLabelText(translations.dateFrom.en), { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toBe(translations.salesPeriodInvalid.en);
    expect(request).not.toHaveBeenCalled();
  });
  it('does not show another filter’s values during loading or an error', async () => {
    const user = userEvent.setup(); mount(); await screen.findByRole('button', { name: 'Meetings attended · students: 4' });
    let reject!: (error: Error) => void;
    request.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await user.click(screen.getByRole('button', { name: 'Funnel B' }));
    expect(screen.queryByText('12')).toBeNull();
    await act(async () => reject(new Error('offline')));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
    request.mockResolvedValue(report); await user.click(screen.getByRole('button', { name: translations.retry.en }));
    expect(await screen.findByRole('button', { name: 'Meetings attended · students: 4' })).toBeTruthy();
  });
  it('opens attendees with the identical funnel, manager and period', async () => {
    const user = userEvent.setup(); mount(); await user.click(screen.getByRole('button', { name: 'Funnel B' }));
    await screen.findByRole('button', { name: 'Meetings attended · students: 4' });
    request.mockImplementation(async (_method, url: string) => url.includes('/demo-students') ? [] : report);
    await user.click(screen.getByRole('button', { name: 'Meetings attended · students: 4' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(request).toHaveBeenCalledWith('GET', '/api/academy/modules/sales/demo-students?from=2026-08-01&to=2026-08-31&managerId=1&funnelId=2'));
  });
});
