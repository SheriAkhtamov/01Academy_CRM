import { visibleLeadPhones, type LeadContactFields } from './leadContact';
import { isInReportingRange } from './reportingDateRange';

/** "Any" keeps the lead, the other two ask for the presence or absence of a value. */
export type LeadFilterTriState = 'any' | 'yes' | 'no';

const TRI_STATES: readonly LeadFilterTriState[] = ['any', 'yes', 'no'];
export const LEAD_FILTER_LANGUAGES = ['ru', 'uz', 'en'] as const;

export interface FilterableLead extends LeadContactFields {
  sourceId?: number | null;
  managerId?: number | null;
  language?: string | null;
  tags?: Array<{ id: number; tagId: number; name: string }> | null;
  firstViewedAt?: string | null;
  demoAt?: string | null;
  comment?: string | null;
  studentAge?: number | null;
  expectedPaymentUzs?: number | null;
  offerPriceUzs?: number | null;
  createdAt?: string | null;
}

export interface LeadFilterState {
  sourceIds: number[];
  managerIds: number[];
  includeUnassignedManager: boolean;
  languages: string[];
  hasPhone: LeadFilterTriState;
  hasMessenger: LeadFilterTriState;
  tagIds: number[];
  onlyNew: boolean;
  demoBooked: LeadFilterTriState;
  hasComment: LeadFilterTriState;
  ageFrom: string;
  ageTo: string;
  amountFrom: string;
  amountTo: string;
  createdFrom: string;
  createdTo: string;
}

export const EMPTY_LEAD_FILTERS: LeadFilterState = {
  sourceIds: [],
  managerIds: [],
  includeUnassignedManager: false,
  languages: [],
  hasPhone: 'any',
  hasMessenger: 'any',
  tagIds: [],
  onlyNew: false,
  demoBooked: 'any',
  hasComment: 'any',
  ageFrom: '',
  ageTo: '',
  amountFrom: '',
  amountTo: '',
  createdFrom: '',
  createdTo: '',
};

/** Each group counts once, so the badge shows conditions rather than checkboxes. */
export const countActiveLeadFilters = (filters: LeadFilterState) => {
  let count = 0;
  if (filters.sourceIds.length > 0) count += 1;
  if (filters.managerIds.length > 0 || filters.includeUnassignedManager) count += 1;
  if (filters.languages.length > 0) count += 1;
  if (filters.hasPhone !== 'any') count += 1;
  if (filters.hasMessenger !== 'any') count += 1;
  if (filters.tagIds.length > 0) count += 1;
  if (filters.onlyNew) count += 1;
  if (filters.demoBooked !== 'any') count += 1;
  if (filters.hasComment !== 'any') count += 1;
  if (filters.ageFrom || filters.ageTo) count += 1;
  if (filters.amountFrom || filters.amountTo) count += 1;
  if (filters.createdFrom || filters.createdTo) count += 1;
  return count;
};

export const leadFilterAmount = (lead: FilterableLead) => (
  Number(lead.offerPriceUzs || lead.expectedPaymentUzs || 0)
);

const matchesTriState = (state: LeadFilterTriState, present: boolean) => (
  state === 'any' || (state === 'yes' ? present : !present)
);

const matchesRange = (value: number | null, from: string, to: string) => {
  const lower = from.trim() === '' ? null : Number(from);
  const upper = to.trim() === '' ? null : Number(to);
  if (lower === null && upper === null) return true;
  // A lead with no age or no amount cannot satisfy a numeric window.
  if (value === null || !Number.isFinite(value)) return false;
  if (lower !== null && Number.isFinite(lower) && value < lower) return false;
  if (upper !== null && Number.isFinite(upper) && value > upper) return false;
  return true;
};

