// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '../client/src/components/ux/UnsavedChangesGuard';
import { LeadDetailSheet } from '../client/src/components/ux/LeadDetailSheet';
import Admin from '../client/src/pages/admin';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
(Element.prototype as unknown as Record<string, unknown>).hasPointerCapture = () => false;
(Element.prototype as unknown as Record<string, unknown>).setPointerCapture = () => undefined;
(Element.prototype as unknown as Record<string, unknown>).releasePointerCapture = () => undefined;
(Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => undefined;

vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({
  useOnlinePbxCall: () => ({ startCall: vi.fn(), isPending: false, pendingPhone: null }),
}));

const adminUser = {
  id: 1,
  fullName: 'Администратор',
  email: 'admin@example.com',
  module: 'administration',
  role: 'admin',
  modules: ['administration'],
};

const employee = {
  id: 7,
  fullName: 'Продажник',
  email: 'sales@example.com',
  phone: '+998901234567',
  dateOfBirth: '1995-03-14T00:00:00.000Z',
  position: 'Менеджер',
  module: 'sales',
  modules: ['sales'],
  teacherSchoolIds: [],
  teacherAvailability: [],
  isActive: true,
};

vi.mock('../client/src/hooks/useAuth', () => ({
  useAuth: () => ({ user: adminUser, setUser: vi.fn(), isLoading: false, isAuthenticated: true }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: unknown }) => {
      const key = JSON.stringify(queryKey);
      if (key.includes('/api/users')) return { data: [employee], isLoading: false, isError: false };
      if (key.includes('schools')) return { data: [], isLoading: false, isError: false };
      return { data: [], isLoading: false, isError: false };
    },
  };
});

vi.mock('../client/src/lib/queryClient', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../client/src/lib/queryClient');
  return { ...actual, apiRequest: vi.fn(async () => ({ id: 7, email: 'sales@example.com' })) };
});

const makeLead = (id: number, contactName: string) => ({
  id,
  contactName,
  phone: `+9989012345${id}`,
  phoneNumbers: [`+9989012345${id}`],
  sourceId: 3,
  language: 'ru',
  statusCode: 'new',
  createdAt: '2026-01-01T00:00:00.000Z',
  expectedPaymentUzs: id * 100000,
  offerPriceUzs: id * 100000,
  students: [{ id: id * 10, studentName: `Ученик ${id}`, status: 'active', groups: [] }],
  payments: [],
  comments: [],
  tasks: [],
  contacts: [],
  tags: [],
  channels: [],
  history: [],
});

const leadsById: Record<number, ReturnType<typeof makeLead>> = {
  15: makeLead(15, 'Лид А'),
  16: makeLead(16, 'Лид Б'),
};

vi.mock('../client/src/features/leads/queries', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../client/src/features/leads/queries');
  return {
    ...actual,
    useLeadDetailsQuery: (leadId: number | null) => ({
      data: leadId ? leadsById[leadId] : undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

const warningShown = () => screen.queryByRole('alertdialog') !== null;
const newQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('useUnsavedChangesGuard', () => {
  function GuardHarness({ isDirty }: { isDirty: boolean }) {
    const [open, setOpen] = useState(true);
    const guard = useUnsavedChangesGuard({ open, isDirty, onOpenChange: setOpen });
    return (
      <div>
        <div data-testid="open">{String(open)}</div>
        <button type="button" onClick={() => guard.handleOpenChange(false)}>close</button>
        <UnsavedChangesDialog
          open={guard.confirmationOpen}
          onOpenChange={guard.setConfirmationOpen}
          onDiscard={guard.discardChanges}
        />
      </div>
    );
  }

  it('closes an untouched dialog without asking', () => {
    render(<GuardHarness isDirty={false} />);
    fireEvent.click(screen.getByText('close'));

    expect(warningShown()).toBe(false);
    expect(screen.getByTestId('open').textContent).toBe('false');
  });

  it('asks before dropping real edits, and closes on discard', async () => {
    render(<GuardHarness isDirty />);
    fireEvent.click(screen.getByText('close'));

    await waitFor(() => expect(warningShown()).toBe(true));
    expect(screen.getByTestId('open').textContent).toBe('true');

    const discard = screen.getAllByRole('button')
      .find((button) => /Выйти без сохранения|Discard changes/.test(button.textContent ?? ''));
    fireEvent.click(discard as HTMLElement);

    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
    expect(warningShown()).toBe(false);
  });
});

describe('lead sheet drafts do not leak between leads', () => {
  const renderSheet = (leadId: number, onOpenChange: () => void) => (
    <QueryClientProvider client={newQueryClient()}>
      <LeadDetailSheet
        leadId={leadId}
        open
        onOpenChange={onOpenChange}
        initialTab="deal"
        courses={[]}
        groups={[]}
        sources={[{ id: 3, name: 'Instagram', isActive: true }] as never}
        statuses={[{ code: 'new', name: 'Новый', color: '#000000' }] as never}
        managers={[]}
        currentUserId={1}
        leadStatusName={(code: string) => code}
        dateTime={(value: unknown) => String(value ?? '')}
        money={(value: unknown) => String(value ?? '')}
        onChanged={vi.fn()}
      />
    </QueryClientProvider>
  );

  const paymentAmountInput = () => Array.from(document.querySelectorAll('input'))
    .find((input) => input.getAttribute('inputmode') === 'numeric') as HTMLInputElement;

  it('reseeds the payment form for the new lead and closes it without a warning', async () => {
    const onOpenChange = vi.fn();
    const view = render(renderSheet(15, onOpenChange));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    const paymentTab = Array.from(document.querySelectorAll('button'))
      .find((button) => /Платеж|Оплат|Payment/i.test(button.textContent ?? ''));
    fireEvent.click(paymentTab as HTMLElement);
    await waitFor(() => expect(paymentAmountInput()).toBeTruthy());

    fireEvent.change(paymentAmountInput(), { target: { value: '777777' } });
    await waitFor(() => expect(paymentAmountInput().value).toBe('777 777'));

    // The board swaps the sheet to another lead while it stays open.
    view.rerender(renderSheet(16, onOpenChange));
    await waitFor(() => expect(paymentAmountInput().value).not.toBe('777 777'));
    expect(paymentAmountInput().value).toBe('1 600 000');

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(warningShown()).toBe(false);
  });
});

describe('employee modal starts every session from a clean form', () => {
  it('opens a blank create form after an edit was saved', async () => {
    render(
      <Router hook={memoryLocation({ path: '/employees' }).hook}>
        <QueryClientProvider client={newQueryClient()}>
          <Admin mode="employees" />
        </QueryClientProvider>
      </Router>,
    );

    await waitFor(() => expect(screen.getAllByText('Продажник').length).toBeGreaterThan(0));
    const employeeRow = Array.from(document.querySelectorAll('tr, [data-row]'))
      .find((row) => row.textContent?.includes('Продажник') && row.querySelector('button'));
    const editButton = Array.from(employeeRow?.querySelectorAll('button') ?? [])
      .find((button) => !button.getAttribute('title'));
    fireEvent.click(editButton as HTMLElement);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    const fullName = () => document.querySelector('input[name="fullName"]') as HTMLInputElement;
    fireEvent.change(fullName(), { target: { value: 'Продажник Изменённый' } });
    fireEvent.click(document.querySelector('form button[type="submit"]') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const createButton = Array.from(document.querySelectorAll('button'))
      .find((button) => /Создать сотрудника|Create employee/i.test(button.textContent ?? ''));
    fireEvent.click(createButton as HTMLElement);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    expect(fullName().value).toBe('');

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(warningShown()).toBe(false);
  });
});
