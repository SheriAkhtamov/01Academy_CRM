import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateConfig, type AppConfig } from '../server/config';

const config = (): AppConfig => JSON.parse(readFileSync('config/app.config.example.json', 'utf8'));

describe('Meta account configuration', () => {
  it('accepts the existing primary account and additional numeric account IDs', () => {
    const value = config();
    Object.assign(value.integrations!.metaAds!, { adAccountId: '1355695016602510', adAccountIds: ['act_1770795927172689'], marketingPageId: '1171222076066744' });
    expect(() => validateConfig(value)).not.toThrow();
  });

  it.each([['not-an-account'], ['https://example.com'], [123456]])('rejects malformed account lists %j', (...ids) => {
    const value = config();
    value.integrations!.metaAds!.adAccountIds = ids as string[];
    expect(() => validateConfig(value)).toThrow('adAccountIds');
  });
});
