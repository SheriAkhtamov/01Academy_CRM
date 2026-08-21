// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsModal, { hasSettingsChanges } from '../client/src/components/modals/SettingsModal';
import { MotionProvider } from '../client/src/components/ux/motion';
import {
  DEFAULT_MOTION_PREFERENCES,
  readMotionPreferences,
} from '../client/src/lib/motionPreferences';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

const user = {
  id: 7,
  fullName: 'Продажник',
  email: 'sales@example.com',
  phone: '+998901234567',
  onlinePbxExtension: null,
  dateOfBirth: null,
  position: 'Менеджер',
  module: 'sales',
  hasReportAccess: null,
  isActive: true,
  isOnline: false,
  onlinePbxIncomingEnabled: false,
  lastSeenAt: null,
  createdAt: null,
  updatedAt: null,
  modules: ['sales'],
};

vi.mock('../client/src/hooks/useAuth', () => ({
  useAuth: () => ({ user, setUser: vi.fn(), isLoading: false, isAuthenticated: true }),
}));

afterEach(() => {
  window.localStorage.clear();
});

const openModal = () => {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MotionProvider>
        <SettingsModal open onOpenChange={onOpenChange} />
      </MotionProvider>
    </QueryClientProvider>,
  );
  return onOpenChange;
};

const field = (name: string) => document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const warningShown = () => screen.queryByRole('alertdialog') !== null;
const close = () => {
  const cancel = Array.from(document.querySelectorAll('button'))
    .find((button) => /Отмена|Cancel/i.test(button.textContent ?? ''));
  fireEvent.click(cancel as HTMLElement);
};

describe('account settings closes without a false unsaved warning', () => {
  it('treats an untouched form as unchanged', async () => {
    const onOpenChange = openModal();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    close();

    expect(warningShown()).toBe(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ignores a current password the browser filled in on its own', async () => {
    const onOpenChange = openModal();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    // What a password manager does the moment the dialog mounts.
    fireEvent.change(field('currentPassword'), { target: { value: 'saved-by-chrome' } });
    close();

    expect(warningShown()).toBe(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('still guards a profile edit the user actually made', async () => {
    openModal();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    fireEvent.change(field('fullName'), { target: { value: 'Другое имя' } });
    close();

    await waitFor(() => expect(warningShown()).toBe(true));
  });

  it('still guards a password the user is in the middle of changing', async () => {
    openModal();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    fireEvent.change(field('newPassword'), { target: { value: 'a-brand-new-password' } });
    close();

    await waitFor(() => expect(warningShown()).toBe(true));
  });
});

describe('hasSettingsChanges', () => {
  const baseline = {
    fullName: 'Продажник',
    email: 'sales@example.com',
    position: 'Менеджер',
    phone: '+998901234567',
    hasReportAccess: false,
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
  };

  it('ignores whitespace the user never typed', () => {
    expect(hasSettingsChanges({ ...baseline, fullName: '  Продажник  ' }, baseline)).toBe(false);
  });

  it('sees a login change, which is what makes the current password matter', () => {
    expect(hasSettingsChanges({ ...baseline, email: 'other@example.com' }, baseline)).toBe(true);
  });

  it('sees the reports toggle flip', () => {
    expect(hasSettingsChanges({ ...baseline, hasReportAccess: true }, baseline)).toBe(true);
  });
});

describe('animation switches live in the account settings modal', () => {
  const toggle = (id: string) => document.getElementById(id) as HTMLButtonElement;

  it('turns every animation off from the master switch and remembers it', async () => {
    openModal();
    await waitFor(() => expect(toggle('motion-enabled')).toBeTruthy());

    fireEvent.click(toggle('motion-enabled'));

    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('off'));
    expect(readMotionPreferences().enabled).toBe(false);
    // The per-feature switches stay untouched, so turning the master back on
    // restores whatever the user had picked rather than a blanket default.
    expect(readMotionPreferences().decorative).toBe(true);
    expect(toggle('motion-decorative').getAttribute('disabled')).not.toBeNull();
  });

  it('turns off one kind of animation on its own', async () => {
    openModal();
    await waitFor(() => expect(toggle('motion-decorative')).toBeTruthy());

    fireEvent.click(toggle('motion-decorative'));

    await waitFor(() => expect(document.documentElement.dataset.motionDecor).toBe('off'));
    expect(document.documentElement.dataset.motion).toBe('on');
    expect(readMotionPreferences()).toEqual({ ...DEFAULT_MOTION_PREFERENCES, decorative: false });
  });

  it('does not count an animation switch as an unsaved profile edit', async () => {
    const onOpenChange = openModal();
    await waitFor(() => expect(toggle('motion-enabled')).toBeTruthy());

    fireEvent.click(toggle('motion-enabled'));
    close();

    expect(warningShown()).toBe(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
