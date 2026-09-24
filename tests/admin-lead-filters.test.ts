import { describe, expect, it } from 'vitest';
import { matchesAdminLeadFilters, type AdminLead } from '../client/src/pages/admin-leads';

const lead = (overrides: Partial<AdminLead> = {}): AdminLead => ({
  id: 1,
  contactName: 'Corporate lead',
  statusCode: 'new_request',
  funnelId: 7,
  managerId: 11,
  createdAt: '2026-09-11T00:00:00.000Z',
  ...overrides,
});

describe('administration lead filters', () => {
  it('filters by sales funnel together with manager and status', () => {
    const filters = { manager: '11', status: 'new_request', funnel: '7' };

    expect(matchesAdminLeadFilters(lead(), filters)).toBe(true);
    expect(matchesAdminLeadFilters(lead({ funnelId: 8 }), filters)).toBe(false);
    expect(matchesAdminLeadFilters(lead({ managerId: 12 }), filters)).toBe(false);
    expect(matchesAdminLeadFilters(lead({ statusCode: 'qualified' }), filters)).toBe(false);
  });

  it('keeps unassigned and all-funnel filtering compatible', () => {
    expect(matchesAdminLeadFilters(lead({ managerId: null }), {
      manager: 'unassigned',
      status: 'all',
      funnel: 'all',
    })).toBe(true);
  });

  it('searches names and formatted phone numbers within the selected filters', () => {
    const matchingLead = lead({
      contactName: 'Елена Каримова',
      studentName: 'Дамир',
      phone: '+998 (90) 123-45-67',
    });
    const filters = { manager: '11', status: 'new_request', funnel: '7' };

    expect(matchesAdminLeadFilters(matchingLead, { ...filters, search: '  ЕЛЕНА ' })).toBe(true);
    expect(matchesAdminLeadFilters(matchingLead, { ...filters, search: 'дамир' })).toBe(true);
    expect(matchesAdminLeadFilters(matchingLead, { ...filters, search: '99890123' })).toBe(true);
    expect(matchesAdminLeadFilters(matchingLead, { ...filters, search: '+998 (90) 123' })).toBe(true);
    expect(matchesAdminLeadFilters(matchingLead, { ...filters, search: 'другой' })).toBe(false);
    expect(matchesAdminLeadFilters(matchingLead, { ...filters, manager: '12', search: 'дамир' })).toBe(false);
  });
});
