// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n, translations } from '../client/src/lib/i18n';
const request = vi.hoisted(() => vi.fn());
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: request }));
import { SalesOverviewMetrics } from '../client/src/components/ux/SalesOverviewMetrics';
import { SalesOverviewEmployeeFilter } from '../client/src/components/ux/SalesOverviewEmployeeFilter';
import { SalesOverviewPeriodFilter } from '../client/src/components/ux/sales-overview/SalesOverviewPeriodFilter';
import { useSalesReportingRange } from '../client/src/features/sales/useSalesReportingRange';

const report = { asOf: '2026-09-08T10:00:00Z', daily: [
  { date: '2026-08-01', newLeads: 4, processedLeads: 4, reachedLeads: 3, qualifiedLeads: 2, demoBookings: 2, demoAttendees: 1, successfulStudents: 1 },
  { date: '2026-08-02', newLeads: 6, processedLeads: 5, reachedLeads: 4, qualifiedLeads: 3, demoBookings: 3, demoAttendees: 3, successfulStudents: 2 },
], newLeads: 10, processedLeads: 9, reachedLeads: 7, qualifiedLeads: 5, demoBookings: 5, demoAttendees: 4,
  successfulStudents: 3, closedLeads: 2, closedReasons: [{ reason: 'no_budget', count: 1 }, { reason: 'Moving away', count: 1 }],
  contactBreakdown: { firstAttempt: 2, secondAttempt: 2, thirdAttempt: 1, laterAttempt: 1, incomingFirst: 1,
    attemptedUnreached: 2, notAttempted: 1, reachedArchived: 1, reachedQualifiedInWork: 4, reachedUnqualifiedInWork: 2 },
};
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
  i18n.setLanguage('en');
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
    await screen.findByRole('button', { name: 'Meetings attended: 4' });
    expect(screen.getAllByRole('article')).toHaveLength(7);
    expect(screen.getAllByRole('slider')).toHaveLength(7);
    expect(screen.getByRole('img', { name: /Closed leads by reason/ })).toBeTruthy();
    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(within(screen.getByRole('article', { name: 'Reached leads' })).getByText('7')).toBeTruthy();
    const closed = within(screen.getByRole('region', { name: 'Closed leads by reason' }));
    expect(closed.getByText(translations.archiveReasonNoBudget.en)).toBeTruthy();
    expect(closed.getByText('Moving away')).toBeTruthy();
    expect(screen.queryByText(translations.revenue.en)).toBeNull();
    expect(request.mock.calls.every(([, url]) => url.includes('/sales/metrics'))).toBe(true);
  });
  it('exposes daily and cumulative values with keyboard navigation', async () => {
    mount(); await screen.findByRole('button', { name: 'Meetings attended: 4' });
    const calls = screen.getByRole('slider', { name: /Reached leads/ });
    fireEvent.focus(calls);
    fireEvent.keyDown(calls, { key: 'Home' });
    expect(calls.getAttribute('aria-valuetext')).toBe('Aug 1: 3');
    fireEvent.keyDown(calls, { key: 'ArrowRight' });
    expect(calls.getAttribute('aria-valuetext')).toBe('Aug 2: 4');
    const successes = screen.getByRole('slider', { name: /Successful/ });
    fireEvent.keyDown(successes, { key: 'End' });
    expect(successes.getAttribute('aria-valuetext')).toBe('Aug 2: 3');
  });
  it('shows first-contact buckets against new leads and outcomes against reached leads', async () => {
    mount(); await screen.findByRole('button', { name: 'Meetings attended: 4' });
    const contact = within(screen.getByRole('region', { name: 'First connected call' }));
    expect(contact.getByRole('row', { name: 'On the first attempt 2 20%' })).toBeTruthy();
    expect(contact.getByRole('row', { name: 'Called, no conversation yet 2 20%' })).toBeTruthy();
    expect(contact.getByRole('row', { name: 'No outgoing attempts 1 10%' })).toBeTruthy();
    const outcomes = within(contact.getByRole('region', { name: 'Current state of reached leads' }));
    expect(outcomes.getByText('57.1%')).toBeTruthy();
    expect(outcomes.getByText('Qualified, active')).toBeTruthy();
    expect(screen.getByText('70% of new leads')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Reporting period' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Meetings booked · By booking date' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Meetings attended · By demo date' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Successful · Cumulative by payment date' })).toBeTruthy();
  });
  it('updates arbitrary dates, manager, and funnel together', async () => {
    const user = userEvent.setup(); mount();
    await screen.findByRole('button', { name: 'Meetings attended: 4' });
    fireEvent.change(screen.getByLabelText(translations.salesReportCreatedFrom.en), { target: { value: '2026-08-15' } });
    fireEvent.change(screen.getByLabelText(translations.salesReportCreatedTo.en), { target: { value: '2026-09-02' } });
    await user.click(screen.getByRole('combobox', { name: translations.salesOverviewManager.en }));
    await user.click(screen.getByRole('option', { name: 'Bob' }));
    await user.click(screen.getByRole('button', { name: 'Funnel B' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('GET', '/api/academy/modules/sales/metrics?from=2026-08-15&to=2026-09-02&managerId=2&funnelId=2'));
  });
  it('keeps invalid period drafts out of requests', async () => {
    mount(); await screen.findByRole('button', { name: 'Meetings attended: 4' }); request.mockClear();
    fireEvent.change(screen.getByLabelText(translations.salesReportCreatedFrom.en), { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toBe(translations.salesPeriodInvalid.en);
    expect(request).not.toHaveBeenCalled();
  });
  it('does not show another filter’s values during loading or an error', async () => {
    const user = userEvent.setup(); mount(); await screen.findByRole('button', { name: 'Meetings attended: 4' });
    let reject!: (error: Error) => void;
    request.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await user.click(screen.getByRole('button', { name: 'Funnel B' }));
    expect(within(screen.getByRole('article', { name: 'Reached leads' })).queryByText('7')).toBeNull();
    await act(async () => reject(new Error('offline')));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
    request.mockResolvedValue(report); await user.click(screen.getByRole('button', { name: translations.retry.en }));
    expect(await screen.findByRole('button', { name: 'Meetings attended: 4' })).toBeTruthy();
  });
  it('opens attendees with the identical funnel, manager and period', async () => {
    const user = userEvent.setup(); mount(); await user.click(screen.getByRole('button', { name: 'Funnel B' }));
    await screen.findByRole('button', { name: 'Meetings attended: 4' });
    request.mockImplementation(async (_method, url: string) => url.includes('/demo-students') ? [] : report);
    await user.click(screen.getByRole('button', { name: 'Meetings attended: 4' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(request).toHaveBeenCalledWith('GET', '/api/academy/modules/sales/demo-students?from=2026-08-01&to=2026-08-31&managerId=1&funnelId=2'));
  });
});
