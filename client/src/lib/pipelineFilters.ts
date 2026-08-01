/**
 * Client-side search, filtering and sorting for the sales pipeline board.
 *
 * The board already receives every visible lead with the workspace payload, so
 * narrowing the view stays a pure transformation over that data — no extra
 * requests, and the optimistic drag-and-drop state keeps working untouched.
 */

export type PipelineSort = 'newest' | 'oldest' | 'amount' | 'name';

export interface PipelineFilterState {
  query: string;
  managerId: string;
  sourceId: string;
  sort: PipelineSort;
}

export interface PipelineFilterableLead {
  id: number;
  contactName: string;
  phone?: string | null;
  phoneNumbers?: string[];
  messenger?: string | null;
  comment?: string | null;
  sourceId?: number;
  sourceName?: string;
  managerId?: number | null;
  managerName?: string | null;
  tags?: Array<{ name: string }>;
  createdAt?: string;
  expectedPaymentUzs?: number;
  offerPriceUzs?: number;
}

export const PIPELINE_FILTER_ALL = 'all';
export const PIPELINE_FILTER_UNASSIGNED = 'unassigned';

export const EMPTY_PIPELINE_FILTERS: PipelineFilterState = {
  query: '',
  managerId: PIPELINE_FILTER_ALL,
  sourceId: PIPELINE_FILTER_ALL,
  sort: 'newest',
};

export const hasActivePipelineFilters = (filters: PipelineFilterState) => (
  filters.query.trim().length > 0
  || filters.managerId !== PIPELINE_FILTER_ALL
  || filters.sourceId !== PIPELINE_FILTER_ALL
);

export const leadDealAmount = (lead: PipelineFilterableLead) => {
  const amount = Number(lead.offerPriceUzs || lead.expectedPaymentUzs || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const digitsOf = (value: string) => value.replace(/\D/g, '');

const leadSearchIndex = (lead: PipelineFilterableLead) => {
  const phones = lead.phoneNumbers?.length
    ? lead.phoneNumbers
    : lead.phone
      ? [lead.phone]
      : [];

  return {
    text: [
      lead.contactName,
      lead.messenger,
      lead.comment,
      lead.sourceName,
      lead.managerName,
      ...phones,
      ...(lead.tags ?? []).map((tag) => tag.name),
    ].filter(Boolean).join(' ').toLowerCase(),
    digits: phones.map(digitsOf).filter(Boolean),
  };
};

const matchesQuery = (lead: PipelineFilterableLead, query: string) => {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const index = leadSearchIndex(lead);
  return tokens.every((token) => {
    if (index.text.includes(token)) return true;
    const tokenDigits = digitsOf(token);
    return tokenDigits.length > 0 && index.digits.some((phone) => phone.includes(tokenDigits));
  });
};

const matchesManager = (lead: PipelineFilterableLead, managerId: string) => {
  if (managerId === PIPELINE_FILTER_ALL) return true;
  if (managerId === PIPELINE_FILTER_UNASSIGNED) return !lead.managerId;
  return Number(lead.managerId) === Number(managerId);
};

const matchesSource = (lead: PipelineFilterableLead, sourceId: string) => {
  if (sourceId === PIPELINE_FILTER_ALL) return true;
  return Number(lead.sourceId) === Number(sourceId);
};

const createdAtTime = (lead: PipelineFilterableLead) => {
  const time = new Date(lead.createdAt ?? 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

export const sortPipelineLeads = <T extends PipelineFilterableLead>(leads: T[], sort: PipelineSort): T[] => {
  const sorted = [...leads];
  switch (sort) {
    case 'oldest':
      return sorted.sort((left, right) => createdAtTime(left) - createdAtTime(right));
    case 'amount':
      return sorted.sort((left, right) => leadDealAmount(right) - leadDealAmount(left));
    case 'name':
      return sorted.sort((left, right) => left.contactName.localeCompare(right.contactName));
    case 'newest':
    default:
      return sorted.sort((left, right) => createdAtTime(right) - createdAtTime(left));
  }
};

export const applyPipelineFilters = <T extends PipelineFilterableLead>(
  leads: T[],
  filters: PipelineFilterState,
): T[] => sortPipelineLeads(
  leads.filter((lead) => (
    matchesQuery(lead, filters.query)
    && matchesManager(lead, filters.managerId)
    && matchesSource(lead, filters.sourceId)
  )),
  filters.sort,
);
