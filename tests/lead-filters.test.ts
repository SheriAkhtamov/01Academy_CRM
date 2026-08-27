import { describe, expect, it } from 'vitest';
import {
  EMPTY_LEAD_FILTERS,
  countActiveLeadFilters,
  leadFilterAmount,
  leadMatchesFilters,
  parseStoredLeadFilters,
  toggleFilterValue,
  type FilterableLead,
  type LeadFilterState,
} from '../client/src/lib/leadFilters';

const lead = (overrides: Partial<FilterableLead> = {}): FilterableLead => ({
  id: 1,
  sourceId: 5,
  language: 'ru',
  phone: '+998901234567',
  phoneNumbers: ['+998901234567'],
  messenger: null,
  tags: [],
  firstViewedAt: '2026-08-04T10:00:00.000Z',
  demoAt: null,
  comment: null,
  studentAge: 10,
  offerPriceUzs: 1_000_000,
  createdAt: '2026-08-04T10:00:00.000Z',
  ...overrides,
});

const withFilters = (overrides: Partial<LeadFilterState>): LeadFilterState => ({
  ...EMPTY_LEAD_FILTERS,
  ...overrides,
});

describe('pipeline lead filters', () => {
  it('keeps every lead while nothing is filtered', () => {
    expect(leadMatchesFilters(lead(), EMPTY_LEAD_FILTERS)).toBe(true);
    expect(leadMatchesFilters(lead({ sourceId: null, language: null }), EMPTY_LEAD_FILTERS)).toBe(true);
    expect(countActiveLeadFilters(EMPTY_LEAD_FILTERS)).toBe(0);
  });

  it('filters by any of the selected sources', () => {
    const filters = withFilters({ sourceIds: [5, 9] });
    expect(leadMatchesFilters(lead({ sourceId: 9 }), filters)).toBe(true);
    expect(leadMatchesFilters(lead({ sourceId: 7 }), filters)).toBe(false);
  });

  it('filters by any selected manager and can include unassigned leads', () => {
    const assignedOnly = withFilters({ managerIds: [7, 9] });
    expect(leadMatchesFilters(lead({ managerId: 9 }), assignedOnly)).toBe(true);
    expect(leadMatchesFilters(lead({ managerId: 12 }), assignedOnly)).toBe(false);
    expect(leadMatchesFilters(lead({ managerId: null }), assignedOnly)).toBe(false);

    const assignedOrUnassigned = withFilters({
      managerIds: [9],
      includeUnassignedManager: true,
    });
    expect(leadMatchesFilters(lead({ managerId: 9 }), assignedOrUnassigned)).toBe(true);
    expect(leadMatchesFilters(lead({ managerId: null }), assignedOrUnassigned)).toBe(true);
    expect(leadMatchesFilters(lead({ managerId: 12 }), assignedOrUnassigned)).toBe(false);
  });

  it('filters by communication language regardless of stored casing', () => {
    const filters = withFilters({ languages: ['uz'] });
    expect(leadMatchesFilters(lead({ language: 'UZ' }), filters)).toBe(true);
    expect(leadMatchesFilters(lead({ language: 'ru' }), filters)).toBe(false);
    expect(leadMatchesFilters(lead({ language: null }), filters)).toBe(false);
  });

  it('does not treat a synthetic Instagram phone as a real number', () => {
    const instagramLead = lead({ phone: 'instagram:17841400000', phoneNumbers: ['instagram:17841400000'] });

    expect(leadMatchesFilters(instagramLead, withFilters({ hasPhone: 'yes' }))).toBe(false);
    expect(leadMatchesFilters(instagramLead, withFilters({ hasPhone: 'no' }))).toBe(true);
    expect(leadMatchesFilters(lead(), withFilters({ hasPhone: 'yes' }))).toBe(true);
  });

  it('filters by messenger presence', () => {
    expect(leadMatchesFilters(lead({ messenger: '@client' }), withFilters({ hasMessenger: 'yes' }))).toBe(true);
    expect(leadMatchesFilters(lead({ messenger: '   ' }), withFilters({ hasMessenger: 'yes' }))).toBe(false);
    expect(leadMatchesFilters(lead({ messenger: null }), withFilters({ hasMessenger: 'no' }))).toBe(true);
  });

  it('keeps a lead carrying any of the selected tags', () => {
    const filters = withFilters({ tagIds: [3, 4] });
    expect(leadMatchesFilters(
      lead({ tags: [{ id: 104, tagId: 4, name: 'VIP' }] }),
      filters,
    )).toBe(true);
    expect(leadMatchesFilters(
      lead({ tags: [{ id: 105, tagId: 4, name: 'VIP' }] }),
      filters,
    )).toBe(true);
    expect(leadMatchesFilters(
      lead({ tags: [{ id: 4, tagId: 8, name: 'Cold' }] }),
      filters,
    )).toBe(false);
    expect(leadMatchesFilters(lead({ tags: [] }), filters)).toBe(false);
  });

  it('shows only leads nobody opened when asked', () => {
    const filters = withFilters({ onlyNew: true });
    expect(leadMatchesFilters(lead({ firstViewedAt: null }), filters)).toBe(true);
    expect(leadMatchesFilters(lead({ firstViewedAt: '2026-08-04T10:00:00.000Z' }), filters)).toBe(false);
  });

  it('filters by trial lesson booking and by comment', () => {
    expect(leadMatchesFilters(lead({ demoAt: '2026-08-06T09:00:00.000Z' }), withFilters({ demoBooked: 'yes' }))).toBe(true);
    expect(leadMatchesFilters(lead({ demoAt: null }), withFilters({ demoBooked: 'yes' }))).toBe(false);
    expect(leadMatchesFilters(lead({ comment: 'звонить после 18' }), withFilters({ hasComment: 'yes' }))).toBe(true);
    expect(leadMatchesFilters(lead({ comment: '' }), withFilters({ hasComment: 'no' }))).toBe(true);
  });

  it('applies open-ended age and amount windows', () => {
    expect(leadMatchesFilters(lead({ studentAge: 10 }), withFilters({ ageFrom: '8' }))).toBe(true);
    expect(leadMatchesFilters(lead({ studentAge: 6 }), withFilters({ ageFrom: '8' }))).toBe(false);
    expect(leadMatchesFilters(lead({ studentAge: 14 }), withFilters({ ageTo: '12' }))).toBe(false);
    expect(leadMatchesFilters(lead({ studentAge: 12 }), withFilters({ ageFrom: '8', ageTo: '12' }))).toBe(true);
  });

  it('excludes leads with no number at all once a window is set', () => {
    // A blank age cannot be proven to sit inside the window, so it drops out
    // rather than silently passing every filter.
    expect(leadMatchesFilters(lead({ studentAge: null }), withFilters({ ageFrom: '8' }))).toBe(false);
    expect(leadMatchesFilters(lead({ studentAge: null }), EMPTY_LEAD_FILTERS)).toBe(true);
    expect(leadMatchesFilters(
      lead({ offerPriceUzs: null, expectedPaymentUzs: null }),
      withFilters({ amountFrom: '1' }),
    )).toBe(false);
  });

  it('prefers the offered price over the expected payment for the amount', () => {
    expect(leadFilterAmount(lead({ offerPriceUzs: 900, expectedPaymentUzs: 100 }))).toBe(900);
    expect(leadFilterAmount(lead({ offerPriceUzs: null, expectedPaymentUzs: 100 }))).toBe(100);
    expect(leadMatchesFilters(
      lead({ offerPriceUzs: null, expectedPaymentUzs: 500_000 }),
      withFilters({ amountFrom: '400000', amountTo: '600000' }),
    )).toBe(true);
  });

  it('filters by creation date, including one-sided periods', () => {
    const august = lead({ createdAt: '2026-08-04T10:00:00.000Z' });
    expect(leadMatchesFilters(august, withFilters({ createdFrom: '2026-08-01' }))).toBe(true);
    expect(leadMatchesFilters(august, withFilters({ createdFrom: '2026-08-05' }))).toBe(false);
    expect(leadMatchesFilters(august, withFilters({ createdTo: '2026-08-04' }))).toBe(true);
    expect(leadMatchesFilters(august, withFilters({ createdTo: '2026-08-03' }))).toBe(false);
  });

  it('counts each condition once so the badge stays readable', () => {
    expect(countActiveLeadFilters(withFilters({ sourceIds: [1, 2, 3] }))).toBe(1);
    expect(countActiveLeadFilters(withFilters({ ageFrom: '8', ageTo: '12' }))).toBe(1);
    expect(countActiveLeadFilters(withFilters({
      managerIds: [7, 9],
      includeUnassignedManager: true,
    }))).toBe(1);
    expect(countActiveLeadFilters(withFilters({
      sourceIds: [1],
      onlyNew: true,
      hasPhone: 'yes',
      createdFrom: '2026-08-01',
    }))).toBe(4);
  });
});

