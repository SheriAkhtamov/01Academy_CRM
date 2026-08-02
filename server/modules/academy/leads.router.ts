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
import { leadTagNameKey, type LeadTagOption } from '@shared/lead-tags';
import { createAcademyLeadRequestSchema } from '@shared/contracts/academy-leads';

import {
  DbValue,
  LEAD_MODULES,
  Row,
  SALES_MODULES,
  applyLeadVisibilityForActor,
  applyLeadVisibilityForRequest,
  canMutateLeadRow,
  createAudit,
  createNotification,
  createTask,
  ensureAdministrationModuleAccess,
  ensureLeadMutationAccess,
  ensureLeadRowAccess,
  ensureModuleAccess,
  getActiveLeadStatus,
  insertRow,
  isValidLeadArchiveReason,
  leadPhoneNumbersSelect,
  leadTagsSelect,
  lockLeadContactIdentities,
  normalizeLeadPhones,
  normalizePhoneForStorage,
  nullableDate,
  nullableText,
  parseId,
  parseOptionalDate,
  query,
  queryOne,
  resolveInitialLeadStatusCode,
  resolveLeadManagerId,
  studentGroupMembershipsSelect,
  syncLeadChannelInCurrentTransaction,
  syncLeadPhones,
  toBoolean,
  toIdOrNull,
  toIntegerOrNull,
  updateRow,
  withTransaction,
} from './academy-core';
import {
  assertValidReferrerStudent,
  buildLeadStageDurations,
  createStageHistory,
  createStudentFromLead,
  duplicateHintForRequest,
  findDuplicate,
  getActiveSalesManager,
  getLead,
  getLockedLeadWithSource,
  handleLeadStatusEffects,
  leadContactSummary,
  reassignLead,
  recalculateStudentMetrics,
  resolveCourseByAge,
  resolveSourceId,
  syncLeadManagerAssignment,
  syncLeadOwnedNotifications,
  validateEnrollmentGroup,
  validateLeadSelectedGroups,
} from './academy-leads';

export const registerAcademyLeadRoutes = (router: ReturnType<typeof Router>) => {
router.get('/lead-tags', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead access required')) return;
  try {
    const [sources, customTags] = await Promise.all([
      query<{ name: string }>(
        `SELECT name
         FROM academy_lead_sources
         WHERE is_active = true
         ORDER BY name`,
      ),
      query<{ id: number; name: string }>(
        `SELECT id, name
         FROM academy_lead_tags
         ORDER BY LOWER(name), id`,
      ),
    ]);

    const options = new Map<string, LeadTagOption>();
    for (const source of sources) {
      const key = leadTagNameKey(source.name);
      if (key) options.set(key, { id: null, name: source.name });
    }
    for (const tag of customTags) {
      const key = leadTagNameKey(tag.name);
      if (key) options.set(key, { id: Number(tag.id), name: tag.name });
    }

    res.json(
      [...options.values()].sort((left, right) => (
        left.name.localeCompare(right.name, 'ru', { sensitivity: 'base' })
      )),
    );
  } catch (error) {
    logger.error('Failed to fetch lead tags', { error });
    res.status(500).json({ error: 'leadTagsLoadFailed' });
  }
});

