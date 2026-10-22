import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresPortalRepository } from '../server/modules/portal-identity/infrastructure/postgres-repository';
import { PortalIdentityService } from '../server/modules/portal-identity/application/identity-service';
import { createPortalCrypto } from '../server/modules/portal-identity/infrastructure/crypto';
import type { PortalRepository, PortalSession } from '../server/modules/portal-identity/application/ports';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `portal_consent_concurrency_${randomBytes(6).toString('hex')}`;
let admin: Pool;
let pool: Pool;

describe.skipIf(!databaseUrl)('Reciprocal adult representative consent concurrency', () => {
  beforeAll(async () => {
    if (!databaseUrl || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname))
      throw new Error('Local isolated PostgreSQL required');
    admin = new Pool({connectionString: databaseUrl});
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({connectionString: databaseUrl, options: `-c search_path=${schema} -c statement_timeout=5000`, max: 6});
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY);
      CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text NOT NULL,manager_id int REFERENCES users(id));`);
    await pool.query(readFileSync(new URL('../migrations/0134_portal_identity.sql', import.meta.url), 'utf8'));
    await pool.query(`INSERT INTO users DEFAULT VALUES;
      INSERT INTO academy_students(student_name,contact_name,manager_id) VALUES('Adult A','Adult A',1),('Adult B','Adult B',1);
      INSERT INTO portal_student_identity(student_id,classification,verified_at,verification_method,verified_by)
        VALUES(1,'adult',now(),'in_person',1),(2,'adult',now(),'in_person',1);
      INSERT INTO portal_accounts(login,full_name,status,password_hash)
        VALUES('adult.a','Adult A','active','hash'),('adult.b','Adult B','active','hash');
      INSERT INTO portal_student_links(account_id,student_id,kind,relationship,permissions,status,verified_at,verified_by) VALUES
        (1,1,'self',NULL,'[]','active',now(),1),(2,2,'self',NULL,'[]','active',now(),1),
        (1,2,'representative','other','["learning.read"]','suspended',now(),1),
        (2,1,'representative','other','["learning.read"]','suspended',now(),1);
      INSERT INTO portal_access_audit(actor_kind,staff_id,student_id,action,details) VALUES
        ('staff',1,2,'REPRESENTATIVE_ACCESS_CONFIRMED','{"linkId":3,"accountId":1}'),
        ('staff',1,1,'REPRESENTATIVE_ACCESS_CONFIRMED','{"linkId":4,"accountId":2}');`);
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it('serializes reciprocal consent and preserves both active links', async () => {
    const repository = createPostgresPortalRepository(pool);
    const now = Date.now();
    const sessions = [1,2].map((accountId): PortalSession => ({
      id: `session-${accountId}-${'a'.repeat(32)}`, accountId, authVersion: 1,
      createdAt: now, lastSeenAt: now, absoluteExpiresAt: now + 3_600_000,
      csrfToken: 'csrf-token', reauthenticatedAt: now,
    }));
    for (const session of sessions) await repository.saveSession(session);
    let arrivals = 0;
    let release: () => void = () => {};
    const bothStudentsLocked = new Promise<void>(resolve => { release = resolve; });
    const locks: number[][] = [];
    const traced = (target: PortalRepository, order?: number[]): PortalRepository => new Proxy(target, {
      get(object, property) {
        if (property === 'transaction') {
          return <T>(work: (transaction: PortalRepository) => Promise<T>) => object.transaction(transaction => {
            const transactionLocks: number[] = [];
            locks.push(transactionLocks);
            return work(traced(transaction, transactionLocks));
          });
        }
        if (property === 'getStudent' && order) {
          return async (id: number, lock = false) => {
            const student = await object.getStudent(id, lock);
            if (lock) {
              arrivals++;
              if (arrivals === 2) release();
              await bothStudentsLocked;
            }
            return student;
          };
        }
        if (property === 'getAccount' && order) {
          return async (id: number, lock = false) => {
            const account = await object.getAccount(id, lock);
            if (lock) {
              order.push(id);
              // Give the other command time to contend after the first real
              // account lock. Opposite lock orders would produce a DB deadlock.
              if (order.length === 1) await new Promise(resolve => setTimeout(resolve, 50));
            }
            return account;
          };
        }
        const value = Reflect.get(object, property);
        return typeof value === 'function' ? value.bind(object) : value;
      },
    });
    const service = new PortalIdentityService(traced(repository), createPortalCrypto(randomBytes(32).toString('base64')),
      {appUrl: 'https://academy.example', allowInvitations: true});
    const results = await Promise.allSettled([
      service.representativeConsent(sessions[0].id, 4, ['learning.read'], true),
      service.representativeConsent(sessions[1].id, 3, ['learning.read'], true),
    ]);
    expect(results).toEqual([{status:'fulfilled',value:undefined},{status:'fulfilled',value:undefined}]);
    expect(locks.map(order => [...new Set(order)])).toEqual([[1,2],[1,2]]);
    expect((await pool.query("SELECT id,status FROM portal_student_links WHERE kind='representative' ORDER BY id")).rows)
      .toEqual([{id:3,status:'active'},{id:4,status:'active'}]);
    expect((await pool.query("SELECT count(*)::int AS count FROM portal_access_audit WHERE action='CONSENT_GRANTED'")).rows[0].count).toBe(2);
  });
});
