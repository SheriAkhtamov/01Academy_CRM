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
import {
  getMetaMarketingIntegrationConfig,
  processMetaConversionEvents,
  retryMetaConversionEvent,
  syncMetaAdCatalog,
} from '../../services/meta-marketing';
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
  ACADEMY_TIME_ZONE,
  DatasetActor,
  DbValue,
  Row,
  academyConstants,
  applyLeadVisibilityForActor,
  createAudit,
  createTask,
  ensureAdministrationModuleAccess,
  ensureMarketingModuleAccess,
  ensureSalesAccess,
  ensureSalesModuleAccess,
  ensureTeacherModuleAccess,
  getCompanySettings,
  leadPhoneNumbersSelect,
  nullableDate,
  nullableText,
  parseId,
  query,
  queryOne,
  toAnalyticsTargets,
  updateRow,
} from './academy-core';
import {
  academyDateOnlyKey,
  listAvailableSchoolSlots,
  parseDateOnly,
  parseReportingRange,
  startOfAcademyDay,
} from './academy-scheduling';
import {
  buildAdministrationDashboard,
  buildAnalytics,
  buildMarketingAnalyticsPayload,
  getAcademyDataset,
  getMarketingModuleDataset,
  resolveTeacherId,
} from './academy-analytics';
import {
  getMetaAttributionAnalytics,
  getMetaConversionEventDataset,
} from './meta-marketing-analytics';
import { buildSalesDashboardMetrics } from './sales-dashboard-metrics';

export const registerAcademyModuleRoutes = (router: ReturnType<typeof Router>) => {
router.get('/modules/administration', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const reportingRange = parseReportingRange(req.query.from, req.query.to);
    res.json(await buildAdministrationDashboard(reportingRange));
  } catch (error: any) {
    logger.error('Failed to fetch administration dashboard', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to fetch administration dashboard') });
  }
});

router.get('/modules/sales', async (req, res) => {
  if (!ensureSalesModuleAccess(req, res)) return;
  try {
    const actor: DatasetActor = {
      userId: req.user!.id,
      module: req.user!.module,
      modules: getAssignedModules(req.user),
      scopeModule: 'sales',
    };
    const [dataset, companySettings] = await Promise.all([getAcademyDataset(actor), getCompanySettings()]);

    res.json({
      schools: dataset.schools,
      rooms: dataset.rooms,
      courses: dataset.courses,
      groups: dataset.groups,
      sources: dataset.sources,
      statuses: dataset.statuses,
      leads: dataset.leads,
      archivedLeads: dataset.archivedLeads,
      students: dataset.students,
      lessons: dataset.lessons,
      payments: dataset.payments,
      tasks: dataset.tasks,
      projects: dataset.projects,
      referrals: dataset.referrals,
      referralBenefits: dataset.referralBenefits,
      constants: { ...academyConstants(), targets: toAnalyticsTargets(companySettings) },
    });
  } catch (error) {
    logger.error('Failed to fetch sales module', { error });
    res.status(500).json({ error: 'Failed to fetch sales module' });
  }
});

router.get('/modules/sales/metrics', async (req, res) => {
  if (!ensureSalesModuleAccess(req, res)) return;
  try {
    const reportingRange = parseReportingRange(req.query.from, req.query.to);
    if (!reportingRange) {
      return res.status(400).json({ error: 'invalidReportingPeriod' });
    }
    const actor: DatasetActor = {
      userId: req.user!.id,
      module: req.user!.module,
      modules: getAssignedModules(req.user),
      scopeModule: 'sales',
    };
    res.json(await buildSalesDashboardMetrics(actor, reportingRange));
  } catch (error: any) {
    logger.error('Failed to fetch sales dashboard metrics', { error });
    res.status(error.statusCode || 500).json({
      error: getPublicErrorMessage(error, 'Failed to fetch sales dashboard metrics'),
    });
  }
});

