// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations, type TranslationKey } from '../client/src/lib/i18n';
const request = vi.hoisted(() => vi.fn());
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: request }));
vi.mock('../client/src/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: TranslationKey) => translations[key].en, language: 'en' }) }));
import { LeadQualificationAction } from '../client/src/features/leads/ui/LeadQualificationAction';
let client: QueryClient;
const noQualification = { funnelId: 1, qualifiedAt: null, qualifiedBy: null };
const qualified = { funnelId: 1, qualifiedAt: '2026-10-23T10:00:00.000Z', qualifiedBy: 7 };
function tree(id = 1) {
  return <QueryClientProvider client={client}><LeadQualificationAction key={id} leadId={id} funnelId={1} /></QueryClientProvider>;
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  request.mockReset().mockImplementation(async (method) => method === 'GET' ? noQualification : qualified);
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  const button = await screen.findByRole('button', { name: 'Qualify lead' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  await user.click(button);
  return within(screen.getByRole('dialog'));
};
const checkAll = async (user: ReturnType<typeof userEvent.setup>, dialog: ReturnType<typeof within>) => {
  for (const checkbox of dialog.getAllByRole('checkbox')) await user.click(checkbox);
};
describe('explicit lead qualification', () => {
  it('requires all three confirmations, saves once, and shows the qualified state', async () => {
    const user = userEvent.setup(); render(tree()); const dialog = await open(user);
    const save = dialog.getByRole('button', { name: 'Qualify lead' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(dialog.getByRole('checkbox', { name: 'Location fits' }));
    await user.click(dialog.getByRole('checkbox', { name: 'Age fits' }));
    expect(save.disabled).toBe(true);
    await user.click(dialog.getByRole('checkbox', { name: 'Budget fits' }));
    await user.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Qualified')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('POST', '/api/academy/leads/1/qualification', { funnelId: 1, locationFits: true, ageFits: true, budgetFits: true });
  });
  it('keeps the checklist when continuing after an attempted discard', async () => {
    const user = userEvent.setup(); render(tree()); const dialog = await open(user);
    await user.click(dialog.getByRole('checkbox', { name: 'Age fits' }));
    await user.click(dialog.getByRole('button', { name: translations.cancel.en }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: translations.keepEditing.en }));
    expect(dialog.getByRole('checkbox', { name: 'Age fits' }).getAttribute('aria-checked')).toBe('true');
    expect(request.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(0);
  });
  it('prevents duplicate submission and preserves checked criteria after a failed save', async () => {
    const user = userEvent.setup(); render(tree()); const dialog = await open(user); await checkAll(user, dialog);
    let fail!: (error: Error) => void;
    request.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const save = dialog.getByRole('button', { name: 'Qualify lead' });
    await user.dblClick(save);
    expect(request.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
    await user.keyboard('{Escape}'); expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => fail(new Error('offline')));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(dialog.getAllByRole('checkbox').every(item => item.getAttribute('aria-checked') === 'true')).toBe(true);
  });
  it('requires confirmation before revocation and sends the displayed qualification version', async () => {
    request.mockResolvedValue(qualified);
    const user = userEvent.setup(); render(tree());
    await user.click(await screen.findByRole('button', { name: 'Revoke qualification' }));
    expect(request.mock.calls.filter(([method]) => method === 'DELETE')).toHaveLength(0);
    request.mockResolvedValue(noQualification);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke qualification' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('DELETE', '/api/academy/leads/1/qualification', { funnelId: 1, qualifiedAt: qualified.qualifiedAt }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
  it('does not close a different lead’s dialog when an old save completes', async () => {
    const user = userEvent.setup(); const view = render(tree()); const dialog = await open(user); await checkAll(user, dialog);
    let finish!: (value: unknown) => void;
    request.mockImplementation((method) => method === 'POST' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(noQualification));
    await user.click(dialog.getByRole('button', { name: 'Qualify lead' }));
    view.rerender(tree(2)); const second = await open(user);
    await user.click(second.getByRole('checkbox', { name: 'Budget fits' }));
    await act(async () => finish(qualified));
    expect(second.getByRole('checkbox', { name: 'Budget fits' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