router.get('/leads', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead access required')) return;
  try {
    const conditions: string[] = [];
    const params: DbValue[] = [];
    const assignedModules = getAssignedModules(req.user);
    const canSeeAllLeads = hasLeadershipAccess(req.user) || assignedModules.includes('marketing');
    const wantsArchived = req.query.archived === 'true';

    conditions.push(`COALESCE(l.is_archived, false) = ${wantsArchived ? 'true' : 'false'}`);

    if (assignedModules.includes('sales') && !canSeeAllLeads) {
      params.push(req.user!.id);
      conditions.push(`(l.manager_id = $${params.length} OR l.manager_id IS NULL)`);
    }

    if (req.query.status) {
      params.push(String(req.query.status));
      conditions.push(`l.status_code = $${params.length}`);
    }
    if (req.query.courseId) {
      params.push(Number(req.query.courseId));
      conditions.push(`l.course_id = $${params.length}`);
    }
    if (req.query.sourceId) {
      params.push(Number(req.query.sourceId));
      conditions.push(`l.source_id = $${params.length}`);
    }
    if (req.query.managerId) {
      params.push(Number(req.query.managerId));
      conditions.push(`l.manager_id = $${params.length}`);
    }
    if (req.query.warmBase === 'true') {
      conditions.push(`l.status_code = 'not_now'`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      conditions.push(`(
        LOWER(l.contact_name) LIKE $${params.length}
        OR LOWER(COALESCE(l.student_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(l.phone, '')) LIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM academy_lead_phones lp
          WHERE lp.lead_id = l.id
            AND LOWER(lp.phone) LIKE $${params.length}
        )
        OR LOWER(COALESCE(l.messenger, '')) LIKE $${params.length}
      )`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const leads = await query(
      `SELECT l.*, c.name AS course_name, s.name AS source_name, s.channel AS source_channel, u.full_name AS manager_name,
          sc.name AS school_name, archived_by_user.full_name AS archived_by_name,
          ${leadPhoneNumbersSelect('l')},
          ${leadTagsSelect('l')}
       FROM academy_leads l
       LEFT JOIN academy_courses c ON c.id = l.course_id
       LEFT JOIN academy_lead_sources s ON s.id = l.source_id
       LEFT JOIN users u ON u.id = l.manager_id
       LEFT JOIN academy_schools sc ON sc.id = l.school_id
       LEFT JOIN users archived_by_user ON archived_by_user.id = l.archived_by
       ${whereSql}
       ORDER BY l.created_at DESC`,
      params,
    );
    res.json(await applyLeadVisibilityForActor(
      {
        userId: req.user!.id,
        module: req.user!.module,
        modules: assignedModules,
        scopeModule: 'sales',
      },
      leads,
    ));
  } catch (error) {
    logger.error('Failed to fetch leads', { error });
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

router.post('/leads', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
  try {
    const parsedInput = createAcademyLeadRequestSchema.safeParse(req.body);
    if (!parsedInput.success) {
      return res.status(400).json({ error: 'invalidData' });
    }
    const input = parsedInput.data;
    const contactName = nullableText(input.contactName);
    const phones = normalizeLeadPhones(input.phoneNumbers ?? input.phone);
    const primaryPhone = phones[0]?.phone ?? null;
    const messenger = nullableText(input.messenger);
    const requestedReferrerStudentId = toIdOrNull(input.referrerStudentId, 'referrerStudentId');

    if (!contactName) return res.status(400).json({ error: 'contactPersonRequired' });

    const duplicate = await findDuplicate(phones, messenger, {
      studentName: nullableText(input.studentName),
    });
    if (duplicate) {
      return res.status(409).json({
        error: 'clientAlreadyExists',
        duplicate: duplicateHintForRequest(req.actor!, duplicate),
      });
    }
    if (input.demoAt) {
      return res.status(400).json({ error: 'leadScheduleThroughGroupOnly' });
    }

    const lead = await withTransaction<Row>(async () => {
      await lockLeadContactIdentities(phones, messenger);
      const lockedDuplicate = await findDuplicate(phones, messenger, {
        studentName: nullableText(input.studentName),
      });
      if (lockedDuplicate) {
        throw Object.assign(new Error('clientAlreadyExists'), {
          statusCode: 409,
          duplicate: lockedDuplicate,
        });
      }
      const referrer = requestedReferrerStudentId
        ? await assertValidReferrerStudent(requestedReferrerStudentId)
        : null;
      const sourceId = await resolveSourceId(input, referrer);
      if (!sourceId) {
        throw Object.assign(new Error('sourceRequired'), { statusCode: 400 });
      }
      const studentAge = toIntegerOrNull(input.studentAge) as number | null | undefined;
      let courseId = parseId(input.courseId);
      if (!courseId && studentAge) {
        courseId = Number((await resolveCourseByAge(studentAge))?.id ?? 0) || null;
      }

      const statusCode = await resolveInitialLeadStatusCode(nullableText(input.statusCode));
      if (statusCode === 'paid') {
        throw Object.assign(new Error('paymentRequiredBeforePaid'), { statusCode: 409 });
      }
      const managerId = await resolveLeadManagerId(req.actor!, input.managerId);
      await getActiveSalesManager(managerId, true);

      const enrolledGroupId = parseId(input.enrolledGroupId);
      if (enrolledGroupId) {
        await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [enrolledGroupId]);
      }
      const enrolledGroup = await validateEnrollmentGroup(enrolledGroupId);
      if (enrolledGroup) {
        courseId = Number(enrolledGroup.courseId);
      }
      const schoolId = enrolledGroup?.schoolId ? Number(enrolledGroup.schoolId) : null;
      const validationError = validateLeadForStatusChange({
        nextStatus: statusCode,
        studentName: nullableText(input.studentName),
        studentAge: studentAge ?? null,
        courseId,
        enrolledGroupId,
      });
      if (validationError) {
        throw Object.assign(new Error(validationError), { statusCode: 400 });
      }

      const source = await queryOne(`SELECT * FROM academy_lead_sources WHERE id = $1`, [sourceId]);
      const initialComment = nullableText(input.comment);
      const createdLead = await insertRow('academy_leads', {
        contactName,
        phone: primaryPhone,
        messenger: messenger ?? null,
        studentName: nullableText(input.studentName) ?? null,
        studentAge: studentAge ?? null,
        courseId: courseId ?? null,
        schoolId,
        sourceId,
        advertisingCampaign: nullableText(input.advertisingCampaign) ?? nullableText(source?.campaignName) ?? null,
        acquisitionCostUzs: normalizeMoney(input.acquisitionCostUzs ?? source?.costPerLeadUzs),
        statusCode,
        managerId,
        language: nullableText(input.language) ?? 'ru',
        comment: initialComment ?? null,
        enrolledGroupId,
        referralCode: nullableText(input.referralCode) ?? null,
        referrerStudentId: requestedReferrerStudentId,
        createdBy: req.user!.id,
      });
      if (initialComment) {
        await insertRow('academy_lead_comments', {
          leadId: createdLead.id,
          authorId: req.user!.id,
          body: initialComment,
        });
      }
      if (enrolledGroupId) {
        await query(
          `INSERT INTO academy_lead_group_reservations
             (lead_id, group_id, created_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (lead_id, group_id) DO NOTHING`,
          [createdLead.id, enrolledGroupId, req.user!.id],
        );
      }
      await syncLeadPhones(createdLead.id, phones);
      await syncLeadChannelInCurrentTransaction({
        leadId: Number(createdLead.id),
        sourceId: Number(sourceId),
        messenger: messenger ?? null,
        phone: primaryPhone,
      });
      await createStageHistory(
        createdLead.id,
        null,
        createdLead.statusCode,
        req.user!.id,
        enrolledGroupId ? 'Создание лида и добавление в группу' : 'Создание лида',
      );
      return { ...createdLead, phoneNumbers: phones.map((phone) => phone.phone) };
    });

    await handleLeadStatusEffects(req.actor!, lead);
    await createAudit(req.actor!, 'CREATE_ACADEMY_LEAD', 'academy_lead', lead.id, lead);
    res.status(201).json(lead);
  } catch (error: any) {
    logger.error('Failed to create lead', { error });
    res.status(error.statusCode || 500).json({
      error: getPublicErrorMessage(error, 'Failed to create lead'),
      ...(error.duplicate ? { duplicate: duplicateHintForRequest(req.actor!, error.duplicate) } : {}),
    });
  }
});

router.post('/leads/bulk-assign', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  try {
    const leadIds = Array.from(new Set(
      (Array.isArray(req.body.leadIds) ? req.body.leadIds : [])
        .map(parseId)
        .filter((id: number | null): id is number => Boolean(id)),
    ));
    if (leadIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one lead' });
    }
    if (leadIds.length > 500) {
      return res.status(400).json({ error: 'Too many leads selected' });
    }

    const managerId = parseId(req.body.managerId);
    if (!managerId) {
      return res.status(400).json({ error: 'Active account manager is required' });
    }
    const comment = nullableText(req.body.comment) ?? 'Массовое переназначение администратором';
    const { manager, changedLeads } = await withTransaction(async () => {
      const lockedManager = await getActiveSalesManager(managerId, true);
      const leads = await query(
        `SELECT *
         FROM academy_leads
         WHERE id = ANY($1::int[])
         ORDER BY id
         FOR UPDATE`,
        [leadIds],
      );
      if (leads.length !== leadIds.length) {
        throw Object.assign(new Error('One or more leads were not found'), { statusCode: 404 });
      }
      const changed = leads.filter(
        (lead) => Number(lead.managerId) !== Number(lockedManager.id),
      );
      if (changed.length === 0) return { manager: lockedManager, changedLeads: changed };

      const changedIds = changed.map((lead) => Number(lead.id));
      await query(
        `UPDATE academy_leads
         SET manager_id = $1, updated_at = NOW()
         WHERE id = ANY($2::int[])`,
        [lockedManager.id, changedIds],
      );
      await query(
        `UPDATE academy_students
         SET manager_id = $1, updated_at = NOW()
         WHERE lead_id = ANY($2::int[])`,
        [lockedManager.id, changedIds],
      );
      await query(
        `UPDATE academy_tasks
         SET responsible_id = $1, updated_at = NOW()
         WHERE status <> 'done'
           AND (
             (entity_type = 'lead' AND entity_id = ANY($2::int[]))
             OR (
               entity_type = 'student'
               AND entity_id IN (
                 SELECT id FROM academy_students WHERE lead_id = ANY($2::int[])
               )
             )
           )`,
        [lockedManager.id, changedIds],
      );
      await query(
        `UPDATE board_tasks
         SET assignee_id = $1, updated_at = NOW()
         WHERE lead_id = ANY($2::int[])
           AND status NOT IN ('done', 'accepted')`,
        [lockedManager.id, changedIds],
      );
      await syncLeadOwnedNotifications(lockedManager.id, changedIds);
      for (const lead of changed) {
        await insertRow('academy_lead_assignment_history', {
          leadId: lead.id,
          fromManagerId: lead.managerId ?? null,
          toManagerId: lockedManager.id,
          changedBy: req.user!.id,
          comment,
        });
      }
      return { manager: lockedManager, changedLeads: changed };
    });

    if (changedLeads.length > 0) {
      const changedIds = changedLeads.map((lead) => Number(lead.id));
      await createNotification(
        manager.id,
        'Вам назначены лиды',
        `Назначено лидов: ${changedLeads.length}`,
        'lead_assignment',
      );
      await createAudit(req.actor!, 'BULK_ASSIGN_ACADEMY_LEADS', 'academy_lead', 0, {
        leadIds: changedIds,
        managerId: manager.id,
      }, {
        assignments: changedLeads.map((lead) => ({ leadId: lead.id, managerId: lead.managerId ?? null })),
      });
    }

    res.json({ updatedCount: changedLeads.length, manager });
  } catch (error: any) {
    logger.error('Failed to bulk assign leads', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to assign leads') });
  }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadRowAccess(req, res, lead)) return;
    const [history, assignmentHistory, comments, communications, calls, tasks, payments, students] = await Promise.all([
      query(`SELECT * FROM academy_lead_stage_history WHERE lead_id = $1 ORDER BY entered_at DESC`, [id]),
      query(
        `SELECT h.*,
            previous.full_name AS from_manager_name,
            next.full_name AS to_manager_name,
            actor.full_name AS changed_by_name
         FROM academy_lead_assignment_history h
         LEFT JOIN users previous ON previous.id = h.from_manager_id
         LEFT JOIN users next ON next.id = h.to_manager_id
         LEFT JOIN users actor ON actor.id = h.changed_by
         WHERE h.lead_id = $1
         ORDER BY h.created_at DESC`,
        [id],
      ),
      query(
        `SELECT comment.*, author.full_name AS author_name
         FROM academy_lead_comments comment
         LEFT JOIN users author ON author.id = comment.author_id
         WHERE comment.lead_id = $1
         ORDER BY comment.created_at DESC, comment.id DESC`,
        [id],
      ),
      query(`SELECT * FROM academy_communications WHERE lead_id = $1 ORDER BY created_at DESC`, [id]),
      query(
        `SELECT call.id, call.direction, call.status, call.phone,
                call.started_at, call.answered_at, call.ended_at,
                call.duration_seconds, call.talk_seconds, call.hangup_cause,
                call.user_id, employee.full_name AS user_name,
                (NULLIF(BTRIM(call.recording_url), '') IS NOT NULL OR call.talk_seconds > 0)
                  AS has_recording
         FROM telephony_calls call
         LEFT JOIN users employee ON employee.id = call.user_id
         WHERE call.lead_id = $1
            OR (call.contact_type = 'lead' AND call.contact_id = $1)
         ORDER BY call.started_at DESC`,
        [id],
      ),
      query(
        `SELECT task.id, task.title, task.description, task.due_at, task.status
         FROM board_tasks task
         WHERE task.lead_id = $1
         ORDER BY task.due_at NULLS LAST, task.created_at DESC`,
        [id],
      ),
      query(
        `SELECT payment.*,
                student.student_name,
                student.contact_name AS student_contact_name
         FROM academy_payments payment
         LEFT JOIN academy_students student ON student.id = payment.student_id
         WHERE payment.lead_id = $1
         ORDER BY payment.created_at DESC`,
        [id],
      ),
      query(
        `SELECT student.*,
                course.name AS course_name,
                academy_group.name AS group_name,
                school.name AS school_name,
                student.group_id AS primary_group_id,
                ${studentGroupMembershipsSelect('student')}
         FROM academy_students student
         LEFT JOIN academy_courses course ON course.id = student.course_id
         LEFT JOIN academy_groups academy_group ON academy_group.id = student.group_id
         LEFT JOIN academy_schools school ON school.id = student.school_id
         WHERE student.lead_id = $1
         ORDER BY student.created_at, student.id`,
        [id],
      ),
    ]);
    const [visibleLead] = await applyLeadVisibilityForActor({
      userId: req.user!.id,
      module: req.user!.module,
      modules: getAssignedModules(req.user),
      scopeModule: 'sales',
    }, [lead]);
    res.json({
      ...visibleLead,
      history,
      assignmentHistory,
      comments,
      stageDurations: buildLeadStageDurations(history),
      communications,
      calls,
      tasks,
      payments,
      students,
      studentId: students.length === 1 ? students[0].id : null,
      primaryGroupId: students.length === 1 ? students[0].primaryGroupId : null,
      groups: students.length === 1 ? students[0].groups : [],
      groupIds: students.length === 1 ? students[0].groupIds : [],
    });
  } catch (error) {
    logger.error('Failed to fetch lead', { error });
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

router.post('/leads/:id/groups', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead group access required')) return;
  try {
    const leadId = parseId(req.params.id);
    const groupId = parseId(req.body.groupId);
    const makePrimary = req.body.isPrimary === true;
    if (!leadId || !groupId) {
      return res.status(400).json({ error: 'Lead and group are required' });
    }
    const initialLead = await getLead(leadId);
    if (!initialLead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, initialLead)) return;

    const lead = await withTransaction(async () => {
      const lockedLead = await queryOne(
        `SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`,
        [leadId],
      );
      if (!lockedLead) {
        throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      }
      if (!canMutateLeadRow(req.actor!, lockedLead)) {
        throw Object.assign(new Error('Lead access required'), { statusCode: 403 });
      }
      const student = await queryOne(
        `SELECT id FROM academy_students WHERE lead_id = $1 FOR UPDATE`,
        [leadId],
      );
      if (student) {
        throw Object.assign(new Error('leadAlreadyConvertedToStudent'), { statusCode: 409 });
      }

      await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupId]);
      const group = await validateEnrollmentGroup(groupId, leadId);
      await query(
        `INSERT INTO academy_lead_group_reservations
           (lead_id, group_id, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (lead_id, group_id) DO NOTHING`,
        [leadId, groupId, req.user!.id],
      );

      if (makePrimary || !lockedLead.enrolledGroupId) {
        return updateRow('academy_leads', leadId, {
          enrolledGroupId: groupId,
          courseId: Number(group?.courseId),
          schoolId: Number(group?.schoolId),
        });
      }
      return lockedLead;
    });

    await createAudit(req.actor!, 'ADD_ACADEMY_LEAD_GROUP', 'academy_lead', leadId, {
      groupId,
      isPrimary: makePrimary || !initialLead.enrolledGroupId,
    });
    res.status(201).json(lead);
  } catch (error: any) {
    logger.error('Failed to add lead group', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to add lead group') });
  }
});

router.delete('/leads/:id/groups/:groupId', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead group access required')) return;
  try {
    const leadId = parseId(req.params.id);
    const groupId = parseId(req.params.groupId);
    if (!leadId || !groupId) {
      return res.status(400).json({ error: 'Lead and group are required' });
    }
    const initialLead = await getLead(leadId);
    if (!initialLead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, initialLead)) return;

    const lead = await withTransaction(async () => {
      const lockedLead = await queryOne(
        `SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`,
        [leadId],
      );
      if (!lockedLead) {
        throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      }
      if (!canMutateLeadRow(req.actor!, lockedLead)) {
        throw Object.assign(new Error('Lead access required'), { statusCode: 403 });
      }
      const student = await queryOne(
        `SELECT id FROM academy_students WHERE lead_id = $1 FOR UPDATE`,
        [leadId],
      );
      if (student) {
        throw Object.assign(new Error('leadAlreadyConvertedToStudent'), { statusCode: 409 });
      }
      const reservation = await queryOne(
        `SELECT *
         FROM academy_lead_group_reservations
         WHERE lead_id = $1 AND group_id = $2
         FOR UPDATE`,
        [leadId, groupId],
      );
      if (!reservation) {
        throw Object.assign(new Error('Lead group reservation not found'), { statusCode: 404 });
      }
      const reservationCount = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM academy_lead_group_reservations
         WHERE lead_id = $1`,
        [leadId],
      );
      if (
        ['enrolled', 'paid'].includes(String(lockedLead.statusCode))
        && Number(reservationCount?.count ?? 0) <= 1
      ) {
        throw Object.assign(new Error('groupRequiredForEnrollment'), { statusCode: 409 });
      }

      await query(
        `DELETE FROM academy_lead_group_reservations WHERE id = $1`,
        [reservation.id],
      );
      if (Number(lockedLead.enrolledGroupId) !== groupId) return lockedLead;

      const replacement = await queryOne(
        `SELECT reservation.group_id, academy_group.course_id, academy_group.school_id
         FROM academy_lead_group_reservations reservation
         JOIN academy_groups academy_group ON academy_group.id = reservation.group_id
         WHERE reservation.lead_id = $1
         ORDER BY reservation.created_at, reservation.id
         LIMIT 1
         FOR UPDATE OF reservation`,
        [leadId],
      );
      return updateRow('academy_leads', leadId, {
        enrolledGroupId: replacement?.groupId ?? null,
        courseId: replacement?.courseId ? Number(replacement.courseId) : null,
        schoolId: replacement?.schoolId ? Number(replacement.schoolId) : null,
      });
    });

    await createAudit(req.actor!, 'REMOVE_ACADEMY_LEAD_GROUP', 'academy_lead', leadId, { groupId });
    res.json(lead);
  } catch (error: any) {
    logger.error('Failed to remove lead group', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to remove lead group') });
  }
});

router.post('/leads/:id/archive', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });

    const oldLead = await getLead(id);
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, oldLead)) return;

    if (oldLead.isArchived) return res.json(oldLead);
    if (oldLead.statusCode === 'paid') return res.status(400).json({ error: 'paidLeadCannotArchive' });

    const archiveReasonCode = nullableText(req.body.reason);
    if (!isValidLeadArchiveReason(archiveReasonCode)) {
      return res.status(400).json({ error: 'archiveReasonRequired' });
    }
    const customArchiveReason = nullableText(req.body.customReason);
    if (archiveReasonCode === 'other' && !customArchiveReason) {
      return res.status(400).json({ error: 'archiveCustomReasonRequired' });
    }
    if (customArchiveReason && customArchiveReason.length > 80) {
      return res.status(400).json({ error: 'archiveCustomReasonTooLong' });
    }
    const archiveReason = archiveReasonCode === 'other'
      ? customArchiveReason!
      : archiveReasonCode;

    const assignToSelf = toBoolean(req.body.assignToSelf, false) === true;
    let archived: Row | undefined;

    await withTransaction(async () => {
      let leadBeforeArchive = oldLead;

      if (!leadBeforeArchive.managerId) {
        if (!assignToSelf) {
          throw Object.assign(new Error('leadRequiresResponsibleManager'), { statusCode: 409 });
        }

        const manager = await getActiveSalesManager(req.user!.id);
        const assignedLead = await reassignLead(
          req,
          leadBeforeArchive,
          manager,
          nullableText(req.body.assignmentComment) ?? 'Присвоено себе перед архивированием',
        );
        await createAudit(req.actor!, 'ASSIGN_ACADEMY_LEAD', 'academy_lead', assignedLead.id, assignedLead, leadBeforeArchive);
        leadBeforeArchive = assignedLead;
      }

      archived = await updateRow('academy_leads', id, {
        isArchived: true,
        archiveReason,
        archivedAt: new Date(),
        archivedBy: req.user!.id,
      });
      if (!archived) {
        throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      }

      await createAudit(req.actor!, 'ARCHIVE_ACADEMY_LEAD', 'academy_lead', archived.id, archived, leadBeforeArchive);
    });

    res.json(await getLead(id) ?? archived);
  } catch (error: any) {
    logger.error('Failed to archive lead', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to archive lead') });
  }
});

router.post('/leads/:id/restore', async (req, res) => {
  if (!ensureModuleAccess(req, res, SALES_MODULES, 'Lead restore access required')) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });

    const oldLead = await getLead(id);
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, oldLead)) return;
    if (!oldLead.isArchived) return res.json(oldLead);

    const targetStatusCode = nullableText(req.body.statusCode) ?? oldLead.statusCode;
    const targetStatus = await queryOne(
      `SELECT code
       FROM academy_lead_statuses
       WHERE code = $1 AND is_active = true AND is_pipeline = true`,
      [targetStatusCode],
    );
    if (!targetStatus) return res.status(400).json({ error: 'invalidData' });

    const transitionError = validateLeadStatusTransition(oldLead.statusCode, targetStatusCode);
    if (transitionError) return res.status(400).json({ error: transitionError });

    const validationError = validateLeadForStatusChange({
      nextStatus: targetStatusCode,
      studentName: oldLead.studentName,
      studentAge: oldLead.studentAge,
      courseId: oldLead.courseId,
      enrolledGroupId: oldLead.enrolledGroupId,
    });
    if (validationError) return res.status(400).json({ error: validationError });

    const restored = await withTransaction(async () => {
      if (targetStatusCode !== 'not_now' && oldLead.enrolledGroupId) {
        await validateLeadSelectedGroups(id, Number(oldLead.enrolledGroupId));
      }
      return updateRow('academy_leads', id, {
        statusCode: targetStatusCode,
        isArchived: false,
        archiveReason: null,
        archivedAt: null,
        archivedBy: null,
      });
    });
    if (!restored) return res.status(404).json({ error: 'Lead not found' });

    if (oldLead.statusCode !== targetStatusCode) {
      await createStageHistory(
        restored.id,
        oldLead.statusCode,
        targetStatusCode,
        req.user!.id,
        `Восстановлен из архива${oldLead.archiveReason ? `: ${oldLead.archiveReason}` : ''}`,
      );
      await handleLeadStatusEffects(req.actor!, restored, oldLead.statusCode);
    }

    await createAudit(req.actor!, 'RESTORE_ACADEMY_LEAD', 'academy_lead', restored.id, restored, oldLead);
    res.json(await getLead(id) ?? restored);
  } catch (error: any) {
    logger.error('Failed to restore lead', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to restore lead') });
  }
});

router.patch('/leads/:id', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
  try {
    if (
      req.body.demoAt !== undefined
      || req.body.demoCourseId !== undefined
      || req.body.demoFormat !== undefined
      || req.body.demoLocation !== undefined
    ) {
      return res.status(400).json({ error: 'leadScheduleThroughGroupOnly' });
    }
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const expectedUpdatedAt = parseOptionalDate(req.body.expectedUpdatedAt, 'expectedUpdatedAt');
    const oldLead = await getLead(id);
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, oldLead)) return;
    const requestedComment = req.body.comment === undefined
      ? undefined
      : nullableText(req.body.comment);

    const hasRequestedGroup = req.body.enrolledGroupId !== undefined;
    const requestedGroupId = hasRequestedGroup
      ? toIdOrNull(req.body.enrolledGroupId, 'enrolledGroupId')
      : undefined;
    const existingStudent = hasRequestedGroup
      ? await queryOne<{ id: number; status: string }>(
          `SELECT id, status FROM academy_students WHERE lead_id = $1 LIMIT 1`,
          [id],
        )
      : null;
    if (existingStudent?.status === 'studying' && requestedGroupId === null) {
      return res.status(409).json({ error: 'studentRequiresAtLeastOneGroup' });
    }
    const hasRequestedCourse = req.body.courseId !== undefined;
    const requestedCourseId = hasRequestedCourse
      ? toIdOrNull(req.body.courseId, 'courseId')
      : undefined;
    const hasRequestedOfferCourse = req.body.offerCourseId !== undefined;
    const requestedOfferCourseId = hasRequestedOfferCourse
      ? toIdOrNull(req.body.offerCourseId, 'offerCourseId')
      : undefined;
    const hasRequestedReferrer = req.body.referrerStudentId !== undefined;
    const requestedReferrerStudentId = hasRequestedReferrer
      ? toIdOrNull(req.body.referrerStudentId, 'referrerStudentId')
      : undefined;
    const hasRequestedSource = req.body.sourceId !== undefined;
    const requestedSourceId = hasRequestedSource
      ? toIdOrNull(req.body.sourceId, 'sourceId')
      : undefined;
    if (hasRequestedSource && requestedSourceId === null) {
      return res.status(400).json({ error: 'sourceRequired' });
    }
    const requestedGroup = requestedGroupId
      ? await validateEnrollmentGroup(requestedGroupId, id, existingStudent?.id)
      : null;
    const hasRequestedStatus = req.body.statusCode !== undefined;
    const requestedStatusCode = hasRequestedStatus ? nullableText(req.body.statusCode) : undefined;
    if (hasRequestedStatus && !requestedStatusCode) {
      return res.status(400).json({ error: 'invalidLeadStatus' });
    }
    if (requestedStatusCode && requestedStatusCode !== oldLead.statusCode) {
      const targetStatus = await getActiveLeadStatus(requestedStatusCode);
      if (!targetStatus) return res.status(400).json({ error: 'invalidLeadStatus' });
    }
    const nextStatus = requestedStatusCode ?? oldLead.statusCode;
    const transitionError = validateLeadStatusTransition(oldLead.statusCode, nextStatus);
    if (transitionError) return res.status(400).json({ error: transitionError });
    const merged = {
      nextStatus,
      studentName: req.body.studentName === undefined
        ? oldLead.studentName
        : nullableText(req.body.studentName),
      studentAge: req.body.studentAge === undefined
        ? oldLead.studentAge
        : toIntegerOrNull(req.body.studentAge),
      courseId: requestedGroup?.courseId
        ? Number(requestedGroup.courseId)
        : hasRequestedCourse
          ? requestedCourseId
          : oldLead.courseId,
      enrolledGroupId: !hasRequestedGroup
        ? oldLead.enrolledGroupId
        : requestedGroupId,
    };
    const validationError = validateLeadForStatusChange(merged);
    if (validationError) return res.status(400).json({ error: validationError });
    const canAssignAnyManager = hasLeadershipAccess(req.user) || canAccessAcademyModule(req.user, 'marketing');
    const hasRequestedManager = req.body.managerId !== undefined;
    const requestedManagerId = hasRequestedManager ? parseId(req.body.managerId) : undefined;
    if (hasRequestedManager && !requestedManagerId) {
      return res.status(400).json({ error: 'Active account manager is required' });
    }
    if (requestedManagerId && !canAssignAnyManager && Number(requestedManagerId) !== Number(req.user!.id)) {
      return res.status(403).json({ error: 'Only leadership can assign a lead to another manager' });
    }
    const managerId = requestedManagerId
      ? await resolveLeadManagerId(req.actor!, requestedManagerId)
      : undefined;
    if (nextStatus !== oldLead.statusCode && !oldLead.managerId && !managerId) {
      return res.status(409).json({ error: 'leadRequiresResponsibleManager' });
    }
    const requestedPhones = req.body.phoneNumbers !== undefined || req.body.phone !== undefined
      ? normalizeLeadPhones(req.body.phoneNumbers ?? req.body.phone)
      : undefined;
    const requestedMessenger = req.body.messenger !== undefined ? nullableText(req.body.messenger) : undefined;
    const duplicate = await findDuplicate(
      requestedPhones ?? [],
      requestedMessenger === undefined ? null : requestedMessenger,
      { excludeLeadId: id, studentName: merged.studentName },
    );
    if (duplicate) {
      return res.status(409).json({
        error: 'clientAlreadyExists',
        duplicate: duplicateHintForRequest(req.actor!, duplicate),
      });
    }
    const updates: Row = {
      contactName: nullableText(req.body.contactName) ?? oldLead.contactName,
      phone: requestedPhones === undefined ? undefined : requestedPhones[0]?.phone ?? null,
      messenger: requestedMessenger,
      studentName: nullableText(req.body.studentName),
      studentAge: toIntegerOrNull(req.body.studentAge),
      courseId: req.body.enrolledGroupId !== undefined
        ? requestedGroup?.courseId
          ? Number(requestedGroup.courseId)
          : hasRequestedCourse
            ? requestedCourseId
            : undefined
        : hasRequestedCourse
          ? requestedCourseId
          : undefined,
      schoolId: req.body.enrolledGroupId === undefined
        ? undefined
        : requestedGroup?.schoolId
          ? Number(requestedGroup.schoolId)
          : null,
      sourceId: hasRequestedSource ? requestedSourceId : undefined,
      advertisingCampaign: nullableText(req.body.advertisingCampaign),
      acquisitionCostUzs: toIntegerOrNull(req.body.acquisitionCostUzs),
      statusCode: nullableText(req.body.statusCode),
      managerId,
      language: nullableText(req.body.language),
      comment: requestedComment,
      firstContactAt: nullableDate(req.body.firstContactAt),
      firstContactChannel: nullableText(req.body.firstContactChannel),
      firstContactResult: nullableText(req.body.firstContactResult),
      demoAttended: toBoolean(req.body.demoAttended),
      demoResult: nullableText(req.body.demoResult),
      offerCourseId: hasRequestedOfferCourse ? requestedOfferCourseId : undefined,
      offerPriceUzs: toIntegerOrNull(req.body.offerPriceUzs),
      offerDiscount: nullableText(req.body.offerDiscount),
      offerAt: nullableDate(req.body.offerAt),
      enrolledGroupId: req.body.enrolledGroupId === undefined ? undefined : requestedGroupId,
      expectedPaymentUzs: toIntegerOrNull(req.body.expectedPaymentUzs),
      paymentMethod: nullableText(req.body.paymentMethod),
      warmReason: nullableText(req.body.warmReason),
      warmMovedAt: nullableDate(req.body.warmMovedAt),
      noMailing: toBoolean(req.body.noMailing),
      referralCode: nullableText(req.body.referralCode),
      referrerStudentId: hasRequestedReferrer ? requestedReferrerStudentId : undefined };

    const manager = managerId ? await getActiveSalesManager(managerId) : null;
    const managerChanged = Boolean(manager && Number(oldLead.managerId) !== Number(manager.id));
    let didChangeManager = false;
    const lead: Row | undefined = await withTransaction<Row | undefined>(async () => {
      if (requestedStatusCode && requestedStatusCode !== oldLead.statusCode) {
        const lockedStatus = await getActiveLeadStatus(requestedStatusCode);
        if (!lockedStatus) {
          throw Object.assign(new Error('invalidLeadStatus'), { statusCode: 400 });
        }
      }
      const lockedManager = manager
        ? await getActiveSalesManager(manager.id, true)
        : manager;
      const lockedLead = await queryOne(
        `SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!lockedLead) {
        throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      }
      if (!canMutateLeadRow(req.actor!, lockedLead)) {
        throw Object.assign(new Error('Lead access required'), { statusCode: 403 });
      }
      const lockedStudent = hasRequestedGroup
        ? await queryOne(
            `SELECT * FROM academy_students WHERE lead_id = $1 FOR UPDATE`,
            [id],
          )
        : null;
      const previousVersion = new Date(expectedUpdatedAt ?? oldLead.updatedAt).getTime();
      const lockedVersion = new Date(lockedLead.updatedAt).getTime();
      if (
        Number.isFinite(previousVersion)
        && Number.isFinite(lockedVersion)
        && previousVersion !== lockedVersion
      ) {
        throw Object.assign(new Error('leadChangedConcurrently'), { statusCode: 409 });
      }
      if (requestedPhones !== undefined || requestedMessenger !== undefined) {
        await lockLeadContactIdentities(requestedPhones ?? [], requestedMessenger ?? null);
        const lockedDuplicate = await findDuplicate(
          requestedPhones ?? [],
          requestedMessenger === undefined ? null : requestedMessenger,
          { excludeLeadId: id, studentName: merged.studentName },
        );
        if (lockedDuplicate) {
          throw Object.assign(new Error('clientAlreadyExists'), {
            statusCode: 409,
            duplicate: lockedDuplicate,
          });
        }
      }
      if (requestedSourceId) {
        const activeSource = await queryOne(
          `SELECT id
           FROM academy_lead_sources
           WHERE id = $1 AND is_active = true
           FOR SHARE`,
          [requestedSourceId],
        );
        if (!activeSource) {
          throw Object.assign(new Error('invalidLeadSource'), { statusCode: 400 });
        }
      }
      if (requestedCourseId && !requestedGroup) {
        const activeCourse = await queryOne(
          `SELECT id FROM academy_courses WHERE id = $1 AND is_active = true FOR SHARE`,
          [requestedCourseId],
        );
        if (!activeCourse) {
          throw Object.assign(new Error('courseNotFound'), { statusCode: 400 });
        }
      }
      if (requestedOfferCourseId) {
        const activeOfferCourse = await queryOne(
          `SELECT id FROM academy_courses WHERE id = $1 AND is_active = true FOR SHARE`,
          [requestedOfferCourseId],
        );
        if (!activeOfferCourse) {
          throw Object.assign(new Error('courseNotFound'), { statusCode: 400 });
        }
      }
      if (hasRequestedReferrer) {
        const oldReferrerId = lockedLead.referrerStudentId == null
          ? null
          : Number(lockedLead.referrerStudentId);
        const nextReferrerId = requestedReferrerStudentId == null
          ? null
          : Number(requestedReferrerStudentId);
        if (oldReferrerId !== nextReferrerId) {
          const existingReward = await queryOne(
            `SELECT id
             FROM academy_referral_rewards
             WHERE referred_lead_id = $1
             LIMIT 1
             FOR UPDATE`,
            [id],
          );
          if (existingReward) {
            throw Object.assign(new Error('referralAlreadyRewarded'), { statusCode: 409 });
          }
        }
        if (requestedReferrerStudentId) {
          await assertValidReferrerStudent(requestedReferrerStudentId, id);
        }
      }
      const groupToReserve = Number(merged.enrolledGroupId || 0);
      const activatesReservations = oldLead.statusCode === 'not_now' && nextStatus !== 'not_now';
      const mustValidateCapacity = Boolean(requestedGroupId) || activatesReservations;
      if (mustValidateCapacity && groupToReserve) {
        let lockedGroup: Row | null;
        if (lockedStudent) {
          await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupToReserve]);
          lockedGroup = await validateEnrollmentGroup(groupToReserve, id, lockedStudent.id);
        } else {
          lockedGroup = (await validateLeadSelectedGroups(id, groupToReserve)).primaryGroup;
        }
        if (req.body.enrolledGroupId !== undefined && lockedGroup) {
          updates.courseId = Number(lockedGroup.courseId);
          updates.schoolId = Number(lockedGroup.schoolId);
        }
      }
      const updated = await updateRow('academy_leads', id, updates);
      if (updated) {
        await syncLeadChannelInCurrentTransaction({
          leadId: Number(updated.id),
          sourceId: Number(updated.sourceId),
          messenger: updated.messenger,
          phone: updated.phone,
        });
      }
      if (
        updated
        && requestedComment
        && requestedComment !== nullableText(lockedLead.comment)
      ) {
        await insertRow('academy_lead_comments', {
          leadId: id,
          authorId: req.user!.id,
          body: requestedComment,
        });
      }
      if (updated && requestedGroupId && lockedStudent) {
        await query(
          `UPDATE academy_student_group_enrollments
           SET is_primary = false, updated_at = NOW()
           WHERE student_id = $1 AND status = 'active' AND is_primary = true`,
          [lockedStudent.id],
        );
        await query(
          `INSERT INTO academy_student_group_enrollments
             (student_id, group_id, status, is_primary, enrolled_at, created_by)
           VALUES ($1, $2, 'active', true, COALESCE($3, NOW()), $4)
           ON CONFLICT (student_id, group_id) WHERE status = 'active'
           DO UPDATE SET is_primary = true, ended_at = NULL, updated_at = NOW()`,
          [lockedStudent.id, requestedGroupId, lockedStudent.enrolledAt, req.user!.id],
        );
        await updateRow('academy_students', Number(lockedStudent.id), {
          groupId: requestedGroupId,
          courseId: Number(updates.courseId ?? requestedGroup?.courseId),
          schoolId: Number(updates.schoolId ?? requestedGroup?.schoolId),
        });
        await recalculateStudentMetrics(Number(lockedStudent.id));
      } else if (updated && hasRequestedGroup && !lockedStudent) {
        if (requestedGroupId) {
          await query(
            `INSERT INTO academy_lead_group_reservations
               (lead_id, group_id, created_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (lead_id, group_id) DO NOTHING`,
            [id, requestedGroupId, req.user!.id],
          );
        } else {
          await query(`DELETE FROM academy_lead_group_reservations WHERE lead_id = $1`, [id]);
        }
      }
      const actualManagerChanged = Boolean(
        updated
        && lockedManager
        && Number(lockedLead.managerId) !== Number(lockedManager.id),
      );
      if (updated && lockedManager && actualManagerChanged) {
        await syncLeadManagerAssignment(
          req,
          lockedLead,
          lockedManager,
          nullableText(req.body.assignmentComment) ?? 'Ответственный назначен при переносе лида',
        );
        didChangeManager = true;
      }
      if (updated && lockedLead.statusCode !== updated.statusCode) {
        await createStageHistory(
          updated.id,
          lockedLead.statusCode,
          updated.statusCode,
          req.user!.id,
          nullableText(req.body.statusComment),
        );
      }
      if (updated && requestedPhones !== undefined) {
        await syncLeadPhones(id, requestedPhones);
        return {
          ...updated,
          managerName: lockedManager?.fullName ?? oldLead.managerName,
          phoneNumbers: requestedPhones.map((phone) => phone.phone),
        };
      }
      return updated ? { ...updated, managerName: lockedManager?.fullName ?? oldLead.managerName } : updated;
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (oldLead.statusCode !== lead.statusCode) {
      await handleLeadStatusEffects(req.actor!, lead, oldLead.statusCode);
    }

    if (manager && managerChanged && didChangeManager) {
      await createNotification(
        manager.id,
        'Вам назначен лид',
        leadContactSummary(lead),
        'lead',
        lead.id,
      );
    }

    await createAudit(req.actor!, 'UPDATE_ACADEMY_LEAD', 'academy_lead', lead.id, lead, oldLead);
    res.json(await applyLeadVisibilityForRequest(req, lead));
  } catch (error: any) {
    logger.error('Failed to update lead', { error });
    res.status(error.statusCode || 500).json({
      error: getPublicErrorMessage(error, 'Failed to update lead'),
      ...(error.duplicate ? { duplicate: duplicateHintForRequest(req.actor!, error.duplicate) } : {}),
    });
  }
});

