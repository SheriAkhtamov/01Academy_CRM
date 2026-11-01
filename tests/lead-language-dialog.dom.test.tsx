// @vitest-environment jsdom
import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadLanguageDialog } from '../client/src/features/leads/ui/LeadLanguageDialog';
import { i18n } from '../client/src/lib/i18n';

const lead = { id: 15, updatedAt: '2026-11-01T08:00:00.000Z' };
const savedLead = { ...lead, language: 'uz', languages: ['uz'], updatedAt: '2026-11-01T08:01:00.000Z' };
let client: QueryClient;

beforeEach(() => {
  i18n.setLanguage('ru');
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

function renderDialog() {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const onConflict = vi.fn();
  const view = render(<StrictMode><QueryClientProvider client={client}>
    <LeadLanguageDialog lead={lead} initialLanguages={[]} expectedUpdatedAt={lead.updatedAt}
      onSaved={onSaved} onClose={onClose} onConflict={onConflict} />
  </QueryClientProvider></StrictMode>);
  return { ...view, user: userEvent.setup(), onSaved, onClose, onConflict };
}

describe('requiring a lead communication language', () => {
  it('keeps the choice on a failed save and allows retrying', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ error: 'Failed to update lead' }, { status: 500 }))
      .mockResolvedValueOnce(Response.json(savedLead));
    const { user, onSaved, onClose } = renderDialog();
    await user.click(screen.getByRole('checkbox', { name: i18n.t('uzbekLang') }));
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('leadSaveFailed'));
    expect((screen.getByRole('checkbox', { name: i18n.t('uzbekLang') }) as HTMLInputElement).checked).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith(savedLead));
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
      languages: ['uz'], language: 'uz', expectedUpdatedAt: lead.updatedAt,
    });
  });

  it('prevents duplicate submissions and closing while saving', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(done => { resolve = done; }));
    const { user, onSaved, onClose } = renderDialog();
    await user.click(screen.getByRole('checkbox', { name: i18n.t('uzbekLang') }));
    const save = screen.getByRole('button', { name: i18n.t('saveChanges') });
    fireEvent.submit(save.closest('form')!);
    fireEvent.submit(save.closest('form')!);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: i18n.t('close') }));
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: i18n.t('uzbekLang') }).matches(':disabled')).toBe(true);
    await act(async () => resolve(Response.json(savedLead)));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reports a concurrent change and keeps the language selection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'leadChangedConcurrently' }, { status: 409 }));
    const { user, onSaved, onClose, onConflict } = renderDialog();
    await user.click(screen.getByRole('checkbox', { name: i18n.t('uzbekLang') }));
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('leadChangedConcurrently'));
    expect(onConflict).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('checkbox', { name: i18n.t('uzbekLang') }) as HTMLInputElement).checked).toBe(true);
  });

  it('does not apply a late result to a card that has been closed or replaced', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(done => { resolve = done; }));
    const { user, onSaved, onClose, unmount } = renderDialog();
    await user.click(screen.getByRole('checkbox', { name: i18n.t('uzbekLang') }));
    await user.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    unmount();
    await act(async () => resolve(Response.json(savedLead)));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
