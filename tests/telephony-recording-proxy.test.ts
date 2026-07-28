import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/config', () => ({
  appConfig: {
    integrations: {
      onlinePbx: {
        apiUrl: 'https://api2.onlinepbx.ru/api',
      },
    },
  },
  isDevelopmentEnvironment: false,
  isProductionEnvironment: false,
}));

vi.mock('../server/db', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('../server/services/onlinepbx', () => ({
  normalizeOnlinePbxPhone: vi.fn(),
  onlinePbxClient: {},
  OnlinePbxError: class OnlinePbxError extends Error {},
}));

import { isAllowedOnlinePbxRecordingUrl } from '../server/routes/telephony.routes';

describe('OnlinePBX recording proxy URL validation', () => {
  it('allows only HTTPS recording downloads from the configured OnlinePBX origin', () => {
    expect(isAllowedOnlinePbxRecordingUrl(
      new URL('https://api2.onlinepbx.ru/calls-records/download/signature/rec.mp3'),
    )).toBe(true);
    expect(isAllowedOnlinePbxRecordingUrl(
      new URL('https://api2.onlinepbx.ru/mongo_history/search.json'),
    )).toBe(false);
    expect(isAllowedOnlinePbxRecordingUrl(
      new URL('https://attacker.example/calls-records/download/signature/rec.mp3'),
    )).toBe(false);
    expect(isAllowedOnlinePbxRecordingUrl(
      new URL('http://api2.onlinepbx.ru/calls-records/download/signature/rec.mp3'),
    )).toBe(false);
    expect(isAllowedOnlinePbxRecordingUrl(
      new URL('https://user:pass@api2.onlinepbx.ru/calls-records/download/signature/rec.mp3'),
    )).toBe(false);
  });
});
