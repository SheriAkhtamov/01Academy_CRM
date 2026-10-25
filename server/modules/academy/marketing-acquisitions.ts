type Row = Record<string, any>;
const metaSources = new Set(['meta_lead_ads', 'meta_lead_ads_facebook', 'meta_website']);

export function marketingAcquisitions({ sources, leads, metaIntakes, periodStart, periodEnd }: {
  sources: Row[]; leads: Row[]; metaIntakes: Row[]; periodStart: Date; periodEnd: Date;
}) {
  const sourceById = new Map(sources.map((source) => [Number(source.id), source]));
  const sourceByCode = new Map(sources.map((source) => [source.code, source]));
  const inPeriod = (value: unknown) => {
    const date = new Date(String(value));
    return date >= periodStart && date < periodEnd;
  };
  return [
    ...leads.filter((lead) => !metaSources.has(sourceById.get(Number(lead.sourceId))?.code)
      && inPeriod(lead.createdAt)).map((lead) => ({
      leadId: Number(lead.id), sourceId: Number(lead.sourceId), acquiredAt: lead.createdAt,
    })),
    ...metaIntakes.filter((intake) => inPeriod(intake.acquiredAt)).map((intake) => ({
      leadId: Number(intake.leadId), sourceId: Number(sourceByCode.get(intake.sourceCode)?.id), acquiredAt: intake.acquiredAt,
    })),
  ];
}