router.get('/availability/slots', async (req, res) => {
  if (!ensureSalesAccess(req, res)) return;
  try {
    const schoolId = parseId(req.query.schoolId);
    const courseId = parseId(req.query.courseId);
    if (!schoolId || !courseId) {
      return res.status(400).json({ error: 'schoolAndCourseRequired' });
    }
    const requestedFrom = parseDateOnly(req.query.from) ?? startOfAcademyDay(new Date());
    const days = Math.min(21, Math.max(1, Number(req.query.days) || 7));
    const format = req.query.format === 'online' ? 'online' : 'offline';
    const participantCount = Math.min(100, Math.max(1, Number(req.query.participantCount) || 1));
    const participantIds = String(req.query.participantIds ?? '')
      .split(',')
      .map((value) => Number(value))
      .filter((value) => Number.isSafeInteger(value) && value > 0)
      .slice(0, 100);
    const result = await listAvailableSchoolSlots({
      schoolId,
      courseId,
      from: requestedFrom,
      days,
      format,
      participantCount,
      participantIds,
      excludeLeadId: parseId(req.query.excludeLeadId),
      excludeDemoLessonId: parseId(req.query.excludeDemoLessonId),
    });
    res.json(result);
  } catch (error: any) {
    logger.error('Failed to fetch available slots', { error });
    res.status(error.statusCode || 500).json({
      error: getPublicErrorMessage(error, 'Failed to fetch available slots'),
    });
  }
});

router.get('/modules/teacher', async (req, res) => {
  if (!ensureTeacherModuleAccess(req, res)) return;
  try {
    const actor: DatasetActor = {
      userId: req.user!.id,
      module: req.user!.module,
      modules: getAssignedModules(req.user),
      scopeModule: 'teacher',
    };
    const dataset = await getAcademyDataset(actor);
    res.json({
      schools: dataset.schools,
      rooms: dataset.rooms,
      courses: dataset.courses,
      teacher: dataset.teachers[0] ?? null,
      groups: dataset.groups,
      students: dataset.students,
      lessons: dataset.lessons,
      attendance: dataset.attendance,
      lessonSurveys: dataset.lessonSurveys,
      projects: dataset.projects,
      constants: academyConstants(),
    });
  } catch (error) {
    logger.error('Failed to fetch teacher module', { error });
    res.status(500).json({ error: 'Failed to fetch teacher module' });
  }
});

router.get('/configuration', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const dataset = await getAcademyDataset();
    res.json({
      schools: dataset.schools,
      rooms: dataset.rooms,
      courses: dataset.courses,
      statuses: dataset.statuses,
      teachers: dataset.teachers,
      groups: dataset.groups,
      lessons: dataset.lessons,
    });
  } catch (error) {
    logger.error('Failed to fetch academy configuration', { error });
    res.status(500).json({ error: 'Failed to fetch academy configuration' });
  }
});

router.get('/company-settings', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    res.json(await getCompanySettings());
  } catch (error) {
    logger.error('Failed to fetch company settings', { error });
    res.status(500).json({ error: 'Failed to fetch company settings' });
  }
});

router.patch('/company-settings', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const current = await getCompanySettings();
    const values = {
      targetRevenueMonthlyUzs: Math.max(0, Number(req.body.targetRevenueMonthlyUzs ?? current.targetRevenueMonthlyUzs) || 0),
      targetNewLeadsMonthly: Math.max(0, Number(req.body.targetNewLeadsMonthly ?? current.targetNewLeadsMonthly) || 0),
      maxCacUzs: Math.max(0, Number(req.body.maxCacUzs ?? current.maxCacUzs) || 0),
      maxCplUzs: Math.max(0, Number(req.body.maxCplUzs ?? current.maxCplUzs) || 0),
      targetRoas: Math.max(0, Number(req.body.targetRoas ?? current.targetRoas) || 0),
      targetAttendancePercent: Math.min(100, Math.max(0, Number(req.body.targetAttendancePercent ?? current.targetAttendancePercent) || 0)),
      targetNps: Math.min(100, Math.max(-100, Number(req.body.targetNps ?? current.targetNps) || 0)),
      salesPhoneVisibility: ['own_leads', 'mask_until_assigned'].includes(String(req.body.salesPhoneVisibility ?? current.salesPhoneVisibility))
        ? String(req.body.salesPhoneVisibility ?? current.salesPhoneVisibility)
        : 'own_leads',
      updatedBy: req.user!.id,
    };
    const settings = await updateRow('academy_company_settings', Number(current.id), values);
    await createAudit(req, 'UPDATE_COMPANY_KPI_TARGETS', 'academy_company_settings', Number(current.id), settings, current);
    res.json(settings);
  } catch (error) {
    logger.error('Failed to update company settings', { error });
    res.status(500).json({ error: 'Failed to update company settings' });
  }
});

