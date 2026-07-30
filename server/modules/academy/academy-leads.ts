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
  ACADEMY_REFERRAL_ADVISORY_LOCK,
  ACADEMY_TIME_ZONE,
  NormalizedLeadPhone,
  ReferralBenefitType,
  Row,
  canAccessLeadRow,
  canMutateLeadRow,
  createAudit,
  createNotification,
  createOutbox,
  insertRow,
  leadChannelsSelect,
  leadGroupReservationsSelect,
  leadPhoneNumbersSelect,
  leadTagsSelect,
  lockLeadContactIdentities,
  normalizeLeadPhones,
  nullableText,
  parseId,
  phoneValues,
  query,
  queryOne,
  resolveLeadManagerId,
  salesUserAccessSql,
  syncLeadChannelInCurrentTransaction,
  syncLeadPhones,
  toIdOrNull,
  toIntegerOrNull,
  transactionContext,
  updateRow,
  withTransaction,
} from './academy-core';
import {
  TEMPLATE_SOURCE_PREFIXES,
} from './academy-scheduling';

export const buildTemplateSourceCode = (prefix: string, suffix: string) => {
  const slug = suffix
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9А-Яа-я]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return slug ? `${prefix}_${slug}` : prefix;
};

export const assertValidReferrerStudent = async (
  referrerStudentId: number,
  referredLeadId?: number | null,
) => {
  const referrer = await queryOne(
    `SELECT id, student_name, lead_id
     FROM academy_students
     WHERE id = $1
     ${transactionContext.getStore() ? 'FOR SHARE' : ''}`,
    [referrerStudentId],
  );
  if (!referrer) {
    throw Object.assign(new Error('referrerStudentNotFound'), { statusCode: 400 });
  }
  if (referredLeadId && Number(referrer.leadId) === referredLeadId) {
    throw Object.assign(new Error('leadCannotReferItself'), { statusCode: 409 });
  }
  return referrer;
};

export const findOrCreateActiveSource = async (values: {
  code: string;
  name: string;
  channel: string;
  campaignName?: string | null;
}) => {
  // A single UPSERT both closes the select-then-insert race on the unique code
  // and returns the winning row when another request created it concurrently.
  // Existing source metadata is intentionally preserved.
  const source = await queryOne(
    `INSERT INTO academy_lead_sources
       (code, name, channel, campaign_name, is_system, is_active)
     VALUES ($1, $2, $3, $4, false, true)
     ON CONFLICT (code) DO UPDATE
       SET code = academy_lead_sources.code
     RETURNING *`,
    [values.code, values.name, values.channel, values.campaignName ?? null],
  );
  if (!source) {
    throw Object.assign(new Error('leadSourceResolutionFailed'), { statusCode: 409 });
  }
  if (source.isActive !== true) {
    throw Object.assign(new Error('inactiveLeadSource'), { statusCode: 400 });
  }
  return source;
};

export const resolveSourceId = async (body: Row, validatedReferrer?: Row | null) => {
  const explicitSourceId = toIdOrNull(body.sourceId, 'sourceId');
  if (explicitSourceId) {
    const source = await queryOne(
      `SELECT id
       FROM academy_lead_sources
       WHERE id = $1 AND is_active = true
       ${transactionContext.getStore() ? 'FOR SHARE' : ''}`,
      [explicitSourceId],
    );
    if (!source) {
      throw Object.assign(new Error('invalidLeadSource'), { statusCode: 400 });
    }
    return explicitSourceId;
  }

  // Referral leads: tag becomes referral_<referrer name> (TZ 1.2 / 5.1).
  const referrerStudentId = toIdOrNull(body.referrerStudentId, 'referrerStudentId');
  if (referrerStudentId) {
    const referrer = validatedReferrer
      ?? await assertValidReferrerStudent(referrerStudentId);
    const referrerName = nullableText(referrer.studentName) ?? `id${referrerStudentId}`;
    const code = buildTemplateSourceCode('referral', referrerName);
    const source = await findOrCreateActiveSource({
      code,
      name: `Реферал: ${referrerName}`,
      channel: 'referral',
    });
    return Number(source.id);
  }

  const rawSourceCode = nullableText(body.sourceCode);
  const campaignName = nullableText(body.advertisingCampaign);
  // Expand template prefixes (instagram_ad_<name>, blogger_<name>, etc.) from TZ 1.2.
  const sourceCode = rawSourceCode && campaignName && TEMPLATE_SOURCE_PREFIXES.includes(rawSourceCode)
    ? buildTemplateSourceCode(rawSourceCode, campaignName)
    : rawSourceCode;

  if (sourceCode) {
    const source = await findOrCreateActiveSource({
      code: sourceCode,
      name: sourceCode,
      channel: sourceCode.split('_')[0],
      campaignName: campaignName ?? null,
    });
    return Number(source.id);
  }

  return null;
};

export const resolveCourseByAge = async (age?: number | null) => {
  const slug = suggestCourseSlugByAge(age);
  if (!slug) return null;
  const course = await queryOne(`SELECT * FROM academy_courses WHERE slug = $1`, [slug]);
  return course ?? null;
};

export const normalizeStudentIdentity = (value: unknown) => nullableText(value)
  ?.normalize('NFKC')
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('ru-RU') ?? null;

export const findDuplicate = async (
  phones: NormalizedLeadPhone[] = [],
  messenger?: string | null,
  options: { excludeLeadId?: number | null; studentName?: string | null } = {},
) => {
  const normalizedPhones = phoneValues(phones);
  if (normalizedPhones.length === 0 && !messenger) return null;
  const excludeLeadId = options.excludeLeadId ?? null;
  const studentName = normalizeStudentIdentity(options.studentName);

  const duplicateLead = await queryOne(
    `SELECT 'lead' AS entity_type, l.id, l.contact_name AS name, l.phone, l.messenger,
        l.student_name, l.status_code, l.manager_id, l.is_archived, u.full_name AS manager_name,
        ${leadPhoneNumbersSelect('l')}
     FROM academy_leads l
     LEFT JOIN users u ON u.id = l.manager_id
     WHERE ($3::int IS NULL OR l.id <> $3)
       AND (
         $4::text IS NULL
         OR l.student_name IS NULL
         OR LOWER(REGEXP_REPLACE(BTRIM(l.student_name), '\\s+', ' ', 'g')) = $4
       )
       AND (
         (
           $1::text[] IS NOT NULL
           AND (
             l.phone = ANY($1::text[])
             OR EXISTS (
               SELECT 1
               FROM academy_lead_phones lp
               WHERE lp.lead_id = l.id
                 AND lp.normalized_phone = ANY($1::text[])
             )
           )
         )
         OR (
           $2::text IS NOT NULL
           AND LOWER(BTRIM(l.messenger)) = LOWER(BTRIM($2))
         )
       )
     ORDER BY COALESCE(l.is_archived, false), l.updated_at DESC NULLS LAST, l.id DESC
     LIMIT 1`,
    [normalizedPhones.length > 0 ? normalizedPhones : null, messenger ?? null, excludeLeadId, studentName],
  );
  if (duplicateLead) return duplicateLead;

  return queryOne(
    `SELECT 'student' AS entity_type, id, lead_id, student_name AS name, phone, messenger
     FROM academy_students
     WHERE ($3::int IS NULL OR lead_id IS DISTINCT FROM $3)
       AND (
         $4::text IS NULL
         OR student_name IS NULL
         OR LOWER(REGEXP_REPLACE(BTRIM(student_name), '\\s+', ' ', 'g')) = $4
       )
       AND (
         ($1::text[] IS NOT NULL AND phone = ANY($1::text[]))
         OR (
           $2::text IS NOT NULL
           AND LOWER(BTRIM(messenger)) = LOWER(BTRIM($2))
         )
       )
     LIMIT 1`,
    [normalizedPhones.length > 0 ? normalizedPhones : null, messenger ?? null, excludeLeadId, studentName],
  );
};

export const duplicateHintForRequest = (req: any, duplicate: Row | null | undefined) => {
  if (!duplicate) return duplicate;
  return {
    ...duplicate,
    canMerge: duplicate.entityType === 'lead'
      && duplicate.isArchived !== true
      && canMutateLeadRow(req, duplicate),
  };
};

export const usefulLeadValue = <T>(value: T | null | undefined): value is T => (
  value !== null && value !== undefined && value !== ''
);

export const preferLeadValue = <T>(retained: T | null | undefined, duplicate: T | null | undefined) => (
  usefulLeadValue(retained) ? retained : usefulLeadValue(duplicate) ? duplicate : null
);

export const isSyntheticInstagramIdentity = (value: unknown) => /^instagram:/i.test(String(value ?? '').trim());

