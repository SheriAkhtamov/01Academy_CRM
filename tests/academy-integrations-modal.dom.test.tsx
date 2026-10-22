// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AcademyPage from '../client/src/pages/academy';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ api: vi.fn(), invalidate: vi.fn() }));
let client: QueryClient;
vi.mock('../client/src/lib/queryClient', () => ({
  apiRequest: mocks.api,
  queryClient: { invalidateQueries: mocks.invalidate, setQueryData: (key: unknown[], data: unknown) => client.setQueryData(key, data) },
}));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../client/src/features/voice-reminders/ui/VoiceRemindersDialog', () => ({ VoiceRemindersDialog: () => null }));
const routing = {
  primaryManagerId: 7, activePrimaryManagerId: 7, ringDelaySeconds: 10,
  managers: [{ id: 7, fullName: 'Routing manager' }],
  assignments: [{ managerId: 7, fullName: 'Routing manager', extension: '100', isOnline: true, isProviderEnabled: true, isRegistered: true, isTelephonyReady: true, isPrimary: true, isActivePrimary: true }],
  extensions: [{ extension: '100', name: 'Main', enabled: true, registered: true }],
  forwarding: { enabled: false, phone: '' },
};
beforeEach(() => {
  i18n.setLanguage('en'); mocks.api.mockReset(); mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.api.mockImplementation(async (_method: string, url: string) => url === '/api/academy/integrations/status'
    ? [{ provider: 'onlinepbx', mode: 'live', connected: true }] : routing);
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: 0, queryFn: ({ queryKey }) => mocks.api('GET', queryKey[0]),
  }, mutations: { retry: false } } });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); client.clear(); });
async function openRouting() {
  render(<QueryClientProvider client={client}><AcademyPage section="integrations" /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: i18n.t('integrationCallRouting') }));
  const dialog = screen.getByRole('dialog', { name: i18n.t('onlinePbxSettingsTitle') });
  const phone = await within(dialog).findByLabelText(i18n.t('onlinePbxForwardingPhone')) as HTMLInputElement;
  return { user, dialog, phone };
}

describe('compact OnlinePBX routing', () => {
  it('keeps a forwarding draft when folded or refreshed and asks before discarding it', async () => {
    const { user, dialog, phone } = await openRouting();
    fireEvent.change(phone, { target: { value: '+998901234567' } });
    const draftPhone = phone.value;
    await user.click(within(dialog).getByRole('button', { name: i18n.t('onlinePbxForwardingTitle') }));
    act(() => client.setQueryData(['/api/telephony/routing'], { ...routing, forwarding: { enabled: false, phone: '+998909999999' } }));
    await user.click(within(dialog).getByRole('button', { name: i18n.t('onlinePbxForwardingTitle') }));
    expect(phone.value).toBe(draftPhone);
    await user.click(within(dialog).getAllByRole('button', { name: i18n.t('close') })[0]);
    const confirmation = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('keepEditing') }));
    expect(phone.value).toBe(draftPhone);
    expect(mocks.api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it('blocks duplicate updates and dismissal while a routing save is pending', async () => {
    const { user, dialog, phone } = await openRouting();
    let finish!: (data: unknown) => void;
    mocks.api.mockImplementation((method: string) => method === 'PUT' ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(routing));
    fireEvent.change(phone, { target: { value: '+998901234567' } });
    const save = within(dialog).getByRole('button', { name: i18n.t('save') }) as HTMLButtonElement;
    await act(async () => { fireEvent.click(save); fireEvent.click(save); });
    await waitFor(() => expect(save.disabled).toBe(true));
    fireEvent.click(save);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: i18n.t('onlinePbxSettingsTitle') })).toBe(dialog);
    expect(mocks.api.mock.calls.filter(([method]) => method === 'PUT')).toHaveLength(1);
    await act(async () => finish({ ...routing, forwarding: { enabled: false, phone: '+998901234567' } }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
    expect(screen.getByRole('dialog', { name: i18n.t('onlinePbxSettingsTitle') })).toBe(dialog);
  });
  it.each([500, 403, 404])('handles a cached %s routing refresh without exposing a denied form', async status => {
    const { dialog, phone, user } = await openRouting();
    fireEvent.change(phone, { target: { value: '+998901234567' } });
    const draftPhone = phone.value;
    if (status !== 500) await user.click(within(dialog).getByRole('button', { name: i18n.t('onlinePbxRemoveManager') }));
    mocks.api.mockRejectedValue(Object.assign(new Error('Request rejected'), { status }));
    await act(async () => { await client.refetchQueries({ queryKey: ['/api/telephony/routing'], exact: true }); });
    if (status === 500) {
      expect(phone.isConnected).toBe(true);
      expect(phone.value).toBe(draftPhone);
      expect(screen.getByRole('dialog')).toBe(dialog);
    } else {
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByRole('alertdialog')).toBeNull();
      act(() => client.setQueryData(['/api/telephony/routing'], routing));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it.each([403, 404])('ignores a late routing save after cached access was rejected with %s', async status => {
    const { user, dialog, phone } = await openRouting();
    let finish!: (data: unknown) => void;
    mocks.api.mockImplementation((method: string) => method === 'PUT'
      ? new Promise(resolve => { finish = resolve; })
      : Promise.reject(Object.assign(new Error('Access revoked'), { status })));
    fireEvent.change(phone, { target: { value: '+998901234567' } });
    await user.click(within(dialog).getByRole('button', { name: i18n.t('save') }));
    await act(async () => { await client.refetchQueries({ queryKey: ['/api/telephony/routing'], exact: true }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => finish(routing));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it.each([403, 404])('closes routing after a %s save rejection', async status => {
    const { user, dialog, phone } = await openRouting();
    mocks.api.mockRejectedValue(Object.assign(new Error('Access revoked'), { status }));
    fireEvent.change(phone, { target: { value: '+998901234567' } });
    await user.click(within(dialog).getByRole('button', { name: i18n.t('save') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

});
