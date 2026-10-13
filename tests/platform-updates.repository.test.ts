import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { publishUpdateSchema, type UpdateContent } from '../shared/contracts/platform-updates';
import { PlatformUpdateService } from '../server/modules/platform-updates/application/update-service';
import { PostgresUpdateRepository } from '../server/modules/platform-updates/infrastructure/postgres-repository';

const command = () => publishUpdateSchema.parse({ publicationKey: 'legacy-release-one', content: {
  title: { ru: 'Обновление', en: 'Update' }, summary: { ru: 'Описание', en: 'Description' },
  sections: [{ heading: { ru: 'Изменения', en: 'Changes' }, paragraphs: [{ ru: 'Текст', en: 'Text' }] }],
} });
const legacyRow = () => ({
  id: 5,
  published_at: new Date('2026-10-13T07:00:00.000Z'),
  content: { ...command().content, category: 'sales', action: { href: '/sales/groups' } },
});

it('presents historical posts without retired metadata in every read path without mutating stored JSON', async () => {
  const row = legacyRow();
  const snapshot = structuredClone(row.content);
  const query = vi.fn().mockResolvedValue({ rows: [row] });
  const repository = new PostgresUpdateRepository({ query } as unknown as Pool);
  const expected = { id: row.id, content: command().content, publishedAt: row.published_at.toISOString() };

  expect(await repository.list()).toEqual([expected]);
  expect(await repository.find(row.id)).toEqual(expected);
  expect(await repository.findByKey(command().publicationKey)).toEqual(expected);
  expect(row.content).toEqual(snapshot);
  expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT '))).toBe(true);
});

function publicationRepository(row: ReturnType<typeof legacyRow> | { id: number; content: UpdateContent; published_at: Date }, created = false) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('INSERT INTO platform_updates')) return { rows: created ? [row] : [] };
    if (sql.startsWith('SELECT id, content')) return { rows: [row] };
    if (sql.startsWith('INSERT INTO notifications')) return { rows: [{ user_id: 1 }, { user_id: 7 }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return { repository: new PostgresUpdateRepository({ connect } as unknown as Pool), query, release };
}

it('retries a historical publication with only current content and does not deliver notifications again', async () => {
  const row = legacyRow();
  const snapshot = structuredClone(row.content);
  const { repository, query, release } = publicationRepository(row);
  const notify = vi.fn();
  const service = new PlatformUpdateService(repository, notify);

  expect(await service.publish(command(), 7)).toEqual({
    id: row.id, content: command().content, publishedAt: row.published_at.toISOString(),
  });
  expect(notify).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO notifications'))).toBe(false);
  expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE '))).toBe(false);
  expect(query).toHaveBeenLastCalledWith('COMMIT');
  expect(release).toHaveBeenCalledOnce();
  expect(row.content).toEqual(snapshot);
});

it.each(['title', 'summary', 'sections'] as const)('keeps a real %s change in a historical retry a conflict', async (field) => {
  const row = legacyRow();
  const { repository, query, release } = publicationRepository(row);
  const retry = command();
  if (field === 'sections') retry.content.sections[0].paragraphs[0].en = 'Changed text';
  else retry.content[field].en = 'Changed text';

  await expect(repository.publish(retry, 7)).rejects.toMatchObject({
    statusCode: 409, message: 'updatesPublicationConflict',
  });
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO notifications'))).toBe(false);
  expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(release).toHaveBeenCalledOnce();
  expect(row.content).toEqual(legacyRow().content);
});

it('stores a new current publication and delivers its notifications once after committing', async () => {
  const input = command();
  const row = { id: 8, content: input.content, published_at: new Date('2026-10-13T08:00:00.000Z') };
  const { repository, query, release } = publicationRepository(row, true);
  const notify = vi.fn(() => expect(query).toHaveBeenLastCalledWith('COMMIT'));
  const post = await new PlatformUpdateService(repository, notify).publish(input, 7);

  expect(post).toEqual({ id: row.id, content: input.content, publishedAt: row.published_at.toISOString() });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO platform_updates'), [
    input.publicationKey, JSON.stringify(input.content), 7,
  ]);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notifications'), [
    input.content.title.ru, input.content.summary.ru, row.id,
  ]);
  expect(notify).toHaveBeenCalledExactlyOnceWith([1, 7], row.id);
  expect(release).toHaveBeenCalledOnce();
});
