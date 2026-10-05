import { z } from 'zod';

export const CALL_JOURNAL_STATUSES = ['all', 'callback', 'dialing', 'ringing', 'connected', 'ended', 'failed', 'declined', 'missed'] as const;
const calendarDate = z.string().refine((value) => value === '' || (
  /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
));

export const callJournalFieldsSchema = z.object({
  userId: z.string().refine((value) => ['all', 'unassigned'].includes(value) || (/^[1-9]\d*$/.test(value) && Number(value) <= 2_147_483_647)).default('all'),
  direction: z.enum(['all', 'incoming', 'outgoing']).default('all'),
  status: z.enum(CALL_JOURNAL_STATUSES).default('all'),
  q: z.string().trim().max(200).default(''),
  from: calendarDate.default(''),
  to: calendarDate.default(''),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const callJournalQuerySchema = callJournalFieldsSchema.refine((value) => !value.from || !value.to || value.from <= value.to);
export type CallJournalFilters = z.infer<typeof callJournalQuerySchema>;

export const readCallJournalFilters = (params: URLSearchParams, defaultEmployeeId = 'all'): CallJournalFilters => {
  const defaults = { ...callJournalFieldsSchema.parse({}), userId: defaultEmployeeId };
  const filters = Object.fromEntries(Object.entries(callJournalFieldsSchema.shape).map(([key, schema]) => {
    const parsed = schema.safeParse(params.get(key) ?? (key === 'userId' ? defaultEmployeeId : undefined));
    return [key, parsed.success ? parsed.data : defaults[key as keyof CallJournalFilters]];
  })) as CallJournalFilters;
  if (filters.from && filters.to && filters.from > filters.to) filters.to = filters.from;
  return filters;
};

export const callJournalSearchParams = (filters: CallJournalFilters) => {
  const params = new URLSearchParams();
  params.set('userId', filters.userId);
  if (filters.direction !== 'all') params.set('direction', filters.direction);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.q) params.set('q', filters.q);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.page !== 1) params.set('page', String(filters.page));
  if (filters.limit !== 50) params.set('limit', String(filters.limit));
  return params;
};
