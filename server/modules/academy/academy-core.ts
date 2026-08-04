import { Router } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { pool } from '../../db';
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
  type AcademyAccessModule,
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
  actorContextFrom,
  type ActorSource,
} from '../leads/domain/actor-context';
import {
  actorHasModule,
  canActorMutateLead,
  canActorViewLead,
} from '../leads/domain/access-policy';


export type DbValue = string | number | boolean | Date | null | unknown[] | Record<string, unknown>;
export type Row = Record<string, any>;
export type ReferralBenefitType = (typeof REFERRAL_BENEFIT_TYPES)[number];
export const transactionContext = new AsyncLocalStorage<PoolClient>();
export type AfterCommitTask = () => Promise<void>;
export const afterCommitContext = new AsyncLocalStorage<AfterCommitTask[]>();

export const ADMINISTRATION_MODULES = new Set(['administration']);
export const OPERATIONS_MODULES = new Set(['administration']);
export const MARKETING_MODULES = new Set(['marketing', 'administration']);
export const SALES_MODULES = new Set(['sales', 'administration']);
export const LEAD_MODULES = new Set(['administration', 'sales', 'marketing']);
export const SOURCE_MANAGEMENT_MODULES = new Set(['administration', 'marketing']);
// All group and lesson mutations take this transaction-scoped lock before
// checking room/teacher availability. It closes the race where two requests
// checked the same free slot in different rooms and assigned one teacher twice.
export const ACADEMY_SCHEDULING_ADVISORY_LOCK = 7_315_001;
export const ACADEMY_REFERRAL_ADVISORY_LOCK = 7_315_002;
export const ACADEMY_TIME_ZONE = process.env.ACADEMY_TIME_ZONE?.trim() || 'Asia/Tashkent';
export const salesUserAccessSql = `
  (
    u.module = 'sales'
    OR EXISTS (
      SELECT 1
      FROM user_modules uw
      WHERE uw.user_id = u.id AND uw.module = 'sales'
    )
  )
`;
export const leadershipUserAccessSql = `
  (
    u.module = 'administration'
    OR EXISTS (
      SELECT 1
      FROM user_modules uw
      WHERE uw.user_id = u.id AND uw.module = 'administration'
    )
  )
`;

export const toSnake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
export const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

export const camelize = (row: Row): Row => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [toCamel(key), value]),
);

export const camelizeRows = (rows: Row[]) => rows.map(camelize);

export const quoteIdent = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
export const TABLES_WITHOUT_UPDATED_AT = new Set([
  'academy_lead_stage_history',
  'academy_lead_assignment_history',
  'academy_lead_comments',
  'academy_communications',
  'academy_student_transfers',
  'academy_student_status_history',
  'academy_lesson_status_history',
  'academy_lesson_surveys',
  'academy_parent_surveys',
  'academy_referral_rewards',
]);

export const parseId = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export const toIdOrNull = (value: unknown, fieldName: string) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = parseId(value);
  if (!parsed) {
    throw Object.assign(new Error(`Invalid ${fieldName}`), { statusCode: 400 });
  }
  return parsed;
};

export const nullableText = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

export type NormalizedLeadPhone = {
  phone: string;
  normalizedPhone: string;
};

export const normalizePhoneForStorage = (value: unknown): NormalizedLeadPhone | null => {
  const text = nullableText(value);
  if (!text) return null;
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `998${digits}`;
  const phone = `+${digits}`;
  return { phone, normalizedPhone: phone };
};

export const normalizeLeadPhones = (value: unknown): NormalizedLeadPhone[] => {
  const rawValues = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const seen = new Set<string>();
  return rawValues.flatMap((raw) => {
    const normalized = normalizePhoneForStorage(raw);
    if (!normalized || seen.has(normalized.normalizedPhone)) return [];
    seen.add(normalized.normalizedPhone);
    return [normalized];
  });
};

export const leadPhoneNumbersSelect = (leadAlias = 'l') => `
  COALESCE(
    (
      SELECT json_agg(lp.phone ORDER BY lp.is_primary DESC, lp.id)
      FROM academy_lead_phones lp
      WHERE lp.lead_id = ${leadAlias}.id
    ),
    CASE
      WHEN ${leadAlias}.phone IS NULL OR btrim(${leadAlias}.phone) = '' THEN '[]'::json
      ELSE json_build_array(${leadAlias}.phone)
    END
  ) AS phone_numbers`;

