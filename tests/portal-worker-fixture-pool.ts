import type { Pool, PoolClient } from 'pg';

/** Independent test schemas represent independent queues; workers in one fixture still share a lock. */
export function isolatePortalWorkerFixture(pool: Pool, schema: string) {
  pool.on('connect', client => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    client.query = ((sql: unknown, ...args: unknown[]) => {
      if (typeof sql === 'string' && /pg_(?:try_)?advisory_(?:un)?lock/.test(sql) && Array.isArray(args[0])) {
        args[0] = args[0].map(value => typeof value === 'string' && value.startsWith('academy-lms-notification-worker:') ? `${value}:${schema}` : value);
      }
      return query(sql, ...args);
    }) as PoolClient['query'];
  });
}
