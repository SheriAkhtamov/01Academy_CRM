// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../client/src/components/ConfirmDialog';
import { LeadDetailSheet } from '../client/src/components/ux/LeadDetailSheet';

vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({
  useOnlinePbxCall: () => ({ startCall: vi.fn(), isPending: false, pendingPhone: null }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const renderLeadSheet = (open: boolean) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LeadDetailSheet
        leadId={15}
        open={open}
        onOpenChange={vi.fn()}
        courses={[]}
        groups={[]}
        sources={[]}
        statuses={[]}
        managers={[]}
        currentUserId={1}
        leadStatusName={(code) => code}
        dateTime={(value) => String(value ?? '')}
        money={(value) => String(value ?? '')}
        onChanged={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
};

describe('lead modal behavior', () => {
  it('keeps lead details inside a Sheet and unmounts it when closed', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => undefined));
    const view = renderLeadSheet(true);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Loading|Загрузка/)).toBeTruthy();

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LeadDetailSheet
          leadId={15}
          open={false}
          onOpenChange={vi.fn()}
          courses={[]}
          groups={[]}
          sources={[]}
          statuses={[]}
          managers={[]}
          currentUserId={1}
          leadStatusName={(code) => code}
          dateTime={(value) => String(value ?? '')}
          money={(value) => String(value ?? '')}
          onChanged={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('requires an explicit destructive confirmation', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Delete lead"
        description="This action cannot be undone"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('preserves a dirty deal draft during a background refetch', async () => {
    const firstLead = {
      id: 15,
      contactName: 'Initial parent',
      statusCode: 'new_request',
      sourceId: 1,
      createdAt: '2026-08-01T08:00:00.000Z',
      updatedAt: '2026-08-01T08:00:00.000Z',
      phoneNumbers: [],
      students: [],
      payments: [],
    };
    const refreshedLead = {
      ...firstLead,
      contactName: 'Server parent',
      updatedAt: '2026-08-01T09:00:00.000Z',
    };
    let requestCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify(requestCount++ === 0 ? firstLead : refreshedLead),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    const { queryClient } = renderLeadSheet(true);
    const nameInput = await screen.findByLabelText(/Contact Person Name|Имя контактного лица/);
    fireEvent.change(nameInput, { target: { value: 'Local draft' } });

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['/api/academy/leads', 15] });
    });

    await waitFor(() => {
      expect(screen.getByText('Server parent')).toBeTruthy();
      expect((nameInput as HTMLInputElement).value).toBe('Local draft');
    });
  });

  it('asks to claim an unassigned lead and retries the payment with confirmation', async () => {
    const paymentBodies: Array<Record<string, unknown>> = [];
    let claimed = false;
    const lead = () => ({
      id: 15,
      contactName: 'Alexandra Zadorozhnaya',
      statusCode: 'paid',
      managerId: claimed ? 1 : null,
      managerName: claimed ? 'Sales Manager' : null,
      sourceId: 1,
      expectedPaymentUzs: 100_000,
      createdAt: '2026-08-01T08:00:00.000Z',
      updatedAt: '2026-08-01T08:00:00.000Z',
      phoneNumbers: [],
      students: [{
        id: 50,
        managerId: claimed ? 1 : null,
        studentName: 'Alexandra Zadorozhnaya',
        status: 'studying',
      }],
      payments: [],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        paymentBodies.push(body);
        claimed = true;
        return new Response(JSON.stringify({
          payment: { id: 99, leadId: 15, studentId: 50, amountUzs: 100_000, status: 'paid' },
          student: lead().students[0],
        }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(lead()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <LeadDetailSheet
          leadId={15}
          open
          initialTab="payment"
          onOpenChange={vi.fn()}
          courses={[]}
          groups={[]}
          sources={[{ id: 1, name: 'Website' }]}
          statuses={[]}
          managers={[{ id: 1, fullName: 'Sales Manager' }]}
          currentUserId={1}
          canClaimUnassignedLead
          leadStatusName={(code) => code}
          dateTime={(value) => String(value ?? '')}
          money={(value) => String(value ?? '')}
          onChanged={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await screen.findByRole('heading', { name: 'Alexandra Zadorozhnaya' });
    fireEvent.click(await screen.findByRole('button', {
      name: /Confirm Payment|Подтвердить оплату/,
    }));

    expect(await screen.findByText(/Assign the lead to continue|Присвойте лид, чтобы продолжить/)).toBeTruthy();
    expect(paymentBodies).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', {
      name: /Assign to me and continue|Присвоить себе и продолжить/,
    }));

    await waitFor(() => expect(paymentBodies).toHaveLength(1));
    expect(paymentBodies[0]).toEqual(expect.objectContaining({
      leadId: 15,
      studentId: 50,
      assignToSelf: true,
    }));
  });
});
