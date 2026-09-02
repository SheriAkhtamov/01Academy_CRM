// These are stable database codes, not editable stage names.
export const DEMO_ATTENDED_STAGE = 'demo_attended';
export const DEMO_NO_SHOW_STAGE = 'ne_prishli_na_vstrechu';

export const isDemoPipelineStage = (code: unknown): boolean => (
  code === DEMO_ATTENDED_STAGE || code === DEMO_NO_SHOW_STAGE
);

export const demoAttendanceStage = (statuses: readonly string[], demoStatus = 'scheduled'): string | null => {
  if (demoStatus === 'cancelled') return null;
  const active = statuses.filter((status) => status !== 'cancelled')
    .map((status) => demoStatus === 'not_conducted' && status === 'attended' ? 'invited' : status);
  if (active.includes('attended')) return DEMO_ATTENDED_STAGE;
  if (active.length > 0 && active.every((status) => status === 'no_show')) return DEMO_NO_SHOW_STAGE;
  return null;
};

export const canAdvanceLeadFromDemo = (lead: {
  isArchived?: boolean | null;
  statusCode: string;
}): boolean => !lead.isArchived && ![
  'offer', 'thinking', 'enrolled', 'paid', 'not_now',
].includes(lead.statusCode);
