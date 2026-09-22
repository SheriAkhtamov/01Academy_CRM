import { apiRequest } from '@/lib/queryClient';
export type IntegrationType = 'telegram_tasks' | 'website' | 'instagram' | 'meta' | 'onlinepbx';

export type SafeIntegrationSettings = Record<string, string | number | boolean | string[]>;

export const getIntegrationSettings = (provider: IntegrationType) =>
  apiRequest('GET', `/api/academy/integrations/settings/${provider}`) as Promise<SafeIntegrationSettings>;

export const saveIntegrationSettings = (provider: IntegrationType, draft: Record<string, string>) =>
  apiRequest('PUT', `/api/academy/integrations/settings/${provider}`, draft) as Promise<SafeIntegrationSettings>;

export const issueWebsiteToken = (domain: string) =>
  apiRequest('POST', '/api/academy/integrations/website-token', { domain }) as Promise<{ domain: string; token: string }>;
