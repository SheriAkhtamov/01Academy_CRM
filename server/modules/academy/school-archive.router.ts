import type { Router } from 'express';
import { logger } from '../../lib/logger';
import { getPublicErrorMessage } from '../../lib/http-errors';
import {
  ACADEMY_SCHEDULING_ADVISORY_LOCK,
  createAudit,
  ensureAdministrationModuleAccess,
  parseId,
  query,
  queryOne,
  updateRow,
  withTransaction,
  type Row,
} from './academy-core';

export function registerSchoolArchiveRoutes(router: Router) {
  for (const archived of [true, false]) {
    router.post(`/schools/:id/${archived ? 'archive' : 'unarchive'}`, async (req, res) => {
      if (!ensureAdministrationModuleAccess(req, res)) return;
      try {
        const schoolId = parseId(req.params.id);
        if (!schoolId) return res.status(400).json({ error: 'Invalid school id' });
        const result = await withTransaction(async () => {
          await query('SELECT pg_advisory_xact_lock($1)', [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
          const school = await queryOne<Row>('SELECT * FROM academy_schools WHERE id = $1 FOR UPDATE', [schoolId]);
          if (!school) throw Object.assign(new Error('School not found'), { statusCode: 404 });
          if (Boolean(school.isArchived) === archived) return { school, oldSchool: school, rooms: [], oldRooms: [] };
          if (archived) {
            const group = await queryOne(
              `SELECT id FROM academy_groups
               WHERE school_id = $1 AND status IN ('open', 'in_progress') AND is_archived = false LIMIT 1`,
              [schoolId],
            );
            if (group) throw Object.assign(new Error('schoolArchiveHasActiveGroups'), { statusCode: 409 });
          }
          const oldRooms = await query<Row>(
            `SELECT * FROM academy_rooms WHERE school_id = $1 AND is_archived = $2
             ${archived ? '' : 'AND archived_by_school = true'} FOR UPDATE`,
            [schoolId, !archived],
          );
          const rooms = await query<Row>(archived
            ? `UPDATE academy_rooms SET archived_previous_is_active = is_active,
                 is_active = false, is_archived = true, archived_by_school = true, updated_at = NOW()
               WHERE school_id = $1 AND is_archived = false RETURNING *`
            : `UPDATE academy_rooms SET is_active = COALESCE(archived_previous_is_active, false),
                 is_archived = false, archived_previous_is_active = NULL, archived_by_school = false, updated_at = NOW()
               WHERE school_id = $1 AND is_archived = true AND archived_by_school = true RETURNING *`,
          [schoolId]);
          const updated = await updateRow('academy_schools', schoolId, archived
            ? { isArchived: true, archivedPreviousIsActive: school.isActive, isActive: false }
            : { isArchived: false, isActive: school.archivedPreviousIsActive ?? false, archivedPreviousIsActive: null });
          return { school: updated, oldSchool: school, rooms, oldRooms };
        });
        if (result.school !== result.oldSchool) {
          const action = archived ? 'ARCHIVE' : 'UNARCHIVE';
          await createAudit(req, `${action}_ACADEMY_SCHOOL`, 'academy_schools', schoolId, result.school, result.oldSchool);
          for (const room of result.rooms) {
            await createAudit(req, `${action}_ACADEMY_ROOM`, 'academy_rooms', room.id, room,
              result.oldRooms.find((previous) => previous.id === room.id));
          }
        }
        res.json(result.school);
      } catch (error: any) {
        logger.error('Failed to change school archive', { error, schoolId: req.params.id });
        res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to update school') });
      }
    });
  }
}
