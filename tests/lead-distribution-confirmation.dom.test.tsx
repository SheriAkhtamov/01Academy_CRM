// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadDistributionPanel } from '../client/src/features/lead-distribution/LeadDistributionPanel';
import { i18n } from '../client/src/lib/i18n';
import type { LeadDistributionSettings } from '../shared/contracts/lead-distribution';

const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast }));
let queryClient: QueryClient;
let settings: LeadDistributionSettings;
const mount = () => render(<QueryClientProvider client={queryClient}><LeadDistributionPanel /></QueryClientProvider>);
const writes = () => mocks.api.mock.calls.filter(([method]) => method === 'PATCH');

beforeEach(() => {
  i18n.setLanguage('ru');
  settings = {
    enabled: false, defaultFunnelId: 1, defaultFunnelName: 'Main',
    eligibleManagers: [{ id: 7, fullName: 'Manager' }], unassignedNewLeadCount: 123,
  };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.api.mockImplementation(async (method, _url, body) => method === 'PATCH'
    ? { ...settings, enabled: body.enabled, unassignedNewLeadCount: 0, distributedLeadCount: 123 }
    : settings);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe('automatic lead distribution confirmation', () => {
  it('enables distribution only through the confirmation button', async () => {
    const user = userEvent.setup();
    mount();
    const toggle = await screen.findByRole('switch');
    await user.click(toggle);
    const confirmation = screen.getByRole('alertdialog', { name: i18n.t('autoLeadDistributionEnableConfirmTitle') });
    expect(within(confirmation).getByText(i18n.t('autoLeadDistributionEnableConfirmDescription').replace('{count}', '123'))).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(writes()).toHaveLength(0);
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('autoLeadDistributionEnableAction') }));
    await waitFor(() => expect(writes()).toEqual([['PATCH', '/api/academy/sales-lead-distribution', { enabled: true }]]));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('leaves distribution off without a write when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('switch'));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('cancel') }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(writes()).toHaveLength(0);
  });

  it('also opens confirmation when the switch label is clicked', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('switch');
    await user.click(document.querySelector('label[for="auto-lead-distribution"]')!);
    expect(screen.getByRole('alertdialog', { name: i18n.t('autoLeadDistributionEnableConfirmTitle') })).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });
});
