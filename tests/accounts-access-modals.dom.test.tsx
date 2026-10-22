// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsModal from '../client/src/components/modals/SettingsModal';
import AddAccountModal from '../client/src/components/modals/AddAccountModal';
import { MotionProvider } from '../client/src/components/ux/motion';
import { i18n } from '../client/src/lib/i18n';
import { readMotionPreferences } from '../client/src/lib/motionPreferences';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  api: vi.fn(),
  setUser: vi.fn(),
  user: { id: 7, fullName: 'Staff Member', email: 'staff.member', position: 'Manager', phone: '', module: 'sales', modules: ['sales'] },
}));
vi.mock('../client/src/hooks/useAccounts', () => ({ useAccounts: () => ({ addAccount: mocks.add, isAdding: false }) }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, setUser: mocks.setUser }) }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api, localizeApiErrorMessage: (message: string) => message }));
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverStub;
const clients: QueryClient[] = [];
const mount = (content: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const wrap = (child: React.ReactNode) => <QueryClientProvider client={client}><MotionProvider>{child}</MotionProvider></QueryClientProvider>;
  return { ...render(wrap(content)), wrap };
};
const settingsField = (name: string) => document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
beforeEach(() => {
  vi.clearAllMocks();
  i18n.setLanguage('en');
  window.localStorage.clear();
  mocks.user = { id: 7, fullName: 'Staff Member', email: 'staff.member', position: 'Manager', phone: '', module: 'sales', modules: ['sales'] };
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe('compact account settings', () => {
  it('keeps a folded password draft and reveals the current password error before focusing it', async () => {
    mount(<SettingsModal open onOpenChange={vi.fn()} />);
    const section = screen.getByRole('button', { name: i18n.t('portalSecurityNotifications') });
    fireEvent.click(section);
    fireEvent.change(settingsField('newPassword'), { target: { value: 'NewSecurePassword123!' } });
    fireEvent.change(settingsField('confirmNewPassword'), { target: { value: 'NewSecurePassword123!' } });
    fireEvent.click(section);
    expect(section.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('saveChanges') }));
    await waitFor(() => expect(document.activeElement).toBe(settingsField('currentPassword')));
    expect(section.getAttribute('aria-expanded')).toBe('true');
    expect(settingsField('newPassword').value).toBe('NewSecurePassword123!');
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('blocks dismissal and repeated saves while pending, then preserves the draft after failure', async () => {
    const request = pending<unknown>();
    mocks.api.mockReturnValue(request.promise);
    const onOpenChange = vi.fn();
    mount(<SettingsModal open onOpenChange={onOpenChange} />);
    fireEvent.change(settingsField('fullName'), { target: { value: 'Unsaved Member' } });
    const form = settingsField('fullName').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => request.reject(new Error('Save failed')));
    expect(settingsField('fullName').value).toBe('Unsaved Member');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('does not close a reopened settings session after an earlier save completes', async () => {
    const request = pending<unknown>();
    mocks.api.mockReturnValue(request.promise);
    const onOpenChange = vi.fn();
    const tree = (open: boolean) => <SettingsModal open={open} onOpenChange={onOpenChange} />;
    const view = mount(tree(true));
    fireEvent.change(settingsField('fullName'), { target: { value: 'Submitted Member' } });
    fireEvent.submit(settingsField('fullName').closest('form')!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    view.rerender(view.wrap(tree(false)));
    view.rerender(view.wrap(tree(true)));
    fireEvent.change(settingsField('fullName'), { target: { value: 'New session draft' } });
    await act(async () => request.resolve({ user: { ...mocks.user, fullName: 'Submitted Member' } }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.setUser).not.toHaveBeenCalled();
    expect(settingsField('fullName').value).toBe('New session draft');
  });

  it('requires a separate confirmation before restoring animation defaults', async () => {
    mount(<SettingsModal open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('interfaceAnimations') }));
    fireEvent.click(document.getElementById('motion-decorative')!);
    expect(readMotionPreferences().decorative).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('motionResetDefaults') }));
    expect(readMotionPreferences().decorative).toBe(false);
    let confirmation = screen.getByRole('alertdialog', { name: i18n.t('motionResetConfirmTitle') });
    fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('cancel') }));
    expect(readMotionPreferences().decorative).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('motionResetDefaults') }));
    confirmation = screen.getByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: i18n.t('motionResetDefaults') }));
    await waitFor(() => expect(readMotionPreferences().decorative).toBe(true));
  });
});

describe('adding a saved account', () => {
  const fill = () => {
    fireEvent.change(screen.getByRole('textbox', { name: i18n.t('loginOrEmailLabel') }), { target: { value: 'second.account' } });
    fireEvent.change(screen.getByLabelText(i18n.t('password')), { target: { value: 'Password123!' } });
  };

  it('keeps credentials after a cancelled discard and clears them only after a confirmed close', async () => {
    const onOpenChange = vi.fn();
    mount(<AddAccountModal open onOpenChange={onOpenChange} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('keepEditing') }));
    expect((screen.getByLabelText(i18n.t('password')) as HTMLInputElement).value).toBe('Password123!');
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('discardChanges') }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect((screen.getByRole('textbox', { name: i18n.t('loginOrEmailLabel') }) as HTMLInputElement).value).toBe('');
  });

  it('blocks Escape and duplicate submissions while account sign-in is pending', async () => {
    const request = pending<void>();
    mocks.add.mockReturnValue(request.promise);
    const onOpenChange = vi.fn();
    mount(<AddAccountModal open onOpenChange={onOpenChange} />);
    fill();
    const form = screen.getByRole('textbox', { name: i18n.t('loginOrEmailLabel') }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => request.reject(new Error('Sign-in failed')));
    expect(screen.getByRole('alert').textContent).toBe('Sign-in failed');
    expect((screen.getByLabelText(i18n.t('password')) as HTMLInputElement).value).toBe('Password123!');
  });

  it('ignores the result of a previous open session when the account dialog is reopened', async () => {
    const request = pending<void>();
    mocks.add.mockReturnValue(request.promise);
    const onOpenChange = vi.fn();
    const tree = (open: boolean) => <AddAccountModal open={open} onOpenChange={onOpenChange} />;
    const view = mount(tree(true));
    fill();
    fireEvent.submit(screen.getByRole('textbox', { name: i18n.t('loginOrEmailLabel') }).closest('form')!);
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
    view.rerender(view.wrap(tree(false)));
    view.rerender(view.wrap(tree(true)));
    fireEvent.change(screen.getByRole('textbox', { name: i18n.t('loginOrEmailLabel') }), { target: { value: 'new.session' } });
    await act(async () => request.resolve());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: i18n.t('loginOrEmailLabel') }) as HTMLInputElement).value).toBe('new.session');
  });
});
