// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AcademySettings from '../client/src/pages/academy-settings';
import { SalesFunnelsPanel } from '../client/src/features/sales-funnels/SalesFunnelsPanel';
import { i18n } from '../client/src/lib/i18n';
import { allowNavigation } from '../client/src/lib/navigationGuard';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'administration', modules: ['administration'] } }) }));

const school = { id: 1, name: 'Cyberpark', address: 'Tashkent', timezone: 'Asia/Tashkent', isActive: true };
const room = { id: 2, schoolId: 1, name: 'Room A', capacity: 12, isActive: true };
const statuses = [
  { id: 3, code: 'intake', funnelId: 7, name: 'Intake', color: '#2563eb', sortOrder: 0, isActive: true, isPipeline: true, isSystem: false },
  { id: 4, code: 'contacted', funnelId: 7, name: 'Contacted', color: '#16a34a', sortOrder: 10, isActive: true, isPipeline: true, isSystem: false },
];
const funnels = [
  { id: 7, name: 'Main funnel', initialStageCode: 'intake', isActive: true, isDefault: true, integrations: ['instagram'], leadCount: 2, employeeCount: 1, integrationCount: 1 },
  { id: 8, name: 'Second funnel', initialStageCode: 'intake_b', isActive: true, isDefault: false, integrations: [], leadCount: 0, employeeCount: 0, integrationCount: 0 },
];
const configuration = { schools: [school], rooms: [room], statuses, courses: [], teachers: [], groups: [] };
const clients: QueryClient[] = [];

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

function mountPage(tab: 'schools' | 'rooms' | 'pipeline' | 'funnels') {
  const sales = tab === 'pipeline' || tab === 'funnels';
  allowNavigation(() => history.replaceState(null, '', `/admin/${sales ? 'sales-settings' : 'academy-settings'}?tab=${tab}`));
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false,
    gcTime: 0,
    queryFn: async ({ queryKey }) => queryKey[0] === '/api/academy/configuration'
      ? configuration
      : queryKey[0] === '/api/academy/sales-funnels' ? funnels : [],
  } } });
  clients.push(client);
  render(<QueryClientProvider client={client}>
    {tab === 'funnels' ? <SalesFunnelsPanel /> : <AcademySettings mode={sales ? 'sales' : 'academy'} />}
  </QueryClientProvider>);
  return { client, user: userEvent.setup() };
}

async function openStageList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Main funnel/ }));
  return within(screen.getByRole('dialog', { name: 'Main funnel' }));
}

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); i18n.setLanguage('en');
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn();
  mocks.api.mockResolvedValue({});
});

afterEach(async () => {
  cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals();
  await new Promise(resolve => setTimeout(resolve, 0));
});

