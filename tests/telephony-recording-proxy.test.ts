import { readFileSync } from 'node:fs';
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

const telephonyRoutes = readFileSync(
  new URL('../server/routes/telephony.routes.ts', import.meta.url),
  'utf8',
);
const academyRoutes = readFileSync(
  new URL('../server/routes/academy.routes.ts', import.meta.url),
  'utf8',
);

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

  it('keeps stored recordings playable even when legacy talk time is zero', () => {
    expect(telephonyRoutes).toContain(
      `(NULLIF(BTRIM(recording_url), '') IS NOT NULL OR talk_seconds > 0) AS "hasRecording"`,
    );
    expect(telephonyRoutes).toContain(
      `(NULLIF(BTRIM(call.recording_url), '') IS NOT NULL OR call.talk_seconds > 0) AS "hasRecording"`,
    );
    expect(academyRoutes).toContain(
      `(NULLIF(BTRIM(call.recording_url), '') IS NOT NULL OR call.talk_seconds > 0)`,
    );
    expect(telephonyRoutes).not.toContain('if (Number(call.talkSeconds) <= 0)');
    expect(telephonyRoutes).toContain('Using stored OnlinePBX recording URL after refresh failed');
  });
});
