import { apiRequest } from '@/lib/queryClient';

export type MetaIntegrationState = {
  attributionConfigured?: boolean;
  capiConfigured?: boolean;
  accessTokenConfigured?: boolean;
  adAccountId?: string | null;
  businessId?: string | null;
  datasetId?: string | null;
  pageId?: string | null;
  apiVersion?: string | null;
  conversionStages?: Array<{ code: string; name: string }>;
  testMode?: boolean;
  usdToUzsRate?: number;
  convertsToUzs?: boolean;
};

export type MetaCreativeRow = {
  attributionKey: string;
  adId?: string | null;
  adName?: string | null;
  adsetId?: string | null;
  adsetName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  creativeId?: string | null;
  creativeName?: string | null;
  creativeTitle?: string | null;
  mediaType?: string | null;
  hookName?: string | null;
  placement?: string | null;
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
  effectiveStatus?: string | null;
  inCatalog?: boolean;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  utmDerived?: boolean;
  leads: number;
  qualified: number;
  demoInvited: number;
  paid: number;
  revenue: number;
  spend: number;
  costPerLead: number | null;
  impressions?: number;
  clicks?: number;
  qualificationRate: number;
  paymentRate: number;
  enrichmentFailures?: number;
  firstCapturedAt?: string | null;
  lastCapturedAt?: string | null;
};

export type MetaFormRow = {
  formId: string;
  formName?: string | null;
  leads: number;
  qualified: number;
  demoInvited: number;
  paid: number;
  revenue: number;
};

export type MetaAttributionLeadRow = {
  id: number;
  contactName?: string | null;
  studentName?: string | null;
  phone?: string | null;
  statusCode: string;
  statusName?: string | null;
  statusColor?: string | null;
  managerId?: number | null;
  managerName?: string | null;
  isArchived?: boolean;
  createdAt?: string | null;
  capturedAt?: string | null;
  leadgenId?: string | null;
  formId?: string | null;
};

export type MetaAttributionLeadsData = {
  leads: MetaAttributionLeadRow[];
};

export type MetaAttributionData = {
  summary: {
    creatives: number;
    totalAds: number;
    leads: number;
    qualified: number;
    demoInvited: number;
    paid: number;
    revenue: number;
    spend: number;
  };
  creatives: MetaCreativeRow[];
  forms: MetaFormRow[];
  spendCurrency: 'UZS' | 'USD';
  integration: MetaIntegrationState;
};

export type MetaEventRow = {
  id: number;
  leadId?: number | null;
  contactName?: string | null;
  eventId: string;
  eventName: string;
  crmStage: string;
  eventTime: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  attemptCount: number;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
  sentAt?: string | null;
  responsePayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
  adId?: string | null;
  adName?: string | null;
  hookName?: string | null;
  campaignName?: string | null;
};

export type MetaEventsData = {
  summary: { total: number; pending: number; sent: number; failed: number; deliveryRate: number };
  events: MetaEventRow[];
  integration: MetaIntegrationState;
};

export const metaMarketingQueryKeys = {
  attribution: ['/api/academy/modules/marketing/meta-attribution'] as const,
  attributionLeads: ['/api/academy/modules/marketing/meta-attribution/leads'] as const,
  events: ['/api/academy/modules/marketing/meta-events'] as const,
};

export const metaMarketingApi = {
  attribution: (reportingQuery: string) => apiRequest(
    'GET',
    `/api/academy/modules/marketing/meta-attribution?${reportingQuery}`,
  ) as Promise<MetaAttributionData>,
  attributionLeads: (reportingQuery: string, attributionKey: string) => {
    const query = new URLSearchParams(reportingQuery);
    query.set('attributionKey', attributionKey);
    return apiRequest(
      'GET',
      `/api/academy/modules/marketing/meta-attribution/leads?${query.toString()}`,
    ) as Promise<MetaAttributionLeadsData>;
  },
  events: () => apiRequest(
    'GET',
    '/api/academy/modules/marketing/meta-events',
  ) as Promise<MetaEventsData>,
  retryEvent: (id: number) => apiRequest(
    'POST',
    `/api/academy/modules/marketing/meta-events/${id}/retry`,
  ),
  syncCatalog: () => apiRequest(
    'POST',
    '/api/academy/modules/marketing/meta-attribution/sync',
  ) as Promise<{ synced: number }>,
};