router.post('/leads/:id/contact', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, lead)) return;

    const communication = await insertRow('academy_communications', {
      leadId: id,
      channel: nullableText(req.body.channel) ?? 'call',
      result: nullableText(req.body.result) ?? null,
      comment: nullableText(req.body.comment) ?? null,
      createdBy: req.user!.id });

    const updates: Row = {
      firstContactAt: lead.firstContactAt ?? new Date(),
      firstContactChannel: nullableText(req.body.channel) ?? lead.firstContactChannel ?? 'call',
      firstContactResult: nullableText(req.body.result) ?? lead.firstContactResult ?? null };
    if (lead.statusCode === 'new_request') {
      updates.statusCode = 'first_contact';
    }

    const updatedLead = await updateRow('academy_leads', id, updates);
    if (!updatedLead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.statusCode !== updatedLead.statusCode) {
      await createStageHistory(id, lead.statusCode, updatedLead.statusCode, req.user!.id, 'Первый контакт зафиксирован');
    }

    if (String(req.body.result || '').toLowerCase().includes('не отвечает')) {
      await createTask('Повторный контакт', {
        responsibleId: updatedLead.managerId ?? req.user!.id,
        deadlineAt: addDays(new Date(), 1),
        entityType: 'lead',
        entityId: id });
    }

    res.status(201).json({ communication, lead: await applyLeadVisibilityForRequest(req, updatedLead) });
  } catch (error) {
    logger.error('Failed to add lead contact', { error });
    res.status(500).json({ error: 'Failed to add lead contact' });
  }
});

