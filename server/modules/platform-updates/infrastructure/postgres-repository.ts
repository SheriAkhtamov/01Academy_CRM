import type { Pool } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import type { UpdateRepository } from '../application/update-service';
import type { PlatformUpdate, PublishUpdateCommand, UpdatePublicationResult, UpdateContent } from '@shared/contracts/platform-updates';

type Row = { id: number; content: UpdateContent; published_at: Date };
// Historical JSON may contain retired metadata. Present only current content fields without rewriting it.
const present = (row: Row): PlatformUpdate => ({
  id: row.id,
  content: { title: row.content.title, summary: row.content.summary, sections: row.content.sections },
  publishedAt: row.published_at.toISOString(),
});
export class PostgresUpdateRepository implements UpdateRepository {
  constructor(private readonly pool: Pool) {}
  async list() {
    const rows = await this.pool.query<Row>('SELECT id, content, published_at FROM platform_updates ORDER BY published_at DESC, id DESC LIMIT 100');
    return rows.rows.map(present);
  }
  async find(id: number) {
    const result = await this.pool.query<Row>('SELECT id, content, published_at FROM platform_updates WHERE id=$1', [id]);
    return result.rows[0] ? present(result.rows[0]) : null;
  }
  async findByKey(key: string) {
    const result = await this.pool.query<Row>('SELECT id, content, published_at FROM platform_updates WHERE publication_key=$1', [key]);
    return result.rows[0] ? present(result.rows[0]) : null;
  }
  async publish(command: PublishUpdateCommand, actorId: number | null): Promise<UpdatePublicationResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<Row>(`INSERT INTO platform_updates(publication_key, content, created_by)
        VALUES($1, $2::jsonb, $3) ON CONFLICT(publication_key) DO NOTHING RETURNING id, content, published_at`,
      [command.publicationKey, JSON.stringify(command.content), actorId]);
      const created = Boolean(inserted.rows[0]);
      const row = inserted.rows[0] ?? (await client.query<Row>(
        'SELECT id, content, published_at FROM platform_updates WHERE publication_key=$1', [command.publicationKey])).rows[0];
      const post = row && present(row);
      if (!post || !isDeepStrictEqual(post.content, command.content)) {
        throw Object.assign(new Error('updatesPublicationConflict'), { statusCode: 409 });
      }
      let recipientIds: number[] = [];
      if (created) {
        const recipients = await client.query<{ user_id: number }>(`INSERT INTO notifications
          (user_id, type, title, message, is_read, related_entity_type, related_entity_id)
          SELECT id, 'platform_update', $1, $2, false, 'platform_update', $3 FROM users
          WHERE is_active=true AND is_archived=false RETURNING user_id`,
        [command.content.title.ru, command.content.summary.ru, post.id]);
        recipientIds = recipients.rows.map((recipient) => recipient.user_id);
      }
      await client.query('COMMIT');
      return { post, recipientIds, created };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}
