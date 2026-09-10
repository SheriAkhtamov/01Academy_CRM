export const FIXED_LEAD_INTEGRATION_PROVIDERS = [
  'instagram',
  'meta',
  'onlinepbx',
] as const;

export type FixedLeadIntegrationProvider = typeof FIXED_LEAD_INTEGRATION_PROVIDERS[number];
export type WebsiteLeadIntegrationProvider = `website:${string}`;
export type LeadIntegrationProvider = FixedLeadIntegrationProvider | WebsiteLeadIntegrationProvider;

const WEBSITE_PROVIDER_PATTERN = /^website:[a-z\d](?:[a-z\d.-]{0,69}[a-z\d])?$/;

export const isWebsiteLeadIntegrationProvider = (
  value: unknown,
): value is WebsiteLeadIntegrationProvider => (
  typeof value === 'string' && WEBSITE_PROVIDER_PATTERN.test(value)
);

export const isLeadIntegrationProvider = (value: unknown): value is LeadIntegrationProvider => (
  FIXED_LEAD_INTEGRATION_PROVIDERS.includes(value as FixedLeadIntegrationProvider)
  || isWebsiteLeadIntegrationProvider(value)
);

export const websiteIntegrationProvider = (
  domain: string,
): WebsiteLeadIntegrationProvider => `website:${domain}`;

export const websiteIntegrationDomain = (provider: unknown): string | null => (
  isWebsiteLeadIntegrationProvider(provider) ? provider.slice('website:'.length) : null
);