router.post('/leads/:id/demo', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
  res.status(400).json({ error: 'leadScheduleThroughGroupOnly' });
});

router.post('/leads/:id/demo-attendance', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const oldLead = await getLead(id);
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, oldLead)) return;

    const attended = req.body.attended !== false;
    const nextStatus = attended ? 'demo_attended' : oldLead.statusCode;
    const transitionError = validateLeadStatusTransition(oldLead.statusCode, nextStatus);
    if (transitionError) return res.status(400).json({ error: transitionError });
    const lead = await updateRow('academy_leads', id, {
      demoAttended: attended,
      demoResult: nullableText(req.body.demoResult) ?? null,
      statusCode: nextStatus });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (oldLead.statusCode !== nextStatus) {
      await createStageHistory(id, oldLead.statusCode, nextStatus, req.user!.id, 'Отмечено посещение демо');
      await handleLeadStatusEffects(req.actor!, lead, oldLead.statusCode);
    }
    res.json(await applyLeadVisibilityForRequest(req, lead));
  } catch (error) {
    logger.error('Failed to mark demo attendance', { error });
    res.status(500).json({ error: 'Failed to mark demo attendance' });
  }
});

router.post('/leads/:id/convert-to-student', async (req, res) => {
  if (!ensureModuleAccess(req, res, SALES_MODULES, 'Student conversion access required')) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, lead)) return;
    const student = await withTransaction(async () => {
      await queryOne(`SELECT id FROM academy_leads WHERE id = $1 FOR UPDATE`, [id]);
      const paidPayment = await queryOne(
        `SELECT id FROM academy_payments WHERE lead_id = $1 AND status = 'paid' ORDER BY paid_at DESC, id DESC LIMIT 1`,
        [id],
      );
      if (!paidPayment) {
        throw Object.assign(new Error('paymentRequiredBeforePaid'), { statusCode: 409 });
      }
      return createStudentFromLead(req.actor!, id, Number(paidPayment.id));
    });
    res.status(201).json(student);
  } catch (error: any) {
    logger.error('Failed to convert lead to student', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to convert lead to student') });
  }
});