export const preferLeadIdentity = (
  retained: string | null | undefined,
  duplicate: string | null | undefined,
) => {
  const retainedText = nullableText(retained);
  const duplicateText = nullableText(duplicate);
  if (!retainedText) return duplicateText ?? null;
  if (isSyntheticInstagramIdentity(retainedText) && duplicateText && !isSyntheticInstagramIdentity(duplicateText)) {
    return duplicateText;
  }
  return retainedText;
};

export const combineLeadComments = (
  retained: string | null | undefined,
  duplicate: string | null | undefined,
) => {
  const values = [nullableText(retained), nullableText(duplicate)].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set(values)].join('\n\n') || null;
};

export const earliestLeadDate = (
  retained: Date | string | null | undefined,
  duplicate: Date | string | null | undefined,
) => {
  const dates = [retained, duplicate]
    .filter(usefulLeadValue)
    .map((value) => new Date(value as Date | string))
    .filter((value) => !Number.isNaN(value.getTime()));
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((value) => value.getTime())));
};

export const leadMergeCandidateSelect = (whereSql: string) => `
  SELECT l.id, l.contact_name, l.phone, l.messenger, l.student_name, l.student_age,
      l.status_code, status.name AS status_name, l.manager_id,
      manager.full_name AS manager_name, source.name AS source_name,
      l.created_at, l.updated_at, l.is_archived,
      ${leadPhoneNumbersSelect('l')},
      (SELECT COUNT(*)::int FROM instagram_conversations conversation WHERE conversation.lead_id = l.id)
        AS instagram_conversation_count,
      (SELECT COUNT(*)::int FROM academy_students student WHERE student.lead_id = l.id)
        AS student_count,
      (SELECT COUNT(*)::int FROM academy_payments payment WHERE payment.lead_id = l.id)
        AS payment_count,
      (SELECT COUNT(*)::int FROM academy_communications communication WHERE communication.lead_id = l.id)
        AS communication_count,
      (SELECT COUNT(*)::int FROM academy_tasks task WHERE task.entity_type = 'lead' AND task.entity_id = l.id)
        AS task_count
   FROM academy_leads l
   LEFT JOIN users manager ON manager.id = l.manager_id
   LEFT JOIN academy_lead_sources source ON source.id = l.source_id
   LEFT JOIN academy_lead_statuses status ON status.code = l.status_code
   WHERE ${whereSql}`;

export const getLeadMergeCandidates = (leadIds: number[]) => {
  if (leadIds.length === 0) return Promise.resolve([]);
  return query(
    `${leadMergeCandidateSelect('l.id = ANY($1::int[])')}
     ORDER BY l.id`,
    [leadIds],
  );
};

export type LeadMergeResult = {
  retainedLead: Row;
  duplicateLeadId: number;
  moved: Row;
};

