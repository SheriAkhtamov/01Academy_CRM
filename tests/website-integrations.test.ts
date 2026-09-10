import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAD_SOURCES } from '../shared/academy';
import {
  isLeadIntegrationProvider,
  websiteIntegrationDomain,
} from '../shared/lead-integrations';
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
    expect(websiteIntegrationDomain('website:01academy.pro')).toBe('01academy.pro');
    expect(isLeadIntegrationProvider('website:01academy.pro')).toBe(true);
    expect(isLeadIntegrationProvider('website')).toBe(false);
  });

  it('seeds separate lead sources instead of a generic website source', () => {
    expect(DEFAULT_LEAD_SOURCES).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'website:01academy.uz', name: '01academy.uz' }),
      expect.objectContaining({ code: 'website:01academy.pro', name: '01academy.pro' }),
    ]));
    expect((DEFAULT_LEAD_SOURCES as readonly { code: string }[])
      .some((source) => source.code === 'website')).toBe(false);
  });
});
