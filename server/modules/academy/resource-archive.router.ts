import type { Router } from 'express';
import { logger } from '../../lib/logger';
import { getPublicErrorMessage } from '../../lib/http-errors';
import { ACADEMY_SCHEDULING_ADVISORY_LOCK, createAudit, ensureAdministrationModuleAccess, parseId, query, queryOne, updateRow, withTransaction, type Row } from './academy-core';

export function registerResourceArchiveRoutes(router: Router) {
  for (const resource of ['rooms', 'courses'] as const) {
    const table = resource === 'rooms' ? 'academy_rooms' : 'academy_courses';
    const groupColumn = resource === 'rooms' ? 'room_id' : 'course_id';
    for (const archived of [true, false]) {
      router.post(`/${resource}/:id/${archived ? 'archive' : 'unarchive'}`, async (req, res) => {
        if (!ensureAdministrationModuleAccess(req, res)) return;
        try {
          const id = parseId(req.params.id);
          if (!id) return res.status(400).json({ error: 'invalidData' });
          const result = await withTransaction(async () => {
            await query('SELECT pg_advisory_xact_lock($1)', [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
            const row = await queryOne<Row>(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
            if (!row) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
            if (Boolean(row.isArchived) === archived) return { row, previous: row };
            if (archived) {
              const group = await queryOne(`SELECT id FROM academy_groups
                WHERE ${groupColumn} = $1 AND status IN ('open', 'in_progress') AND is_archived = false LIMIT 1`, [id]);
              if (group) throw Object.assign(new Error(resource === 'rooms' ? 'roomHasActiveGroups' : 'courseHasActiveGroups'), { statusCode: 409 });
            } else if (resource === 'rooms') {
              const school = await queryOne<Row>('SELECT * FROM academy_schools WHERE id = $1 FOR SHARE', [row.schoolId]);
              if (!school || school.isArchived) throw Object.assign(new Error('schoolIsArchived'), { statusCode: 409 });
              if (school.isActive === false && row.archivedPreviousIsActive === true) {
                throw Object.assign(new Error('schoolMustBeActiveToRestoreRoom'), { statusCode: 409 });
              }
            }
            const updated = await updateRow(table, id, {
              isArchived: archived,
              isActive: archived ? false : row.archivedPreviousIsActive ?? false,
              archivedPreviousIsActive: archived ? row.isActive : null,
              ...(resource === 'rooms' ? { archivedBySchool: false } : {}),
            });
            return { row: updated, previous: row };
          });
          if (result.row !== result.previous) await createAudit(req,
            `${archived ? 'ARCHIVE' : 'UNARCHIVE'}_ACADEMY_${resource === 'rooms' ? 'ROOM' : 'COURSE'}`,
            table, id, result.row, result.previous);
          res.json(result.row);
        } catch (error: any) {
          logger.error('Failed to change resource archive', { error, resource, id: req.params.id });
          res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'updateFailed') });
        }
      });
    }
  }
}