describe('academy resource editors', () => {
  it.each([
    ['schools', 'editSchool', 'schoolName', '/api/academy/schools/1'],
    ['rooms', 'editRoom', 'roomName', '/api/academy/rooms/2'],
    ['pipeline', 'editPipelineStage', 'name', '/api/academy/pipeline-statuses/4'],
  ] as const)('keeps %s drafts after canceling discard and blocks edits, close and duplicate saves while pending', async (tab, title, nameKey, endpoint) => {
    const request = deferred();
    mocks.api.mockImplementation((method, url) => method === 'PATCH' && url === endpoint ? request.promise : Promise.resolve({}));
    const { user } = mountPage(tab);
    if (tab === 'pipeline') {
      const list = await openStageList(user);
      const row = list.getByText('Contacted').closest('div.rounded-xl') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: i18n.t('edit') }));
    } else {
      await user.click(await screen.findByRole('button', { name: i18n.t('edit') }));
    }
    const editor = screen.getByRole('dialog', { name: i18n.t(title) });
    const name = within(editor).getByRole('textbox', { name: i18n.t(nameKey) }) as HTMLInputElement;
    await user.type(name, ' changed');
    const draftName = name.value;
    await user.click(within(editor).getByRole('button', { name: i18n.t('cancel') }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('keepEditing') }));
    expect(name.value).toBe(draftName);
    await user.click(within(editor).getByRole('button', { name: i18n.t('save') }));
    await waitFor(() => expect(name.disabled).toBe(true));
    expect((within(editor).getByRole('button', { name: i18n.t('cancel') }) as HTMLButtonElement).disabled).toBe(true);
    expect([...editor.querySelectorAll('input, button[role="switch"], button[role="combobox"]')].every(field => field.matches(':disabled'))).toBe(true);
    fireEvent.submit(name.closest('form')!);
    fireEvent.submit(name.closest('form')!);
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog', { name: i18n.t(title) })).toBe(editor);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.api.mock.calls.filter(([method]) => method === 'PATCH')).toHaveLength(1);
    request.reject(new Error('Save failed'));
    await waitFor(() => expect(name.disabled).toBe(false));
    expect(name.value).toBe(draftName);
  });

  it('focuses the visible required school name without folding away validation', async () => {
    const { user } = mountPage('schools');
    await user.click(await screen.findByRole('button', { name: i18n.t('addSchool') }));
    const editor = within(screen.getByRole('dialog', { name: i18n.t('addSchool') }));
    await user.click(editor.getByRole('button', { name: i18n.t('save') }));
    const name = editor.getByRole('textbox', { name: i18n.t('schoolName') });
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
    expect(document.activeElement).toBe(name);
    expect(name.closest('fieldset')?.hidden).toBe(false);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('focuses the missing school when a new room otherwise has valid required fields', async () => {
    const { user } = mountPage('rooms');
    await user.click(await screen.findByRole('button', { name: i18n.t('addRoom') }));
    const editor = within(screen.getByRole('dialog', { name: i18n.t('addRoom') }));
    await user.type(editor.getByRole('textbox', { name: i18n.t('roomName') }), 'New room');
    await user.click(editor.getByRole('button', { name: i18n.t('save') }));
    const schoolSelect = editor.getByRole('combobox', { name: i18n.t('school') });
    await waitFor(() => expect(schoolSelect.getAttribute('aria-invalid')).toBe('true'));
    expect(document.activeElement).toBe(schoolSelect);
    expect(schoolSelect.closest('fieldset')?.hidden).toBe(false);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('confirms stage transfer and deletion in an AlertDialog and keeps the target on a failed request', async () => {
    const request = deferred();
    mocks.api.mockImplementation((method) => method === 'GET' ? Promise.resolve({ leadCount: 2 }) : request.promise);
    const { user } = mountPage('pipeline');
    const list = await openStageList(user);
    const row = list.getByText('Contacted').closest('div.rounded-xl') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: i18n.t('delete') }));
    const confirmation = screen.getByRole('alertdialog', { name: i18n.t('pipelineStageDeleteTransferTitle') });
    const target = within(confirmation).getByRole('combobox', { name: i18n.t('transferLeadsToStage') }) as HTMLButtonElement;
    expect(target.textContent).toContain('Intake');
    expect(mocks.api.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(0);
    const confirm = within(confirmation).getByRole('button', { name: i18n.t('transferLeadsAndDeleteStage') });
    await user.click(confirm);
    await waitFor(() => expect(target.disabled).toBe(true));
    fireEvent.click(confirm);
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBe(confirmation);
    expect((within(confirmation).getByRole('button', { name: i18n.t('cancel') }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.api.mock.calls.filter(([method]) => method === 'POST')).toEqual([
      ['POST', '/api/academy/pipeline-statuses/4/transfer-leads-and-delete', { targetStatusId: 3 }],
    ]);
    request.reject(new Error('Transfer failed'));
    await waitFor(() => expect(target.disabled).toBe(false));
    expect(target.textContent).toContain('Intake');
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('cancel') }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps the current funnel open and locks stage actions while delete usage is being checked', async () => {
    const request = deferred();
    mocks.api.mockReturnValue(request.promise);
    const { user } = mountPage('pipeline');
    const list = await openStageList(user);
    const row = list.getByText('Contacted').closest('div.rounded-xl') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: i18n.t('delete') }));
    await waitFor(() => expect((list.getByRole('button', { name: i18n.t('addPipelineStage') }) as HTMLButtonElement).disabled).toBe(true));
    expect(list.getAllByRole('button', { name: i18n.t('edit') }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Main funnel' })).toBeTruthy();
    expect(mocks.api.mock.calls).toEqual([['GET', '/api/academy/pipeline-statuses/4/usage']]);
    request.resolve({ leadCount: 2 });
    const confirmation = within(await screen.findByRole('alertdialog', { name: i18n.t('pipelineStageDeleteTransferTitle') }));
    expect(confirmation.getByRole('combobox', { name: i18n.t('transferLeadsToStage') }).textContent).toContain('Intake');
  });

  it('keeps resource deletion confirmed and blocks repeated requests until the server responds', async () => {
    const request = deferred();
    mocks.api.mockReturnValue(request.promise);
    const { user } = mountPage('schools');
    await user.click(await screen.findByRole('button', { name: i18n.t('delete') }));
    const confirmation = screen.getByRole('alertdialog', { name: i18n.t('confirmDeleteResource') });
    const confirm = within(confirmation).getByRole('button', { name: i18n.t('delete') });
    expect(mocks.api).not.toHaveBeenCalled();
    await user.click(confirm);
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(confirm);
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBe(confirmation);
    expect(mocks.api.mock.calls).toEqual([['DELETE', '/api/academy/schools/1']]);
    request.reject(new Error('Delete failed'));
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('alertdialog')).toBe(confirmation);
  });
});