router.get('/audit', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const filters: string[] = [];
    const params: DbValue[] = [];
    const add = (value: DbValue) => {
      params.push(value);
      return `$${params.length}`;
    };
    const userId = parseId(req.query.userId);
    const action = nullableText(req.query.action);
    const entityType = nullableText(req.query.entityType);
    const from = nullableDate(req.query.from);
    const to = nullableDate(req.query.to);
    if (userId) filters.push(`a.user_id = ${add(userId)}`);
    if (action) filters.push(`a.action ILIKE ${add(`%${action}%`)}`);
    if (entityType) filters.push(`a.entity_type ILIKE ${add(`%${entityType}%`)}`);
    if (from instanceof Date) filters.push(`a.created_at >= ${add(from)}`);
    if (to instanceof Date) filters.push(`a.created_at < ${add(addDays(to, 1))}`);
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const logs = await query(
      `SELECT a.*, u.full_name AS user_name, u.module AS user_module
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ${add(limit)}`,
      params,
    );
    const integrationLogs = await query(
      `SELECT id, provider, direction, status, payload, error_message, retry_count, created_at, updated_at
       FROM academy_integration_logs
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
    );
    const employees = await query(
      `SELECT id, full_name, module FROM users WHERE is_active = true ORDER BY full_name`,
    );
    res.json({ logs, integrationLogs, employees });
  } catch (error) {
    logger.error('Failed to fetch audit trail', { error });
    res.status(500).json({ error: 'Failed to fetch audit trail' });
  }
});

router.post('/dashboard/alerts/:key/task', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const key = String(req.params.key);
    const tasks: Record<string, { title: string; description: string; entityType: string; targetModule: string }> = {
      payments: {
        title: 'Позвонить должникам',
        description: 'Проверить и закрыть просроченные оплаты из CEO Dashboard.',
        entityType: 'payment',
        targetModule: 'sales',
      },
      attendance: {
        title: 'Связаться с учениками с низкой посещаемостью',
        description: 'Разобрать причины посещаемости ниже установленной нормы.',
        entityType: 'student',
        targetModule: 'sales',
      },
      teachers: {
        title: 'Назначить преподавателя в группы',
        description: 'Закрыть группы без назначенного преподавателя.',
        entityType: 'group',
        targetModule: 'teacher',
      },
    };
    const definition = tasks[key];
    if (!definition) return res.status(404).json({ error: 'Unknown dashboard alert' });
    const responsible = await queryOne(
      `SELECT id FROM users WHERE module = $1 AND is_active = true ORDER BY id LIMIT 1`,
      [definition.targetModule],
    );
    const task = await createTask(definition.title, {
      responsibleId: responsible ? Number(responsible.id) : req.user!.id,
      description: definition.description,
      entityType: definition.entityType,
      deadlineAt: addDays(new Date(), 1),
    });
    await createAudit(req, 'CREATE_DASHBOARD_ACTION_TASK', 'academy_task', Number(task.id), task);
    res.status(201).json(task);
  } catch (error) {
    logger.error('Failed to create dashboard task', { error });
    res.status(500).json({ error: 'Failed to create dashboard task' });
  }
});

router.get('/schedule/resource', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const schoolId = parseId(req.query.schoolId);
    if (!schoolId) return res.status(400).json({ error: 'schoolRequired' });
    const selectedDate = parseDateOnly(req.query.date) ?? startOfAcademyDay(new Date());
    const nextDate = getZonedDayRange(selectedDate, ACADEMY_TIME_ZONE, 1).start;

    const [school, rooms, groups, lessons, demos] = await Promise.all([
      queryOne(`SELECT id, name FROM academy_schools WHERE id = $1`, [schoolId]),
      query(`SELECT * FROM academy_rooms WHERE school_id = $1 AND is_active = true ORDER BY name`, [schoolId]),
      query(
        `SELECT g.*, c.name AS course_name, g.lesson_duration_minutes AS duration_minutes,
                t.full_name AS teacher_name
         FROM academy_groups g
         LEFT JOIN academy_courses c ON c.id = g.course_id
         LEFT JOIN academy_teachers t ON t.id = g.teacher_id
         WHERE g.school_id = $1 AND g.status IN ('open', 'in_progress')
         ORDER BY g.room_id, g.name`,
        [schoolId],
      ),
      query(
        `SELECT l.*, g.name AS group_name, c.name AS course_name, t.full_name AS teacher_name
         FROM academy_lessons l
         LEFT JOIN academy_groups g ON g.id = l.group_id
         LEFT JOIN academy_courses c ON c.id = l.course_id
         LEFT JOIN academy_teachers t ON t.id = l.teacher_id
         WHERE l.school_id = $1
           AND l.status <> 'cancelled'
           AND l.scheduled_at >= $2
           AND l.scheduled_at < $3
         ORDER BY l.room_id, l.scheduled_at`,
        [schoolId, selectedDate, nextDate],
      ),
      query(
        `SELECT demo.*, c.name AS course_name, t.full_name AS teacher_name,
                COUNT(participant.id)::int AS participant_count
         FROM academy_demo_lessons demo
         JOIN academy_courses c ON c.id = demo.course_id
         JOIN academy_teachers t ON t.id = demo.teacher_id
         LEFT JOIN academy_demo_lesson_participants participant
           ON participant.demo_lesson_id = demo.id AND participant.status <> 'cancelled'
         WHERE demo.school_id = $1
           AND demo.status <> 'cancelled'
           AND demo.scheduled_at >= $2
           AND demo.scheduled_at < $3
         GROUP BY demo.id, c.name, t.full_name
         ORDER BY demo.room_id, demo.scheduled_at`,
        [schoolId, selectedDate, nextDate],
      ),
    ]);
    if (!school) return res.status(404).json({ error: 'resourceNotFound' });

    res.json({
      school,
      date: selectedDate.toISOString(),
      rooms: rooms.map((room) => ({
        ...room,
        groups: groups.filter((group) => Number(group.roomId) === Number(room.id)),
        lessons: lessons.filter((lesson) => Number(lesson.roomId) === Number(room.id)),
        demos: demos.filter((demo) => Number(demo.roomId) === Number(room.id)),
      })),
      onlineDemos: demos.filter((demo) => demo.format === 'online'),
    });
  } catch (error) {
    logger.error('Failed to fetch resource schedule', { error });
    res.status(500).json({ error: 'failedToLoadData' });
  }
});

router.patch('/teachers/me/availability', (_req, res) => {
  res.status(403).json({ error: 'adminAccessRequired' });
});

router.get('/modules/marketing', async (req, res) => {
  if (!ensureMarketingModuleAccess(req, res)) return;
  try {
    const reportingRange = parseReportingRange(req.query.from, req.query.to);
    const [dataset, analytics] = await Promise.all([
      getMarketingModuleDataset(),
      buildAnalytics(reportingRange),
    ]);
    res.json({
      ...dataset,
      analytics: buildMarketingAnalyticsPayload(analytics),
      constants: academyConstants(),
    });
  } catch (error: any) {
    logger.error('Failed to fetch marketing module', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to fetch marketing module') });
  }
});

router.get('/modules/marketing/meta-attribution', async (req, res) => {
  if (!ensureMarketingModuleAccess(req, res)) return;
  try {
    const reportingRange = parseReportingRange(req.query.from, req.query.to);
    const defaultMonth = getZonedMonthRange(new Date(), ACADEMY_TIME_ZONE);
    const range = reportingRange ?? {
      start: defaultMonth.start,
      end: defaultMonth.end,
      from: academyDateOnlyKey(defaultMonth.start),
      to: academyDateOnlyKey(new Date(defaultMonth.end.getTime() - 1)),
    };
    res.json({
      ...(await getMetaAttributionAnalytics(range)),
      integration: getMetaMarketingIntegrationConfig(),
    });
  } catch (error: any) {
    logger.error('Failed to fetch Meta attribution analytics', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to fetch Meta attribution analytics') });
  }
});

router.post('/modules/marketing/meta-attribution/sync', async (req, res) => {
  if (!ensureMarketingModuleAccess(req, res)) return;
  try {
    const result = await syncMetaAdCatalog();
    if (result.skipped) return res.status(409).json({ error: 'metaAttributionNotConfigured' });
    res.json(result);
  } catch (error: any) {
    logger.error('Failed to sync Meta ad catalog', { error });
    res.status(error.statusCode || 502).json({ error: getPublicErrorMessage(error, 'Failed to sync Meta ad catalog') });
  }
});

router.get('/modules/marketing/meta-events', async (req, res) => {
  if (!ensureMarketingModuleAccess(req, res)) return;
  try {
    const limit = Number(req.query.limit ?? 200);
    res.json({
      ...(await getMetaConversionEventDataset(Number.isFinite(limit) ? limit : 200)),
      integration: getMetaMarketingIntegrationConfig(),
    });
  } catch (error: any) {
    logger.error('Failed to fetch Meta conversion events', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to fetch Meta conversion events') });
  }
});

router.post('/modules/marketing/meta-events/:id/retry', async (req, res) => {
  if (!ensureMarketingModuleAccess(req, res)) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalidData' });
    const existing = await queryOne<{ status: string }>(
      `SELECT status FROM meta_conversion_events WHERE id = $1`,
      [id],
    );
    if (!existing) return res.status(404).json({ error: 'resourceNotFound' });
    if (existing.status === 'sent') return res.status(409).json({ error: 'metaEventAlreadySent' });
    const event = await retryMetaConversionEvent(id);
    await processMetaConversionEvents(1);
    res.json(event);
  } catch (error: any) {
    logger.error('Failed to retry Meta conversion event', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to retry Meta conversion event') });
  }
});

router.get('/search', async (req, res) => {
  try {
    const term = String(req.query.q ?? '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit ?? 8) || 8, 1), 10);
    if (term.length < 2) {
      return res.json([]);
    }

    const like = `%${term.toLowerCase()}%`;
    const assignedModules = getAssignedModules(req.user);
    const isLeadershipActor = hasLeadershipAccess(req.user);
    const results: Row[] = [];
    const remaining = () => Math.max(limit - results.length, 0);

    const pushLeads = async (whereSql: string, params: DbValue[], href: string) => {
      if (remaining() <= 0) return;
      const cleanDigits = term.replace(/\D/g, '');
      const hasDigits = cleanDigits.length >= 3;

      let matchConditions = `(
        LOWER(l.contact_name) LIKE $${params.length + 1}
        OR LOWER(COALESCE(l.student_name, '')) LIKE $${params.length + 1}
        OR LOWER(COALESCE(l.phone, '')) LIKE $${params.length + 1}
        OR EXISTS (
          SELECT 1
          FROM academy_lead_phones lp
          WHERE lp.lead_id = l.id
            AND LOWER(lp.phone) LIKE $${params.length + 1}
        )
        OR LOWER(COALESCE(l.messenger, '')) LIKE $${params.length + 1}
        OR CAST(l.id AS text) LIKE $${params.length + 1}
      )`;

      const queryParams: DbValue[] = [...params, like];

      if (hasDigits) {
        queryParams.push(`%${cleanDigits}%`);
        const digitParamIndex = queryParams.length;
        matchConditions += ` OR (regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g') LIKE $${digitParamIndex})`;
        matchConditions += ` OR EXISTS (SELECT 1 FROM academy_lead_phones lp WHERE lp.lead_id = l.id AND regexp_replace(lp.phone, '[^0-9]', '', 'g') LIKE $${digitParamIndex})`;
      }

      queryParams.push(remaining());
      const limitParamIndex = queryParams.length;

      const rows = await query(
        `SELECT l.id, l.contact_name, l.phone, l.student_name, l.is_archived, c.name AS course_name,
            ${leadPhoneNumbersSelect('l')}
         FROM academy_leads l
         LEFT JOIN academy_courses c ON c.id = l.course_id
         WHERE ${whereSql}
           AND ${matchConditions}
         ORDER BY l.created_at DESC
         LIMIT $${limitParamIndex}`,
        queryParams,
      );
      const visibleRows = await applyLeadVisibilityForActor({
        userId: req.user!.id,
        module: req.user!.module,
        modules: assignedModules,
        scopeModule: 'sales',
      }, rows);
      results.push(...visibleRows.map((lead) => {
        const leadIdTag = `№ ${lead.id}`;
        const mainPhone = lead.phoneNumbers?.[0] ?? lead.phone;
        const mainTitle = lead.contactName || lead.studentName || mainPhone || leadIdTag;
        const baseHref = lead.isArchived ? '/sales/archive' : href;
        const finalHref = `${baseHref}${baseHref.includes('?') ? '&' : '?'}lead=${lead.id}`;

        const subtitleItems = [
          leadIdTag,
          mainPhone && mainPhone !== mainTitle ? mainPhone : (mainPhone ? mainPhone : null),
          lead.studentName && lead.studentName !== mainTitle ? lead.studentName : null,
          lead.courseName,
          lead.isArchived ? 'Архив' : null,
        ].filter(Boolean);

        return {
          id: `lead-${lead.id}`,
          entityType: 'lead',
          title: mainTitle,
          subtitle: subtitleItems.join(' • '),
          href: finalHref,
        };
      }));
    };

    const pushStudents = async (whereSql: string, params: DbValue[], href: string) => {
      if (remaining() <= 0) return;
      const cleanDigits = term.replace(/\D/g, '');
      const hasDigits = cleanDigits.length >= 3;

      let matchConditions = `(
        LOWER(COALESCE(st.student_name, '')) LIKE $${params.length + 1}
        OR LOWER(st.contact_name) LIKE $${params.length + 1}
        OR LOWER(st.phone) LIKE $${params.length + 1}
        OR LOWER(COALESCE(st.referral_code, '')) LIKE $${params.length + 1}
        OR CAST(st.id AS text) LIKE $${params.length + 1}
      )`;

      const queryParams: DbValue[] = [...params, like];

      if (hasDigits) {
        queryParams.push(`%${cleanDigits}%`);
        const digitParamIndex = queryParams.length;
        matchConditions += ` OR (regexp_replace(COALESCE(st.phone, ''), '[^0-9]', '', 'g') LIKE $${digitParamIndex})`;
      }

      queryParams.push(remaining());
      const limitParamIndex = queryParams.length;

      const rows = await query(
        `SELECT st.id, st.student_name, st.contact_name, st.phone, g.name AS group_name,
            COALESCE(
              (
                SELECT array_agg(membership_group.name ORDER BY membership.is_primary DESC, membership_group.name)
                FROM academy_student_group_enrollments membership
                JOIN academy_groups membership_group ON membership_group.id = membership.group_id
                WHERE membership.student_id = st.id AND membership.status = 'active'
              ),
              ARRAY[]::text[]
            ) AS group_names
         FROM academy_students st
         LEFT JOIN academy_groups g ON g.id = st.group_id
         WHERE ${whereSql}
           AND ${matchConditions}
         ORDER BY st.created_at DESC
         LIMIT $${limitParamIndex}`,
        queryParams,
      );
      results.push(...rows.map((student) => {
        const finalHref = `${href}${href.includes('?') ? '&' : '?'}student=${student.id}`;
        return {
          id: `student-${student.id}`,
          entityType: 'student',
          title: student.studentName || student.contactName,
          subtitle: [
            student.contactName,
            student.phone,
            Array.isArray(student.groupNames) && student.groupNames.length > 0
              ? student.groupNames.join(', ')
              : student.groupName,
          ].filter(Boolean).join(' • '),
          href: finalHref,
        };
      }));
    };

    const pushGroups = async (whereSql: string, params: DbValue[], href: string) => {
      if (remaining() <= 0) return;
      const rows = await query(
        `SELECT g.id, g.name, c.name AS course_name, t.full_name AS teacher_name
         FROM academy_groups g
         LEFT JOIN academy_courses c ON c.id = g.course_id
         LEFT JOIN academy_teachers t ON t.id = g.teacher_id
         WHERE ${whereSql}
           AND (
             LOWER(g.name) LIKE $${params.length + 1}
             OR LOWER(COALESCE(c.name, '')) LIKE $${params.length + 1}
             OR LOWER(COALESCE(t.full_name, '')) LIKE $${params.length + 1}
           )
         ORDER BY g.created_at DESC
         LIMIT $${params.length + 2}`,
        [...params, like, remaining()],
      );
      results.push(...rows.map((group) => ({
        id: `group-${group.id}`,
        entityType: 'group',
        title: group.name,
        subtitle: [group.courseName, group.teacherName].filter(Boolean).join(' • '),
        href,
      })));
    };

    const pushCourses = async (href: string) => {
      if (remaining() <= 0) return;
      const rows = await query(
        `SELECT id, name, age_category
         FROM academy_courses
         WHERE LOWER(name) LIKE $1 OR LOWER(slug) LIKE $1 OR LOWER(COALESCE(age_category, '')) LIKE $1
         ORDER BY name
         LIMIT $2`,
        [like, remaining()],
      );
      results.push(...rows.map((course) => ({
        id: `course-${course.id}`,
        entityType: 'course',
        title: course.name,
        subtitle: course.ageCategory,
        href,
      })));
    };

    if (isLeadershipActor) {
      await pushLeads(`TRUE`, [], '/sales/pipeline');
      await pushStudents(`TRUE`, [], '/sales/clients');
      await pushGroups(`TRUE`, [], '/teacher-module/groups');
      await pushCourses('/teacher-module/groups');
      if (remaining() > 0) {
        const sources = await query(
          `SELECT id, name, channel, campaign_name
           FROM academy_lead_sources
           WHERE is_active = true
             AND (LOWER(name) LIKE $1 OR LOWER(code) LIKE $1 OR LOWER(COALESCE(channel, '')) LIKE $1 OR LOWER(COALESCE(campaign_name, '')) LIKE $1)
           ORDER BY name
           LIMIT $2`,
          [like, remaining()],
        );
        results.push(...sources.map((source) => ({
          id: `source-${source.id}`,
          entityType: 'source',
          title: source.name,
          subtitle: [source.channel, source.campaignName].filter(Boolean).join(' • '),
          href: '/marketing-module/sources',
        })));
      }
      if (remaining() > 0) {
        const users = await query(
          `SELECT id, full_name, module
           FROM users
           WHERE LOWER(full_name) LIKE $1 OR LOWER(module) LIKE $1
           ORDER BY full_name
           LIMIT $2`,
          [like, remaining()],
        );
        results.push(...users.map((user) => ({
          id: `user-${user.id}`,
          entityType: 'user',
          title: user.fullName,
          subtitle: user.module,
          href: '/employees',
        })));
      }
    } else {
      if (assignedModules.includes('sales')) {
        await pushLeads(`(l.manager_id = $1 OR l.manager_id IS NULL)`, [req.user!.id], '/sales/pipeline');
        await pushStudents(`st.manager_id = $1`, [req.user!.id], '/sales/clients');
      }
      if (assignedModules.includes('teacher')) {
        const teacherId = await resolveTeacherId(req.user!.id);
        if (teacherId) {
          await pushGroups(`g.teacher_id = $1`, [teacherId], '/teacher-module/groups');
          await pushStudents(`EXISTS (
            SELECT 1
            FROM academy_student_group_enrollments teacher_membership
            JOIN academy_groups teacher_group ON teacher_group.id = teacher_membership.group_id
            WHERE teacher_membership.student_id = st.id
              AND teacher_membership.status = 'active'
              AND teacher_group.teacher_id = $1
          )`, [teacherId], '/teacher-module/groups');
          await pushCourses('/teacher-module/groups');
        }
      }
      if (assignedModules.includes('marketing')) {
        if (remaining() > 0) {
          const sources = await query(
            `SELECT id, name, channel, campaign_name
             FROM academy_lead_sources
             WHERE is_active = true
               AND (LOWER(name) LIKE $1 OR LOWER(code) LIKE $1 OR LOWER(COALESCE(channel, '')) LIKE $1 OR LOWER(COALESCE(campaign_name, '')) LIKE $1)
             ORDER BY name
             LIMIT $2`,
            [like, remaining()],
          );
          results.push(...sources.map((source) => ({
            id: `source-${source.id}`,
            entityType: 'source',
            title: source.name,
            subtitle: [source.channel, source.campaignName].filter(Boolean).join(' • '),
            href: '/marketing-module/sources',
          })));
        }
        await pushLeads(`TRUE`, [], '/marketing-module/funnel');
      }
    }

    res.json(results.slice(0, limit));
  } catch (error) {
    logger.error('Failed to search academy data', { error });
    res.status(500).json({ error: 'Failed to search academy data' });
  }
});
};
