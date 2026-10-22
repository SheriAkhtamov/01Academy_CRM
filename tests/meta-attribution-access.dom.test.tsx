// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaAttributionSection } from '../client/src/components/marketing/MetaAttributionSection';
import { metaMarketingQueryKeys, type MetaAttributionData, type MetaAttributionLeadsData } from '../client/src/features/marketing/meta-api';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: vi.fn() }));
const reportingQuery = 'from=2026-10-08&to=2026-10-08';
const data: MetaAttributionData = {
  summary: { creatives: 1, totalAds: 1, leads: 1, paid: 0, revenue: 0, spend: 100 },
  creatives: [{ attributionKey: 'ad:scoped', hookName: 'Scoped ad', adName: 'Scoped advert', campaignName: 'Scoped campaign', mediaType: 'image', leads: 1, paid: 0, revenue: 0, spend: 100, costPerLead: 100, paymentRate: 0 }],
  forms: [], spendCurrency: 'UZS', integration: { attributionConfigured: true },
};
const leads: MetaAttributionLeadsData = { leads: [{ attributionId: 1, id: 10, contactName: 'Scoped lead', statusCode: 'new', statusName: 'New', phone: '+998901234567' }] };
let client: QueryClient;
function mount() {
  return render(<QueryClientProvider client={client}><MetaAttributionSection reportingQuery={reportingQuery} /></QueryClientProvider>);
}
beforeEach(() => {
  i18n.setLanguage('en'); mocks.api.mockReset();
  mocks.api.mockImplementation(async (_method: string, url: string) => url.includes('/leads?') ? leads : data);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); client.clear(); });

describe('Meta attribution access changes', () => {
  it.each([500, 403, 404])('handles a cached %s attribution refresh while details are open', async status => {
    mount(); fireEvent.click(await screen.findByText('Scoped ad'));
    const dialog = screen.getByRole('dialog', { name: i18n.t('metaDetails') });
    mocks.api.mockRejectedValue(Object.assign(new Error('Request rejected'), { status }));
    await act(async () => { await client.refetchQueries({ queryKey: [...metaMarketingQueryKeys.attribution, reportingQuery], exact: true }); });
    if (status === 500) expect(screen.getByRole('dialog')).toBe(dialog);
    else {
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByText('Scoped ad')).toBeNull();
      act(() => client.setQueryData([...metaMarketingQueryKeys.attribution, reportingQuery], data));
      expect(screen.queryByText('Scoped ad')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it.each([500, 403, 404])('handles a cached %s nested leads refresh and requires a new authorized read before reopening', async status => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: `${i18n.t('metaViewAttributedLeads')}: 1` }));
    await screen.findByText('Scoped lead');
    const dialog = screen.getByRole('dialog', { name: i18n.t('metaAttributedLeads') });
    mocks.api.mockImplementation(async (_method: string, url: string) => {
      if (url.includes('/leads?')) throw Object.assign(new Error('Request rejected'), { status });
      return data;
    });
    const leadsKey = [...metaMarketingQueryKeys.attributionLeads, reportingQuery, 'ad:scoped'];
    await act(async () => { await client.refetchQueries({ queryKey: leadsKey, exact: true }); });
    if (status === 500) {
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(within(dialog).getByText('Scoped lead')).toBeTruthy();
    } else {
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const before = mocks.api.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: `${i18n.t('metaViewAttributedLeads')}: 1` }));
      await waitFor(() => expect(mocks.api.mock.calls.length).toBeGreaterThan(before));
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => client.setQueryData(leadsKey, { leads: [{ ...leads.leads[0], contactName: 'Late cached lead' }] }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByText('Late cached lead')).toBeNull();
      expect(screen.getByText('Scoped ad')).toBeTruthy();
    }
  });

  it.each([403, 404])('hides attribution after a %s catalogue synchronization rejection', async status => {
    mount(); await screen.findByText('Scoped ad');
    mocks.api.mockRejectedValue(Object.assign(new Error('Access revoked'), { status }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('metaRefreshCatalog') }));
    await waitFor(() => expect(screen.queryByText('Scoped ad')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps denied placeholder data hidden during a new reporting period until its read succeeds', async () => {
    const view = mount(); await screen.findByText('Scoped ad');
    mocks.api.mockRejectedValue(Object.assign(new Error('Access revoked'), { status: 403 }));
    await act(async () => { await client.refetchQueries({ queryKey: [...metaMarketingQueryKeys.attribution, reportingQuery], exact: true }); });
    let finish!: (result: MetaAttributionData) => void;
    mocks.api.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    view.rerender(<QueryClientProvider client={client}><MetaAttributionSection reportingQuery="from=2026-10-09&to=2026-10-09" /></QueryClientProvider>);
    expect(screen.queryByText('Scoped ad')).toBeNull();
    await waitFor(() => expect(typeof finish).toBe('function'));
    await act(async () => finish({ ...data, creatives: [{ ...data.creatives[0], hookName: 'New authorized ad' }] }));
    expect(await screen.findByText('New authorized ad')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores an older successful read after synchronization has confirmed access loss', async () => {
    mount(); await screen.findByText('Scoped ad');
    let finish!: (result: MetaAttributionData) => void;
    mocks.api.mockImplementation((method: string) => method === 'POST'
      ? Promise.reject(Object.assign(new Error('Access revoked'), { status: 403 }))
      : new Promise(resolve => { finish = resolve; }));
    let reading!: Promise<void>;
    act(() => { reading = client.refetchQueries({ queryKey: [...metaMarketingQueryKeys.attribution, reportingQuery], exact: true }); });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('metaRefreshCatalog') }));
    await waitFor(() => expect(screen.queryByText('Scoped ad')).toBeNull());
    await act(async () => { finish(data); await reading; });
    expect(screen.queryByText('Scoped ad')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