export const mergeLeadRecords = async (
  req: any,
  retainedLeadId: number,
  duplicateLeadId: number,
): Promise<LeadMergeResult> => withTransaction(async () => {
  if (retainedLeadId === duplicateLeadId) {
    throw Object.assign(new Error('leadMergeRequiresDifferentLeads'), { statusCode: 400 });
  }

  const orderedIds = [retainedLeadId, duplicateLeadId].sort((left, right) => left - right);
  for (const leadId of orderedIds) {
    await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `academy-lead-merge:${leadId}`,
    ]);
  }

  const lockedLeads = await query(
    `SELECT *
     FROM academy_leads
     WHERE id = ANY($1::int[])
     ORDER BY id
     FOR UPDATE`,
    [orderedIds],
  );
  const retainedLead = lockedLeads.find((lead) => Number(lead.id) === retainedLeadId);
  const duplicateLead = lockedLeads.find((lead) => Number(lead.id) === duplicateLeadId);
  if (!retainedLead || !duplicateLead) {
    throw Object.assign(new Error('leadMergeLeadNotFound'), { statusCode: 404 });
  }
  if (retainedLead.isArchived || duplicateLead.isArchived) {
    throw Object.assign(new Error('leadMergeActiveLeadsOnly'), { statusCode: 409 });
  }
  if (!canMutateLeadRow(req, retainedLead) || !canMutateLeadRow(req, duplicateLead)) {
    throw Object.assign(new Error('leadMergeAccessDenied'), { statusCode: 403 });
  }

  for (const lead of [retainedLead, duplicateLead]) {
    const legacyComment = nullableText(lead.comment);
    if (!legacyComment) continue;
    await query(
      `INSERT INTO academy_lead_comments (lead_id, author_id, body, created_at)
       SELECT $1, $2, $3, COALESCE($4, $5, NOW())
       WHERE NOT EXISTS (
         SELECT 1
         FROM academy_lead_comments existing
         WHERE existing.lead_id = $1 AND existing.body = $3
       )`,
      [lead.id, lead.createdBy ?? null, legacyComment, lead.updatedAt ?? null, lead.createdAt ?? null],
    );
  }

  const preferEnrollmentValue = <T>(retained: T | null | undefined, duplicate: T | null | undefined) => (
    preferLeadValue(retained, duplicate)
  );

  const moved = await queryOne(
    `SELECT
       (SELECT COUNT(*)::int FROM instagram_conversations WHERE lead_id = $1) AS instagram_conversations,
       (SELECT COUNT(*)::int FROM academy_communications WHERE lead_id = $1) AS communications,
       (SELECT COUNT(*)::int FROM academy_lead_assignment_history WHERE lead_id = $1) AS assignment_history,
       (SELECT COUNT(*)::int FROM academy_lead_stage_history WHERE lead_id = $1) AS stage_history,
       (SELECT COUNT(*)::int FROM academy_lead_comments WHERE lead_id = $1) AS comments,
       (SELECT COUNT(*)::int FROM academy_payments WHERE lead_id = $1) AS payments,
       (SELECT COUNT(*)::int FROM academy_referral_rewards WHERE referred_lead_id = $1) AS referral_rewards,
       (SELECT COUNT(*)::int FROM academy_students WHERE lead_id = $1) AS students,
       (SELECT COUNT(*)::int FROM academy_lead_phones WHERE lead_id = $1) AS phones,
       (SELECT COUNT(*)::int FROM academy_lead_channels WHERE lead_id = $1) AS channels,
       (SELECT COUNT(*)::int FROM academy_lead_tag_assignments WHERE lead_id = $1) AS manual_tags,
       (SELECT COUNT(*)::int FROM telephony_calls WHERE lead_id = $1) AS calls,
       (SELECT COUNT(*)::int FROM academy_lead_group_reservations WHERE lead_id = $1) AS group_reservations,
       (SELECT COUNT(*)::int FROM academy_tasks WHERE entity_type = 'lead' AND entity_id = $1) AS tasks,
       (SELECT COUNT(*)::int FROM academy_notification_outbox WHERE entity_type = 'lead' AND entity_id = $1)
         AS notification_outbox,
       (SELECT COUNT(*)::int FROM academy_escalation_events WHERE entity_type = 'lead' AND entity_id = $1)
         AS escalation_events,
       (SELECT COUNT(*)::int FROM notifications WHERE related_entity_type = 'lead' AND related_entity_id = $1) AS notifications`,
    [duplicateLeadId],
  ) ?? {};

  const phoneRows = await query(
    `SELECT *
     FROM academy_lead_phones
     WHERE lead_id = ANY($1::int[])
     ORDER BY lead_id, is_primary DESC, id
     FOR UPDATE`,
    [orderedIds],
  );
  const contactPhones = phoneRows.map((phone) => ({
    phone: String(phone.phone),
    normalizedPhone: String(phone.normalizedPhone),
  }));
  await lockLeadContactIdentities(contactPhones, retainedLead.messenger);
  await lockLeadContactIdentities([], duplicateLead.messenger);

  await query(
    `UPDATE instagram_conversations
     SET lead_id = $1, updated_at = NOW()
     WHERE lead_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `DELETE FROM academy_lead_channels duplicate_channel
     USING academy_lead_channels retained_channel
     WHERE duplicate_channel.lead_id = $2
       AND retained_channel.lead_id = $1
       AND retained_channel.channel = duplicate_channel.channel
       AND retained_channel.provider_account_id = duplicate_channel.provider_account_id
       AND (
         (
           retained_channel.external_id IS NOT NULL
           AND duplicate_channel.external_id IS NOT NULL
           AND retained_channel.external_id = duplicate_channel.external_id
         )
         OR (
           retained_channel.handle IS NOT NULL
           AND duplicate_channel.handle IS NOT NULL
           AND LOWER(retained_channel.handle) = LOWER(duplicate_channel.handle)
         )
       )`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `UPDATE academy_lead_channels
     SET lead_id = $1, updated_at = NOW()
     WHERE lead_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `INSERT INTO academy_lead_tag_assignments
       (lead_id, tag_id, created_by, created_at)
     SELECT $1, tag_id, created_by, created_at
     FROM academy_lead_tag_assignments
     WHERE lead_id = $2
     ON CONFLICT (lead_id, tag_id) DO NOTHING`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `DELETE FROM academy_lead_tag_assignments WHERE lead_id = $1`,
    [duplicateLeadId],
  );
  await query(
    `UPDATE telephony_calls
     SET lead_id = $1,
         contact_id = CASE
           WHEN contact_type = 'lead' AND contact_id = $2 THEN $1
           ELSE contact_id
         END,
         updated_at = NOW()
     WHERE lead_id = $2 OR (contact_type = 'lead' AND contact_id = $2)`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(`UPDATE academy_communications SET lead_id = $1 WHERE lead_id = $2`, [retainedLeadId, duplicateLeadId]);
  await query(`UPDATE academy_lead_assignment_history SET lead_id = $1 WHERE lead_id = $2`, [retainedLeadId, duplicateLeadId]);
  await query(`UPDATE academy_lead_stage_history SET lead_id = $1 WHERE lead_id = $2`, [retainedLeadId, duplicateLeadId]);
  await query(`UPDATE academy_lead_comments SET lead_id = $1 WHERE lead_id = $2`, [retainedLeadId, duplicateLeadId]);
  await query(
    `UPDATE academy_payments SET lead_id = $1, updated_at = NOW() WHERE lead_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `UPDATE academy_referral_rewards SET referred_lead_id = $1 WHERE referred_lead_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `UPDATE academy_students SET lead_id = $1, updated_at = NOW() WHERE lead_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `INSERT INTO academy_lead_group_reservations
       (lead_id, group_id, created_by, created_at, updated_at)
     SELECT $1, group_id, created_by, created_at, NOW()
     FROM academy_lead_group_reservations
     WHERE lead_id = $2
     ON CONFLICT (lead_id, group_id) DO NOTHING`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(`DELETE FROM academy_lead_group_reservations WHERE lead_id = $1`, [duplicateLeadId]);

  const mergedStudents = await query(
    `SELECT * FROM academy_students WHERE lead_id = $1 FOR UPDATE`,
    [retainedLeadId],
  );
  if (mergedStudents.length === 1) {
    const mergedStudent = mergedStudents[0];
    await query(
      `INSERT INTO academy_student_group_enrollments
         (student_id, group_id, status, is_primary, enrolled_at, created_by)
       SELECT $1,
              reservation.group_id,
              'active',
              reservation.group_id = $2,
              COALESCE($3, reservation.created_at, NOW()),
              reservation.created_by
       FROM academy_lead_group_reservations reservation
       WHERE reservation.lead_id = $4
       ON CONFLICT (student_id, group_id) WHERE status = 'active'
       DO UPDATE SET ended_at = NULL, updated_at = NOW()`,
      [mergedStudent.id, mergedStudent.groupId, mergedStudent.enrolledAt, retainedLeadId],
    );
    await query(`DELETE FROM academy_lead_group_reservations WHERE lead_id = $1`, [retainedLeadId]);
  }

  await query(
    `DELETE FROM academy_lead_phones source_phone
     USING academy_lead_phones retained_phone
     WHERE source_phone.lead_id = $2
       AND retained_phone.lead_id = $1
       AND retained_phone.normalized_phone = source_phone.normalized_phone`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `UPDATE academy_lead_phones
     SET lead_id = $1, updated_at = NOW()
     WHERE lead_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );

  const legacyPhones = [retainedLead.phone, duplicateLead.phone]
    .filter((value) => usefulLeadValue(value) && !isSyntheticInstagramIdentity(value))
    .flatMap((value) => normalizeLeadPhones(value));
  for (const phone of legacyPhones) {
    await query(
      `INSERT INTO academy_lead_phones (lead_id, phone, normalized_phone, is_primary)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (lead_id, normalized_phone) DO NOTHING`,
      [retainedLeadId, phone.phone, phone.normalizedPhone],
    );
  }

  const mergedPhoneRows = await query(
    `SELECT * FROM academy_lead_phones WHERE lead_id = $1 ORDER BY is_primary DESC, id FOR UPDATE`,
    [retainedLeadId],
  );
  const retainedPhoneIds = new Set(
    phoneRows.filter((phone) => Number(phone.leadId) === retainedLeadId).map((phone) => Number(phone.id)),
  );
  const primaryPhoneRow = mergedPhoneRows.find((phone) => retainedPhoneIds.has(Number(phone.id)) && phone.isPrimary)
    ?? mergedPhoneRows.find((phone) => retainedPhoneIds.has(Number(phone.id)))
    ?? mergedPhoneRows.find((phone) => phone.isPrimary)
    ?? mergedPhoneRows[0];
  if (primaryPhoneRow) {
    await query(
      `UPDATE academy_lead_phones SET is_primary = (id = $2), updated_at = NOW() WHERE lead_id = $1`,
      [retainedLeadId, primaryPhoneRow.id],
    );
  }
  const latestMergedComment = await queryOne<{ body: string }>(
    `SELECT body
     FROM academy_lead_comments
     WHERE lead_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [retainedLeadId],
  );

  await query(
    `UPDATE academy_tasks
     SET entity_id = $1, updated_at = NOW()
     WHERE entity_type = 'lead' AND entity_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `UPDATE board_tasks
     SET lead_id = $1, updated_at = NOW()
     WHERE lead_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `UPDATE academy_notification_outbox
     SET entity_id = $1, updated_at = NOW()
     WHERE entity_type = 'lead' AND entity_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `UPDATE academy_escalation_events
     SET entity_id = $1
     WHERE entity_type = 'lead' AND entity_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `UPDATE notifications
     SET related_entity_id = $1
     WHERE related_entity_type = 'lead' AND related_entity_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );

  const retainedContactName = isGeneratedInstagramLeadName(retainedLead.contactName)
    && !isGeneratedInstagramLeadName(duplicateLead.contactName)
    ? duplicateLead.contactName
    : retainedLead.contactName;
  const updatedRetainedLead = await updateRow('academy_leads', retainedLeadId, {
    contactName: retainedContactName,
    phone: primaryPhoneRow?.phone
      ?? preferLeadIdentity(retainedLead.phone, duplicateLead.phone),
    messenger: preferLeadIdentity(retainedLead.messenger, duplicateLead.messenger),
    studentName: preferEnrollmentValue(retainedLead.studentName, duplicateLead.studentName),
    studentAge: preferEnrollmentValue(retainedLead.studentAge, duplicateLead.studentAge),
    courseId: preferEnrollmentValue(retainedLead.courseId, duplicateLead.courseId),
    schoolId: preferEnrollmentValue(retainedLead.schoolId, duplicateLead.schoolId),
    advertisingCampaign: preferLeadValue(retainedLead.advertisingCampaign, duplicateLead.advertisingCampaign),
    acquisitionCostUzs: Number(retainedLead.acquisitionCostUzs || 0) > 0
      ? retainedLead.acquisitionCostUzs
      : duplicateLead.acquisitionCostUzs,
    managerId: preferLeadValue(retainedLead.managerId, duplicateLead.managerId),
    language: preferLeadValue(retainedLead.language, duplicateLead.language),
    comment: latestMergedComment?.body ?? combineLeadComments(retainedLead.comment, duplicateLead.comment),
    firstContactAt: earliestLeadDate(retainedLead.firstContactAt, duplicateLead.firstContactAt),
    firstContactChannel: preferLeadValue(retainedLead.firstContactChannel, duplicateLead.firstContactChannel),
    firstContactResult: preferLeadValue(retainedLead.firstContactResult, duplicateLead.firstContactResult),
    demoAt: earliestLeadDate(retainedLead.demoAt, duplicateLead.demoAt),
    demoCourseId: preferLeadValue(retainedLead.demoCourseId, duplicateLead.demoCourseId),
    demoFormat: preferLeadValue(retainedLead.demoFormat, duplicateLead.demoFormat),
    demoLocation: preferLeadValue(retainedLead.demoLocation, duplicateLead.demoLocation),
    demoAttended: Boolean(retainedLead.demoAttended || duplicateLead.demoAttended),
    demoResult: preferLeadValue(retainedLead.demoResult, duplicateLead.demoResult),
    offerCourseId: preferLeadValue(retainedLead.offerCourseId, duplicateLead.offerCourseId),
    offerPriceUzs: preferLeadValue(retainedLead.offerPriceUzs, duplicateLead.offerPriceUzs),
    offerDiscount: preferLeadValue(retainedLead.offerDiscount, duplicateLead.offerDiscount),
    offerAt: earliestLeadDate(retainedLead.offerAt, duplicateLead.offerAt),
    enrolledGroupId: preferEnrollmentValue(retainedLead.enrolledGroupId, duplicateLead.enrolledGroupId),
    expectedPaymentUzs: preferLeadValue(retainedLead.expectedPaymentUzs, duplicateLead.expectedPaymentUzs),
    paymentMethod: preferLeadValue(retainedLead.paymentMethod, duplicateLead.paymentMethod),
    warmReason: preferLeadValue(retainedLead.warmReason, duplicateLead.warmReason),
    warmMovedAt: earliestLeadDate(retainedLead.warmMovedAt, duplicateLead.warmMovedAt),
    noMailing: Boolean(retainedLead.noMailing || duplicateLead.noMailing),
    referralCode: preferLeadValue(retainedLead.referralCode, duplicateLead.referralCode),
    referrerStudentId: preferLeadValue(retainedLead.referrerStudentId, duplicateLead.referrerStudentId),
  });
  if (!updatedRetainedLead) {
    throw Object.assign(new Error('leadMergeLeadNotFound'), { statusCode: 404 });
  }

  if (updatedRetainedLead?.managerId) {
    await query(
      `UPDATE academy_students
       SET manager_id = $1, updated_at = NOW()
       WHERE lead_id = $2`,
      [updatedRetainedLead.managerId, retainedLeadId],
    );
    await query(
      `UPDATE academy_tasks
       SET responsible_id = $1, updated_at = NOW()
       WHERE entity_type = 'lead'
         AND entity_id = $2
         AND status <> 'done'`,
      [updatedRetainedLead.managerId, retainedLeadId],
    );
    await syncLeadOwnedNotifications(Number(updatedRetainedLead.managerId), [retainedLeadId]);
  }

  await updateRow('academy_leads', duplicateLeadId, {
    phone: null,
    messenger: null,
    referralCode: null,
    referrerStudentId: null,
    enrolledGroupId: null,
    isArchived: true,
    archiveReason: 'duplicate_or_invalid',
    archivedAt: new Date(),
    archivedBy: req.user!.id,
  });

  await insertRow('audit_logs', {
    userId: req.user!.id,
    action: 'MERGE_ACADEMY_LEADS',
    entityType: 'academy_lead',
    entityId: retainedLeadId,
    oldValues: {
      retainedLeadId,
      duplicateLeadId,
      retainedContactName: retainedLead.contactName,
      duplicateContactName: duplicateLead.contactName,
    },
    newValues: {
      retainedLeadId,
      duplicateLeadId,
      moved,
      duplicateArchived: true,
    },
  });

  const remainingLinks = await queryOne<{ total: number }>(
    `SELECT (
       (SELECT COUNT(*) FROM instagram_conversations WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_communications WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_lead_assignment_history WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_lead_stage_history WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_lead_comments WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_payments WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_referral_rewards WHERE referred_lead_id = $1)
       + (SELECT COUNT(*) FROM academy_students WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_lead_phones WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_lead_channels WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_lead_tag_assignments WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM telephony_calls WHERE lead_id = $1 OR (contact_type = 'lead' AND contact_id = $1))
       + (SELECT COUNT(*) FROM academy_lead_group_reservations WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_tasks WHERE entity_type = 'lead' AND entity_id = $1)
       + (SELECT COUNT(*) FROM academy_notification_outbox WHERE entity_type = 'lead' AND entity_id = $1)
       + (SELECT COUNT(*) FROM academy_escalation_events WHERE entity_type = 'lead' AND entity_id = $1)
       + (SELECT COUNT(*) FROM notifications WHERE related_entity_type = 'lead' AND related_entity_id = $1)
     )::int AS total`,
    [duplicateLeadId],
  );
  if (Number(remainingLinks?.total ?? 0) !== 0) {
    throw Object.assign(new Error('leadMergeIncomplete'), { statusCode: 409 });
  }

  return {
    retainedLead: await getLead(retainedLeadId) ?? updatedRetainedLead,
    duplicateLeadId,
    moved,
  };
});

