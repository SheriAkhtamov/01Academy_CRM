import { ensureGroupCapacity } from './group-capacity';
export { ensureGroupCapacity } from './group-capacity';
import { loadStudentLearningMetrics } from "./student-learning-metrics";
import { enqueueMetaLeadIntakeSafely } from '../../services/meta-marketing';
import { assertSalesFunnelAssignment } from './sales-funnel-policy';
import {
  LEAD_STATUSES,
  addDays,
  calculateAverage,
  normalizeMoney,
  suggestCourseSlugByAge,
} from '@shared/academy';
import { isGeneratedInstagramLeadName } from '../../lib/instagram-lead';
import { selectedLeadLanguages } from '@shared/lead-languages';
import { leadPhoneOwnersSchema } from '@shared/contracts/academy-leads';
import { logger } from '../../lib/logger';
import { leadExpectedPaymentTotalSelect } from './student-expected-payment';
import { leadViewStateAfterManagerTransfer } from '../../services/lead-view-state';
import {
  NormalizedLeadPhone,
  Row,
  canAccessLeadRow,
  canMutateLeadRow,
  createAudit,
  createNotification,
  insertRow,
  leadChannelsSelect,
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
  runAfterTransactionCommit,
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
import {
  actorContextFrom,
  type ActorSource,
} from '../leads/domain/actor-context';
import { canActorAssignLead, duplicateHintForActor } from '../leads/domain/access-policy';

export const buildTemplateSourceCode = (prefix: string, suffix: string) => {
  const slug = suffix
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9А-Яа-я]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return slug ? `${prefix}_${slug}` : prefix;
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

export const resolveSourceId = async (body: Row) => {
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

export const duplicateHintForRequest = (source: ActorSource, duplicate: Row | null | undefined) => {
  return duplicateHintForActor(actorContextFrom(source), duplicate);
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
      (SELECT COUNT(*)::int FROM board_tasks task WHERE task.lead_id = l.id)
        AS task_count
   FROM academy_leads l
   LEFT JOIN users manager ON manager.id = l.manager_id
   LEFT JOIN academy_lead_sources source ON source.id = l.source_id AND source.is_active = true
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
  source: ActorSource,
  retainedLeadId: number,
  duplicateLeadId: number,
): Promise<LeadMergeResult> => withTransaction(async () => {
  const actor = actorContextFrom(source);
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
  if (!canMutateLeadRow(actor, retainedLead) || !canMutateLeadRow(actor, duplicateLead)) {
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
       (SELECT COUNT(*)::int FROM academy_students WHERE lead_id = $1) AS students,
       (SELECT COUNT(*)::int FROM academy_lead_phones WHERE lead_id = $1) AS phones,
       (SELECT COUNT(*)::int FROM academy_lead_channels WHERE lead_id = $1) AS channels,
       (SELECT COUNT(*)::int FROM academy_lead_tag_assignments WHERE lead_id = $1) AS manual_tags,
       (SELECT COUNT(*)::int FROM telephony_calls WHERE lead_id = $1) AS calls,
       (SELECT COUNT(*)::int FROM board_tasks WHERE lead_id = $1) AS tasks,
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
  await query(`UPDATE voice_reminder_call_details SET lead_id=$1,updated_at=now() WHERE lead_id=$2`, [retainedLeadId, duplicateLeadId]);
  await query(`UPDATE academy_lead_assignment_history SET lead_id = $1 WHERE lead_id = $2`, [retainedLeadId, duplicateLeadId]);
  await query(
    `UPDATE audit_logs SET entity_id = $1
     WHERE entity_type = 'academy_lead' AND entity_id = $2
       AND action IN ('QUALIFY_ACADEMY_LEAD_BY_CRITERIA', 'REVOKE_ACADEMY_LEAD_QUALIFICATION')`,
    [retainedLeadId, duplicateLeadId],
  );
  // The merged lead keeps the earliest qualification of the two.
  await query(
    `UPDATE academy_leads retained
     SET is_qualified = true, qualified_at = duplicate.qualified_at, qualified_by = duplicate.qualified_by
     FROM academy_leads duplicate
     WHERE retained.id = $1 AND duplicate.id = $2 AND duplicate.is_qualified
       AND (NOT retained.is_qualified OR duplicate.qualified_at < retained.qualified_at)`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(`UPDATE academy_lead_stage_history SET lead_id = $1 WHERE lead_id = $2`, [retainedLeadId, duplicateLeadId]);
  await query(`UPDATE academy_lead_comments SET lead_id = $1 WHERE lead_id = $2`, [retainedLeadId, duplicateLeadId]);
  await query(
    `UPDATE academy_payments SET lead_id = $1, updated_at = NOW() WHERE lead_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  await query(
    `UPDATE academy_students SET lead_id = $1, updated_at = NOW() WHERE lead_id = $2`,
    [retainedLeadId, duplicateLeadId],
  );
  // Keep the retained lead's owner, filling an empty name from its duplicate.
  await query(
    `UPDATE academy_lead_phones retained_phone
     SET owner_name = source_phone.owner_name, updated_at = NOW()
     FROM academy_lead_phones source_phone
     WHERE retained_phone.lead_id = $1 AND source_phone.lead_id = $2
       AND retained_phone.normalized_phone = source_phone.normalized_phone
       AND NULLIF(BTRIM(retained_phone.owner_name), '') IS NULL
       AND source_phone.owner_name IS NOT NULL`,
    [retainedLeadId, duplicateLeadId],
  );
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
    `UPDATE board_tasks
     SET lead_id = $1, updated_at = NOW()
     WHERE lead_id = $2`,
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
  const mergedLanguages = [...new Set([
    ...selectedLeadLanguages(retainedLead.languages, retainedLead.language),
    ...selectedLeadLanguages(duplicateLead.languages, duplicateLead.language),
  ])];
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
    language: mergedLanguages[0] ?? '',
    languages: mergedLanguages,
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
    expectedPaymentUzs: preferLeadValue(retainedLead.expectedPaymentUzs, duplicateLead.expectedPaymentUzs),
    paymentMethod: preferLeadValue(retainedLead.paymentMethod, duplicateLead.paymentMethod),
    warmReason: preferLeadValue(retainedLead.warmReason, duplicateLead.warmReason),
    warmMovedAt: earliestLeadDate(retainedLead.warmMovedAt, duplicateLead.warmMovedAt),
    noMailing: Boolean(retainedLead.noMailing || duplicateLead.noMailing),
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
    await syncLeadOwnedNotifications(Number(updatedRetainedLead.managerId), [retainedLeadId]);
  }

  await updateRow('academy_leads', duplicateLeadId, {
    phone: null,
    messenger: null,
    isArchived: true,
    isWon: false,
    wonAt: null,
    wonBy: null,
    // The retained lead carries the qualification; a duplicate must not count twice.
    isQualified: false,
    qualifiedAt: null,
    qualifiedBy: null,
    archiveReason: 'duplicate_or_invalid',
    archivedAt: new Date(),
    archivedBy: actor.userId,
  });

  await insertRow('audit_logs', {
    userId: actor.userId,
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
       + (SELECT COUNT(*) FROM academy_students WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_lead_phones WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_lead_channels WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM academy_lead_tag_assignments WHERE lead_id = $1)
       + (SELECT COUNT(*) FROM telephony_calls WHERE lead_id = $1 OR (contact_type = 'lead' AND contact_id = $1))
       + (SELECT COUNT(*) FROM board_tasks WHERE lead_id = $1)
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
  source: ActorSource,
  retainedLeadId: number,
  draft: Row,
): Promise<LeadDraftMergeResult> => withTransaction(async () => {
  const actor = actorContextFrom(source);
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
  if (!canMutateLeadRow(actor, retainedLead)) {
    throw Object.assign(new Error('leadMergeAccessDenied'), { statusCode: 403 });
  }

  const parsedPhoneOwners = leadPhoneOwnersSchema.optional().safeParse(draft.phoneOwners);
  if (!parsedPhoneOwners.success) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  const draftPhones = normalizeLeadPhones(draft.phoneNumbers ?? draft.phone, parsedPhoneOwners.data);
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
      ownerName: nullableText(phone.ownerName),
    });
  }
  if (usefulLeadValue(retainedLead.phone) && !isSyntheticInstagramIdentity(retainedLead.phone)) {
    for (const phone of normalizeLeadPhones(retainedLead.phone)) {
      if (!mergedPhones.has(phone.normalizedPhone)) mergedPhones.set(phone.normalizedPhone, phone);
    }
  }
  for (const phone of draftPhones) {
    const existing = mergedPhones.get(phone.normalizedPhone);
    mergedPhones.set(phone.normalizedPhone, { ...phone, ownerName: existing?.ownerName || phone.ownerName });
  }
  const phoneValuesToSave = [...mergedPhones.values()];

  const requestedManagerId = retainedLead.managerId
    ? null
    : await resolveLeadManagerId(actor, draft.managerId, retainedLead.funnelRole, retainedLead.funnelId);
  const assignedManager = requestedManagerId
    ? await getActiveSalesManager(requestedManagerId, true)
    : null;
  if (assignedManager) {
    await assertSalesFunnelAssignment(retainedLead.funnelId, assignedManager.id);
  }
  const nextStudentName = preferLeadValue(retainedLead.studentName, nullableText(draft.studentName));
  const nextStudentAge = preferLeadValue(retainedLead.studentAge, toIntegerOrNull(draft.studentAge));
  const nextCourseId = preferLeadValue(retainedLead.courseId, toIdOrNull(draft.courseId, 'courseId'));
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
    schoolId: preferLeadValue(retainedLead.schoolId, toIdOrNull(draft.schoolId, 'schoolId')),
    managerId: assignedManager?.id ?? retainedLead.managerId,
    comment: draftComment ?? retainedLead.comment,
    language: selectedLeadLanguages(draft.languages ?? retainedLead.languages,
      draft.language ?? retainedLead.language)[0] ?? '',
    languages: selectedLeadLanguages(draft.languages ?? retainedLead.languages,
      draft.language ?? retainedLead.language),
  });
  if (!updatedLead) {
    throw Object.assign(new Error('leadMergeLeadNotFound'), { statusCode: 404 });
  }
  if (draftComment) {
    await insertRow('academy_lead_comments', {
      leadId: retainedLeadId,
      authorId: actor.userId,
      body: draftComment,
    });
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
      actor,
      retainedLead,
      assignedManager,
      'Ответственный назначен при объединении новой заявки с существующим лидом',
    );
  }

  await insertRow('audit_logs', {
    userId: actor.userId,
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
        (SELECT workflow_role FROM academy_sales_funnels WHERE id = l.funnel_id) AS funnel_role,
        archived_by_user.full_name AS archived_by_name,
        ${leadExpectedPaymentTotalSelect('l')}, ${leadPhoneNumbersSelect('l')},
        ${leadChannelsSelect('l')},
        ${leadTagsSelect('l')}
     FROM academy_leads l
     LEFT JOIN academy_courses c ON c.id = l.course_id
     LEFT JOIN academy_lead_sources s ON s.id = l.source_id AND s.is_active = true
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
     JOIN academy_lead_sources source ON source.id = lead.source_id AND source.is_active = true
     WHERE lead.id = $1
     FOR UPDATE OF lead`,
    [id],
  );

export const createStageHistory = async (leadId: number, fromStatusCode: string | null, toStatusCode: string, changedBy: number, comment?: string | null, context?: { fromFunnelId: number | null; toFunnelId: number }) =>
  insertRow('academy_lead_stage_history', {
    leadId,
    fromStatusCode,
    toStatusCode,
    changedBy,
    ...(context ?? {}),
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
       )`,
    [managerId, leadIds],
  );
};

export const updateLeadManagerRows = async (leads: Row[], managerId: number) => {
  const leadIds = leads.map((lead) => Number(lead.id));
  const transferredIds = leads
    .filter((lead) => Number(lead.managerId) > 0)
    .map((lead) => Number(lead.id));
  await query(
    `UPDATE academy_leads
     SET manager_id = $1,
         first_viewed_at = CASE WHEN id = ANY($3::int[]) THEN NULL ELSE first_viewed_at END,
         first_viewed_by = CASE WHEN id = ANY($3::int[]) THEN NULL ELSE first_viewed_by END,
         updated_at = NOW()
     WHERE id = ANY($2::int[])`,
    [managerId, leadIds, transferredIds],
  );
};

export const syncLeadManagerRelations = async (
  leadId: number,
  managerId: number | null,
) => {
  await query(
    `UPDATE academy_students
     SET manager_id = $1, updated_at = NOW()
     WHERE lead_id = $2`,
    [managerId, leadId],
  );
  await query(
    `UPDATE board_tasks
     SET assignee_id = $1, updated_at = NOW()
     WHERE lead_id = $2
       AND status NOT IN ('done', 'accepted')`,
    [managerId, leadId],
  );
  if (managerId !== null) await syncLeadOwnedNotifications(managerId, [leadId]);
};

export const syncLeadManagerAssignment = async (
  source: ActorSource,
  lead: Row,
  manager: { id: number; fullName: string },
  comment?: string | null,
) => {
  const actor = actorContextFrom(source);
  await syncLeadManagerRelations(Number(lead.id), Number(manager.id));
  await insertRow('academy_lead_assignment_history', {
    leadId: lead.id,
    fromManagerId: lead.managerId ?? null,
    toManagerId: manager.id,
    changedBy: actor.userId,
    comment: comment ?? null,
  });
};

export const reassignLead = async (
  source: ActorSource,
  lead: Row,
  manager: { id: number; fullName: string },
  comment?: string | null,
): Promise<Row> => {
  const actor = actorContextFrom(source);
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
    if (!canActorAssignLead(actor, lockedLead, lockedManager.id)) {
      throw Object.assign(new Error('accessDenied'), { statusCode: 403 });
    }
    await assertSalesFunnelAssignment(lockedLead.funnelId, lockedManager.id);
    if (Number(lockedLead.managerId) === Number(lockedManager.id)) {
      await syncLeadManagerRelations(Number(lockedLead.id), Number(lockedManager.id));
      return { ...lockedLead, managerName: lockedManager.fullName };
    }

    const updated = await updateRow('academy_leads', lead.id, {
      managerId: lockedManager.id,
      ...leadViewStateAfterManagerTransfer(lockedLead.managerId, lockedManager.id),
    });
    if (!updated) {
      throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
    }

    await syncLeadManagerAssignment(actor, lockedLead, lockedManager, comment);
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

export const validateEnrollmentGroup = async (
  groupId?: number | null,
  excludeStudentId?: number | null,
) => {
  if (!groupId) return null;
  const group = await queryOne(`SELECT * FROM academy_groups WHERE id = $1`, [groupId]);
  if (!group) throw Object.assign(new Error('Group not found'), { statusCode: 404 });
  if (group.isArchived === true || !['planned', 'open', 'in_progress'].includes(String(group.status))) {
    throw Object.assign(new Error('groupNotOpen'), { statusCode: 409 });
  }
  const resources = await queryOne<{ resourcesActive: boolean }>(
    `SELECT (
       course.is_active = true
       -- An online group needs neither a branch nor a room.
       AND (academy_group.school_id IS NULL AND academy_group.delivery_mode = 'online' OR school.is_active = true)
       AND (academy_group.delivery_mode = 'online'
         OR academy_group.status = 'planned' AND academy_group.room_id IS NULL
         OR room.is_active = true AND room.school_id = academy_group.school_id)
     ) AS resources_active
     FROM academy_groups academy_group
     JOIN academy_courses course ON course.id = academy_group.course_id
     LEFT JOIN academy_schools school ON school.id = academy_group.school_id
     LEFT JOIN academy_rooms room ON room.id = academy_group.room_id
     WHERE academy_group.id = $1`,
    [groupId],
  );
  if (resources && resources.resourcesActive !== true) {
    throw Object.assign(new Error('groupHasInactiveResources'), { statusCode: 409 });
  }
  await ensureGroupCapacity(groupId, excludeStudentId);
  return group;
};

export const recalculateStudentMetrics = async (studentId: number) => {
  const metrics = (await loadStudentLearningMetrics([studentId])).get(studentId);
  if (!metrics) return;
  await updateRow('academy_students', studentId, {
    attendancePercent: metrics.attendancePercent,
    progressPercent: metrics.progressPercent,
    riskFlags: metrics.riskFlags,
  });
};

export const notifyLeadIntake = async (source: ActorSource, lead: Row) => {
  const actor = actorContextFrom(source);
  await createNotification(lead.managerId ?? actor.userId, 'Новая заявка 01 Academy', leadContactSummary(lead), 'lead', lead.id);
  await runAfterTransactionCommit(() => enqueueMetaLeadIntakeSafely(Number(lead.id)).then(() => undefined));
};

