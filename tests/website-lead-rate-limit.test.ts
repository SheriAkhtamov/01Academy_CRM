import { describe, expect, it, vi } from 'vitest';
vi.mock('../server/services/website-lead-tokens', () => ({
  authenticateWebsiteLeadToken: (token: string) => token === 'Bearer fixture' ? '01academy.uz' : null,
}));
import { websiteLeadRateLimitKey } from '../server/middleware/rateLimiter';

const request = (token: string, visitor: string) => ({ ip: '172.18.0.9',
  get: (name: string) => ({ authorization: token, 'x-website-client-ip': visitor })[name] });

describe('website visitor rate limit', () => {
  it('keeps different visitors behind the same authenticated server separate', () => {
    expect(websiteLeadRateLimitKey(request('Bearer fixture', '203.0.113.1')))
      .not.toBe(websiteLeadRateLimitKey(request('Bearer fixture', '203.0.113.2')));
  });
  it('does not trust an unauthenticated visitor header', () => {
    expect(websiteLeadRateLimitKey(request('invalid', '203.0.113.1'))).toBe('172.18.0.9');
    expect(websiteLeadRateLimitKey(request('invalid', '203.0.113.2'))).toBe('172.18.0.9');
    expect(websiteLeadRateLimitKey(request('Bearer fixture', 'not-an-ip'))).toBe('172.18.0.9');
  });
});
