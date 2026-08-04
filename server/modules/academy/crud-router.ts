import { Router } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { pool } from '../../db';
import { appConfig } from '../../config';
import { requireAuth } from '../../middleware/auth.middleware';
import { storage } from '../../storage';
import { logger } from '../../lib/logger';
import { getPublicErrorMessage } from '../../lib/http-errors';
import { isGeneratedInstagramLeadName } from '../../lib/instagram-lead';
import {
  getZonedDateTimeParts,
  getZonedDateOnlyRange,
  getZonedDayRange,
  getZonedMonthRange,
  zonedWallClockToInstant,
} from '../../lib/academy-time';
import {
  buildRecurringLessonSchedule,
  type CalendarDate,
} from '../../lib/lesson-schedule';
import { runAutomations } from '../../services/automations';
import { onlinePbxClient, OnlinePbxError } from '../../services/onlinepbx';
import { syncLeadSourceChannel } from '../../services/lead-channels';
import { getWorkforcePolicy, maskPhone } from '../../services/workforce-policy';
import {
  CHURN_REASONS,
  FINAL_PROJECT_STATUSES,
  GROUP_STATUSES,
  LEAD_ARCHIVE_REASON_CODES,
  LEAD_STATUSES,
  LESSON_STATUSES,
  PAYMENT_DISCOUNTS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  REFERRAL_BENEFIT_TYPES,
  REFERRAL_TIERS,
  STUDENT_STATUSES,
  TARGET_ATTENDANCE_PERCENT,
  TARGET_CAC_UZS,
  TARGET_LTV_CAC_RATIO,
  TARGET_NPS,
  TARGET_ROAS,
  addDays,
  addMinutes,
  buildReferralCode,
  calculateAttendancePercent,
  calculateAverage,
  calculateAvgDealCycleDays,
  calculateAvgStudyMonths,
  calculateCac,
  calculateLtv,
  calculateNps,
  calculateProgressPercent,
  calculateRoas,
  calculateTrend,
  canAccessAcademyModule,
  getAssignedModules,
  getComputedPaymentStatus,
  hasLeadershipAccess,
  normalizeMoney,
  resolveStudentRiskFlags,
  resolveReferralLevel,
  resolveReferralMilestone,
  suggestCourseSlugByAge,
  validateLeadForStatusChange,
  validateLeadStatusTransition } from '@shared/academy';
import {
  getGroupScheduleValidationError,
  getMinimumGroupEndDate,
  normalizeWeeklySchedule,
  parseScheduleTimeToMinutes,
  scheduleIntervalsOverlap,
  weeklySchedulesOverlap,
  type NormalizedWeeklyScheduleItem,
} from '@shared/scheduling';
import {
  leadTagNameKey,
  normalizeLeadTagName,
  type LeadTagOption,
} from '@shared/lead-tags';

import {
  ACADEMY_SCHEDULING_ADVISORY_LOCK,
  Row,
  createAudit,
  deleteRow,
  ensureAdministrationModuleAccess,
  ensureMarketingAccess,
  ensureOperationsAccess,
  ensureModuleAccess,
  insertRow,
  nullableText,
  parseId,
  parseOptionalDate,
  query,
  queryOne,
  quoteIdent,
  safeJson,
  toBoolean,
  toIdOrNull,
  toIntegerOrNull,
  updateRow,
  withTransaction,
} from './academy-core';
import {
  buildCrudScope,
  groupSchedulePreparationRequired,
  materializeGroupLessons,
  prepareGroupMetadataMutation,
  prepareGroupMutation,
  prepareLessonMutation,
  reconcileAutomaticTeacherAssignments,
} from './academy-route-support';

