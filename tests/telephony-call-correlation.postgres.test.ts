import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/config', () => ({ appConfig: { integrations: { onlinePbx: {} } },
  isDevelopmentEnvironment: false, isProductionEnvironment: false }));
vi.mock('../server/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../server/services/onlinepbx', () => ({ onlinePbxClient: {},
  normalizeOnlinePbxPhone: (value: unknown) => String(value), OnlinePbxError: class extends Error {} }));

import { findCallHandledInCrm, findCallReportedByProvider } from '../server/routes/telephony.routes';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `call_identity_${randomUUID().replace(/-/g, '')}`;

describe.skipIf(!url)('incoming call correlation on PostgreSQL', () => {
  let admin: Pool;
  let database: Pool;
  const startedAt = new Date();
  const input = { direction: 'incoming' as const, phone: '+998901234567',
    startedAt, extension: '100', status: 'ringing' as const };

  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('Local isolated PostgreSQL required');
    }
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC` });
    await database.query(`CREATE TABLE users(id integer PRIMARY KEY, online_pbx_extension text, is_active boolean);
      CREATE TABLE telephony_calls(id serial PRIMARY KEY,client_call_id text,provider_call_id text,
      direction text,phone text,status text,extension text,user_id integer,started_at timestamp,
      created_at timestamp DEFAULT timezone('UTC',now()),ended_at timestamp)`);
  });
  beforeEach(async () => { await database.query('TRUNCATE telephony_calls RESTART IDENTITY'); });
  afterAll(async () => {
    await database?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  const insert = (clientId: string | null, providerId: string | null, status = 'ringing', start = startedAt, extension = '100') => (
    database.query(`INSERT INTO telephony_calls(client_call_id,provider_call_id,direction,phone,status,extension,started_at,ended_at)
      VALUES($1,$2,'incoming',$3,$4,$5,$6,CASE WHEN $4='missed' THEN $6::timestamp+interval '1 second' ELSE NULL END)`,
    [clientId, providerId, input.phone, status, extension, start])
  );

  it('does not adopt an ended same-phone call when a new incoming call starts seconds later', async () => {
    await insert(null, 'old-provider', 'missed', new Date(startedAt.getTime() - 2_000));
    expect(await findCallReportedByProvider(database, input)).toBeNull();
    await insert('old-browser', null, 'missed', new Date(startedAt.getTime() - 2_000));
    expect(await findCallHandledInCrm(database, input)).toBeNull();
    await insert(null, 'new-provider');
    expect(await findCallReportedByProvider(database, input)).toBe(3);
  });
  it('does not assign delayed end replay to a currently active same-phone call', async () => {
    await insert(null, 'new-provider');
    expect(await findCallReportedByProvider(database, { ...input, status: 'ended' })).toBeNull();
    const rows = (await database.query('SELECT provider_call_id,status,ended_at FROM telephony_calls')).rows;
    expect(rows).toEqual([{ provider_call_id: 'new-provider', status: 'ringing', ended_at: null }]);
  });
  it('requires a unique live candidate with matching arrival time and extension', async () => {
    await insert(null, 'different-extension', 'ringing', startedAt, '101');
    await insert(null, 'older-call', 'ringing', new Date(startedAt.getTime() - 20_000));
    expect(await findCallReportedByProvider(database, input)).toBeNull();
    await insert(null, 'first-match');
    expect(await findCallReportedByProvider(database, input)).toBe(3);
    await insert(null, 'second-match');
    expect(await findCallReportedByProvider(database, input)).toBeNull();
  });
});
