export { websiteIntegrationProvider } from '@shared/lead-integrations';

export const normalizeWebsiteIntegrationDomain = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim();
  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate);
  if (!hasProtocol && /[/?#]/.test(candidate)) return null;
  try {
    const url = new URL(
      hasProtocol ? candidate : `https://${candidate}`,
    );
    const domain = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return domain.length <= 71 ? domain || null : null;
  } catch {
    return null;
  }
};
