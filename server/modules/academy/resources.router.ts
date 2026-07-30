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
import { normalizeOutboxRecipient } from '../../services/message-recipients';
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
  SOURCE_MANAGEMENT_MODULES,
  createPipelineStatusCode,
  nullableText,
  queryOne,
} from './academy-core';
import {
  assertGroupLifecycleUpdateAllowed,
  getLeadCountForStatusCode,
} from './academy-route-support';
import { createAcademyCrudRegistrar } from './crud-router';

export const registerAcademyResourceRoutes = (router: ReturnType<typeof Router>) => {
  const registerSimpleCrud = createAcademyCrudRegistrar(router);
registerSimpleCrud('schools', 'academy_schools', [
  'name', 'code', 'address', 'timezone', 'isActive',
], {
  orderBy: 'is_active DESC, name',
  requireAdministration: true,
  beforeUpdate: async ({ id, values, row }) => {
    if (row.isActive !== false && values.isActive === false) {
      const usage = await queryOne<{ inUse: boolean }>(
        `SELECT (
           EXISTS (
             SELECT 1 FROM academy_groups
             WHERE school_id = $1 AND status IN ('open', 'in_progress')
           )
           OR EXISTS (
             SELECT 1 FROM academy_rooms
             WHERE school_id = $1 AND is_active = true
           )
         ) AS in_use`,
        [id],
      );
      if (usage?.inUse) throw Object.assign(new Error('schoolHasActiveResources'), { statusCode: 409 });
    }
  },
});

registerSimpleCrud('rooms', 'academy_rooms', [
  'schoolId', 'name', 'capacity', 'isActive',
], {
  orderBy: 'school_id, is_active DESC, name',
  requireAdministration: true,
  beforeUpdate: async ({ id, values, row }) => {
    const nextSchoolId = Number(values.schoolId ?? row.schoolId);
    if (Number(values.schoolId) > 0 && Number(row.schoolId) !== nextSchoolId) {
      const usage = await queryOne<{ inUse: boolean }>(
        `SELECT (
           EXISTS (SELECT 1 FROM academy_groups WHERE room_id = $1)
           OR EXISTS (SELECT 1 FROM academy_lessons WHERE room_id = $1)
         ) AS in_use`,
        [id],
      );
      if (usage?.inUse) throw Object.assign(new Error('roomSchoolCannotChangeWhileInUse'), { statusCode: 409 });
    }
    const school = await queryOne(`SELECT id FROM academy_schools WHERE id = $1 AND is_active = true`, [nextSchoolId]);
    if (!school) throw Object.assign(new Error('School not found'), { statusCode: 404 });
    const nextCapacity = Number(values.capacity ?? row.capacity);
    const maxGroup = await queryOne<{ maxStudents: number }>(
      `SELECT COALESCE(MAX(max_students), 0)::int AS max_students
       FROM academy_groups
       WHERE room_id = $1`,
      [id],
    );
    if (nextCapacity < Number(maxGroup?.maxStudents ?? 0)) {
      throw Object.assign(new Error('roomCapacityBelowGroupCapacity'), { statusCode: 409 });
    }
    if (row.isActive !== false && values.isActive === false) {
      const activeGroup = await queryOne(
        `SELECT id FROM academy_groups
         WHERE room_id = $1 AND status IN ('open', 'in_progress')
         LIMIT 1`,
        [id],
      );
      if (activeGroup) throw Object.assign(new Error('roomHasActiveGroups'), { statusCode: 409 });
    }
  },
});

registerSimpleCrud('courses', 'academy_courses', [
  'name', 'slug', 'ageCategory',
  'description', 'basePriceUzs', 'discountedPriceUzs',
  'ltvTargetMinUzs', 'ltvTargetMaxUzs', 'program', 'isActive',
], {
  orderBy: 'is_active DESC, name',
  requireAdministration: true,
  allowCreate: false,
  allowUpdate: false,
});

registerSimpleCrud('pipeline-statuses', 'academy_lead_statuses', [
  'name', 'color', 'sortOrder', 'isPipeline', 'isActive',
], {
  orderBy: 'sort_order, id',
  requireAdministration: true,
  beforeCreate: async ({ values }) => {
    values.code = await createPipelineStatusCode(String(values.name ?? ''));
    values.isSystem = false;
  },
  beforeDelete: async ({ row }) => {
    if (row.isSystem === true) {
      throw Object.assign(new Error('systemPipelineStageCannotBeDeleted'), {
        statusCode: 409,
      });
    }
    const leadCount = await getLeadCountForStatusCode(String(row.code));
    if (leadCount > 0) {
      throw Object.assign(new Error('pipelineStageHasLeads'), {
        statusCode: 409,
        leadCount,
      });
    }
  },
});

registerSimpleCrud('teachers', 'academy_teachers', [
  'userId', 'fullName', 'courseIds', 'schoolIds', 'availability', 'schedule', 'status',
], { orderBy: 'full_name', requireAdministration: true });

registerSimpleCrud('groups', 'academy_groups', [
  'name', 'courseId', 'schoolId', 'roomId', 'teacherId', 'schedule',
  'lessonCount', 'lessonDurationMinutes', 'durationDays', 'frequency',
  'maxStudents', 'status', 'startDate', 'endDate',
], {
  orderBy: 'created_at DESC',
  requireAdministration: true,
  beforeUpdate: async ({ id, values, row }) => {
    await assertGroupLifecycleUpdateAllowed({
      id,
      values,
      row,
    });
  },
  beforeDelete: async ({ id, row }) => {
    if (row.status !== 'completed') {
      throw Object.assign(new Error('groupMustBeArchivedBeforeDelete'), { statusCode: 409 });
    }
    const usage = await queryOne<{ inUse: boolean }>(
      `SELECT (
         EXISTS (
           SELECT 1 FROM academy_student_group_enrollments
           WHERE group_id = $1
         )
         OR EXISTS (SELECT 1 FROM academy_lead_group_reservations WHERE group_id = $1)
         OR EXISTS (SELECT 1 FROM academy_lessons WHERE group_id = $1)
         OR EXISTS (SELECT 1 FROM academy_payments WHERE group_id = $1)
         OR EXISTS (
           SELECT 1 FROM academy_student_transfers
           WHERE from_group_id = $1 OR to_group_id = $1
         )
         OR EXISTS (SELECT 1 FROM academy_portfolio_projects WHERE group_id = $1)
       ) AS in_use`,
      [id],
    );
    if (usage?.inUse) throw Object.assign(new Error('groupHistoryCannotBeDeleted'), { statusCode: 409 });
  },
});

registerSimpleCrud('sources', 'academy_lead_sources', [
  'code', 'name', 'channel', 'campaignName', 'costPerLeadUzs', 'isSystem', 'isActive',
], {
  orderBy: 'name',
  listWhere: 'is_active = true',
  allowedModules: SOURCE_MANAGEMENT_MODULES,
  beforeCreate: async ({ values }) => {
    const code = nullableText(values.code)?.toLowerCase();
    const name = nullableText(values.name);
    const channel = nullableText(values.channel)?.toLowerCase();
    if (
      !code
      || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(code)
      || !name
      || name.length > 255
      || !channel
      || channel.length > 120
      || Number(values.costPerLeadUzs ?? 0) < 0
    ) {
      throw Object.assign(new Error('invalidData'), { statusCode: 400 });
    }
    values.code = code;
    values.name = name;
    values.channel = channel;
    values.isSystem = false;
    values.isActive = values.isActive ?? true;
  },
  beforeUpdate: async ({ values, row }) => {
    if (
      values.isSystem !== undefined
      && Boolean(values.isSystem) !== Boolean(row.isSystem)
    ) {
      throw Object.assign(new Error('systemLeadSourceProtected'), { statusCode: 409 });
    }
    if (
      row.isSystem === true
      && (
        (values.code !== undefined && nullableText(values.code)?.toLowerCase() !== String(row.code).toLowerCase())
        || (values.channel !== undefined && nullableText(values.channel)?.toLowerCase() !== String(row.channel).toLowerCase())
        || values.isActive === false
      )
    ) {
      throw Object.assign(new Error('systemLeadSourceProtected'), { statusCode: 409 });
    }
    const code = nullableText(values.code ?? row.code)?.toLowerCase();
    const name = nullableText(values.name ?? row.name);
    const channel = nullableText(values.channel ?? row.channel)?.toLowerCase();
    const cost = Number(values.costPerLeadUzs ?? row.costPerLeadUzs ?? 0);
    if (
      !code
      || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(code)
      || !name
      || name.length > 255
      || !channel
      || channel.length > 120
      || !Number.isSafeInteger(cost)
      || cost < 0
    ) {
      throw Object.assign(new Error('invalidData'), { statusCode: 400 });
    }
    if (values.code !== undefined) values.code = code;
    if (values.name !== undefined) values.name = name;
    if (values.channel !== undefined) values.channel = channel;
  },
  beforeDelete: async ({ row }) => {
    if (row.isSystem === true) {
      throw Object.assign(new Error('systemLeadSourceProtected'), { statusCode: 409 });
    }
  },
});

registerSimpleCrud('lessons', 'academy_lessons', [
  'groupId', 'courseId', 'schoolId', 'roomId', 'teacherId', 'lessonNumber', 'topic', 'materials', 'scheduledAt', 'durationMinutes',
], {
  orderBy: 'scheduled_at DESC',
  requireOperations: true,
  beforeDelete: async ({ id, row }) => {
    if (row.status !== 'scheduled') {
      throw Object.assign(new Error('conductedLessonCannotBeDeleted'), { statusCode: 409 });
    }
    const usage = await queryOne<{ inUse: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM academy_attendance WHERE lesson_id = $1)
         OR EXISTS (SELECT 1 FROM academy_lesson_surveys WHERE lesson_id = $1)
         OR EXISTS (SELECT 1 FROM academy_lesson_status_history WHERE lesson_id = $1)
         OR EXISTS (SELECT 1 FROM academy_lesson_reschedules WHERE lesson_id = $1)
         OR EXISTS (SELECT 1 FROM academy_portfolio_projects WHERE lesson_id = $1)
       ) AS in_use`,
      [id],
    );
    if (usage?.inUse) throw Object.assign(new Error('lessonHistoryCannotBeDeleted'), { statusCode: 409 });
  },
});

registerSimpleCrud('tasks', 'academy_tasks', [
  'title', 'description', 'responsibleId', 'deadlineAt', 'status', 'entityType', 'entityId', 'completedAt',
], { orderBy: 'COALESCE(deadline_at, created_at)' });

registerSimpleCrud('expenses', 'academy_marketing_expenses', [
  'sourceId', 'channel', 'campaignName', 'periodStart', 'periodEnd', 'amountUzs', 'createdBy',
], {
  orderBy: 'period_start DESC',
  requireMarketing: true,
  beforeCreate: async ({ values }) => {
    if (!values.channel || Number(values.amountUzs) <= 0 || !values.periodStart || !values.periodEnd) {
      throw Object.assign(new Error('invalidData'), { statusCode: 400 });
    }
    if (new Date(values.periodEnd).getTime() < new Date(values.periodStart).getTime()) {
      throw Object.assign(new Error('invalidData'), { statusCode: 400 });
    }
  },
  beforeUpdate: async ({ values, row }) => {
    const channel = values.channel ?? row.channel;
    const amount = Number(values.amountUzs ?? row.amountUzs);
    const start = values.periodStart ?? row.periodStart;
    const end = values.periodEnd ?? row.periodEnd;
    if (!channel || amount <= 0 || !start || !end || new Date(end).getTime() < new Date(start).getTime()) {
      throw Object.assign(new Error('invalidData'), { statusCode: 400 });
    }
  },
});
};