export const createAcademyCrudRegistrar = (router: ReturnType<typeof Router>) => {
const registerSimpleCrud = (path: string, table: string, columns: string[], options: {
  orderBy?: string;
  listWhere?: string;
  allowedModules?: Set<string>;
  requireAdministration?: boolean;
  requireOperations?: boolean;
  requireMarketing?: boolean;
  allowCreate?: boolean;
  allowUpdate?: boolean;
  beforeCreate?: (context: { values: Row; req: any }) => Promise<void>;
  beforeUpdate?: (context: { id: number; values: Row; row: Row; req: any }) => Promise<void>;
  beforeDelete?: (context: { id: number; row: Row; req: any }) => Promise<void>;
} = {}) => {
  router.get(`/${path}`, async (req, res) => {
    if (options.allowedModules && !ensureModuleAccess(req, res, options.allowedModules, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationModuleAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    try {
      const scope = await buildCrudScope(req, table);
      if (scope.denied) return res.status(403).json({ error: `${path} access required` });
      const filters = [scope.whereSql, options.listWhere].filter(Boolean);
      const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const rows = await query(
        `SELECT * FROM ${quoteIdent(table)} ${whereSql} ORDER BY ${options.orderBy ?? 'created_at DESC, id DESC'}`,
        scope.params,
      );
      res.json(rows);
    } catch (error) {
      logger.error(`Failed to fetch ${path}`, { error });
      res.status(500).json({ error: `Failed to fetch ${path}` });
    }
  });

  router.get(`/${path}/:id`, async (req, res) => {
    if (options.allowedModules && !ensureModuleAccess(req, res, options.allowedModules, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationModuleAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: `Invalid ${path} id` });
      const scope = await buildCrudScope(req, table, 2);
      if (scope.denied) return res.status(403).json({ error: `${path} access required` });
      const scopedWhere = scope.whereSql ? `AND ${scope.whereSql}` : '';
      const listedWhere = options.listWhere ? `AND (${options.listWhere})` : '';
      const row = await queryOne(
        `SELECT * FROM ${quoteIdent(table)} WHERE id = $1 ${scopedWhere} ${listedWhere}`,
        [id, ...scope.params],
      );
      if (!row) return res.status(404).json({ error: `${path} not found` });
      res.json(row);
    } catch (error) {
      logger.error(`Failed to fetch ${path}`, { error });
      res.status(500).json({ error: `Failed to fetch ${path}` });
    }
  });

  router.post(`/${path}`, async (req, res) => {
    if (options.allowedModules && !ensureModuleAccess(req, res, options.allowedModules, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationModuleAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    if (options.allowCreate === false) return res.status(405).json({ error: 'methodNotAllowed' });
    if (options.requireOperations && getAssignedModules(req.user).includes('teacher') && !hasLeadershipAccess(req.user)) {
      return res.status(403).json({ error: 'Operations mutation access required' });
    }
    try {
      const values: Row = {  };
      for (const column of columns) {
        const value = req.body[column];
        if (column.endsWith('At') || column.endsWith('Date') || column === 'periodStart' || column === 'periodEnd') {
          values[column] = parseOptionalDate(value, column);
        } else if (column.endsWith('Id')) {
          values[column] = toIdOrNull(value, column);
        } else if (column.endsWith('Uzs') || column.endsWith('Count') || column.endsWith('Minutes') || column.endsWith('Days') || column === 'age' || column === 'score' || column === 'npsScore' || column === 'maxStudents' || column === 'capacity' || column === 'lessonNumber' || column === 'sortOrder') {
          values[column] = toIntegerOrNull(value);
        } else if (column === 'program' || column === 'schedule' || column === 'availability' || column === 'courseIds' || column === 'schoolIds' || column === 'riskFlags' || column === 'rooms') {
          values[column] = safeJson(value, []);
        } else if (['isActive', 'isSystem', 'isPipeline'].includes(column)) {
          values[column] = toBoolean(value);
        } else {
          values[column] = nullableText(value);
        }
      }

      if (table === 'academy_tasks' && !hasLeadershipAccess(req.user)) {
        const hasRequestedResponsible = req.body.responsibleId !== undefined
          && req.body.responsibleId !== null
          && req.body.responsibleId !== '';
        const requestedResponsibleId = hasRequestedResponsible
          ? parseId(req.body.responsibleId)
          : req.user!.id;
        if (!requestedResponsibleId) {
          return res.status(400).json({ error: 'Invalid responsible user' });
        }
        if (Number(requestedResponsibleId) !== Number(req.user!.id)) {
          return res.status(403).json({ error: 'Task mutation access required' });
        }
        // Staff-created tasks always remain in the creator's own scope. The old
        // pre-check defaulted to self but left the value itself undefined, which
        // inserted a NULL owner and made the new task immediately disappear.
        values.responsibleId = req.user!.id;
      }

      if (table === 'academy_marketing_expenses') {
        values.createdBy = req.user!.id;
        values.status = 'pending';
        values.approvedBy = null;
        values.approvedAt = null;
      }
      if (options.beforeCreate) {
        await options.beforeCreate({ values, req });
      }
      const row = table === 'academy_groups'
        ? await withTransaction(async () => {
          await prepareGroupMutation({ values, forceAutoAssign: req.body.autoAssign === true });
          const group = await insertRow(table, values);
          await materializeGroupLessons(Number(group.id));
          return await queryOne(`SELECT * FROM academy_groups WHERE id = $1`, [group.id]) ?? group;
        })
        : table === 'academy_lessons'
          ? await withTransaction(async () => {
            await prepareLessonMutation({
              values,
              forceAutoAssign: req.body.autoAssign === true || !values.teacherId,
            });
            return insertRow(table, values);
          })
        : table === 'academy_teachers'
          ? await withTransaction(async () => {
            await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
            const teacher = await insertRow(table, values);
            await reconcileAutomaticTeacherAssignments(Number(teacher.id));
            return teacher;
          })
        : await insertRow(table, values);
      await createAudit(req, `CREATE_${table.toUpperCase()}`, table, row.id, row);
      res.status(201).json(row);
    } catch (error: any) {
      logger.error(`Failed to create ${path}`, { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, `Failed to create ${path}`),
        ...(error.minimumEndDate ? { minimumEndDate: error.minimumEndDate } : {}),
      });
    }
  });

  router.patch(`/${path}/:id`, async (req, res) => {
    if (options.allowedModules && !ensureModuleAccess(req, res, options.allowedModules, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationModuleAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    if (options.allowUpdate === false) return res.status(405).json({ error: 'methodNotAllowed' });
    if (options.requireOperations && getAssignedModules(req.user).includes('teacher') && !hasLeadershipAccess(req.user)) {
      return res.status(403).json({ error: 'Operations mutation access required' });
    }
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: `Invalid ${path} id` });
      const oldRow = await queryOne(`SELECT * FROM ${quoteIdent(table)} WHERE id = $1`, [id]);
      if (!oldRow) return res.status(404).json({ error: `${path} not found` });
      if (table === 'academy_tasks' && !hasLeadershipAccess(req.user) && Number(oldRow.responsibleId) !== Number(req.user!.id)) {
        return res.status(403).json({ error: 'Task mutation access required' });
      }
      const values: Row = {};
      for (const column of columns) {
        if (!(column in req.body)) continue;
        const value = req.body[column];
        if (column.endsWith('At') || column.endsWith('Date') || column === 'periodStart' || column === 'periodEnd') {
          values[column] = parseOptionalDate(value, column);
        } else if (column.endsWith('Id')) {
          values[column] = toIdOrNull(value, column);
        } else if (column.endsWith('Uzs') || column.endsWith('Count') || column.endsWith('Minutes') || column.endsWith('Days') || column === 'age' || column === 'score' || column === 'npsScore' || column === 'maxStudents' || column === 'capacity' || column === 'lessonNumber' || column === 'sortOrder') {
          values[column] = toIntegerOrNull(value);
        } else if (column === 'program' || column === 'schedule' || column === 'availability' || column === 'courseIds' || column === 'schoolIds' || column === 'riskFlags' || column === 'rooms') {
          values[column] = safeJson(value, []);
        } else if (['isActive', 'isSystem', 'isPipeline'].includes(column)) {
          values[column] = toBoolean(value);
        } else {
          values[column] = nullableText(value);
        }
      }
      if (
        table === 'academy_tasks'
        && !hasLeadershipAccess(req.user)
        && Object.prototype.hasOwnProperty.call(req.body, 'responsibleId')
      ) {
        const requestedResponsibleId = parseId(req.body.responsibleId);
        if (!requestedResponsibleId) {
          return res.status(400).json({ error: 'Invalid responsible user' });
        }
        if (Number(requestedResponsibleId) !== Number(req.user!.id)) {
          return res.status(403).json({ error: 'Task mutation access required' });
        }
        values.responsibleId = req.user!.id;
      }
      const row = table === 'academy_groups'
        ? await withTransaction(async () => {
          await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
          const lockedRow = await queryOne(
            `SELECT * FROM academy_groups WHERE id = $1 FOR UPDATE`,
            [id],
          );
          if (!lockedRow) {
            throw Object.assign(new Error(`${path} not found`), { statusCode: 404 });
          }
          if (options.beforeUpdate) {
            await options.beforeUpdate({ id, values, row: lockedRow, req });
          }
          const prepareSchedule = groupSchedulePreparationRequired(values, lockedRow);
          if (prepareSchedule) {
            await prepareGroupMutation({
              values,
              oldRow: lockedRow,
              excludeGroupId: id,
              forceAutoAssign: req.body.autoAssign === true,
            });
          } else {
            await prepareGroupMetadataMutation(values, lockedRow);
          }
          const updatedGroup = await updateRow(table, id, values);
          await materializeGroupLessons(id);
          return await queryOne(`SELECT * FROM academy_groups WHERE id = $1`, [id]) ?? updatedGroup;
        })
        : table === 'academy_lessons'
          ? await withTransaction(async () => {
            await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
            const lockedRow = await queryOne(
              `SELECT * FROM academy_lessons WHERE id = $1 FOR UPDATE`,
              [id],
            );
            if (!lockedRow) {
              throw Object.assign(new Error(`${path} not found`), { statusCode: 404 });
            }
            if (options.beforeUpdate) {
              await options.beforeUpdate({ id, values, row: lockedRow, req });
            }
            await prepareLessonMutation({
              values,
              oldRow: lockedRow,
              excludeLessonId: id,
              forceAutoAssign: req.body.autoAssign === true,
            });
            const updatedLesson = await updateRow(table, id, values);
            if (values.status !== undefined && lockedRow.status !== updatedLesson?.status) {
              await insertRow('academy_lesson_status_history', {
                lessonId: id,
                fromStatus: lockedRow.status ?? null,
                toStatus: updatedLesson?.status ?? String(values.status),
                changedBy: req.user!.id,
                comment: nullableText(req.body.statusComment) ?? null,
              });
            }
            return updatedLesson;
          })
        : table === 'academy_teachers'
          && ['courseIds', 'schoolIds', 'availability', 'schedule', 'status']
            .some((field) => field in req.body)
          ? await withTransaction(async () => {
            await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
            const lockedTeacher = await queryOne(
              `SELECT * FROM academy_teachers WHERE id = $1 FOR UPDATE`,
              [id],
            );
            if (!lockedTeacher) {
              throw Object.assign(new Error(`${path} not found`), { statusCode: 404 });
            }
            if (options.beforeUpdate) {
              await options.beforeUpdate({ id, values, row: lockedTeacher, req });
            }
            const updatedTeacher = await updateRow(table, id, values);
            await reconcileAutomaticTeacherAssignments(id);
            return updatedTeacher;
          })
        : options.beforeUpdate
          ? await withTransaction(async () => {
            const lockedRow = await queryOne(
              `SELECT * FROM ${quoteIdent(table)} WHERE id = $1 FOR UPDATE`,
              [id],
            );
            if (!lockedRow) {
              throw Object.assign(new Error(`${path} not found`), { statusCode: 404 });
            }
            await options.beforeUpdate!({ id, values, row: lockedRow, req });
            return updateRow(table, id, values);
          })
          : await updateRow(table, id, values);
      await createAudit(req, `UPDATE_${table.toUpperCase()}`, table, id, row, oldRow);
      res.json(row);
    } catch (error: any) {
      logger.error(`Failed to update ${path}`, { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, `Failed to update ${path}`),
        ...(error.minimumEndDate ? { minimumEndDate: error.minimumEndDate } : {}),
      });
    }
  });

  router.delete(`/${path}/:id`, async (req, res) => {
    if (options.allowedModules && !ensureModuleAccess(req, res, options.allowedModules, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationModuleAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    if (options.requireOperations && getAssignedModules(req.user).includes('teacher') && !hasLeadershipAccess(req.user)) {
      return res.status(403).json({ error: 'Operations mutation access required' });
    }
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: `Invalid ${path} id` });
      const scope = await buildCrudScope(req, table, 2);
      if (scope.denied) return res.status(403).json({ error: `${path} access required` });
      const scopedWhere = scope.whereSql ? `AND ${scope.whereSql}` : '';
      const row = await queryOne(`SELECT * FROM ${quoteIdent(table)} WHERE id = $1 ${scopedWhere}`, [id, ...scope.params]);
      if (!row) return res.status(404).json({ error: `${path} not found` });
      if (table === 'academy_lead_statuses') {
        await withTransaction(async () => {
          const lockedRow = await queryOne(
            `SELECT * FROM academy_lead_statuses WHERE id = $1 FOR UPDATE`,
            [id],
          );
          if (!lockedRow) {
            throw Object.assign(new Error(`${path} not found`), { statusCode: 404 });
          }
          if (options.beforeDelete) {
            await options.beforeDelete({ id, row: lockedRow, req });
          }
          await deleteRow(table, id);
        });
      } else if (table === 'academy_teachers') {
        await withTransaction(async () => {
          await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
          const lockedTeacher = await queryOne(
            `SELECT * FROM academy_teachers WHERE id = $1 FOR UPDATE`,
            [id],
          );
          if (!lockedTeacher) {
            throw Object.assign(new Error(`${path} not found`), { statusCode: 404 });
          }
          if (options.beforeDelete) {
            await options.beforeDelete({ id, row: lockedTeacher, req });
          }
          await deleteRow(table, id);
          await reconcileAutomaticTeacherAssignments(null);
        });
      } else {
        await withTransaction(async () => {
          const lockedRow = await queryOne(
            `SELECT * FROM ${quoteIdent(table)} WHERE id = $1 FOR UPDATE`,
            [id],
          );
          if (!lockedRow) {
            throw Object.assign(new Error(`${path} not found`), { statusCode: 404 });
          }
          if (options.beforeDelete) {
            await options.beforeDelete({ id, row: lockedRow, req });
          }
          await deleteRow(table, id);
        });
      }
      if (table === 'academy_groups') {
        await createAudit(req, 'DELETE_ACADEMY_GROUP', 'academy_group', id, undefined, row);
      }
      res.json({ ok: true });
    } catch (error: any) {
      logger.error(`Failed to delete ${path}`, { error });
      const isForeignKeyConflict = error?.code === '23503';
      res.status(error.statusCode || (isForeignKeyConflict ? 409 : 500)).json({
        error: isForeignKeyConflict ? 'resourceInUse' : getPublicErrorMessage(error, `Failed to delete ${path}`),
      });
    }
  });
};

  return registerSimpleCrud;
};
