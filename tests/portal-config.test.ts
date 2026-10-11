import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateConfig, type AppConfig } from '../server/config';

const config = (): AppConfig => JSON.parse(readFileSync('config/app.config.example.json', 'utf8')) as AppConfig;
const configured = (): AppConfig => {
  const value = config();
  value.portal = {
    enabled: true,
    sessionSecret: 'portal-session-fixture-'.repeat(3),
    tokenEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
    groupIds: [2, 7],
  };
  return value;
};

describe('optional portal configuration', () => {
  it('keeps a deployed config without a portal section valid', () => {
    const value = config();
    delete value.portal;
    expect(() => validateConfig(value)).not.toThrow();
  });
  it('does not require new secrets while the portal is disabled', () => {
    expect(() => validateConfig(config())).not.toThrow();
  });
  it('validates independent configured portal secrets', () => {
    expect(() => validateConfig(configured())).not.toThrow();
  });
  it.each(['sessionSecret', 'tokenEncryptionKey'] as const)('rejects enabled portal without %s', (field) => {
    const value = configured();
    value.portal![field] = '';
    expect(() => validateConfig(value)).toThrow(`portal.${field}`);
  });
  it('rejects reuse of the staff session secret', () => {
    const value = configured();
    value.session.secret = value.portal!.sessionSecret!;
    expect(() => validateConfig(value)).toThrow('independent');
  });
  it.each([{ ids: [2, 2] }, { ids: [0] }, { ids: [-1] }, { ids: [1.5] }])('rejects an ambiguous pilot group list %j', ({ ids }) => {
    const value = configured();
    value.portal!.groupIds = ids;
    expect(() => validateConfig(value)).toThrow('distinct positive');
  });
  it('rejects string truthiness as a feature flag', () => {
    const value = configured();
    value.portal!.learningEnabled = 'false' as unknown as boolean;
    expect(() => validateConfig(value)).toThrow('boolean');
  });
});
