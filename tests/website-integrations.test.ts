import { describe, expect, it } from 'vitest';
import {
  normalizeWebsiteIntegrationDomain,
  websiteIntegrationProvider,
} from '../server/services/website-integrations';

describe('website integration identity', () => {
  it('groups www and bare origins under the same site', () => {
    expect(normalizeWebsiteIntegrationDomain('https://www.01academy.pro/form')).toBe('01academy.pro');
    expect(normalizeWebsiteIntegrationDomain('01academy.uz')).toBe('01academy.uz');
  });

  it('rejects missing or invalid site values', () => {
    expect(normalizeWebsiteIntegrationDomain(undefined)).toBeNull();
    expect(normalizeWebsiteIntegrationDomain('/contact')).toBeNull();
  });

  it('creates a stable integration key per site', () => {
    expect(websiteIntegrationProvider('01academy.uz')).toBe('website:01academy.uz');
    expect(websiteIntegrationProvider('01academy.pro')).toBe('website:01academy.pro');
  });
});
