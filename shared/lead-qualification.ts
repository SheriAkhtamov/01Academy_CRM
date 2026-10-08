export type LeadStagePosition = {
  funnelId?: number | null;
  statusCode?: string | null;
  isArchived?: boolean | null;
};

/** Qualification records the first deliberate exit from this funnel's intake. */
export const qualifiesManualLeadStageMove = (
  previous: LeadStagePosition,
  updated: LeadStagePosition,
  initialStageCode: string,
): boolean => Boolean(previous.funnelId && updated.funnelId
  && Number(previous.funnelId) === Number(updated.funnelId)
  && !updated.isArchived
  && previous.statusCode === initialStageCode
  && updated.statusCode && updated.statusCode !== initialStageCode);

export type LeadQualificationFact = { leadId: number; funnelId: number };
export type LeadQualificationSummary = { total: number; byFunnel: Record<string, number> };

/** One lead can qualify in several funnels, but contributes once to the total. */
export const summarizeLeadQualifications = (facts: readonly LeadQualificationFact[], knownFunnelIds: readonly number[] = []): LeadQualificationSummary => {
  const overall = new Set<number>();
  const byFunnel = new Map<number, Set<number>>(knownFunnelIds.filter((id) => Number.isSafeInteger(id) && id > 0).map((id) => [id, new Set<number>()]));
  for (const fact of facts) {
    if (!Number.isSafeInteger(fact.leadId) || fact.leadId <= 0
      || !Number.isSafeInteger(fact.funnelId) || fact.funnelId <= 0) continue;
    overall.add(fact.leadId);
    const leads = byFunnel.get(fact.funnelId) ?? new Set<number>();
    leads.add(fact.leadId);
    byFunnel.set(fact.funnelId, leads);
  }
  return { total: overall.size, byFunnel: Object.fromEntries([...byFunnel].map(([funnelId, leads]) => [String(funnelId), leads.size])) };
};