export type LeadDraftMergeResult = {
  retainedLead: Row;
  assignedManager: { id: number; fullName: string } | null;
};

export const mergeLeadDraftIntoExisting = async (
  req: any,
  retainedLeadId: number,
  draft: Row,
): Promise<LeadDraftMergeResult> => withTransaction(async () => {
  await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `academy-lead-merge:${retainedLeadId}`,
  ]);
  const retainedLead = await queryOne(
    `SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`,
    [retainedLeadId],
  );
  if (!retainedLead) {
    throw Object.assign(new Error('leadMergeLeadNotFound'), { statusCode: 404 });
  }
  if (retainedLead.isArchived) {
    throw Object.assign(new Error('leadMergeActiveLeadsOnly'), { statusCode: 409 });
  }
  if (!canMutateLeadRow(req, retainedLead)) {
    throw Object.assign(new Error('leadMergeAccessDenied'), { statusCode: 403 });
  }

  const draftPhones = normalizeLeadPhones(draft.phoneNumbers ?? draft.phone);
  const draftMessenger = nullableText(draft.messenger);
  await lockLeadContactIdentities(draftPhones, draftMessenger);
  const otherDuplicate = await findDuplicate(draftPhones, draftMessenger, {
    excludeLeadId: retainedLeadId,
    studentName: nullableText(draft.studentName),
  });
  if (otherDuplicate) {
    throw Object.assign(new Error('clientAlreadyExists'), {
      statusCode: 409,
      duplicate: otherDuplicate,
    });
  }

  const existingPhoneRows = await query(
    `SELECT *
     FROM academy_lead_phones
     WHERE lead_id = $1
     ORDER BY is_primary DESC, id
     FOR UPDATE`,
    [retainedLeadId],
  );
  const mergedPhones = new Map<string, NormalizedLeadPhone>();
  for (const phone of existingPhoneRows) {
    mergedPhones.set(String(phone.normalizedPhone), {
      phone: String(phone.phone),
      normalizedPhone: String(phone.normalizedPhone),
    });
  }
  if (usefulLeadValue(retainedLead.phone) && !isSyntheticInstagramIdentity(retainedLead.phone)) {
    for (const phone of normalizeLeadPhones(retainedLead.phone)) {
      mergedPhones.set(phone.normalizedPhone, phone);
    }
  }
  for (const phone of draftPhones) {
    mergedPhones.set(phone.normalizedPhone, phone);
  }
  const phoneValuesToSave = [...mergedPhones.values()];

  const requestedGroupId = retainedLead.enrolledGroupId
    ? null
    : parseId(draft.enrolledGroupId);
  let requestedGroup: Row | null = null;
  if (requestedGroupId) {
    await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [requestedGroupId]);
    requestedGroup = await validateEnrollmentGroup(requestedGroupId, retainedLeadId);
  }

  const requestedManagerId = retainedLead.managerId
    ? null
    : await resolveLeadManagerId(req, draft.managerId);
  const assignedManager = requestedManagerId
    ? await getActiveSalesManager(requestedManagerId, true)
    : null;
  const nextStudentName = preferLeadValue(retainedLead.studentName, nullableText(draft.studentName));
  const nextStudentAge = preferLeadValue(retainedLead.studentAge, toIntegerOrNull(draft.studentAge));
  const nextCourseId = requestedGroup?.courseId
    ? Number(requestedGroup.courseId)
    : preferLeadValue(retainedLead.courseId, toIdOrNull(draft.courseId, 'courseId'));
  const nextEnrolledGroupId = preferLeadValue(retainedLead.enrolledGroupId, requestedGroupId);
  const validationError = validateLeadForStatusChange({
    nextStatus: retainedLead.statusCode,
    studentName: nextStudentName,
    studentAge: nextStudentAge,
    courseId: nextCourseId,
    enrolledGroupId: nextEnrolledGroupId,
  });
  if (validationError) {
    throw Object.assign(new Error(validationError), { statusCode: 409 });
  }

  const retainedContactName = isGeneratedInstagramLeadName(retainedLead.contactName)
    && nullableText(draft.contactName)
    ? nullableText(draft.contactName)
    : retainedLead.contactName;
  const draftComment = nullableText(draft.comment);
  const updatedLead = await updateRow('academy_leads', retainedLeadId, {
    contactName: retainedContactName,
    phone: phoneValuesToSave[0]?.phone ?? retainedLead.phone,
    messenger: preferLeadIdentity(retainedLead.messenger, draftMessenger),
    studentName: nextStudentName,
    studentAge: nextStudentAge,
    courseId: nextCourseId,
    schoolId: requestedGroup?.schoolId
      ? Number(requestedGroup.schoolId)
      : preferLeadValue(retainedLead.schoolId, toIdOrNull(draft.schoolId, 'schoolId')),
    managerId: assignedManager?.id ?? retainedLead.managerId,
    comment: draftComment ?? retainedLead.comment,
    language: preferLeadValue(retainedLead.language, nullableText(draft.language)),
    enrolledGroupId: nextEnrolledGroupId,
  });
  if (!updatedLead) {
    throw Object.assign(new Error('leadMergeLeadNotFound'), { statusCode: 404 });
  }
  if (draftComment) {
    await insertRow('academy_lead_comments', {
      leadId: retainedLeadId,
      authorId: req.user!.id,
      body: draftComment,
    });
  }
  if (nextEnrolledGroupId) {
    await query(
      `INSERT INTO academy_lead_group_reservations
         (lead_id, group_id, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (lead_id, group_id) DO NOTHING`,
      [retainedLeadId, nextEnrolledGroupId, req.user!.id],
    );
  }
  await syncLeadPhones(retainedLeadId, phoneValuesToSave);
  await syncLeadChannelInCurrentTransaction({
    leadId: retainedLeadId,
    sourceId: parseId(draft.sourceId) ?? Number(retainedLead.sourceId),
    messenger: draftMessenger ?? retainedLead.messenger,
    phone: draftPhones[0]?.phone ?? retainedLead.phone,
  });

  if (assignedManager) {
    await syncLeadManagerAssignment(
      req,
      retainedLead,
      assignedManager,
      'Ответственный назначен при объединении новой заявки с существующим лидом',
    );
  }

  await insertRow('audit_logs', {
    userId: req.user!.id,
    action: 'MERGE_ACADEMY_LEAD_DRAFT',
    entityType: 'academy_lead',
    entityId: retainedLeadId,
    oldValues: {
      retainedLeadId,
      contactName: retainedLead.contactName,
      phone: retainedLead.phone,
    },
    newValues: {
      retainedLeadId,
      draftContactName: nullableText(draft.contactName),
      mergedPhoneCount: phoneValuesToSave.length,
    },
  });

  return {
    retainedLead: await getLead(retainedLeadId) ?? updatedLead,
    assignedManager,
  };
});

