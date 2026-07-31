import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { leadQueryKeys } from '../client/src/features/leads/api';
import { invalidateLeadData } from '../client/src/features/leads/queries';
import {
  invalidateSalesLeadData,
  salesQueryKeys,
} from '../client/src/features/sales/queries';

describe('lead query cache boundaries', () => {
  it('uses stable hierarchical keys for detail and merge queries', () => {
    expect(leadQueryKeys.detail(14)).toEqual(['/api/academy/leads', 14]);
    expect(leadQueryKeys.mergeCandidates('parent')).toEqual([
      '/api/academy/leads/merge-candidates',
      'parent',
    ]);
    expect(leadQueryKeys.mergePreview(14, 15)).toEqual([
      '/api/academy/leads/merge-preview',
      14,
      15,
    ]);
  });

  it('centralizes lead and sales invalidation after a mutation', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    await invalidateSalesLeadData(queryClient, 14);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: salesQueryKeys.module });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: salesQueryKeys.metrics });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: leadQueryKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: leadQueryKeys.tags });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: leadQueryKeys.detail(14) });
  });

  it('does not invent a nullable detail key for collection-only refreshes', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    await invalidateLeadData(queryClient);

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: leadQueryKeys.detail(null) });
  });
});
