import { randomBytes } from 'node:crypto';
import type { PortalFileDto } from '@shared/contracts/portal-resources';
import { PORTAL_MAX_FILE_BYTES } from '@shared/contracts/portal-resources';
import type { CourseCurriculum } from '@shared/contracts/course-curriculum';
import { LocalResourceFileStore } from '../portal-resources/infrastructure/file-store';
import type { ResourceFileStore } from '../portal-resources/application/ports';
import { PortalResourceError } from '../portal-resources/domain/policy';
import { query, queryOne, withTransaction, type Row } from './academy-core';

const administratorSql = `SELECT employee.id FROM users employee WHERE employee.id=$1 AND employee.is_active=true AND employee.is_archived=false
  AND (employee.module='administration' OR EXISTS(SELECT 1 FROM user_modules granted WHERE granted.user_id=employee.id AND granted.module='administration'))`;

export async function assertCourseFileAdministrator(userId: number) {
  if (!await queryOne(administratorSql, [userId])) throw new PortalResourceError('portalAccessDenied', 403);
}

function present(file: Row): PortalFileDto {
  return { id: Number(file.id), name: file.name, mime: file.mime, size: Number(file.sizeBytes), state: file.state,
    rejectionCode: file.rejectionCode ?? null, createdAt: new Date(file.createdAt).toISOString(),
    downloadUrl: file.state === 'ready' ? `/api/academy/course-material-files/${file.id}/download` : null };
}

/** Course sources remain private and independent of a group's LMS runtime or timetable. */
export class CourseMaterialFileService {
  constructor(private readonly store: ResourceFileStore = new LocalResourceFileStore()) {}

  async upload(userId: number, temporaryPath: string, originalName: string) {
    const inspected = await this.store.inspect(temporaryPath, originalName);
    if (inspected.size < 1) throw new PortalResourceError('portalFileRequired');
    const storageKey = randomBytes(32).toString('base64url');
    const file = await withTransaction(async () => {
      await assertCourseFileAdministrator(userId);
      await query('SELECT pg_advisory_xact_lock(136036)');
      const settings = await queryOne<{ settings: { maxFileMiB?: number; schoolQuotaGiB?: number } }>('SELECT settings FROM lms_school_settings WHERE singleton=true');
      const maximum = Math.min(PORTAL_MAX_FILE_BYTES, Number(settings?.settings.maxFileMiB ?? 10) * 1024 ** 2);
      if (inspected.size > maximum) throw new PortalResourceError('portalFileTooLarge', 413);
      const used = await queryOne<{ totalBytes: number }>('SELECT COALESCE(sum(size_bytes),0) AS total_bytes FROM lms_files WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL');
      if (Number(used?.totalBytes ?? 0) + inspected.size > Number(settings?.settings.schoolQuotaGiB ?? 20) * 1024 ** 3) throw new PortalResourceError('portalFileQuotaExceeded', 413);
      return queryOne(`INSERT INTO lms_files(owner_user_id,purpose,name,mime,size_bytes,storage_key,sha256)
        VALUES($1,'course_material',$2,$3,$4,$5,$6) RETURNING *`, [userId, originalName, inspected.mime, inspected.size, storageKey, inspected.sha256]);
    });
    try {
      await this.store.commit(temporaryPath, storageKey);
      // Match the existing LMS integrity/signature verification before releasing a source attachment.
      const verified = await this.store.inspect(this.store.location(storageKey), originalName);
      if (verified.sha256 !== inspected.sha256 || verified.mime !== inspected.mime || verified.size !== inspected.size) throw new PortalResourceError('portalFileRejected');
      const ready = await queryOne("UPDATE lms_files SET state='ready',checked_at=now() WHERE id=$1 AND state='uploading' AND deleted_at IS NULL RETURNING *", [file!.id]);
      if (!ready) throw new PortalResourceError('portalUploadFailed');
      return present(ready);
    } catch (error) {
      await query("UPDATE lms_files SET deleted_at=now(),state='rejected',rejection_code='portalUploadFailed' WHERE id=$1", [file!.id]);
      await this.store.remove(storageKey);
      throw error;
    }
  }

  async file(userId: number, fileId: number, download = false) {
    await assertCourseFileAdministrator(userId);
    const file = await queryOne(`SELECT * FROM lms_files WHERE id=$1 AND purpose='course_material' AND deleted_at IS NULL
      AND (owner_user_id=$2 OR course_id IS NOT NULL)`, [fileId, userId]);
    if (!file) throw new PortalResourceError('portalNotFound', 404);
    if (download && file.state !== 'ready') throw new PortalResourceError('portalFileNotReady', 409);
    return { file: present(file), path: this.store.location(file.storageKey) };
  }
}

/** Called inside the course transaction. A source can be claimed only by its uploader or its bound course. */
export async function validateCourseMaterialFiles(program: CourseCurriculum, userId: number, courseId?: number) {
  const references = program.blocks.flatMap(block => block.lessons.flatMap(lesson => lesson.materials.filter(material => material.file)));
  if (!references.length) return [];
  await assertCourseFileAdministrator(userId);
  const ids = [...new Set(references.map(material => material.file!.id))].sort((left, right) => left - right);
  const files = await query(`SELECT * FROM lms_files WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE`, [ids]);
  if (files.length !== ids.length || files.some(file => file.purpose !== 'course_material' || file.deletedAt || file.state !== 'ready'
    || (file.courseId == null ? Number(file.ownerUserId) !== userId : Number(file.courseId) !== courseId))) throw new PortalResourceError('courseMaterialFileInvalid', 409);
  for (const material of references) {
    const file = files.find(file => Number(file.id) === material.file!.id)!;
    material.file = { id: Number(file.id), name: file.name, mime: file.mime, size: Number(file.sizeBytes) };
  }
  return ids;
}

export async function attachCourseMaterialFiles(fileIds: number[], courseId: number) {
  if (fileIds.length) await query('UPDATE lms_files SET course_id=$2,attached_at=COALESCE(attached_at,now()) WHERE id=ANY($1::bigint[])', [fileIds, courseId]);
}
