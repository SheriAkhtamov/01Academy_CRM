// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaEventsSection } from '../client/src/components/marketing/MetaEventsSection';
import { MetaIntegrationDialog } from '../client/src/components/marketing/MetaIntegrationDialog';
import type { MetaEventRow, MetaEventsData } from '../client/src/features/marketing/meta-api';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: vi.fn() }));
let client: QueryClient;
const event = (overrides: Partial<MetaEventRow> = {}): MetaEventRow => ({
  id: 42, leadId: 9, contactName: 'Real new lead', eventId: 'lead-intake:internal-42', eventName: 'Lead', crmStage: null,
  eventTime: '2026-10-08T08:00:00Z', status: 'pending', attemptCount: 0,
  errorMessage: 'Private service error', responsePayload: { internal_response: 'Secret payload' }, ...overrides,
});
function mount(row: MetaEventRow) {
  const payload: MetaEventsData = { summary: { total: 1, pending: row.status === 'pending' ? 1 : 0, sent: row.status === 'sent' ? 1 : 0, failed: row.status === 'failed' ? 1 : 0, deliveryRate: 0 }, events: [row], integration: { capiConfigured: true } };
  mocks.api.mockResolvedValue(payload);
  return render(<QueryClientProvider client={client}><MetaEventsSection reportingQuery="from=2026-10-08&to=2026-10-08" /></QueryClientProvider>);
}
beforeEach(() => {
  i18n.setLanguage('en'); mocks.api.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });

describe('Meta creation events', () => {
  it('shows a first lead creation with its delivery state without CRM stages or internal service values', async () => {
    mount(event());
    fireEvent.click(await screen.findByText('Real new lead'));
    const dialog = screen.getByRole('dialog', { name: i18n.t('metaEventDetails') });
    expect(within(dialog).getByText(i18n.t('newApplication'))).toBeTruthy();
    expect(within(dialog).getByText(i18n.t('metaEventStatusPending'))).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: i18n.t('retrySend') })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/lead-intake:internal-42|Private service error|Secret payload|internal_response/);
    expect(screen.queryByText('CRM stage')).toBeNull();
    expect(screen.queryByText('Attempts')).toBeNull();
  });

  it.each(['cancelled', 'sent', 'processing'] as const)('does not allow retrying %s events', async (status) => {
    mount(event({ status, crmStage: status === 'cancelled' ? 'deleted_legacy_stage' : null }));
    fireEvent.click(await screen.findByText('Real new lead'));
    const dialog = screen.getByRole('dialog');
    const label = status === 'cancelled' ? 'cancelled' : status === 'sent' ? 'messageDelivered' : 'metaEventStatusProcessing';
    expect(within(dialog).getByText(i18n.t(label))).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: i18n.t('retrySend') })).toBeNull();
    expect(document.body.textContent).not.toContain('deleted_legacy_stage');
    expect(mocks.api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it('does not retry an old stage event even if its saved state is failed', async () => {
    mount(event({ status: 'failed', crmStage: 'historical_payment_stage' }));
    fireEvent.click(await screen.findByText('Real new lead'));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: i18n.t('retrySend') })).toBeNull();
    expect(document.body.textContent).not.toContain('historical_payment_stage');
  });

  it.each(['pending', 'failed'] as const)('retries the %s creation event through the existing API and closes the dialog', async (status) => {
    mount(event({ status }));
    fireEvent.click(await screen.findByText('Real new lead'));
    expect(mocks.api).not.toHaveBeenCalledWith('POST', '/api/academy/modules/marketing/meta-events/42/retry');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t('retrySend') }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/academy/modules/marketing/meta-events/42/retry'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps integration status in a modal and omits former stage event configuration', () => {
    render(<MetaIntegrationDialog open onOpenChange={vi.fn()} integration={{ attributionConfigured: true, capiConfigured: true }} />);
    const dialog = screen.getByRole('dialog', { name: i18n.t('metaConnection') });
    expect(within(dialog).getAllByText(i18n.t('metaConfigured'))).toHaveLength(2);
    expect(within(dialog).queryByText('Events available in Ads Manager')).toBeNull();
  });
});
