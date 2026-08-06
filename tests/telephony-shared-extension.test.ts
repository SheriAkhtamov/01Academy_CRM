import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../server/config', () => ({
  appConfig: { integrations: { onlinePbx: {} } },
  isDevelopmentEnvironment: false,
  isProductionEnvironment: false,
}));

vi.mock('../server/db', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: vi.fn(),
  },
}));

vi.mock('../server/services/onlinepbx', () => ({
  normalizeOnlinePbxPhone: (value: unknown) => {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits ? `+${digits}` : null;
  },
  onlinePbxClient: {},
  OnlinePbxError: class OnlinePbxError extends Error {},
}));

import {
  ONLINE_PBX_CALL_CORRELATION_WINDOW_SECONDS,
  ONLINE_PBX_SHARED_EXTENSION,
  onlinePbxExclusiveExtensionHolder,
  onlinePbxRoutingDestination,
  sharedCallEventClaimsOwnership,
} from '../shared/telephony';
import {
  findCallHandledInCrm,
  findManagerByExtensions,
} from '../server/routes/telephony.routes';

describe('shared OnlinePBX extension', () => {
  it('allows the existing extension 100 to be assigned without creating another user', () => {
    expect(ONLINE_PBX_SHARED_EXTENSION).toBe('100');
    expect(onlinePbxRoutingDestination(ONLINE_PBX_SHARED_EXTENSION)).toBe('100');
    expect(onlinePbxRoutingDestination('101')).toBe('101');
  });

  it('does not let a ringing or rejected browser claim an incoming call', () => {
    expect(sharedCallEventClaimsOwnership({
      direction: 'incoming',
      status: 'ringing',
      talkSeconds: 0,
    })).toBe(false);
    expect(sharedCallEventClaimsOwnership({
      direction: 'incoming',
      status: 'declined',
      talkSeconds: 0,
    })).toBe(false);
  });

  it('attributes the call to the employee who answers or starts it', () => {
    expect(sharedCallEventClaimsOwnership({
      direction: 'incoming',
      status: 'connected',
      talkSeconds: 0,
    })).toBe(true);
    expect(sharedCallEventClaimsOwnership({
      direction: 'incoming',
      status: 'ended',
      talkSeconds: 18,
    })).toBe(true);
    expect(sharedCallEventClaimsOwnership({
      direction: 'outgoing',
      status: 'dialing',
      talkSeconds: 0,
    })).toBe(true);
  });

  it('reads an extension as a name only while one manager holds it', () => {
    const honzoda = { id: 7, extension: '100' };
    const maftuna = { id: 16, extension: '100' };

    expect(onlinePbxExclusiveExtensionHolder([honzoda])).toBe(honzoda);
    expect(onlinePbxExclusiveExtensionHolder([honzoda, maftuna])).toBeNull();
    expect(onlinePbxExclusiveExtensionHolder([])).toBeNull();
  });
});

// Postgres rejects a whole statement when it has to read one parameter as two
// different types, and it does so at plan time — the pool is mocked here, so no
// amount of unit testing reaches it. Between 2026-07-23 and 2026-08-06 that made
// every web phone report fail with 500 "inconsistent types deduced for parameter
// $4", which is why the journal fell back to guessing the employee. These
// assertions pin the casts that keep each parameter to a single type.
describe('web phone call statements', () => {
  const source = readFileSync(
    new URL('../server/routes/telephony.routes.ts', import.meta.url),
    'utf8',
  );

  it('keeps the direction and status parameters to one type', () => {
    // $4 is assigned to a varchar column and compared against a bare literal.
    expect(source).toContain('direction = $4::text');
    expect(source).toContain("WHEN $4::text = 'incoming'");
    expect(source).not.toMatch(/WHEN \$4 = 'incoming'/);
    // $5 sits in the same CASE and is pinned alongside it. The webhook
    // statement leaves its own $5 uncast, which Postgres resolves cleanly
    // because nothing there compares it to a literal and assigns it both.
    expect(source).toContain('ELSE $5::text');
    expect(source).toContain("$5::text IN ('ended', 'failed', 'declined', 'missed')");
  });

  it('keeps the conditional employee column an integer', () => {
    expect(source).toContain('CASE WHEN $17 THEN $2::integer ELSE NULL::integer END');
    expect(source).not.toContain('CASE WHEN $17 THEN $2 ELSE NULL END');
  });
});

describe('call ownership on a shared extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names nobody when the extension belongs to more than one manager', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [
        { id: 7, extension: '100' },
        { id: 16, extension: '100' },
      ],
    });

    await expect(findManagerByExtensions(['100', '998901234567'])).resolves.toBeNull();

    const [sql, params] = mocks.poolQuery.mock.calls[0];
    expect(params).toEqual([['100']]);
    expect(sql).toContain('LIMIT 2');
  });

  it('still names the manager who owns an extension alone', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: 16, extension: '102' }] });

    await expect(findManagerByExtensions(['102'])).resolves.toEqual({
      id: 16,
      extension: '102',
    });
  });

  it('gives the call to the manager whose web phone recorded it', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [{ id: 512, userId: 16, extension: '100' }],
    });

    await expect(findCallHandledInCrm(
      { query: mocks.poolQuery } as never,
      { direction: 'outgoing', phone: '+998901234567' },
    )).resolves.toEqual({ id: 512, userId: 16, extension: '100' });

    const [sql, params] = mocks.poolQuery.mock.calls[0];
    expect(params).toEqual([
      'outgoing',
      '+998901234567',
      ONLINE_PBX_CALL_CORRELATION_WINDOW_SECONDS,
    ]);
    // Only a call the provider has not reported yet may be adopted, and the
    // window is measured on the server clock rather than the browser's.
    expect(sql).toContain('call.provider_call_id IS NULL');
    expect(sql).toContain('call.client_call_id IS NOT NULL');
    expect(sql).toContain('call.created_at >= NOW() - make_interval(secs => $3)');
    expect(sql).toContain('ORDER BY call.user_id IS NULL');
  });
});
