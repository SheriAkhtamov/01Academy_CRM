import { describe, expect, it } from 'vitest';
import { isWebsiteSubmissionId, resolveMetaWebsiteLanding, resolveMetaWebsiteSubmission } from '../shared/meta-website-leads';

describe('Meta website landing identity', () => {
  it.each([
    ['explorer', 'ai-kids'], ['creator', 'ai-creator'], ['professional', 'vibe-coding'],
  ])('recognizes %s in both languages as %s', (id, slug) => {
    for (const locale of ['ru', 'uz']) {
      expect(resolveMetaWebsiteLanding(`https://01academy.uz/${locale}/meta/courses/${id}`, '01academy.uz'))
        .toMatchObject({ courseId: id, courseSlug: slug });
    }
  });
  it.each([
    'https://01academy.uz/ru/courses/explorer?utm_source=meta',
    'https://01academy.uz/ru/meta/courses/unknown',
    'https://other.example/ru/meta/courses/explorer',
    'https://01academy.uz.other.example/ru/meta/courses/explorer',
    'javascript:/ru/meta/courses/explorer', '/ru/meta/courses/explorer',
  ])('does not turn an unrelated page into Meta: %s', (url) => {
    expect(resolveMetaWebsiteLanding(url, '01academy.uz')).toBeNull();
  });
  it('requires the matching site token and captures real ad IDs and UTM values', () => {
    const url = 'https://www.01academy.uz/uz/meta/courses/creator/?ad_id=123456&campaign_id=987654&utm_source=instagram&utm_campaign=Summer&utm_content=Reel';
    expect(resolveMetaWebsiteLanding(url, '01academy.pro')).toBeNull();
    expect(resolveMetaWebsiteLanding(url, '01academy.uz')).toMatchObject({ adId: '123456', campaignId: '987654',
      utm: { utm_source: 'instagram', utm_campaign: 'Summer', utm_content: 'Reel' } });
    expect(resolveMetaWebsiteLanding(url.replace('123456', '{{ad.id}}'), '01academy.uz')?.adId).toBeNull();
  });
  it('requires a valid stable form submission ID', () => {
    expect(isWebsiteSubmissionId('a8f6fc2a-91aa-4d83-b96b-12837f85e3fb')).toBe(true);
    for (const value of [undefined, '', 123, 'not-a-uuid']) expect(isWebsiteSubmissionId(value)).toBe(false);
  });
  it('accepts the campaign and adset macros used by current ads without inventing an ad ID', () => {
    const base = 'https://01academy.uz/ru/meta/courses/explorer?utm_id=120250568461990410&utm_term=120250568462000410';
    expect(resolveMetaWebsiteLanding(base, '01academy.uz')).toMatchObject({
      campaignId: '120250568461990410', adsetId: '120250568462000410', adId: null,
      utm: { utm_id: '120250568461990410' },
    });
    expect(resolveMetaWebsiteLanding(`${base}&campaign_id=12345&adset_id=67890`, '01academy.uz'))
      .toMatchObject({ campaignId: '12345', adsetId: '67890' });
    expect(resolveMetaWebsiteLanding(base.replace('120250568462000410', 'parents'), '01academy.uz')?.adsetId).toBeNull();
  });
  it('keeps the ad entry after navigation and language change, with the course actually selected', () => {
    const entry = 'https://01academy.uz/ru/meta/courses/explorer?utm_id=12345&utm_medium=ig';
    expect(resolveMetaWebsiteSubmission('https://01academy.uz/uz/courses/creator', entry, '01academy.uz'))
      .toMatchObject({ pageUrl: entry, courseId: 'creator', courseSlug: 'ai-creator', campaignId: '12345' });
    expect(resolveMetaWebsiteSubmission('https://01academy.uz/uz', entry, '01academy.uz', 'professional'))
      .toMatchObject({ courseId: 'professional', pageUrl: entry });
    expect(resolveMetaWebsiteSubmission('https://01academy.uz/ru', entry, '01academy.uz'))
      .toMatchObject({ courseId: 'explorer', pageUrl: entry });
  });
  it('rejects foreign stored entries and preserves support for old website clients', () => {
    const entry = 'https://01academy.uz/ru/meta/courses/explorer';
    expect(resolveMetaWebsiteSubmission('https://01academy.uz/ru', entry.replace('01academy.uz', 'evil.test'), '01academy.uz')).toBeNull();
    expect(resolveMetaWebsiteSubmission(entry, null, '01academy.uz')).toMatchObject({ courseId: 'explorer' });
    expect(resolveMetaWebsiteSubmission(entry, entry, '01academy.pro')).toBeNull();
    expect(resolveMetaWebsiteSubmission('https://evil.test/ru/courses/creator', entry, '01academy.uz', '__proto__'))
      .toMatchObject({ courseId: 'explorer' });
  });
});