export const leadChannelsSelect = (leadAlias = 'l') => `
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'id', channel.id,
          'channel', channel.channel,
          'providerAccountId', channel.provider_account_id,
          'externalId', channel.external_id,
          'handle', channel.handle,
          'displayName', channel.display_name,
          'profileUrl', channel.profile_url
        )
        ORDER BY channel.channel, channel.created_at, channel.id
      )
      FROM academy_lead_channels channel
      WHERE channel.lead_id = ${leadAlias}.id
    ),
    '[]'::json
  ) AS channels`;

export const leadTagsSelect = (leadAlias = 'l') => `
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'id', assignment.id,
          'tagId', tag.id,
          'name', tag.name
        )
        ORDER BY LOWER(tag.name), tag.id
      )
      FROM academy_lead_tag_assignments assignment
      JOIN academy_lead_tags tag ON tag.id = assignment.tag_id
      WHERE assignment.lead_id = ${leadAlias}.id
    ),
    '[]'::json
  ) AS tags`;

export const leadGroupReservationsSelect = (leadAlias = 'l') => `
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'groupId', reservation.group_id,
          'groupName', reserved_group.name,
          'courseId', reserved_group.course_id,
          'courseName', reserved_course.name,
          'schoolId', reserved_group.school_id,
          'isPrimary', reservation.group_id = ${leadAlias}.enrolled_group_id,
          'enrolledAt', reservation.created_at
        )
        ORDER BY (reservation.group_id = ${leadAlias}.enrolled_group_id) DESC,
                 reserved_group.name,
                 reservation.group_id
      )
      FROM academy_lead_group_reservations reservation
      JOIN academy_groups reserved_group ON reserved_group.id = reservation.group_id
      LEFT JOIN academy_courses reserved_course ON reserved_course.id = reserved_group.course_id
      WHERE reservation.lead_id = ${leadAlias}.id
    ),
    '[]'::json
  ) AS lead_groups,
  COALESCE(
    (
      SELECT array_agg(
        reservation.group_id
        ORDER BY (reservation.group_id = ${leadAlias}.enrolled_group_id) DESC,
                 reserved_group.name
      )
      FROM academy_lead_group_reservations reservation
      JOIN academy_groups reserved_group ON reserved_group.id = reservation.group_id
      WHERE reservation.lead_id = ${leadAlias}.id
    ),
    ARRAY[]::integer[]
  ) AS lead_group_ids`;

export const studentGroupMembershipsSelect = (studentAlias = 'st') => `
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'groupId', membership.group_id,
          'groupName', membership_group.name,
          'courseId', membership_group.course_id,
          'courseName', membership_course.name,
          'schoolId', membership_group.school_id,
          'isPrimary', membership.is_primary,
          'enrolledAt', membership.enrolled_at
        )
        ORDER BY membership.is_primary DESC, membership_group.name, membership.group_id
      )
      FROM academy_student_group_enrollments membership
      JOIN academy_groups membership_group ON membership_group.id = membership.group_id
      LEFT JOIN academy_courses membership_course ON membership_course.id = membership_group.course_id
      WHERE membership.student_id = ${studentAlias}.id
        AND membership.status = 'active'
    ),
    '[]'::json
  ) AS groups,
  COALESCE(
    (
      SELECT array_agg(membership.group_id ORDER BY membership.is_primary DESC, membership_group.name)
      FROM academy_student_group_enrollments membership
      JOIN academy_groups membership_group ON membership_group.id = membership.group_id
      WHERE membership.student_id = ${studentAlias}.id
        AND membership.status = 'active'
    ),
    ARRAY[]::integer[]
  ) AS group_ids,
  COALESCE(
    (
      SELECT array_agg(membership_group.name ORDER BY membership.is_primary DESC, membership_group.name)
      FROM academy_student_group_enrollments membership
      JOIN academy_groups membership_group ON membership_group.id = membership.group_id
      WHERE membership.student_id = ${studentAlias}.id
        AND membership.status = 'active'
    ),
    ARRAY[]::text[]
  ) AS group_names`;

export const phoneValues = (phones: NormalizedLeadPhone[]) =>
  phones.map((phone) => phone.normalizedPhone);

export const normalizeMessengerIdentity = (value: unknown) => nullableText(value)?.toLowerCase() ?? null;

export const lockLeadContactIdentities = async (
  phones: NormalizedLeadPhone[],
  messenger?: string | null,
) => {
  const identities = [
    ...phoneValues(phones).map((phone) => `phone:${phone}`),
    ...(normalizeMessengerIdentity(messenger)
      ? [`messenger:${normalizeMessengerIdentity(messenger)}`]
      : []),
  ].sort();
  for (const identity of identities) {
    await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `academy-lead-contact:${identity}`,
    ]);
  }
};

