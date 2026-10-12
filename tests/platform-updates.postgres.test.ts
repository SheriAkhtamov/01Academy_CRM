import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresUpdateRepository } from '../server/modules/platform-updates/infrastructure/postgres-repository';
import { PlatformUpdateService } from '../server/modules/platform-updates/application/update-service';
import { publishUpdateSchema } from '../shared/contracts/platform-updates';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `updates_${randomUUID().replace(/-/g, '')}`;
const command = () => publishUpdateSchema.parse({ publicationKey: 'test-release-one', content: {
  title: { ru: 'Новая функция', en: 'New feature' }, summary: { ru: 'Описание', en: 'Description' },
  sections: [{ paragraphs: [{ ru: 'Как пользоваться', en: 'How to use it' }] }],
} });
describe.skipIf(!url)('platform update publication transactions', () => {
  let admin: Pool; let pool: Pool; let repository: PostgresUpdateRepository;
  const notify = vi.fn();
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY, is_active boolean, is_archived boolean);
      CREATE TABLE notifications(id serial PRIMARY KEY, user_id integer REFERENCES users(id), type varchar(50),
        title varchar(255), message text, is_read boolean DEFAULT false,
        related_entity_type varchar(50), related_entity_id integer, created_at timestamptz DEFAULT now());`);
    await pool.query(readFileSync('migrations/0140_platform_updates.sql', 'utf8'));
    repository = new PostgresUpdateRepository(pool);
  });
  beforeEach(async () => {
    notify.mockReset();
    await pool.query('TRUNCATE platform_updates, notifications, users RESTART IDENTITY CASCADE');
    await pool.query('INSERT INTO users(is_active,is_archived) VALUES(true,false),(true,false),(true,false),(false,false),(true,true)');
  });
  afterAll(async () => { if (pool) await pool.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
  it('publishes once under concurrency and notifies every active employee including the author', async () => {
    const service = new PlatformUpdateService(repository, notify);
    const [first, retry] = await Promise.all([service.publish(command(), 1), service.publish(command(), 1)]);
    expect(first.id).toBe(retry.id);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith([1, 2, 3], first.id);
    expect((await repository.list())).toHaveLength(1);
    expect(await repository.find(first.id)).toEqual(first);
    const rows = (await pool.query('SELECT user_id,is_read,related_entity_type,related_entity_id FROM notifications ORDER BY user_id')).rows;
    expect(rows).toEqual([1, 2, 3].map((userId) => ({ user_id: userId, is_read: false, related_entity_type: 'platform_update', related_entity_id: first.id })));
  });
  it('does not resend a cleared notification on a publication retry or later restart', async () => {
    const service = new PlatformUpdateService(repository, notify);
    const first = await service.publish(command(), 1);
    await pool.query('DELETE FROM notifications');
    expect((await service.publish(command(), 1)).id).toBe(first.id);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM notifications')).rows[0].count).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(await repository.findByKey(command().publicationKey)).toEqual(first);
    await service.publish({ ...command(), publicationKey: 'test-release-two' }, 1);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM notifications')).rows[0].count).toBe(3);
  });
  it('rolls back both the post and the entire delivery if one notification fails', async () => {
    await pool.query('ALTER TABLE notifications ADD CONSTRAINT fail_one_employee CHECK(user_id <> 2)');
    try {
      await expect(repository.publish(command(), 1)).rejects.toBeTruthy();
      expect((await repository.list())).toHaveLength(0);
      expect((await pool.query('SELECT COUNT(*)::int AS count FROM notifications')).rows[0].count).toBe(0);
      expect(notify).not.toHaveBeenCalled();
    } finally { await pool.query('ALTER TABLE notifications DROP CONSTRAINT fail_one_employee'); }
    expect((await repository.publish(command(), 1)).recipientIds).toEqual([1, 2, 3]);
  });
  it('rejects a reused key with different content without republishing or changing the first post', async () => {
    const first = await repository.publish(command(), 1);
    await expect(repository.publish({ ...command(), content: { ...command().content, title: { ru: 'Другое', en: 'Different' } } }, 1))
      .rejects.toMatchObject({ statusCode: 409, message: 'updatesPublicationConflict' });
    expect(await repository.find(first.post.id)).toEqual(first.post);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM notifications')).rows[0].count).toBe(3);
  });
});