export const getLead = (id: number) =>
  queryOne(
    `SELECT l.*, c.name AS course_name, s.name AS source_name, s.channel AS source_channel, sc.name AS school_name,
        u.full_name AS manager_name,
        archived_by_user.full_name AS archived_by_name,
        ${leadPhoneNumbersSelect('l')},
        ${leadChannelsSelect('l')},
        ${leadTagsSelect('l')},
        ${leadGroupReservationsSelect('l')}
     FROM academy_leads l
     LEFT JOIN academy_courses c ON c.id = l.course_id
     LEFT JOIN academy_lead_sources s ON s.id = l.source_id
     LEFT JOIN academy_schools sc ON sc.id = l.school_id
     LEFT JOIN users u ON u.id = l.manager_id
     LEFT JOIN users archived_by_user ON archived_by_user.id = l.archived_by
     WHERE l.id = $1`,
    [id],
  );

export const getLockedLeadWithSource = (id: number) =>
  queryOne(
    `SELECT lead.*, source.name AS source_name
     FROM academy_leads lead
     JOIN academy_lead_sources source ON source.id = lead.source_id
     WHERE lead.id = $1
     FOR UPDATE OF lead`,
    [id],
  );

export const createStageHistory = async (leadId: number, fromStatusCode: string | null, toStatusCode: string, changedBy: number, comment?: string | null) =>
  insertRow('academy_lead_stage_history', {
    leadId,
    fromStatusCode,
    toStatusCode,
    changedBy,
    comment: comment ?? null });

export const leadContactSummary = (lead: Row) =>
  [lead.contactName, lead.phone || lead.phoneNumbers?.[0] || lead.messenger || 'без телефона'].filter(Boolean).join(': ');

export const getActiveSalesManager = async (managerId: number, lockForAssignment = false) => {
  const manager = await queryOne<{ id: number; fullName: string }>(
    `SELECT id, full_name
     FROM users u
     WHERE u.id = $1 AND ${salesUserAccessSql} AND u.is_active = true
     ${lockForAssignment ? 'FOR UPDATE OF u' : ''}`,
    [managerId],
  );
  if (!manager) {
    throw Object.assign(new Error('Active account manager is required'), { statusCode: 400 });
  }
  return manager;
};

export const syncLeadOwnedNotifications = async (managerId: number, leadIds: number[]) => {
  if (leadIds.length === 0) return;
  await query(
    `UPDATE notifications notification
     SET user_id = $1, is_read = false
     WHERE notification.user_id IS DISTINCT FROM $1
       AND (
         (
           notification.related_entity_type = 'lead'
           AND notification.related_entity_id = ANY($2::int[])
         )
         OR (
           notification.related_entity_type = 'student'
           AND notification.related_entity_id IN (
             SELECT student.id
             FROM academy_students student
             WHERE student.lead_id = ANY($2::int[])
           )
         )
         OR (
           notification.related_entity_type = 'academy_task'
           AND notification.related_entity_id IN (
             SELECT task.id
             FROM academy_tasks task
             WHERE task.status <> 'done'
               AND (
                 (task.entity_type = 'lead' AND task.entity_id = ANY($2::int[]))
                 OR (
                   task.entity_type = 'student'
                   AND task.entity_id IN (
                     SELECT student.id
                     FROM academy_students student
                     WHERE student.lead_id = ANY($2::int[])
                   )
                 )
               )
           )
         )
       )`,
    [managerId, leadIds],
  );
};

export const syncLeadManagerAssignment = async (
  req: any,
  lead: Row,
  manager: { id: number; fullName: string },
  comment?: string | null,
) => {
  await query(
    `UPDATE academy_students
     SET manager_id = $1, updated_at = NOW()
     WHERE lead_id = $2`,
    [manager.id, lead.id],
  );
  await query(
    `UPDATE academy_tasks
     SET responsible_id = $1, updated_at = NOW()
     WHERE status <> 'done'
       AND (
         (entity_type = 'lead' AND entity_id = $2)
         OR (
           entity_type = 'student'
           AND entity_id IN (SELECT id FROM academy_students WHERE lead_id = $2)
         )
       )`,
    [manager.id, lead.id],
  );
  await query(
    `UPDATE board_tasks
     SET assignee_id = $1, updated_at = NOW()
     WHERE lead_id = $2
       AND status NOT IN ('done', 'accepted')`,
    [manager.id, lead.id],
  );
  await syncLeadOwnedNotifications(manager.id, [Number(lead.id)]);
  await insertRow('academy_lead_assignment_history', {
    leadId: lead.id,
    fromManagerId: lead.managerId ?? null,
    toManagerId: manager.id,
    changedBy: req.user!.id,
    comment: comment ?? null,
  });
};

export const reassignLead = async (
  req: any,
  lead: Row,
  manager: { id: number; fullName: string },
  comment?: string | null,
): Promise<Row> => {
  let assignmentChanged = false;
  const updatedLead = await withTransaction(async () => {
    const lockedManager = await getActiveSalesManager(manager.id, true);
    const lockedLead = await queryOne(
      `SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`,
      [lead.id],
    );
    if (!lockedLead) {
      throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
    }
    if (!canAccessLeadRow(req, lockedLead)) {
      throw Object.assign(new Error('Lead access required'), { statusCode: 403 });
    }
    if (Number(lockedLead.managerId) === Number(lockedManager.id)) {
      return { ...lockedLead, managerName: lockedManager.fullName };
    }

    const updated = await updateRow('academy_leads', lead.id, { managerId: lockedManager.id });
    if (!updated) {
      throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
    }

    await syncLeadManagerAssignment(req, lockedLead, lockedManager, comment);
    assignmentChanged = true;

    return { ...updated, managerName: lockedManager.fullName };
  });

  if (assignmentChanged) {
    await createNotification(
      manager.id,
      'Вам назначен лид',
      leadContactSummary(lead),
      'lead',
      lead.id,
    );
  }
  return updatedLead;
};

export const buildLeadStageDurations = (history: Row[]) => {
  const sorted = [...history].sort((left, right) =>
    new Date(left.enteredAt).getTime() - new Date(right.enteredAt).getTime()
  );

  return sorted.map((item, index) => {
    const enteredAt = new Date(item.enteredAt);
    const nextEnteredAt = sorted[index + 1]?.enteredAt ? new Date(sorted[index + 1].enteredAt) : new Date();
    const minutes = Math.max(0, Math.round((nextEnteredAt.getTime() - enteredAt.getTime()) / 60000));
    return {
      statusCode: item.toStatusCode,
      statusTranslationKey: LEAD_STATUSES.find((status) => status.code === item.toStatusCode)?.translationKey ?? item.toStatusCode,
      enteredAt: item.enteredAt,
      minutes,
      hours: Number((minutes / 60).toFixed(1)),
      days: Number((minutes / 1440).toFixed(1)) };
  });
};