export const nullableDate = (value: unknown) => {
  const text = nullableText(value);
  if (text === undefined || text === null) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const parseOptionalDate = (value: unknown, fieldName: string) => {
  const parsed = nullableDate(value);
  if (value !== undefined && value !== null && value !== '' && parsed === null) {
    throw Object.assign(new Error(`Invalid ${fieldName}`), { statusCode: 400 });
  }
  return parsed;
};

export const toIntegerOrNull = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw Object.assign(new Error('Invalid integer value'), { statusCode: 400 });
  }
  return parsed;
};

export const safeJson = (value: unknown, fallback: unknown[] = []) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null || value === '') return JSON.stringify(fallback);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error('Expected an array');
      return JSON.stringify(parsed);
    } catch {
      throw Object.assign(new Error('Invalid JSON array'), { statusCode: 400 });
    }
  }
  throw Object.assign(new Error('Invalid JSON array'), { statusCode: 400 });
};

export const toBoolean = (value: unknown, fallback?: boolean) => {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  throw Object.assign(new Error('Invalid boolean value'), { statusCode: 400 });
};

// Pipeline codes identify a stage in leads, history and automation.  They are
// intentionally language-neutral and stay unchanged if an administrator later
// renames the visible stage.
export const pipelineCodeTransliteration: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ў: 'o',
  ф: 'f', х: 'h', ҳ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export const normalizePipelineStatusCode = (name: string) => {
  const transliterated = name
    .trim()
    .toLowerCase()
    .split('')
    .map((character) => pipelineCodeTransliteration[character] ?? character)
    .join('');
  const normalized = transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return normalized || 'stage';
};

export const createPipelineStatusCode = async (name: string) => {
  const base = normalizePipelineStatusCode(name);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}_${suffix}`;
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM academy_lead_statuses WHERE code = $1`,
      [candidate],
    );
    if (!existing) return candidate;
  }
  throw Object.assign(new Error('pipelineStageCodeGenerationFailed'), { statusCode: 409 });
};

export const query = async <T = Row>(sql: string, values: DbValue[] = []) => {
  const executor = transactionContext.getStore() ?? pool;
  const result = await executor.query(sql, values as any[]);
  return camelizeRows(result.rows) as T[];
};

