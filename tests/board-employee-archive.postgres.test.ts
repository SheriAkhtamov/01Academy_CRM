import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boardTaskEmployeeArchiveSql } from '../server/lib/board-task-archive';
import { canCommentOnBoardTask, canEditBoardTask, canFinalizeBoardTask, canManageBoardTask } from '../shared/board-permissions';

const connectionString = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `employee_tasks_${randomUUID().replace(/-/g, '')}`;

describe.skipIf(!connectionString)('employee task archive without changing execution history', () => {
  let admin: Pool;
  let db: Pool;
  const archived = boardTaskEmployeeArchiveSql('board_tasks');
  const ids = async (archive: boolean) => (await db.query(`SELECT id FROM board_tasks WHERE
    ${archive ? `(status='accepted' OR ${archived})` : `(status<>'accepted' AND NOT ${archived})`} ORDER BY id`)).rows.map(row => row.id);
  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await db.query(`CREATE TABLE users(id int PRIMARY KEY,is_archived boolean NOT NULL DEFAULT false);
      CREATE TABLE board_tasks(id int PRIMARY KEY,creator_id int REFERENCES users(id),assignee_id int REFERENCES users(id),status text);
      CREATE TABLE board_task_comments(id int PRIMARY KEY,task_id int REFERENCES board_tasks(id),body text);
      INSERT INTO users VALUES(1,false),(2,false),(3,true);
      INSERT INTO board_tasks VALUES(1,1,2,'todo'),(2,2,1,'done'),(3,1,2,'accepted'),(4,1,1,'in_progress'),(5,2,3,'backlog');
      INSERT INTO board_task_comments VALUES(1,1,'Keep task history');`);
  });
  beforeEach(async () => { await db.query('UPDATE users SET is_archived=false WHERE id=2'); });
  afterAll(async () => {
    if (db) await db.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  it('moves both authored and assigned work to the existing archive, retaining status and ownership', async () => {
    expect(await ids(false)).toEqual([1,2,4]);
    await db.query('UPDATE users SET is_archived=true WHERE id=2');
    expect(await ids(false)).toEqual([4]);
    expect(await ids(true)).toEqual([1,2,3,5]);
    expect((await db.query('SELECT * FROM board_tasks ORDER BY id')).rows.slice(0,2)).toEqual([
      { id:1,creator_id:1,assignee_id:2,status:'todo' }, { id:2,creator_id:2,assignee_id:1,status:'done' },
    ]);
    expect((await db.query('SELECT body FROM board_task_comments')).rows).toEqual([{ body:'Keep task history' }]);
  });
  it('restores unfinished work, while accepted work and tasks of another archived employee stay archived', async () => {
    await db.query('UPDATE users SET is_archived=true WHERE id=2');
    await db.query('UPDATE users SET is_archived=false WHERE id=2');
    expect(await ids(false)).toEqual([1,2,4]);
    expect(await ids(true)).toEqual([3,5]);
  });
  it('makes archived employee tasks read only even for their original active author or assignee', async () => {
    await db.query('UPDATE users SET is_archived=true WHERE id=2');
    const task = (await db.query(`SELECT creator_id AS "creatorId",assignee_id AS "assigneeId", status,
      ${archived} AS "archivedWithEmployee" FROM board_tasks WHERE id=1`)).rows[0];
    for (const permission of [canEditBoardTask,canManageBoardTask,canFinalizeBoardTask,canCommentOnBoardTask]) {
      expect(permission({ id:1 },task)).toBe(false);
      expect(permission({ id:2 },task)).toBe(false);
    }
  });
});
