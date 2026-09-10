export const normalizeWebsiteIntegrationDomain = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim();
  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate);
  if (!hasProtocol && /[/?#]/.test(candidate)) return null;
  try {
    const url = new URL(
      hasProtocol ? candidate : `https://${candidate}`,
    );
    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') || null;
  } catch {
    return null;
  }
};

export const websiteIntegrationProvider = (domain: string) => `website:${domain}`;