describe('sales funnel editor', () => {
  it.each(['name', 'isActive', 'isDefault', 'integrations'] as const)('protects a draft changed through %s and preserves it when discard is canceled', async field => {
    const { user } = mountPage('funnels');
    await user.click(await screen.findByRole('button', { name: i18n.t('addSalesFunnel') }));
    const editor = screen.getByRole('dialog', { name: i18n.t('addSalesFunnel') });
    const sources = within(editor).getByRole('button', { name: i18n.t('funnelIntegrations') });
    const source = editor.querySelector('#sales-funnel-source-instagram') as HTMLButtonElement;
    expect(source.closest('fieldset')?.hidden).toBe(true);
    if (field === 'name') await user.type(within(editor).getByRole('textbox', { name: i18n.t('salesFunnelName') }), 'New funnel');
    else if (field === 'isActive') await user.click(within(editor).getByRole('switch', { name: i18n.t('salesFunnelActive') }));
    else if (field === 'isDefault') {
      await user.click(within(editor).getByRole('switch', { name: i18n.t('salesFunnelDefault') }));
      const active = within(editor).getByRole('switch', { name: i18n.t('salesFunnelActive') }) as HTMLButtonElement;
      expect(active.getAttribute('aria-checked')).toBe('true');
      expect(active.disabled).toBe(true);
    }
    else {
      await user.click(sources);
      await user.click(source);
      await user.click(sources);
      expect(editor.querySelector('#sales-funnel-source-instagram')).toBe(source);
      expect(source.getAttribute('aria-checked')).toBe('true');
      expect(sources.textContent).toContain(i18n.t('instagramIntegration'));
    }
    await user.click(within(editor).getByRole('button', { name: i18n.t('cancel') }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('keepEditing') }));
    expect(screen.getByRole('dialog', { name: i18n.t('addSalesFunnel') })).toBe(editor);
    if (field === 'integrations') {
      await user.click(sources);
      expect(source.getAttribute('aria-checked')).toBe('true');
    }
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: i18n.t('discardChanges') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('keeps disclosure navigation available while saving, freezes the submitted draft and retries it once after failure', async () => {
    const request = deferred();
    mocks.api.mockReturnValueOnce(request.promise).mockResolvedValue({});
    const { user } = mountPage('funnels');
    await user.click(await screen.findByRole('button', { name: i18n.t('addSalesFunnel') }));
    const editor = screen.getByRole('dialog', { name: i18n.t('addSalesFunnel') });
    const name = within(editor).getByRole('textbox', { name: i18n.t('salesFunnelName') }) as HTMLInputElement;
    await user.type(name, 'New funnel');
    const sources = within(editor).getByRole('button', { name: i18n.t('funnelIntegrations') });
    await user.click(sources);
    await user.click(within(editor).getByRole('switch', { name: i18n.t('instagramIntegration') }));
    await user.click(sources);
    await user.click(within(editor).getByRole('button', { name: i18n.t('save') }));
    await waitFor(() => expect(name.disabled).toBe(true));
    await user.click(sources);
    expect(sources.getAttribute('aria-expanded')).toBe('true');
    expect((within(editor).getByRole('switch', { name: i18n.t('instagramIntegration') }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(name.closest('form')!);
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog', { name: i18n.t('addSalesFunnel') })).toBe(editor);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.api).toHaveBeenCalledOnce();
    request.reject(new Error('Save failed'));
    await waitFor(() => expect(name.disabled).toBe(false));
    expect(name.value).toBe('New funnel');
    expect(within(editor).getByRole('switch', { name: i18n.t('instagramIntegration') }).getAttribute('aria-checked')).toBe('true');
    await user.click(within(editor).getByRole('button', { name: i18n.t('save') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.api.mock.calls).toEqual([
      ['POST', '/api/academy/sales-funnels', { name: 'New funnel', isActive: true, isDefault: false, integrations: ['instagram'] }],
      ['POST', '/api/academy/sales-funnels', { name: 'New funnel', isActive: true, isDefault: false, integrations: ['instagram'] }],
    ]);
  });
});