export const withTransaction = async <T>(callback: () => Promise<T>): Promise<T> => {
  if (transactionContext.getStore()) {
    return callback();
  }

  const client = await pool.connect();
  const afterCommitTasks: AfterCommitTask[] = [];
  let result!: T;
  try {
    await client.query('BEGIN');
    result = await transactionContext.run(
      client,
      () => afterCommitContext.run(afterCommitTasks, callback),
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Storage services use the shared pool rather than this transaction's
  // connection. Running them while row locks are still held can create an
  // application-level deadlock (the transaction waits for the service while
  // the service waits for the transaction). Flush side effects only after the
  // transaction has committed and released its connection.
  for (const task of afterCommitTasks) {
    await task();
  }
  return result;
};

export const syncLeadChannelInCurrentTransaction = (input: Parameters<typeof syncLeadSourceChannel>[1]) => (
  syncLeadSourceChannel(transactionContext.getStore() ?? pool, input)
);

export const runAfterTransactionCommit = async (task: AfterCommitTask) => {
  const pendingTasks = afterCommitContext.getStore();
  if (pendingTasks) {
    pendingTasks.push(task);
    return;
  }
  await task();
};

export const queryOne = async <T = Row>(sql: string, values: DbValue[] = []) => {
  const rows = await query<T>(sql, values);
  return rows[0] as T | undefined;
};

export const getActiveLeadStatus = async (code: string, pipelineOnly = false) => queryOne<{ code: string }>(
  `SELECT code
   FROM academy_lead_statuses
   WHERE code = $1
     AND is_active = true
     ${pipelineOnly ? 'AND is_pipeline = true' : ''}
     ${transactionContext.getStore() ? 'FOR SHARE' : ''}`,
  [code],
);

export const resolveInitialLeadStatusCode = async (requestedCode: string | null | undefined) => {
  if (requestedCode) {
    const status = await getActiveLeadStatus(requestedCode);
    if (status) return status.code;
    throw Object.assign(new Error('invalidLeadStatus'), { statusCode: 400 });
  }

  const firstPipelineStatus = await queryOne<{ code: string }>(
    `SELECT code
     FROM academy_lead_statuses
     WHERE is_active = true AND is_pipeline = true
     ORDER BY sort_order, id
     LIMIT 1
     ${transactionContext.getStore() ? 'FOR SHARE' : ''}`,
  );
  if (firstPipelineStatus) return firstPipelineStatus.code;
  throw Object.assign(new Error('noActivePipelineStages'), { statusCode: 409 });
};

export const normalizeDbValue = (value: DbValue) => {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value);
  return value;
};

export const resolveLeadManagerId = async (source: ActorSource, requestedValue: unknown): Promise<number> => {
  const actor = actorContextFrom(source);
  const assignedModules = actor.modules;
  const hasDirectSalesModule = assignedModules.includes('sales');

  if (hasDirectSalesModule && !actor.isLeadership) {
    return actor.userId;
  }

  const requestedId = requestedValue === undefined || requestedValue === null || requestedValue === ''
    ? null
    : parseId(requestedValue);

  if (requestedValue !== undefined && requestedValue !== null && requestedValue !== '' && !requestedId) {
    throw Object.assign(new Error('Invalid account manager'), { statusCode: 400 });
  }

  if (requestedId) {
    const manager = await queryOne<{ id: string }>(
      `SELECT id
       FROM users u
       WHERE u.id = $1 AND ${salesUserAccessSql} AND u.is_active = true`,
      [requestedId],
    );
    if (!manager) {
      throw Object.assign(new Error('Active account manager is required'), { statusCode: 400 });
    }
    return Number(manager.id);
  }

  if (hasDirectSalesModule) {
    const currentManager = await queryOne<{ id: string }>(
      `SELECT id
       FROM users u
       WHERE u.id = $1 AND ${salesUserAccessSql} AND u.is_active = true`,
      [actor.userId],
    );
    if (currentManager) {
      return Number(currentManager.id);
    }
  }

  const manager = await queryOne<{ id: string }>(
    `SELECT u.id
     FROM users u
     LEFT JOIN academy_leads l
       ON l.manager_id = u.id
      AND l.status_code NOT IN ('paid', 'not_now')
      AND COALESCE(l.is_archived, false) = false
     WHERE ${salesUserAccessSql} AND u.is_active = true
     GROUP BY u.id
     ORDER BY COUNT(l.id), u.id
     LIMIT 1`,
  );
  if (!manager) {
    throw Object.assign(new Error('Active account manager is required'), { statusCode: 400 });
  }
  return Number(manager.id);
};

export const insertRow = async (table: string, values: Record<string, DbValue | undefined>) => {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined) as Array<[string, DbValue]>;
  if (entries.length === 0) {
    throw new Error('No values provided');
  }

  const columns = entries.map(([key]) => quoteIdent(toSnake(key)));
  const placeholders = entries.map((_, index) => `$${index + 1}`);
  const params = entries.map(([, value]) => normalizeDbValue(value));
  const rows = await query(
    `INSERT INTO ${quoteIdent(table)} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    params,
  );
  return rows[0];
};

export const updateRow = async (table: string, id: number, values: Record<string, DbValue | undefined>) => {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined) as Array<[string, DbValue]>;
  if (entries.length === 0) {
    return queryOne(`SELECT * FROM ${quoteIdent(table)} WHERE id = $1`, [id]);
  }

  const assignments = entries.map(([key], index) => `${quoteIdent(toSnake(key))} = $${index + 2}`);
  const params = [id, ...entries.map(([, value]) => normalizeDbValue(value))];
  const updatedAtAssignment = TABLES_WITHOUT_UPDATED_AT.has(table) ? '' : ', updated_at = NOW()';
  const rows = await query(
    `UPDATE ${quoteIdent(table)}
     SET ${assignments.join(', ')}${updatedAtAssignment}
     WHERE id = $1
     RETURNING *`,
    params,
  );
  return rows[0];
};

export const deleteRow = async (table: string, id: number) => {
  await query(`DELETE FROM ${quoteIdent(table)} WHERE id = $1`, [id]);
};

export const syncLeadPhones = async (leadId: number, phones: NormalizedLeadPhone[]) => {
  await query(`DELETE FROM academy_lead_phones WHERE lead_id = $1`, [leadId]);
  for (let index = 0; index < phones.length; index += 1) {
    await insertRow('academy_lead_phones', {
      leadId,
      phone: phones[index].phone,
      normalizedPhone: phones[index].normalizedPhone,
      isPrimary: index === 0,
    });
  }
};

export const ensureOperationsAccess = (req: any, res: any) => {
  const actor = actorContextFrom(req);
  if (
    actor.isLeadership ||
    actor.modules.some((module) => OPERATIONS_MODULES.has(module)) ||
    actorHasModule(actor, 'teacher')
  ) return true;
  res.status(403).json({ error: 'Operations access required' });
  return false;
};

export const ensureMarketingAccess = (req: any, res: any) => {
  const actor = actorContextFrom(req);
  if (
    actor.isLeadership ||
    actor.modules.some((module) => MARKETING_MODULES.has(module))
  ) return true;
  res.status(403).json({ error: 'Marketing access required' });
  return false;
};

export const ensureModuleAccess = (req: any, res: any, modules: Set<string>, message: string) => {
  const actor = actorContextFrom(req);
  if (actor.isLeadership || actor.modules.some((module) => modules.has(module))) return true;
  res.status(403).json({ error: message });
  return false;
};

export const ensureSalesAccess = (req: any, res: any) =>
  ensureModuleAccess(req, res, SALES_MODULES, 'Sales access required');

export const ensureSalesModuleAccess = (req: any, res: any) =>
  ensureModuleAccess(req, res, SALES_MODULES, 'Sales module access required');

export const ensureTeacherModuleAccess = (req: any, res: any) =>
  ensureModuleAccess(req, res, new Set(['teacher']), 'Teacher module access required');

export const ensureMarketingModuleAccess = (req: any, res: any) =>
  ensureModuleAccess(req, res, MARKETING_MODULES, 'Marketing module access required');

export const ensureAdministrationModuleAccess = (req: any, res: any) =>
  ensureModuleAccess(req, res, ADMINISTRATION_MODULES, 'Admin access required');

export const canAccessLeadRow = (source: ActorSource, lead?: Row | null) => (
  canActorViewLead(actorContextFrom(source), lead)
);

export const ensureLeadRowAccess = (req: any, res: any, lead?: Row | null) => {
  if (canAccessLeadRow(req, lead)) return true;
  res.status(403).json({ error: 'Lead access required' });
  return false;
};

export const canMutateLeadRow = (source: ActorSource, lead?: Row | null) => (
  canActorMutateLead(actorContextFrom(source), lead)
);

export const ensureLeadMutationAccess = (req: any, res: any, lead?: Row | null) => {
  if (canMutateLeadRow(req, lead)) return true;
  res.status(403).json({ error: 'Lead mutation access required' });
  return false;
};

export const applyLeadVisibilityForActor = async (actor: DatasetActor | undefined, leads: Row[]) => {
  const context = actorContextFrom(actor);
  if (!actor || !context.modules.includes('sales') || context.modules.includes('marketing') || context.isLeadership) {
    return leads;
  }

  // A sales employee may work with their own leads and with unassigned leads.
  // Cards assigned to another manager are excluded completely instead of
  // exposing a partially redacted card.
  const visibleLeads = leads.filter((lead) => (
    !lead.managerId || Number(lead.managerId) === context.userId
  ));
  const policy = await getWorkforcePolicy();
  if (policy.salesPhoneVisibility === 'own_leads') return visibleLeads;

  return visibleLeads.map((lead) => {
    const shouldMask = !lead.managerId;
    return shouldMask
      ? {
        ...lead,
        phone: maskPhone(lead.phone),
        phoneNumbers: Array.isArray(lead.phoneNumbers)
          ? lead.phoneNumbers.map((phone: string) => maskPhone(phone))
          : lead.phoneNumbers,
      }
      : lead;
  });
};

export const applyLeadVisibilityForRequest = async (req: any, lead: Row) => {
  const actor = actorContextFrom(req);
  return (await applyLeadVisibilityForActor({
    userId: actor.userId,
    module: actor.primaryModule ?? '',
    modules: [...actor.modules],
    scopeModule: 'sales',
  }, [lead]))[0];
};

export const academyConstants = () => ({
  leadStatuses: LEAD_STATUSES,
  studentStatuses: STUDENT_STATUSES,
  groupStatuses: GROUP_STATUSES,
  lessonStatuses: LESSON_STATUSES,
  paymentStatuses: PAYMENT_STATUSES,
  paymentTypes: PAYMENT_TYPES,
  paymentMethods: PAYMENT_METHODS,
  paymentDiscounts: PAYMENT_DISCOUNTS,
  finalProjectStatuses: FINAL_PROJECT_STATUSES,
  referralTiers: REFERRAL_TIERS,
  targets: {
    nps: TARGET_NPS,
    cac: TARGET_CAC_UZS,
    ltvCac: TARGET_LTV_CAC_RATIO,
    roas: TARGET_ROAS,
    attendance: TARGET_ATTENDANCE_PERCENT,
  },
});

export const defaultCompanyTargets = {
  targetRevenueMonthlyUzs: 0,
  targetNewLeadsMonthly: 0,
  maxCacUzs: TARGET_CAC_UZS,
  maxCplUzs: 0,
  targetRoas: TARGET_ROAS,
  targetAttendancePercent: TARGET_ATTENDANCE_PERCENT,
  targetNps: TARGET_NPS,
  salesPhoneVisibility: 'own_leads',
};

export const isValidLeadArchiveReason = (value: string | null | undefined) =>
  Boolean(value && (LEAD_ARCHIVE_REASON_CODES as readonly string[]).includes(value));

export const getCompanySettings = async () => {
  const existing = await queryOne(`SELECT * FROM academy_company_settings ORDER BY id LIMIT 1`);
  if (existing) return existing;
  return insertRow('academy_company_settings', defaultCompanyTargets);
};

export const toAnalyticsTargets = (settings: Row) => ({
  revenue: Number(settings.targetRevenueMonthlyUzs || 0),
  newLeads: Number(settings.targetNewLeadsMonthly || 0),
  nps: Number(settings.targetNps || TARGET_NPS),
  cac: Number(settings.maxCacUzs || TARGET_CAC_UZS),
  cpl: Number(settings.maxCplUzs || 0),
  ltvCac: TARGET_LTV_CAC_RATIO,
  roas: Number(settings.targetRoas || TARGET_ROAS),
  attendance: Number(settings.targetAttendancePercent || TARGET_ATTENDANCE_PERCENT),
});

export const createAudit = async (source: ActorSource, action: string, entityType: string, entityId: number, newValues?: unknown, oldValues?: unknown) => {
  const actor = actorContextFrom(source);
  await runAfterTransactionCommit(async () => {
    await storage.createAuditLog({
      userId: actor.userId,
      action,
      entityType,
      entityId,
      oldValues: oldValues ? [oldValues] : undefined,
      newValues: newValues ? [newValues] : undefined,
    }).catch((error) => logger.error('Failed to write academy audit log', { error, action, entityType, entityId }));
  });
};

export const createNotification = async (userId: number | null | undefined, title: string, message: string, entityType?: string, entityId?: number) => {
  if (!userId) return;
  await runAfterTransactionCommit(async () => {
    await storage.createNotification({
      userId,
      type: 'academy_task',
      title,
      message,
      relatedEntityType: entityType,
      relatedEntityId: entityId,
    }).catch((error) => logger.error('Failed to create notification', { error, userId }));
  });
};

export const createTask = async (title: string, options: {
  responsibleId?: number | null;
  description?: string | null;
  deadlineAt?: Date | null;
  entityType?: string | null;
  entityId?: number | null;
}) => insertRow('academy_tasks', {
  title,
  description: options.description ?? null,
  responsibleId: options.responsibleId ?? null,
  deadlineAt: options.deadlineAt ?? null,
  entityType: options.entityType ?? null,
  entityId: options.entityId ?? null,
  status: 'new' });

export const createTaskOnce = async (title: string, options: {
  responsibleId?: number | null;
  description?: string | null;
  deadlineAt?: Date | null;
  entityType?: string | null;
  entityId?: number | null;
}) => {
  const existing = await queryOne(
    `SELECT *
     FROM academy_tasks
     WHERE title = $1
       AND entity_type IS NOT DISTINCT FROM $2::text
       AND entity_id IS NOT DISTINCT FROM $3::integer
     ORDER BY id
     LIMIT 1`,
    [title, options.entityType ?? null, options.entityId ?? null],
  );
  if (existing) return { task: existing, created: false };
  return { task: await createTask(title, options), created: true };
};

export const logIntegration = async (provider: string, direction: string, status: string, payload: unknown, errorMessage?: string | null) =>
  insertRow('academy_integration_logs', {
    provider,
    direction,
    status,
    payload: payload as any,
    errorMessage: errorMessage ?? null,
    retryCount: 0 });

export const parseTimeToMinutes = parseScheduleTimeToMinutes;

export interface DatasetActor {
  userId: number;
  module: AcademyAccessModule | '';
  modules?: AcademyAccessModule[];
  scopeModule?: 'sales' | 'teacher' | 'marketing';
}
