// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useSalesPipelineBulkActions } from '../client/src/features/sales/useSalesPipelineBulkActions';
import { BulkLeadActionsDialog } from '../client/src/features/sales/ui/BulkLeadActionsDialog';
import { leadsApi } from '../client/src/features/leads/api';
import { i18n } from '../client/src/lib/i18n';

vi.mock('../client/src/features/sales/queries', () => ({ invalidateSalesLeadData: vi.fn() }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
});

const statuses = [{ code: 'paid', name: 'Paid' }];
const mixedLeads = [
  { id: 1, statusCode: 'new_request', managerId: 7 },
  { id: 2, statusCode: 'new_request', managerId: null },
];
const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

function BulkMoveHarness() {
  const bulk = useSalesPipelineBulkActions({ leads: mixedLeads, statuses });
  return <>
    <button onClick={() => {
      bulk.setSelectedLeadIds(new Set([1, 2]));
      bulk.setDialogOpen(true);
    }}>Select both</button>
    <output data-testid="selected-count">{bulk.selectedLeadIds.size}</output>
    <BulkLeadActionsDialog
      open={bulk.dialogOpen}
      onOpenChange={bulk.setDialogOpen}
      selectedCount={bulk.selectedLeadIds.size}
      statuses={bulk.availableMoveStatuses}
      managers={[]}
      canManageAllLeads={false}
      archiveNeedsManagerAssignment={bulk.archiveNeedsManagerAssignment}
      canArchiveSelected={bulk.canArchiveSelected}
      isPending={bulk.isPending}
      moveClaimCount={bulk.moveClaimCount}
      onConfirmMoveClaim={bulk.confirmMoveClaim}
      onCancelMoveClaim={bulk.cancelMoveClaim}
      onMove={bulk.moveSelected}
      onAssign={bulk.assignSelected}
      onArchive={bulk.archiveSelected}
      onDelete={bulk.deleteSelected}
      onClearSelection={bulk.clearSelection}
    />
  </>;
}

const openMoveClaim = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Select both' }));
  await user.click(screen.getByRole('combobox', { name: 'Select target stage' }));
  await user.click(screen.getByRole('option', { name: 'Paid' }));
  await user.click(screen.getByRole('button', { name: 'Move selected leads' }));
  return screen.getByRole('alertdialog');
};

describe('bulk pipeline processing requires ownership', () => {
  it.each([
    { free: true, leadership: false, allowed: false },
    { free: false, leadership: false, allowed: true },
    { free: true, leadership: true, allowed: true },
  ])('offers stages and guards mixed selections (free: $free, leadership: $leadership)', async ({ free, leadership, allowed }) => {
    const update = vi.spyOn(leadsApi, 'bulkUpdateStatus').mockResolvedValue({ updatedCount: 2, statusCode: 'paid' });
    const { result } = renderHook(() => useSalesPipelineBulkActions({
      leads: mixedLeads.map(lead => ({ ...lead, managerId: lead.managerId ?? (free ? null : 7) })),
      statuses, canManageAllLeads: leadership,
    }), { wrapper: createWrapper() });
    act(() => result.current.setSelectedLeadIds(new Set([1, 2])));
    expect(result.current.availableMoveStatuses).toEqual(statuses);
    await act(() => result.current.moveSelected('paid'));
    if (allowed) {
      expect(update).toHaveBeenCalledWith({ leadIds: [1, 2], statusCode: 'paid' });
      expect(result.current.moveClaimCount).toBe(0);
    } else {
      expect(update).not.toHaveBeenCalled();
      expect(result.current.moveClaimCount).toBe(1);
    }
  });

  it('requires confirmation, preserves the selection on cancel, then claims and moves it once', async () => {
    i18n.setLanguage('en');
    const user = userEvent.setup();
    let resolveMove!: (result: { updatedCount: number; statusCode: string }) => void;
    const update = vi.spyOn(leadsApi, 'bulkUpdateStatus').mockImplementation(() => new Promise(resolve => { resolveMove = resolve; }));
    const assign = vi.spyOn(leadsApi, 'bulkAssign');
    render(<BulkMoveHarness />, { wrapper: createWrapper() });
    let claim = await openMoveClaim(user);
    expect(within(claim).getByText('Unassigned leads: 1')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
    await user.click(within(claim).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move selected leads' }));
    expect(screen.getByTestId('selected-count').textContent).toBe('2');
    expect(update).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Move selected leads' }));
    claim = screen.getByRole('alertdialog');
    await user.dblClick(within(claim).getByRole('button', { name: 'Assign to me and continue' }));
    expect(update).toHaveBeenCalledExactlyOnceWith({ leadIds: [1, 2], statusCode: 'paid', assignToSelf: true });
    expect(assign).not.toHaveBeenCalled();
    expect(within(claim).getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
    await act(async () => resolveMove({ updatedCount: 2, statusCode: 'paid' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('selected-count').textContent).toBe('0');
  });

  it('retains the confirmation and selection when the atomic request fails', async () => {
    i18n.setLanguage('en');
    const user = userEvent.setup();
    const update = vi.spyOn(leadsApi, 'bulkUpdateStatus').mockRejectedValue(new Error('accessDenied'));
    render(<BulkMoveHarness />, { wrapper: createWrapper() });
    const claim = await openMoveClaim(user);
    await user.click(within(claim).getByRole('button', { name: 'Assign to me and continue' }));
    await waitFor(() => expect(within(claim).getByRole('button', { name: 'Assign to me and continue' }).hasAttribute('disabled')).toBe(false));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('selected-count').textContent).toBe('2');
    await user.click(within(claim).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('confirms the original selection and prevents concurrent duplicate requests', async () => {
    let finish!: (result: { updatedCount: number }) => void;
    const update = vi.spyOn(leadsApi, 'bulkUpdateStatus').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useSalesPipelineBulkActions({ leads: mixedLeads, statuses }), { wrapper: createWrapper() });
    act(() => result.current.setSelectedLeadIds(new Set([1, 2])));
    await act(() => result.current.moveSelected('paid'));
    act(() => result.current.setSelectedLeadIds(new Set([1])));
    let pending!: Promise<void[]>;
    act(() => { pending = Promise.all([result.current.confirmMoveClaim(), result.current.confirmMoveClaim()]); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ leadIds: [1, 2], statusCode: 'paid', assignToSelf: true });
    act(() => result.current.cancelMoveClaim());
    expect(result.current.moveClaimCount).toBe(1);
    await act(async () => { finish({ updatedCount: 2 }); await pending; });
    expect(result.current.moveClaimCount).toBe(0);
  });
});
