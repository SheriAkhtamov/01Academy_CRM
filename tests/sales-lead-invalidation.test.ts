import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { leadQueryKeys } from '../client/src/features/leads/api';
import { invalidateSalesLeadData, salesQueryKeys } from '../client/src/features/sales/queries';
import { salesFunnelQueryKeys } from '../client/src/features/sales-funnels/queries';

describe('sales cache after a manual funnel transfer', () => {
  it('refreshes the boards without reading the transferred lead outside the sender’s access', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const keys = [
      leadQueryKeys.detail(15),
      leadQueryKeys.all,
      salesQueryKeys.module,
      salesQueryKeys.metrics,
      salesQueryKeys.demoStudents,
      ['/api/academy/sales-kpi'],
      ['/api/academy/sales-funnels'],
      salesFunnelQueryKeys.transferOptions,
    ];
    const fetches = keys.map(() => vi.fn(async () => []));
    const subscriptions = keys.map((queryKey, index) => new QueryObserver(client, {
      queryKey, queryFn: fetches[index], initialData: [],
    }).subscribe(() => undefined));
    try {
      await invalidateSalesLeadData(client, undefined, { excludeLeadDetailId: 15 });

      expect(fetches[0]).not.toHaveBeenCalled();
      for (const fetch of fetches.slice(1)) expect(fetch).toHaveBeenCalledOnce();
      expect(client.getQueryState(leadQueryKeys.detail(15))?.isInvalidated).toBe(true);
    } finally {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      client.clear();
    }
  });
});