export const leadMatchesFilters = (lead: FilterableLead, filters: LeadFilterState): boolean => {
  if (filters.sourceIds.length > 0 && !filters.sourceIds.includes(Number(lead.sourceId))) {
    return false;
  }
  if (filters.managerIds.length > 0 || filters.includeUnassignedManager) {
    const assignedManagerMatches = lead.managerId !== null
      && lead.managerId !== undefined
      && filters.managerIds.includes(Number(lead.managerId));
    const unassignedMatches = filters.includeUnassignedManager
      && (lead.managerId === null || lead.managerId === undefined);
    if (!assignedManagerMatches && !unassignedMatches) return false;
  }
  if (filters.languages.length > 0
    && !filters.languages.includes(String(lead.language ?? '').trim().toLowerCase())) {
    return false;
  }
  // Instagram leads carry a synthetic "instagram:" phone, which is not a number
  // anybody can dial, so it must not count as having a phone.
  if (!matchesTriState(filters.hasPhone, visibleLeadPhones(lead).length > 0)) return false;
  if (!matchesTriState(filters.hasMessenger, Boolean(lead.messenger?.trim()))) return false;

  if (filters.tagIds.length > 0
    && !(lead.tags ?? []).some((tag) => filters.tagIds.includes(tag.tagId))) {
    return false;
  }
  if (filters.onlyNew && lead.firstViewedAt) return false;
  if (!matchesTriState(filters.demoBooked, Boolean(lead.demoAt))) return false;
  if (!matchesTriState(filters.hasComment, Boolean(lead.comment?.trim()))) return false;

  const age = lead.studentAge === null || lead.studentAge === undefined
    ? null
    : Number(lead.studentAge);
  if (!matchesRange(age, filters.ageFrom, filters.ageTo)) return false;

  const amount = leadFilterAmount(lead);
  if (!matchesRange(amount > 0 ? amount : null, filters.amountFrom, filters.amountTo)) return false;

  if (filters.createdFrom || filters.createdTo) {
    const range = {
      from: filters.createdFrom || '0001-01-01',
      to: filters.createdTo || '9999-12-31',
    };
    if (!isInReportingRange(lead.createdAt, range)) return false;
  }

  return true;
};

const readStringArray = (value: unknown, allowed?: readonly string[]) => {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => String(item).trim().toLowerCase())
    .filter((item) => item !== '' && (!allowed || allowed.includes(item)));
  return [...new Set(items)];
};

const readNumberArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => Number(item))
    .filter((item) => Number.isSafeInteger(item) && item > 0);
  return [...new Set(items)];
};

const readTriState = (value: unknown): LeadFilterTriState => (
  TRI_STATES.includes(value as LeadFilterTriState) ? value as LeadFilterTriState : 'any'
);

const readText = (value: unknown) => (
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
);

/**
 * Filters are restored from browser storage, so every field is treated as
 * untrusted: a stale or hand-edited entry must degrade to "no filter" instead
 * of hiding leads for reasons the user cannot see.
 */
export const parseStoredLeadFilters = (raw: string | null | undefined): LeadFilterState => {
  if (!raw) return EMPTY_LEAD_FILTERS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_LEAD_FILTERS;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_LEAD_FILTERS;
  const stored = parsed as Record<string, unknown>;

  return {
    sourceIds: readNumberArray(stored.sourceIds),
    managerIds: readNumberArray(stored.managerIds),
    includeUnassignedManager: stored.includeUnassignedManager === true,
    languages: readStringArray(stored.languages, LEAD_FILTER_LANGUAGES),
    hasPhone: readTriState(stored.hasPhone),
    hasMessenger: readTriState(stored.hasMessenger),
    tagIds: readNumberArray(stored.tagIds),
    onlyNew: stored.onlyNew === true,
    demoBooked: readTriState(stored.demoBooked),
    hasComment: readTriState(stored.hasComment),
    ageFrom: readText(stored.ageFrom),
    ageTo: readText(stored.ageTo),
    amountFrom: readText(stored.amountFrom),
    amountTo: readText(stored.amountTo),
    createdFrom: readText(stored.createdFrom),
    createdTo: readText(stored.createdTo),
  };
};

export const toggleFilterValue = <T>(values: T[], value: T) => (
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
);