export const ensureGroupCapacity = async (
  groupId?: number | null,
  excludeLeadId?: number | null,
  excludeStudentId?: number | null,
) => {
  if (!groupId) return;
  const capacity = await queryOne<{
    currentStudents: number;
    reservedStudents: number;
    maxStudents: number;
  }>(
    `SELECT
       COUNT(DISTINCT s.id)::int AS current_students,
       COUNT(DISTINCT CASE WHEN reserved.id IS NOT NULL THEN reserved.id END)::int AS reserved_students,
       g.max_students
     FROM academy_groups g
     LEFT JOIN academy_student_group_enrollments enrollment
       ON enrollment.group_id = g.id
      AND enrollment.status = 'active'
      AND ($3::int IS NULL OR enrollment.student_id <> $3)
     LEFT JOIN academy_students s
       ON s.id = enrollment.student_id
      AND s.status = 'studying'
     LEFT JOIN academy_lead_group_reservations reserved_membership
      ON reserved_membership.group_id = g.id
     LEFT JOIN academy_leads reserved
      ON reserved.id = reserved_membership.lead_id
      AND reserved.status_code <> 'not_now'
      AND COALESCE(reserved.is_archived, false) = false
      AND ($2::int IS NULL OR reserved.id <> $2)
      AND NOT EXISTS (
        SELECT 1 FROM academy_students existing_student WHERE existing_student.lead_id = reserved.id
      )
     WHERE g.id = $1
     GROUP BY g.id`,
    [groupId, excludeLeadId ?? null, excludeStudentId ?? null],
  );

  if (!capacity) {
    throw Object.assign(new Error('Group not found'), { statusCode: 404 });
  }
  if (
    Number(capacity.currentStudents || 0) + Number(capacity.reservedStudents || 0)
    >= Number(capacity.maxStudents)
  ) {
    throw Object.assign(new Error('groupIsFull'), { statusCode: 409 });
  }
};

export const validateEnrollmentGroup = async (
  groupId?: number | null,
  excludeLeadId?: number | null,
  excludeStudentId?: number | null,
) => {
  if (!groupId) return null;
  const group = await queryOne(`SELECT * FROM academy_groups WHERE id = $1`, [groupId]);
  if (!group) throw Object.assign(new Error('Group not found'), { statusCode: 404 });
  if (!['open', 'in_progress'].includes(String(group.status))) {
    throw Object.assign(new Error('groupNotOpen'), { statusCode: 409 });
  }
  const resources = await queryOne<{ resourcesActive: boolean }>(
    `SELECT (
       course.is_active = true
       AND school.is_active = true
       AND room.is_active = true
       AND room.school_id = academy_group.school_id
     ) AS resources_active
     FROM academy_groups academy_group
     JOIN academy_courses course ON course.id = academy_group.course_id
     JOIN academy_schools school ON school.id = academy_group.school_id
     JOIN academy_rooms room ON room.id = academy_group.room_id
     WHERE academy_group.id = $1`,
    [groupId],
  );
  if (resources && resources.resourcesActive !== true) {
    throw Object.assign(new Error('groupHasInactiveResources'), { statusCode: 409 });
  }
  await ensureGroupCapacity(groupId, excludeLeadId, excludeStudentId);
  return group;
};

export const validateLeadSelectedGroups = async (
  leadId: number,
  primaryGroupId?: number | null,
  excludeStudentId?: number | null,
) => {
  const reservations = await query(
    `SELECT *
     FROM academy_lead_group_reservations
     WHERE lead_id = $1
     ORDER BY group_id
     FOR UPDATE`,
    [leadId],
  );
  const groupIds = [...new Set([
    ...(primaryGroupId ? [Number(primaryGroupId)] : []),
    ...reservations.map((reservation) => Number(reservation.groupId)),
  ])].filter((groupId) => Number.isInteger(groupId) && groupId > 0);
  let primaryGroup: Row | null = null;
  for (const groupId of [...groupIds].sort((left, right) => left - right)) {
    await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupId]);
    const group = await validateEnrollmentGroup(groupId, leadId, excludeStudentId);
    if (groupId === Number(primaryGroupId)) primaryGroup = group;
  }
  return { groupIds, primaryGroup };
};

export const recalculateStudentMetrics = async (studentId: number) => {
  const student = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
  if (!student?.groupId) return;

  const latestGroupEntry = await queryOne<{ createdAt: Date }>(
    `SELECT enrolled_at AS created_at
     FROM academy_student_group_enrollments
     WHERE student_id = $1 AND group_id = $2 AND status = 'active'
     ORDER BY enrolled_at DESC, id DESC
     LIMIT 1`,
    [studentId, student.groupId],
  );
  const membershipStartedAt = latestGroupEntry?.createdAt ?? student.enrolledAt ?? student.createdAt;

  const conductedLessons = await query<{ id: number }>(
    `SELECT lesson.id
     FROM academy_lessons lesson
     WHERE lesson.group_id = $1
       AND lesson.status = 'conducted'
       AND lesson.scheduled_at >= $2
       AND COALESCE(
         (
           SELECT history.to_status
           FROM academy_student_status_history history
           WHERE history.student_id = $3
             AND history.created_at <= lesson.scheduled_at
           ORDER BY history.created_at DESC, history.id DESC
           LIMIT 1
         ),
         'studying'
       ) = 'studying'`,
    [student.groupId, membershipStartedAt, studentId],
  );
  const presentRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM academy_attendance a
     JOIN academy_lessons l ON l.id = a.lesson_id
     WHERE a.student_id = $1
       AND a.status = 'present'
       AND l.status = 'conducted'
       AND l.group_id = $2
       AND l.scheduled_at >= $3
       AND COALESCE(
         (
           SELECT history.to_status
           FROM academy_student_status_history history
           WHERE history.student_id = $1
             AND history.created_at <= l.scheduled_at
           ORDER BY history.created_at DESC, history.id DESC
           LIMIT 1
         ),
         'studying'
       ) = 'studying'`,
    [studentId, student.groupId, membershipStartedAt],
  );
  const group = await queryOne(`SELECT lesson_count FROM academy_groups WHERE id = $1`, [student.groupId]);
  const surveyRows = await query<{ score: number }>(
    `SELECT survey.score
     FROM academy_lesson_surveys survey
     JOIN academy_lessons lesson ON lesson.id = survey.lesson_id
     WHERE survey.student_id = $1
       AND lesson.group_id = $2
       AND lesson.scheduled_at >= $3
       AND COALESCE(
         (
           SELECT history.to_status
           FROM academy_student_status_history history
           WHERE history.student_id = $1
             AND history.created_at <= lesson.scheduled_at
           ORDER BY history.created_at DESC, history.id DESC
           LIMIT 1
         ),
         'studying'
       ) = 'studying'`,
    [studentId, student.groupId, membershipStartedAt],
  );
  const monthlyAttendanceRows = await query<{
    conductedCount: number;
    presentCount: number;
  }>(
    `SELECT
       COUNT(DISTINCT l.id)::int AS conducted_count,
       COUNT(DISTINCT CASE WHEN a.status = 'present' THEN l.id END)::int AS present_count
     FROM academy_lessons l
     LEFT JOIN academy_attendance a
       ON a.lesson_id = l.id
      AND a.student_id = $1
     WHERE l.group_id = $2
       AND l.status = 'conducted'
       AND l.scheduled_at >= $3
       AND COALESCE(
         (
           SELECT history.to_status
           FROM academy_student_status_history history
           WHERE history.student_id = $1
             AND history.created_at <= l.scheduled_at
           ORDER BY history.created_at DESC, history.id DESC
           LIMIT 1
         ),
         'studying'
       ) = 'studying'
       AND l.scheduled_at >= (
         (date_trunc('month', NOW() AT TIME ZONE $4) AT TIME ZONE $4)
         AT TIME ZONE 'UTC'
       )`,
    [studentId, student.groupId, membershipStartedAt, ACADEMY_TIME_ZONE],
  );

  const presentCount = Number(presentRows[0]?.count ?? 0);
  const attendancePercent = calculateAttendancePercent(presentCount, conductedLessons.length);
  const totalLessons = Number(group?.lessonCount) > 0 ? Number(group?.lessonCount) : conductedLessons.length;
  const progressPercent = calculateProgressPercent(presentCount, totalLessons);
  const satisfactionAvg = calculateAverage(surveyRows.map((row) => Number(row.score))) ?? 0;
  const monthConductedCount = Number(monthlyAttendanceRows[0]?.conductedCount ?? 0);
  const monthPresentCount = Number(monthlyAttendanceRows[0]?.presentCount ?? 0);
  const monthAttendancePercent = calculateAttendancePercent(monthPresentCount, monthConductedCount);
  const riskFlags = resolveStudentRiskFlags({
    conductedCount: conductedLessons.length,
    attendancePercent,
    monthConductedCount,
    monthAttendancePercent,
    satisfactionAvg,
  });

  await updateRow('academy_students', studentId, {
    attendancePercent,
    progressPercent,
    satisfactionAvg,
    riskFlags });
};

export const advanceStudentNextPaymentAt = async (
  studentId: number,
  candidate: Date | string | null | undefined,
) => {
  if (!candidate) return queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
  const candidateDate = candidate instanceof Date ? candidate : new Date(candidate);
  if (Number.isNaN(candidateDate.getTime())) {
    throw Object.assign(new Error('Invalid paidUntil'), { statusCode: 400 });
  }
  return queryOne(
    `UPDATE academy_students
     SET next_payment_at = CASE
           WHEN next_payment_at IS NULL OR next_payment_at < $2 THEN $2
           ELSE next_payment_at
         END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [studentId, candidateDate],
  );
};

