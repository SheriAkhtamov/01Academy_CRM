// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationSettingsDialog } from '../client/src/components/integrations/IntegrationSettingsDialog';
import type { IntegrationType } from '../client/src/features/integrations/api';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ api: vi.fn(), invalidate: vi.fn() }));
vi.mock('../client/src/lib/queryClient', () => ({
  apiRequest: mocks.api,
  queryClient: { invalidateQueries: mocks.invalidate },
}));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: vi.fn() }));
const metaSettings = {
  adAccountId: 'Ad account', datasetId: 'Dataset', pageId: 'Page', usdToUzsRate: 12500,
  marketingAccessTokenConfigured: true, capiAccessTokenConfigured: true,
  leadAccessTokenConfigured: true, webhookAppSecretConfigured: true,
  leadWebhookVerifyTokenConfigured: true,
};
let client: QueryClient;
const props = () => ({ onOpenChange: vi.fn(), onInstagramConnect: vi.fn() });
function mount(provider: IntegrationType, options = props(), siteDomain?: string) {
  const view = render(<QueryClientProvider client={client}><IntegrationSettingsDialog provider={provider} siteDomain={siteDomain} {...options} /></QueryClientProvider>);
  return { ...view, options };
}
beforeEach(() => {
  i18n.setLanguage('en');
  mocks.api.mockReset(); mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.api.mockImplementation(async (method: string) => method === 'GET' ? metaSettings : {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

describe('compact integration settings', () => {
  it('keeps an optional draft mounted when folded and preserves it during a settings refresh', async () => {
    mount('meta'); const user = userEvent.setup();
    await screen.findByLabelText(i18n.t('metaAdAccountId'));
    await user.click(screen.getByRole('button', { name: i18n.t('integrationAdditionalSection') }));
    const rate = screen.getByLabelText(i18n.t('integrationUsdRate')) as HTMLInputElement;
    fireEvent.change(rate, { target: { value: '13000' } });
    await user.click(screen.getByRole('button', { name: i18n.t('integrationAdditionalSection') }));
    act(() => client.setQueryData(['/api/academy/integrations/settings', 'meta'], { ...metaSettings, usdToUzsRate: 14000 }));
    await user.click(screen.getByRole('button', { name: i18n.t('integrationAdditionalSection') }));
    expect(screen.getByLabelText(i18n.t('integrationUsdRate'))).toBe(rate);
    expect(rate.value).toBe('13000');
    await user.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    const confirmation = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('keepEditing') }));
    expect(rate.value).toBe('13000');
  });

  it('reveals and focuses an invalid rate after its section was folded', async () => {
    mount('meta'); const user = userEvent.setup();
    await screen.findByLabelText(i18n.t('metaAdAccountId'));
    const toggle = screen.getByRole('button', { name: i18n.t('integrationAdditionalSection') });
    await user.click(toggle);
    const rate = screen.getByLabelText(i18n.t('integrationUsdRate')) as HTMLInputElement;
    fireEvent.change(rate, { target: { value: '-1' } });
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.invalid(rate);
    await waitFor(() => expect(document.activeElement).toBe(rate));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(mocks.api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it('freezes a submitted snapshot and blocks a second save and close while pending', async () => {
    let finish!: (result: unknown) => void;
    mocks.api.mockImplementation((method: string) => method === 'GET' ? Promise.resolve(metaSettings) : new Promise((resolve) => { finish = resolve; }));
    const { options } = mount('meta'); const user = userEvent.setup();
    const account = await screen.findByLabelText(i18n.t('metaAdAccountId'));
    fireEvent.change(account, { target: { value: 'Updated account' } });
    const save = screen.getByRole('button', { name: i18n.t('save') });
    await act(async () => {
      fireEvent.submit(save.closest('form')!);
      fireEvent.submit(save.closest('form')!);
    });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true));
    fireEvent.submit(save.closest('form')!);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(options.onOpenChange).not.toHaveBeenCalled();
    expect(mocks.api.mock.calls.filter(([method]) => method === 'PUT')).toHaveLength(1);
    expect(mocks.api.mock.calls.find(([method]) => method === 'PUT')?.[2].adAccountId).toBe('Updated account');
    await act(async () => finish({}));
    await waitFor(() => expect(options.onOpenChange).toHaveBeenCalledExactlyOnceWith(false));
  });

  it('does not close a newly opened provider when the previous provider save finishes', async () => {
    let finish!: (result: unknown) => void;
    mocks.api.mockImplementation((method: string, url: string) => method === 'GET'
      ? Promise.resolve(url.endsWith('/meta') ? metaSettings : { domain: 'pbx.test', authKeyConfigured: true, webhookSecretConfigured: true })
      : new Promise((resolve) => { finish = resolve; }));
    const options = props(); const view = mount('meta', options); const user = userEvent.setup();
    await screen.findByLabelText(i18n.t('metaAdAccountId'));
    await user.click(screen.getByRole('button', { name: i18n.t('save') }));
    view.rerender(<QueryClientProvider client={client}><IntegrationSettingsDialog provider="onlinepbx" {...options} /></QueryClientProvider>);
    const domain = await screen.findByLabelText(i18n.t('integrationPbxDomain')) as HTMLInputElement;
    fireEvent.change(domain, { target: { value: 'new-pbx.test' } });
    await act(async () => finish({}));
    expect(options.onOpenChange).not.toHaveBeenCalled();
    expect(domain.value).toBe('new-pbx.test');
    expect(screen.getByRole('dialog', { name: i18n.t('onlinePbxIntegration') })).toBeTruthy();
  });

  it('requires token replacement confirmation and keeps it pending until the request settles', async () => {
    let finish!: (result: unknown) => void;
    mocks.api.mockImplementation((method: string) => method === 'GET'
      ? Promise.resolve({ tokenConfiguredDomains: ['academy.test'] })
      : new Promise((resolve) => { finish = resolve; }));
    mount('website', props(), 'academy.test'); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: i18n.t('integrationWebsiteRotateToken') }));
    expect(mocks.api.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(0);
    const confirmation = screen.getByRole('alertdialog', { name: i18n.t('integrationWebsiteRotateTitle') });
    const rotate = within(confirmation).getByRole('button', { name: i18n.t('integrationWebsiteRotateToken') });
    await act(async () => { fireEvent.click(rotate); fireEvent.click(rotate); });
    await waitFor(() => expect((within(confirmation).getByRole('button', { name: i18n.t('cancel') }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole('alertdialog')).toBe(confirmation);
    await act(async () => finish({ domain: 'academy.test', token: 'new-public-token' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((screen.getByLabelText(i18n.t('integrationWebsiteToken'), { selector: 'input' }) as HTMLInputElement).value).toBe('new-public-token');
    expect(mocks.api.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
  });
  it.each([500, 403, 404])('handles a cached %s settings refresh without restoring a denied draft', async status => {
    const { options } = mount('meta');
    const account = await screen.findByLabelText(i18n.t('metaAdAccountId')) as HTMLInputElement;
    fireEvent.change(account, { target: { value: 'Protected draft' } });
    mocks.api.mockRejectedValue(Object.assign(new Error('Request rejected'), { status }));
    await act(async () => { await client.refetchQueries({ queryKey: ['/api/academy/integrations/settings', 'meta'], exact: true }); });
    if (status === 500) {
      expect(account.isConnected).toBe(true);
      expect(account.value).toBe('Protected draft');
      expect(options.onOpenChange).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(options.onOpenChange).toHaveBeenCalledWith(false);
      act(() => client.setQueryData(['/api/academy/integrations/settings', 'meta'], metaSettings));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.body.textContent).not.toContain('Protected draft');
    }
  });

  it.each([403, 404])('removes an issued token and its confirmation on %s and ignores a late token response', async status => {
    let finish!: (result: unknown) => void;
    mocks.api.mockImplementation((method: string) => method === 'GET'
      ? Promise.resolve({ tokenConfiguredDomains: [] })
      : Promise.resolve({ domain: 'academy.test', token: 'issued-before-denial' }));
    mount('website', props(), 'academy.test'); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: i18n.t('integrationWebsiteCreateToken') }));
    await screen.findByDisplayValue('issued-before-denial');
    await user.click(screen.getByRole('button', { name: i18n.t('integrationWebsiteRotateToken') }));
    mocks.api.mockImplementation((method: string) => method === 'GET'
      ? Promise.reject(Object.assign(new Error('Access revoked'), { status }))
      : new Promise(resolve => { finish = resolve; }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('integrationWebsiteRotateToken') }));
    await act(async () => { await client.refetchQueries({ queryKey: ['/api/academy/integrations/settings', 'website'], exact: true }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await act(async () => finish({ domain: 'academy.test', token: 'late-token-after-denial' }));
    expect(screen.queryByDisplayValue('issued-before-denial')).toBeNull();
    expect(screen.queryByDisplayValue('late-token-after-denial')).toBeNull();
  });

  it.each([403, 404])('closes a cached form when its save rejects with %s', async status => {
    mount('meta'); const user = userEvent.setup();
    await screen.findByLabelText(i18n.t('metaAdAccountId'));
    mocks.api.mockRejectedValue(Object.assign(new Error('Access revoked'), { status }));
    await user.click(screen.getByRole('button', { name: i18n.t('save') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

});