router.post('/leads/:id/students', async (req, res) => {
  if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Student creation access required')) return;
  try {
    const leadId = parseId(req.params.id);
    if (!leadId) return res.status(400).json({ error: 'Invalid lead id' });
    const initialLead = await getLead(leadId);
    if (!initialLead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, initialLead)) return;
    if (initialLead.isArchived) {
      return res.status(409).json({ error: 'archivedLeadMustBeRestoredBeforeStudentCreation' });
    }

    const studentName = nullableText(req.body.studentName);
    if (!studentName) return res.status(400).json({ error: 'studentNameRequired' });
    const parsedStudentAge = req.body.studentAge === undefined || req.body.studentAge === null || req.body.studentAge === ''
      ? null
      : toIntegerOrNull(req.body.studentAge);
    const studentAge = parsedStudentAge ?? null;
    if (studentAge !== null && (!Number.isInteger(studentAge) || studentAge < 1 || studentAge > 120)) {
      return res.status(400).json({ error: 'invalidStudentAge' });
    }
    const requestedPhone = nullableText(req.body.phone);
    const studentPhone = requestedPhone ? normalizePhoneForStorage(requestedPhone) : null;
    if (
      requestedPhone
      && (!studentPhone || studentPhone.normalizedPhone.replace(/\D/g, '').length < 7)
    ) {
      return res.status(400).json({ error: 'invalidStudentPhone' });
    }
    const parsedGroupIds: number[] = (Array.isArray(req.body.groupIds) ? req.body.groupIds : [])
      .map((value: unknown) => parseId(value))
      .filter((id: number | null): id is number => id !== null);
    const groupIds = Array.from(new Set<number>(parsedGroupIds)).sort((left, right) => left - right);
    if (groupIds.length === 0) {
      return res.status(400).json({ error: 'studentGroupRequired' });
    }
    const requestedPrimaryGroupId = parseId(req.body.primaryGroupId);
    const primaryGroupId = requestedPrimaryGroupId && groupIds.includes(requestedPrimaryGroupId)
      ? requestedPrimaryGroupId
      : groupIds[0];
    const enrolledAt = parseOptionalDate(req.body.enrolledAt, 'enrolledAt') ?? new Date();

    const student = await withTransaction(async () => {
      const lead = await queryOne(`SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`, [leadId]);
      if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      if (lead.isArchived) {
        throw Object.assign(new Error('archivedLeadMustBeRestoredBeforeStudentCreation'), { statusCode: 409 });
      }
      const selectedGroups: Row[] = [];
      for (const groupId of groupIds) {
        await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupId]);
        const group = await validateEnrollmentGroup(groupId);
        if (group) selectedGroups.push(group);
      }
      const primaryGroup = selectedGroups.find((group) => Number(group.id) === primaryGroupId);
      if (!primaryGroup) throw Object.assign(new Error('Group not found'), { statusCode: 404 });
      const count = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM academy_students WHERE lead_id = $1`,
        [leadId],
      );
      const createdStudent = await insertRow('academy_students', {
        leadId,
        contactName: lead.contactName,
        phone: studentPhone?.phone ?? null,
        messenger: null,
        studentName,
        studentAge,
        courseId: Number(primaryGroup.courseId),
        schoolId: Number(primaryGroup.schoolId),
        groupId: primaryGroupId,
        managerId: lead.managerId ?? req.user!.id,
        status: 'studying',
        enrolledAt,
        enrollmentDate: enrolledAt,
        nextPaymentAt: addDays(enrolledAt, 30),
        referralCode: buildReferralCode(studentName, `${leadId}-${Number(count?.count ?? 0) + 1}`),
        marketingConsent: req.body.marketingConsent === true,
        riskFlags: [],
      });
      await query(
        `INSERT INTO academy_student_group_enrollments
           (student_id, group_id, status, is_primary, enrolled_at, created_by)
         SELECT $1, selected_group_id, 'active', selected_group_id = $2, $3, $4
         FROM UNNEST($5::int[]) AS selected_group_id`,
        [createdStudent.id, primaryGroupId, enrolledAt, req.user!.id, groupIds],
      );
      await insertRow('academy_student_status_history', {
        studentId: createdStudent.id,
        fromStatus: null,
        toStatus: 'studying',
        changedBy: req.user!.id,
        comment: 'Ученик создан из карточки лида',
      });
      await query(`DELETE FROM academy_lead_group_reservations WHERE lead_id = $1`, [leadId]);
      if (!['enrolled', 'paid'].includes(String(lead.statusCode))) {
        const enrolledStatus = await getActiveLeadStatus('enrolled');
        if (!enrolledStatus) {
          throw Object.assign(new Error('enrolledLeadStatusUnavailable'), { statusCode: 409 });
        }
        await updateRow('academy_leads', leadId, { statusCode: 'enrolled' });
        await createStageHistory(
          leadId,
          String(lead.statusCode),
          'enrolled',
          req.user!.id,
          `Создан ученик: ${studentName}`,
        );
      }
      return createdStudent;
    });
    const updatedLead = await getLead(leadId);
    if (updatedLead && String(updatedLead.statusCode) !== String(initialLead.statusCode)) {
      await handleLeadStatusEffects(req.actor!, updatedLead, String(initialLead.statusCode));
    }
    const enriched = await queryOne(
      `SELECT student.*,
              course.name AS course_name,
              academy_group.name AS group_name,
              school.name AS school_name,
              ${studentGroupMembershipsSelect('student')}
       FROM academy_students student
       LEFT JOIN academy_courses course ON course.id = student.course_id
       LEFT JOIN academy_groups academy_group ON academy_group.id = student.group_id
       LEFT JOIN academy_schools school ON school.id = student.school_id
       WHERE student.id = $1`,
      [student.id],
    );
    await createAudit(req.actor!, 'CREATE_ACADEMY_STUDENT_FROM_LEAD', 'academy_student', student.id, enriched ?? student);
    res.status(201).json(enriched ?? student);
  } catch (error: any) {
    logger.error('Failed to create student from lead card', { error });
    res.status(error.statusCode || 500).json({ error: getPublicErrorMessage(error, 'Failed to create student') });
  }
});

// Inbound webhooks (ChatPlace, Google Forms) live in ./incoming.routes.ts as
// PUBLIC routes verified by per-provider secrets, not session auth.
};
