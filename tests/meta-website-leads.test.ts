import { describe, expect, it } from 'vitest';
import { isWebsiteSubmissionId, resolveMetaWebsiteLanding } from '../shared/meta-website-leads';

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
});
