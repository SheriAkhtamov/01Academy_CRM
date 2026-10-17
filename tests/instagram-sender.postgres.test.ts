import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptInstagramToken, sendInstagramTextMessage } from '../server/services/instagram';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../server/services/instagram-audience', () => ({ getInstagramConversationAudienceUserIds: async () => [7] }));
const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `ig_sender_${randomUUID().replace(/-/g, '')}`;

describe.skipIf(!url)('Instagram outgoing message authorship PostgreSQL', () => {
  let admin: Pool;
  let pool: Pool;
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Local isolated PostgreSQL required');
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE instagram_messages (
      id serial PRIMARY KEY, conversation_id integer, external_message_id text UNIQUE,
      direction text,sender_igsid text,recipient_igsid text,content text,message_type text,status text,
      sent_by integer,attachments jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE instagram_conversations(id integer PRIMARY KEY,last_message_at timestamptz,last_outbound_at timestamptz,updated_at timestamptz);
      CREATE TABLE academy_communications(id serial PRIMARY KEY,lead_id integer,channel text,result text,comment text,created_by integer);`);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE instagram_messages,instagram_conversations,academy_communications RESTART IDENTITY');
    await pool.query('INSERT INTO instagram_conversations(id) VALUES(9)');
    mocks.query.mockResolvedValue({ rows: [{ id: 9, account_status: 'connected', manager_id: 7, lead_id: 2,
      access_token_encrypted: encryptInstagramToken('synthetic-test-token'), last_inbound_at: new Date(),
      ig_user_id: 'academy', participant_igsid: 'parent' }] });
    mocks.connect.mockImplementation(() => pool.connect());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ recipient_id: 'parent', message_id: 'same-message' }), { headers: { 'content-type': 'application/json' } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });

  it.each([null, 8])('fills a webhook-first message author while preserving an already known sender (%s)', async (previousSender) => {
    await pool.query(`INSERT INTO instagram_messages(conversation_id,external_message_id,direction,content,sent_by)
      VALUES(9,'same-message','outbound','Спасибо!',$1)`, [previousSender]);
    const message = await sendInstagramTextMessage(9, 'Спасибо!', { id: 7, module: 'sales' });
    expect(message.sentBy).toBe(previousSender ?? 7);
    const stored = await pool.query('SELECT sent_by FROM instagram_messages WHERE external_message_id=$1', ['same-message']);
    expect(stored.rows).toEqual([{ sent_by: previousSender ?? 7 }]);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM instagram_messages')).rows[0].count).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
