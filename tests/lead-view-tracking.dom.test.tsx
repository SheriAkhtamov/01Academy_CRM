// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const markViewed = vi.fn();

vi.mock('../client/src/features/leads/api', () => ({
  leadsApi: { markViewed: (leadId: number) => markViewed(leadId) },
  leadQueryKeys: { unviewedCount: ['/api/academy/leads/unviewed-count'] },
}));

import { salesQueryKeys } from '../client/src/features/sales/queries';
import { useLeadViewTracking } from '../client/src/features/sales/useLeadViewTracking';

const newLead = { id: 42, firstViewedAt: null };
const seenLead = { id: 43, firstViewedAt: '2026-08-04T10:00:00.000Z' };

const renderTracking = (
  input: { leadId: number | null; open: boolean; leads: Array<typeof newLead | typeof seenLead> },
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(salesQueryKeys.module, { leads: [newLead, seenLead] });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook((props: typeof input) => useLeadViewTracking(props), {
    initialProps: input,
    wrapper,
  });
  return { ...view, queryClient };
};

describe('clearing the new-lead marker when the card opens', () => {
  beforeEach(() => {
    markViewed.mockReset();
    markViewed.mockResolvedValue({ leadId: 42, firstViewedAt: '2026-08-04T12:00:00.000Z', firstViewedBy: 7 });
  });

  it('marks the lead viewed and drops the dot without refetching the board', async () => {
    const { queryClient } = renderTracking({ leadId: 42, open: true, leads: [newLead, seenLead] });

    await waitFor(() => expect(markViewed).toHaveBeenCalledWith(42));

    await waitFor(() => {
      const dataset = queryClient.getQueryData(salesQueryKeys.module) as { leads: typeof newLead[] };
      expect(dataset.leads[0].firstViewedAt).toBe('2026-08-04T12:00:00.000Z');
    });
    // The already opened card must survive the patch untouched.
    const dataset = queryClient.getQueryData(salesQueryKeys.module) as { leads: typeof seenLead[] };
    expect(dataset.leads[1]).toEqual(seenLead);
  });

  it('leaves a lead alone while its card is closed', async () => {
    renderTracking({ leadId: 42, open: false, leads: [newLead, seenLead] });

    await Promise.resolve();
    expect(markViewed).not.toHaveBeenCalled();
  });

  it('does not re-mark a lead that was already opened by somebody', async () => {
    renderTracking({ leadId: 43, open: true, leads: [newLead, seenLead] });

    await Promise.resolve();
    expect(markViewed).not.toHaveBeenCalled();
  });

  it('marks each lead once even when the card re-renders', async () => {
    const { rerender } = renderTracking({ leadId: 42, open: true, leads: [newLead, seenLead] });

    await waitFor(() => expect(markViewed).toHaveBeenCalledTimes(1));

    rerender({ leadId: 42, open: true, leads: [{ ...newLead }, seenLead] });
    await Promise.resolve();

    expect(markViewed).toHaveBeenCalledTimes(1);
  });
});
