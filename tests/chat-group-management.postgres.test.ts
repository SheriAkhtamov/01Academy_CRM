import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
import { chatGroupStorage as storage } from '../server/storage/chat-group.storage';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `chat_members_${randomUUID().replace(/-/g, '')}`;
describe.skipIf(!url)('group membership with PostgreSQL transactions', () => {
  let admin: Pool; let pool: Pool; let groupId: number;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!target.pathname.endsWith('_test') || !['localhost', '127.0.0.1', 'postgres'].includes(target.hostname)) {
      throw new Error('This suite requires an explicitly configured disposable local test database');
    }
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE users(id integer PRIMARY KEY, full_name text NOT NULL, position text, avatar_url text,
      is_active boolean NOT NULL DEFAULT true, is_archived boolean NOT NULL DEFAULT false);
      CREATE TABLE chat_groups(id serial PRIMARY KEY, name varchar(80) NOT NULL,
        created_by integer REFERENCES users(id) ON DELETE SET NULL, creator_name text NOT NULL DEFAULT '', created_at timestamp DEFAULT now());
      CREATE TABLE chat_group_members(group_id integer REFERENCES chat_groups(id) ON DELETE CASCADE,
        user_id integer REFERENCES users(id) ON DELETE CASCADE, last_read_message_id integer NOT NULL DEFAULT 0, PRIMARY KEY(group_id,user_id));
      CREATE TABLE chat_group_messages(id serial PRIMARY KEY, group_id integer REFERENCES chat_groups(id) ON DELETE CASCADE,
        sender_id integer REFERENCES users(id) ON DELETE SET NULL, sender_name text NOT NULL DEFAULT '', content text NOT NULL,
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamp DEFAULT now());`);
    mocks.query.mockImplementation((text, values) => pool.query(text, values));
    mocks.connect.mockImplementation(() => pool.connect());
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE chat_group_messages, chat_group_members, chat_groups, users RESTART IDENTITY CASCADE');
    await pool.query(`INSERT INTO users(id,full_name,position,avatar_url,is_active) VALUES
      (1,'Owner','Manager',NULL,true),(2,'Alice','Teacher','/api/users/photos/aaaaaaaaaaaaaaaaaaaaa',true),
      (3,'Bob',NULL,NULL,true),(4,'Inactive',NULL,NULL,false),(5,'New member',NULL,NULL,true)`);
    groupId = (await storage.create(1, { name: 'Team', participantIds: [2, 3] })).id;
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it('returns photos, manages membership and preserves message history after removal', async () => {
    const message = await storage.send(groupId, 2, 'History', []);
    expect(message.senderAvatarUrl).toBe('/api/users/photos/aaaaaaaaaaaaaaaaaaaaa');
    expect((await storage.detail(groupId, 1, false))?.participants.find((member) => member.id === 2)?.position).toBe('Teacher');
    await storage.rename(groupId, 1, false, 'Tutors');
    await storage.addParticipants(groupId, 1, false, [5, 5, 2]);
    expect((await storage.detail(groupId, 5, false))?.unreadCount).toBe(0);
    expect((await storage.list(1))[0]).toMatchObject({ name: 'Tutors', participantCount: 4 });
    expect(await storage.removeParticipant(groupId, 1, false, 2)).toEqual([1, 2, 3, 5]);
    expect(await storage.memberIds(groupId, 2)).toBeNull();
    expect(await storage.detail(groupId, 2, true)).toBeNull();
    await expect(storage.send(groupId, 2, 'Revoked', [])).rejects.toMatchObject({ statusCode: 404 });
    expect((await storage.messages(groupId)).map((item) => item.content)).toEqual(['History']);
  });

  it('commits independent additions and exits without losing membership updates', async () => {
    await Promise.all([storage.addParticipants(groupId, 1, false, [5]), storage.leave(groupId, 3)]);
    expect((await storage.memberIds(groupId, 1))?.sort((a, b) => a - b)).toEqual([1, 2, 5]);
    await expect(storage.addParticipants(groupId, 1, false, [4])).rejects.toMatchObject({ message: 'chatGroupParticipantsUnavailable' });
    expect((await storage.list(1))[0].participantCount).toBe(3);
  });

  it('keeps an owner in the remaining membership when a successor exits concurrently', async () => {
    const results = await Promise.allSettled([storage.leave(groupId, 1, 2), storage.leave(groupId, 2)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const row = (await pool.query('SELECT created_by FROM chat_groups WHERE id=$1', [groupId])).rows[0];
    const members = (await pool.query('SELECT user_id FROM chat_group_members WHERE group_id=$1', [groupId])).rows;
    expect(members.some((member) => member.user_id === row.created_by)).toBe(true);
  });

  it('retains the group and messages after the last member leaves', async () => {
    await storage.send(groupId, 1, 'Saved history', []);
    await storage.leave(groupId, 2); await storage.leave(groupId, 3); await storage.leave(groupId, 1);
    expect(await storage.list(1)).toEqual([]);
    expect((await pool.query('SELECT created_by FROM chat_groups WHERE id=$1', [groupId])).rows[0].created_by).toBeNull();
    expect((await storage.messages(groupId))[0].content).toBe('Saved history');
  });
});
