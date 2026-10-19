// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSalesPipelineBulkActions } from '../client/src/features/sales/useSalesPipelineBulkActions';
import { leadsApi } from '../client/src/features/leads/api';

vi.mock('../client/src/features/sales/queries', () => ({ invalidateSalesLeadData: vi.fn() }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('bulk pipeline processing requires ownership', () => {
  it.each([
    { free: true, leadership: false, allowed: false },
    { free: false, leadership: false, allowed: true },
    { free: true, leadership: true, allowed: true },
  ])('guards mixed selections (free: $free, leadership: $leadership)', async ({ free, leadership, allowed }) => {
    const update = vi.spyOn(leadsApi, 'bulkUpdateStatus').mockResolvedValue({ updatedCount: 2, statusCode: 'paid' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useSalesPipelineBulkActions({
      leads: [
        { id: 1, statusCode: 'new_request', managerId: 7 },
        { id: 2, statusCode: 'new_request', managerId: free ? null : 7 },
      ],
      statuses: [{ code: 'paid' }], canManageAllLeads: leadership,
    }), { wrapper });
    act(() => result.current.setSelectedLeadIds(new Set([1, 2])));
    expect(result.current.availableMoveStatuses).toEqual(allowed ? [{ code: 'paid' }] : []);
    await act(() => result.current.moveSelected('paid'));
    if (allowed) expect(update).toHaveBeenCalledWith({ leadIds: [1, 2], statusCode: 'paid' });
    else expect(update).not.toHaveBeenCalled();
    client.clear();
  });
});
