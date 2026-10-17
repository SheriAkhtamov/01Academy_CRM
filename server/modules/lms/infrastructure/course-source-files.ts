import { rows, type LmsSql } from './postgres-base';

/** A course source is shared across runs; it must never be claimed by the first group. */
export async function courseSourceFilesAvailable(sql: LmsSql, fileIds: readonly number[], runId: number): Promise<boolean> {
  if (!fileIds.length) return true;
  if (fileIds.some(id => !Number.isSafeInteger(id) || id < 1)) return false;
  const unique = [...new Set(fileIds)];
  const files = await rows<{ id: number }>(sql, `SELECT file.id FROM lms_files file
    JOIN academy_groups g ON g.course_id=file.course_id JOIN lms_group_runs run ON run.group_id=g.id
    WHERE file.id=ANY($1::bigint[]) AND run.id=$2 AND file.purpose='course_material' AND file.state='ready' AND file.deleted_at IS NULL
    FOR SHARE OF file`, [unique, runId]);
  if (files.length !== unique.length) return false;
  await sql.query('UPDATE lms_files SET attached_at=COALESCE(attached_at,now()) WHERE id=ANY($1::bigint[])', [unique]);
  return true;
}