describe('restoring filters from browser storage', () => {
  it('falls back to no filtering on missing or broken storage', () => {
    expect(parseStoredLeadFilters(null)).toEqual(EMPTY_LEAD_FILTERS);
    expect(parseStoredLeadFilters('not json')).toEqual(EMPTY_LEAD_FILTERS);
    expect(parseStoredLeadFilters('[]')).toEqual(EMPTY_LEAD_FILTERS);
    expect(parseStoredLeadFilters('"filters"')).toEqual(EMPTY_LEAD_FILTERS);
  });

  it('drops values a stale entry should not be able to smuggle in', () => {
    const restored = parseStoredLeadFilters(JSON.stringify({
      sourceIds: [4, '5', -2, 0, 'x', 4],
      managerIds: [9, '10', -1, 'x', 9],
      includeUnassignedManager: true,
      languages: ['ru', 'klingon', 'UZ'],
      hasPhone: 'maybe',
      tagIds: [7],
      onlyNew: 'true',
      demoBooked: 'no',
      ageFrom: 8,
      createdTo: '2026-08-04',
    }));

    expect(restored.sourceIds).toEqual([4, 5]);
    expect(restored.managerIds).toEqual([9, 10]);
    expect(restored.includeUnassignedManager).toBe(true);
    expect(restored.languages).toEqual(['ru', 'uz']);
    expect(restored.hasPhone).toBe('any');
    expect(restored.tagIds).toEqual([7]);
    // Only a real boolean turns the marker filter on.
    expect(restored.onlyNew).toBe(false);
    expect(restored.demoBooked).toBe('no');
    expect(restored.ageFrom).toBe('8');
    expect(restored.createdTo).toBe('2026-08-04');
  });

  it('round-trips a saved selection', () => {
    const filters = withFilters({
      sourceIds: [2],
      managerIds: [6],
      includeUnassignedManager: true,
      languages: ['uz'],
      onlyNew: true,
      amountTo: '900',
    });
    expect(parseStoredLeadFilters(JSON.stringify(filters))).toEqual(filters);
  });
});

describe('toggling multi-select values', () => {
  it('adds a missing value and removes a selected one', () => {
    expect(toggleFilterValue([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleFilterValue([1, 2, 3], 2)).toEqual([1, 3]);
    expect(toggleFilterValue<string>([], 'ru')).toEqual(['ru']);
  });
});
