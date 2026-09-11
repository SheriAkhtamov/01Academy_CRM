import { describe, expect, it } from 'vitest';
import {
  matchesArchivedLeadFilters,
  type ArchivedLead,
} from '../client/src/features/sales/ui/ArchiveTab';

const lead = (overrides: Partial<ArchivedLead> = {}): ArchivedLead => ({
  id: 1,
  funnelId: 7,
  contactName: 'Corporate lead',
  statusCode: 'not_now',
  managerName: 'Sales manager',
  archiveReason: 'no_answer',
  ...overrides,
});

describe('lead archive filters', () => {
  it('filters archived leads by sales funnel together with the existing filters', () => {
    const filters = {
      search: 'corporate',
      reason: 'no_answer',
      manager: 'Sales manager',
      funnel: '7',
    };

    expect(matchesArchivedLeadFilters(lead(), filters)).toBe(true);
    expect(matchesArchivedLeadFilters(lead({ funnelId: 8 }), filters)).toBe(false);
    expect(matchesArchivedLeadFilters(lead({ managerName: 'Another manager' }), filters)).toBe(false);
    expect(matchesArchivedLeadFilters(lead({ archiveReason: 'not_interested' }), filters)).toBe(false);
  });

  it('keeps the all-funnel option compatible with unassigned archived leads', () => {
    expect(matchesArchivedLeadFilters(lead({ managerName: null }), {
      search: '',
      reason: 'all',
      manager: 'all',
      funnel: 'all',
    })).toBe(true);
  });
});