export const createStudentFromLead = async (req: any, leadId: number, paymentId?: number | null): Promise<Row> => {
  if (!transactionContext.getStore()) {
    return withTransaction(() => createStudentFromLead(req, leadId, paymentId));
  }

  await queryOne(`SELECT id FROM academy_leads WHERE id = $1 FOR UPDATE`, [leadId]);
  const lead = await getLead(leadId);
  if (!lead) {
    throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  }

  const sourcePayment = paymentId
    ? await queryOne(`SELECT * FROM academy_payments WHERE id = $1 FOR UPDATE`, [paymentId])
    : null;
  if (paymentId && !sourcePayment) {
    throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
  }
  if (sourcePayment?.leadId && Number(sourcePayment.leadId) !== Number(leadId)) {
    throw Object.assign(new Error('Payment lead and student do not match'), { statusCode: 400 });
  }
  const nextPaymentAt = sourcePayment?.paidUntil
    ? new Date(sourcePayment.paidUntil)
    : sourcePayment?.paidAt
      ? addDays(new Date(sourcePayment.paidAt), 30)
      : addDays(new Date(), 30);

  const existingStudents = sourcePayment?.studentId
    ? await query(
        `SELECT * FROM academy_students WHERE id = $1 AND lead_id = $2 FOR UPDATE`,
        [sourcePayment.studentId, leadId],
      )
    : await query(
        `SELECT * FROM academy_students WHERE lead_id = $1 ORDER BY id FOR UPDATE`,
        [leadId],
      );
  if (sourcePayment?.studentId && existingStudents.length === 0) {
    throw Object.assign(new Error('Payment lead and student do not match'), { statusCode: 400 });
  }
  if (!sourcePayment?.studentId && existingStudents.length > 1) {
    throw Object.assign(new Error('studentSelectionRequired'), { statusCode: 409 });
  }
  const existingStudent = existingStudents[0];
  if (existingStudent) {
    let resolvedStudent = existingStudent;
    if (paymentId) {
      await updateRow('academy_payments', paymentId, {
        leadId,
        studentId: existingStudent.id,
        groupId: existingStudent.groupId ?? lead.enrolledGroupId ?? null,
      });
    }
    if (sourcePayment?.status === 'paid') {
      resolvedStudent = await advanceStudentNextPaymentAt(Number(existingStudent.id), nextPaymentAt)
        ?? existingStudent;
    }
    if (lead.statusCode !== 'paid') {
      await updateRow('academy_leads', lead.id, { statusCode: 'paid' });
      await createStageHistory(lead.id, lead.statusCode, 'paid', req.user!.id, 'Подтверждена оплата существующего клиента');
    }
    return resolvedStudent;
  }
  if (!lead.enrolledGroupId) {
    throw Object.assign(new Error('groupRequiredForEnrollment'), { statusCode: 409 });
  }

  const { groupIds: reservedGroupIds, primaryGroup: enrolledGroup } = await validateLeadSelectedGroups(
    leadId,
    Number(lead.enrolledGroupId),
  );
  if (!enrolledGroup) {
    throw Object.assign(new Error('Group not found'), { statusCode: 404 });
  }

  const course = lead.courseId
    ? await queryOne(`SELECT * FROM academy_courses WHERE id = $1`, [lead.courseId])
    : await resolveCourseByAge(lead.studentAge);

  const referralCode = buildReferralCode(lead.studentName || lead.contactName, lead.id);
  const student = await insertRow('academy_students', {
    leadId: lead.id,
    contactName: lead.contactName,
    phone: lead.phone,
    messenger: lead.messenger ?? null,
    studentName: lead.studentName || lead.contactName,
    studentAge: lead.studentAge ?? null,
    courseId: enrolledGroup?.courseId ?? lead.courseId ?? course?.id ?? null,
    schoolId: enrolledGroup?.schoolId ?? lead.schoolId ?? null,
    groupId: lead.enrolledGroupId ?? null,
    managerId: lead.managerId ?? req.user!.id,
    status: 'studying',
    enrolledAt: new Date(),
    nextPaymentAt,
    referralCode,
    riskFlags: [] });

  await query(
    `INSERT INTO academy_student_group_enrollments
       (student_id, group_id, status, is_primary, enrolled_at, created_by)
     SELECT $1,
            selected_group_id,
            'active',
            selected_group_id = $2,
            COALESCE($3, NOW()),
            $4
     FROM UNNEST($5::int[]) AS selected_group_id
     ON CONFLICT (student_id, group_id) WHERE status = 'active'
     DO UPDATE SET
       is_primary = EXCLUDED.is_primary,
       ended_at = NULL,
       updated_at = NOW()`,
    [
      student.id,
      student.groupId,
      student.enrolledAt ?? new Date(),
      req.user!.id,
      reservedGroupIds,
    ],
  );
  await query(`DELETE FROM academy_lead_group_reservations WHERE lead_id = $1`, [leadId]);

  if (paymentId) {
    await updateRow('academy_payments', paymentId, {
      leadId,
      studentId: student.id,
      groupId: student.groupId,
    });
  }

  await updateRow('academy_leads', lead.id, { statusCode: 'paid' });
  await createStageHistory(lead.id, lead.statusCode, 'paid', req.user!.id, 'Автоматическое создание ученика после оплаты');

  if (lead.referrerStudentId && Number(lead.referrerStudentId) !== Number(student.id)) {
    await insertRow('academy_referral_rewards', {
      referrerStudentId: Number(lead.referrerStudentId),
      referredLeadId: lead.id,
      referredStudentId: student.id,
      rewardType: 'discount',
      rewardValue: '15%',
      status: 'pending' });
  }

  await createOutbox('whatsapp', lead.phone, `Добро пожаловать в 01 Academy, ${student.studentName}!`, {
    entityType: 'student',
    entityId: student.id });
  await createAudit(req, 'CREATE_ACADEMY_STUDENT_FROM_LEAD', 'academy_student', student.id, student);
  return student;
};

export const ensureReferralBenefit = async (options: {
  studentId: number;
  benefitType: ReferralBenefitType;
  status?: 'pending' | 'consumed' | 'superseded';
  milestone?: 1 | 3 | 5 | null;
  sourceReferralCount?: number | null;
  sourceReferralRewardId?: number | null;
  sourcePaymentId?: number | null;
  consumedByPaymentId?: number | null;
  consumedAt?: Date | null;
}) => {
  const created = await queryOne(
    `INSERT INTO academy_referral_benefits
       (student_id, benefit_type, status, milestone, source_referral_count,
        source_referral_reward_id, source_payment_id, consumed_by_payment_id, consumed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (student_id, benefit_type) DO NOTHING
     RETURNING *`,
    [
      options.studentId,
      options.benefitType,
      options.status ?? 'pending',
      options.milestone ?? null,
      options.sourceReferralCount ?? null,
      options.sourceReferralRewardId ?? null,
      options.sourcePaymentId ?? null,
      options.consumedByPaymentId ?? null,
      options.consumedAt ?? null,
    ],
  );
  if (created) return { benefit: created, created: true };
  const existing = await queryOne(
    `SELECT *
     FROM academy_referral_benefits
     WHERE student_id = $1 AND benefit_type = $2
     FOR UPDATE`,
    [options.studentId, options.benefitType],
  );
  if (!existing) {
    throw Object.assign(new Error('referralBenefitGrantFailed'), { statusCode: 409 });
  }
  return { benefit: existing, created: false };
};

export const consumeReferralBenefit = async (
  benefitId: number,
  paymentId: number,
  status: 'consumed' | 'superseded' = 'consumed',
) => {
  const benefit = await queryOne(
    `UPDATE academy_referral_benefits
     SET status = $2,
         consumed_by_payment_id = $3,
         consumed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [benefitId, status, paymentId],
  );
  if (!benefit) {
    throw Object.assign(new Error('referralBenefitAlreadyConsumed'), { statusCode: 409 });
  }
  return benefit;
};

export const ensureFreeMonthBenefit = async (req: any, options: {
  referrerId: number;
  paidReferrals: number;
  sourceReferralRewardId: number;
  sourcePaymentId: number;
}) => {
  const grant = await ensureReferralBenefit({
    studentId: options.referrerId,
    benefitType: 'free_month',
    milestone: 3,
    sourceReferralCount: options.paidReferrals,
    sourceReferralRewardId: options.sourceReferralRewardId,
    sourcePaymentId: options.sourcePaymentId,
  });
  if (grant.benefit.status !== 'pending') return grant.benefit;

  const referrer = await queryOne(
    `SELECT students.*,
        GREATEST(COALESCE(students.next_payment_at, NOW()), NOW()) AS coverage_start,
        GREATEST(COALESCE(students.next_payment_at, NOW()), NOW()) + INTERVAL '30 days' AS coverage_end
     FROM academy_students students
     WHERE students.id = $1
     FOR UPDATE`,
    [options.referrerId],
  );
  if (!referrer) {
    throw Object.assign(new Error('referrerStudentNotFound'), { statusCode: 409 });
  }

  let freePayment = await queryOne(
    `SELECT *
     FROM academy_payments
     WHERE student_id = $1
       AND amount_uzs = 0
       AND comment = 'Бесплатный месяц по реферальной программе'
     ORDER BY created_at, id
     LIMIT 1
     FOR UPDATE`,
    [options.referrerId],
  );
  if (!freePayment) {
    freePayment = await insertRow('academy_payments', {
      studentId: options.referrerId,
      groupId: referrer.groupId ?? null,
      amountUzs: 0,
      type: 'full',
      method: 'transfer',
      paidAt: new Date(),
      period: 'referral_bonus',
      discount: 'referral_15',
      status: 'paid',
      paidUntil: referrer.coverageEnd,
      comment: 'Бесплатный месяц по реферальной программе',
      confirmedBy: req.user!.id,
    });
  } else if (!freePayment.paidUntil) {
    freePayment = await updateRow('academy_payments', Number(freePayment.id), {
      paidUntil: referrer.coverageEnd,
    });
  }
  if (!freePayment) {
    throw Object.assign(new Error('referralFreeMonthPaymentFailed'), { statusCode: 500 });
  }
  await consumeReferralBenefit(Number(grant.benefit.id), Number(freePayment.id));
  await advanceStudentNextPaymentAt(options.referrerId, freePayment.paidUntil ?? referrer.coverageEnd);
  return freePayment;
};

// A reward row records that one referred student qualified. Benefits are a
// separate one-time ledger: milestone 1 is pending until the referrer's next
// payment, milestone 3 is consumed by one free-month payment, and milestone 5
// remains a pending AI Ambassador training entitlement.
export const applyReferralRewards = async (req: any, studentId: number, leadId: number | null, paymentId: number) => {
  const lead = leadId
    ? await queryOne(`SELECT id, referrer_student_id FROM academy_leads WHERE id = $1`, [leadId])
    : null;
  const referrerId = lead?.referrerStudentId ? Number(lead.referrerStudentId) : null;
  if (!referrerId || referrerId === studentId) return;

  await query(`SELECT pg_advisory_xact_lock($1, $2)`, [ACADEMY_REFERRAL_ADVISORY_LOCK, referrerId]);

  const newlyApplied = await query<{ id: number }>(
    `UPDATE academy_referral_rewards
     SET status = 'applied',
         applied_at = COALESCE(applied_at, NOW()),
         qualified_by_payment_id = COALESCE(qualified_by_payment_id, $3)
     WHERE referred_student_id = $1
       AND referrer_student_id = $2
       AND status = 'pending'
     RETURNING id`,
    [studentId, referrerId, paymentId],
  );
  if (newlyApplied.length === 0) return;

  const paidCountRow = await queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT referred_student_id)::text AS count
     FROM academy_referral_rewards
     WHERE referrer_student_id = $1
       AND referred_student_id IS NOT NULL
       AND status = 'applied'`,
    [referrerId],
  );
  const paidReferrals = Number(paidCountRow?.count ?? 0);
  const level = resolveReferralLevel(paidReferrals);
  const referrer = await updateRow('academy_students', referrerId, { referralLevel: level });
  if (!referrer) return;
  const sourceReferralRewardId = Number(newlyApplied[0].id);
  const milestoneBenefit = resolveReferralMilestone(paidReferrals);

  if (milestoneBenefit === 'next_payment_discount_15') {
    const discountGrant = await ensureReferralBenefit({
      studentId: referrerId,
      benefitType: 'next_payment_discount_15',
      milestone: 1,
      sourceReferralCount: paidReferrals,
      sourceReferralRewardId,
      sourcePaymentId: paymentId,
    });
    if (discountGrant.created) {
      await createOutbox('whatsapp', referrer.phone,
        `${referrer.studentName}, вы получили скидку 15% на следующий месяц за рекомендацию 01 Academy! 🎁`,
        { entityType: 'student', entityId: referrerId });
    }
  }
  if (milestoneBenefit === 'free_month') {
    await ensureFreeMonthBenefit(req, {
      referrerId,
      paidReferrals,
      sourceReferralRewardId,
      sourcePaymentId: paymentId,
    });
    await createOutbox('whatsapp', referrer.phone,
      `${referrer.studentName}, вы получили бесплатный месяц обучения за 3 рекомендации 01 Academy! 🎁`,
      { entityType: 'student', entityId: referrerId });
  }
  if (milestoneBenefit === 'ai_ambassador_free_training') {
    const ambassadorGrant = await ensureReferralBenefit({
      studentId: referrerId,
      benefitType: 'ai_ambassador_free_training',
      milestone: 5,
      sourceReferralCount: paidReferrals,
      sourceReferralRewardId,
      sourcePaymentId: paymentId,
    });
    if (ambassadorGrant.created) {
      await createOutbox('whatsapp', referrer.phone,
        `${referrer.studentName}, вам присвоен статус AI-амбассадора и доступно бесплатное обучение в 01 Academy!`,
        { entityType: 'student', entityId: referrerId });
    }
  }
};

export const handleLeadStatusEffects = async (req: any, lead: Row, previousStatus?: string | null) => {
  const managerId = lead.managerId ?? req.user!.id;
  const now = new Date();

  if (lead.statusCode === 'new_request') {
    await createNotification(managerId, 'Новая заявка 01 Academy', leadContactSummary(lead), 'lead', lead.id);
    // The manager already receives an internal CRM notification above. A CRM
    // user id is not a Telegram chat id, so no Telegram outbox row is created.
  }

  if (lead.statusCode === 'first_contact' && !lead.firstContactAt) {
    await updateRow('academy_leads', lead.id, { firstContactAt: now });
  }

  if (lead.statusCode === 'demo_invited' && lead.demoAt) {
    const demoAt = new Date(lead.demoAt);
    await createOutbox('whatsapp', lead.phone, `Напоминание: демо-урок 01 Academy через 24 часа`, {
      scheduledAt: addDays(demoAt, -1),
      entityType: 'lead',
      entityId: lead.id });
    await createOutbox('whatsapp', lead.phone, `Напоминание: демо-урок 01 Academy через 2 часа`, {
      scheduledAt: addMinutes(demoAt, -120),
      entityType: 'lead',
      entityId: lead.id });
  }

  if (lead.statusCode === 'enrolled' && previousStatus !== 'enrolled') {
    await insertRow('academy_payments', {
      leadId: lead.id,
      groupId: lead.enrolledGroupId ?? null,
      amountUzs: normalizeMoney(lead.expectedPaymentUzs || lead.offerPriceUzs),
      type: 'full',
      method: lead.paymentMethod || 'transfer',
      status: 'pending',
      dueAt: addDays(now, 3),
      period: 'month_1',
      discount: lead.offerDiscount || 'none',
      comment: 'Ожидаемая оплата после записи на курс' });
    await createOutbox('whatsapp', lead.phone, 'Реквизиты для оплаты 01 Academy: карта/перевод/наличные у администратора. После оплаты отправьте чек менеджеру.', {
      scheduledAt: now,
      entityType: 'lead',
      entityId: lead.id });
  }

  if (lead.statusCode === 'not_now') {
    await updateRow('academy_leads', lead.id, {
      warmMovedAt: lead.warmMovedAt ?? now,
      warmReason: lead.warmReason ?? 'Перенесён в тёплую базу' });
  }
};
