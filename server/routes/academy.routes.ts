import { Router } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { appConfig } from '../config';
import { requireAuth } from '../middleware/auth.middleware';
import { storage } from '../storage';
import { logger } from '../lib/logger';
import {
  getTrailingZonedMonthRanges,
  getZonedDateTimeParts,
  getZonedDateOnlyRange,
  getZonedDayRange,
  getZonedMonthRange,
  zonedWallClockToInstant,
} from '../lib/academy-time';
import {
  buildRecurringLessonSchedule,
  type CalendarDate,
} from '../lib/lesson-schedule';
import { runAutomations } from '../services/automations';
import { normalizeOutboxRecipient } from '../services/message-recipients';
import { getWorkforcePolicy, maskPhone } from '../services/workforce-policy';
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
  canAccessAcademyWorkspace,
  getAssignedWorkspaces,
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
  normalizeWeeklySchedule,
  parseScheduleTimeToMinutes,
  scheduleIntervalsOverlap,
  weeklySchedulesOverlap,
  type NormalizedWeeklyScheduleItem,
} from '@shared/scheduling';

const router = Router();

router.use(requireAuth);

type DbValue = string | number | boolean | Date | null | unknown[] | Record<string, unknown>;
type Row = Record<string, any>;
type ReferralBenefitType = (typeof REFERRAL_BENEFIT_TYPES)[number];
const transactionContext = new AsyncLocalStorage<PoolClient>();

const ADMINISTRATION_WORKSPACES = new Set(['administration']);
const OPERATIONS_WORKSPACES = new Set(['administration']);
const MARKETING_WORKSPACES = new Set(['marketing', 'administration']);
const SALES_WORKSPACES = new Set(['sales', 'administration']);
const LEAD_WORKSPACES = new Set(['administration', 'sales', 'marketing']);
const SOURCE_MANAGEMENT_WORKSPACES = new Set(['administration', 'marketing']);
// All group and lesson mutations take this transaction-scoped lock before
// checking room/teacher availability. It closes the race where two requests
// checked the same free slot in different rooms and assigned one teacher twice.
const ACADEMY_SCHEDULING_ADVISORY_LOCK = 7_315_001;
const ACADEMY_REFERRAL_ADVISORY_LOCK = 7_315_002;
const ACADEMY_TIME_ZONE = process.env.ACADEMY_TIME_ZONE?.trim() || 'Asia/Tashkent';
const salesUserAccessSql = `
  (
    u.workspace = 'sales'
    OR EXISTS (
      SELECT 1
      FROM user_workspaces uw
      WHERE uw.user_id = u.id AND uw.workspace = 'sales'
    )
  )
`;
const leadershipUserAccessSql = `
  (
    u.workspace = 'administration'
    OR EXISTS (
      SELECT 1
      FROM user_workspaces uw
      WHERE uw.user_id = u.id AND uw.workspace = 'administration'
    )
  )
`;

const toSnake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const camelize = (row: Row): Row => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [toCamel(key), value]),
);

const camelizeRows = (rows: Row[]) => rows.map(camelize);

const quoteIdent = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
const TABLES_WITHOUT_UPDATED_AT = new Set([
  'academy_lead_stage_history',
  'academy_lead_assignment_history',
  'academy_communications',
  'academy_student_transfers',
  'academy_student_status_history',
  'academy_lesson_status_history',
  'academy_lesson_surveys',
  'academy_parent_surveys',
  'academy_referral_rewards',
]);

const parseId = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const toIdOrNull = (value: unknown, fieldName: string) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = parseId(value);
  if (!parsed) {
    throw Object.assign(new Error(`Invalid ${fieldName}`), { statusCode: 400 });
  }
  return parsed;
};

const nullableText = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

type NormalizedLeadPhone = {
  phone: string;
  normalizedPhone: string;
};

const normalizePhoneForStorage = (value: unknown): NormalizedLeadPhone | null => {
  const text = nullableText(value);
  if (!text) return null;
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `998${digits}`;
  const phone = `+${digits}`;
  return { phone, normalizedPhone: phone };
};

const normalizeLeadPhones = (value: unknown): NormalizedLeadPhone[] => {
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

const leadPhoneNumbersSelect = (leadAlias = 'l') => `
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

const phoneValues = (phones: NormalizedLeadPhone[]) =>
  phones.map((phone) => phone.normalizedPhone);

const normalizeMessengerIdentity = (value: unknown) => nullableText(value)?.toLowerCase() ?? null;

const lockLeadContactIdentities = async (
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

const nullableDate = (value: unknown) => {
  const text = nullableText(value);
  if (text === undefined || text === null) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseOptionalDate = (value: unknown, fieldName: string) => {
  const parsed = nullableDate(value);
  if (value !== undefined && value !== null && value !== '' && parsed === null) {
    throw Object.assign(new Error(`Invalid ${fieldName}`), { statusCode: 400 });
  }
  return parsed;
};

const toIntegerOrNull = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw Object.assign(new Error('Invalid integer value'), { statusCode: 400 });
  }
  return parsed;
};

const safeJson = (value: unknown, fallback: unknown[] = []) => {
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

const toBoolean = (value: unknown, fallback?: boolean) => {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  throw Object.assign(new Error('Invalid boolean value'), { statusCode: 400 });
};

// Pipeline codes identify a stage in leads, history and automation.  They are
// intentionally language-neutral and stay unchanged if an administrator later
// renames the visible stage.
const pipelineCodeTransliteration: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ў: 'o',
  ф: 'f', х: 'h', ҳ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const normalizePipelineStatusCode = (name: string) => {
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

const createPipelineStatusCode = async (name: string) => {
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

const query = async <T = Row>(sql: string, values: DbValue[] = []) => {
  const executor = transactionContext.getStore() ?? pool;
  const result = await executor.query(sql, values as any[]);
  return camelizeRows(result.rows) as T[];
};

const withTransaction = async <T>(callback: () => Promise<T>): Promise<T> => {
  if (transactionContext.getStore()) {
    return callback();
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await transactionContext.run(client, callback);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const queryOne = async <T = Row>(sql: string, values: DbValue[] = []) => {
  const rows = await query<T>(sql, values);
  return rows[0] as T | undefined;
};

const getActiveLeadStatus = async (code: string, pipelineOnly = false) => queryOne<{ code: string }>(
  `SELECT code
   FROM academy_lead_statuses
   WHERE code = $1
     AND is_active = true
     ${pipelineOnly ? 'AND is_pipeline = true' : ''}
     ${transactionContext.getStore() ? 'FOR SHARE' : ''}`,
  [code],
);

const resolveInitialLeadStatusCode = async (requestedCode: string | null | undefined) => {
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

const normalizeDbValue = (value: DbValue) => {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value);
  return value;
};

const resolveLeadManagerId = async (req: any, requestedValue: unknown): Promise<number> => {
  const assignedWorkspaces = getAssignedWorkspaces(req.user);
  const hasDirectSalesWorkspace = assignedWorkspaces.includes('sales');

  if (hasDirectSalesWorkspace && !hasLeadershipAccess(req.user)) {
    return Number(req.user.id);
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

  if (hasDirectSalesWorkspace) {
    const currentManager = await queryOne<{ id: string }>(
      `SELECT id
       FROM users u
       WHERE u.id = $1 AND ${salesUserAccessSql} AND u.is_active = true`,
      [req.user.id],
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

const insertRow = async (table: string, values: Record<string, DbValue | undefined>) => {
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

const updateRow = async (table: string, id: number, values: Record<string, DbValue | undefined>) => {
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

const deleteRow = async (table: string, id: number) => {
  await query(`DELETE FROM ${quoteIdent(table)} WHERE id = $1`, [id]);
};

const syncLeadPhones = async (leadId: number, phones: NormalizedLeadPhone[]) => {
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

const ensureOperationsAccess = (req: any, res: any) => {
  if (
    hasLeadershipAccess(req.user) ||
    getAssignedWorkspaces(req.user).some((workspace) => OPERATIONS_WORKSPACES.has(workspace)) ||
    canAccessAcademyWorkspace(req.user, 'teacher')
  ) return true;
  res.status(403).json({ error: 'Operations access required' });
  return false;
};

const ensureMarketingAccess = (req: any, res: any) => {
  if (
    hasLeadershipAccess(req.user) ||
    getAssignedWorkspaces(req.user).some((workspace) => MARKETING_WORKSPACES.has(workspace))
  ) return true;
  res.status(403).json({ error: 'Marketing access required' });
  return false;
};

const ensureWorkspaceAccess = (req: any, res: any, workspaces: Set<string>, message: string) => {
  if (hasLeadershipAccess(req.user) || getAssignedWorkspaces(req.user).some((workspace) => workspaces.has(workspace))) return true;
  res.status(403).json({ error: message });
  return false;
};

const ensureSalesAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, SALES_WORKSPACES, 'Sales access required');

const ensureSalesWorkspaceAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, SALES_WORKSPACES, 'Sales workspace access required');

const ensureTeacherWorkspaceAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, new Set(['teacher']), 'Teacher workspace access required');

const ensureMarketingWorkspaceAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, MARKETING_WORKSPACES, 'Marketing workspace access required');

const ensureAdministrationWorkspaceAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, ADMINISTRATION_WORKSPACES, 'Admin access required');

const canAccessLeadRow = (req: any, lead?: Row | null) => {
  if (!lead) return false;
  if (hasLeadershipAccess(req.user) || canAccessAcademyWorkspace(req.user, 'marketing')) return true;
  if (lead.isArchived && canAccessAcademyWorkspace(req.user, 'sales')) return true;
  return canAccessAcademyWorkspace(req.user, 'sales')
    && (!lead.managerId || Number(lead.managerId) === Number(req.user?.id));
};

const ensureLeadRowAccess = (req: any, res: any, lead?: Row | null) => {
  if (canAccessLeadRow(req, lead)) return true;
  res.status(403).json({ error: 'Lead access required' });
  return false;
};

const canMutateLeadRow = (req: any, lead?: Row | null) => Boolean(
  lead
  && (
    hasLeadershipAccess(req.user)
    || canAccessAcademyWorkspace(req.user, 'marketing')
    || (
      canAccessAcademyWorkspace(req.user, 'sales')
      && (!lead.managerId || Number(lead.managerId) === Number(req.user?.id))
    )
  ),
);

const ensureLeadMutationAccess = (req: any, res: any, lead?: Row | null) => {
  if (canMutateLeadRow(req, lead)) return true;
  res.status(403).json({ error: 'Lead mutation access required' });
  return false;
};

const redactLeadPhonesForActor = async (actor: DatasetActor | undefined, leads: Row[]) => {
  const actorWorkspaces = getAssignedWorkspaces(actor);
  if (!actor || !actorWorkspaces.includes('sales') || actorWorkspaces.includes('marketing') || hasLeadershipAccess(actor)) {
    return leads;
  }
  const policy = await getWorkforcePolicy();
  return leads.map((lead) => {
    const ownsLead = Number(lead.managerId) === Number(actor.userId);
    const shouldMask = policy.salesPhoneVisibility === 'own_leads'
      ? !ownsLead
      : !lead.managerId || !ownsLead;
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

const redactLeadForRequest = async (req: any, lead: Row) => (
  await redactLeadPhonesForActor({
    userId: req.user!.id,
    workspace: String(req.user!.workspace),
    workspaces: getAssignedWorkspaces(req.user),
    scopeWorkspace: 'sales',
  }, [lead])
)[0];

const academyConstants = () => ({
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

const defaultCompanyTargets = {
  targetRevenueMonthlyUzs: 0,
  targetNewLeadsMonthly: 0,
  maxCacUzs: TARGET_CAC_UZS,
  maxCplUzs: 0,
  targetRoas: TARGET_ROAS,
  targetAttendancePercent: TARGET_ATTENDANCE_PERCENT,
  targetNps: TARGET_NPS,
  salesPhoneVisibility: 'own_leads',
};

const isValidLeadArchiveReason = (value: string | null | undefined) =>
  Boolean(value && (LEAD_ARCHIVE_REASON_CODES as readonly string[]).includes(value));

const getCompanySettings = async () => {
  const existing = await queryOne(`SELECT * FROM academy_company_settings ORDER BY id LIMIT 1`);
  if (existing) return existing;
  return insertRow('academy_company_settings', defaultCompanyTargets);
};

const toAnalyticsTargets = (settings: Row) => ({
  revenue: Number(settings.targetRevenueMonthlyUzs || 0),
  newLeads: Number(settings.targetNewLeadsMonthly || 0),
  nps: Number(settings.targetNps || TARGET_NPS),
  cac: Number(settings.maxCacUzs || TARGET_CAC_UZS),
  cpl: Number(settings.maxCplUzs || 0),
  ltvCac: TARGET_LTV_CAC_RATIO,
  roas: Number(settings.targetRoas || TARGET_ROAS),
  attendance: Number(settings.targetAttendancePercent || TARGET_ATTENDANCE_PERCENT),
});

const createAudit = async (req: any, action: string, entityType: string, entityId: number, newValues?: unknown, oldValues?: unknown) => {
  await storage.createAuditLog({
    userId: req.user!.id,
    action,
    entityType,
    entityId,
    oldValues: oldValues ? [oldValues] : undefined,
    newValues: newValues ? [newValues] : undefined }).catch((error) => logger.error('Failed to write academy audit log', { error, action, entityType, entityId }));
};

const createNotification = async (userId: number | null | undefined, title: string, message: string, entityType?: string, entityId?: number) => {
  if (!userId) return;
  await storage.createNotification({
    userId,
    type: 'academy_task',
    title,
    message,
    relatedEntityType: entityType,
    relatedEntityId: entityId }).catch((error) => logger.error('Failed to create notification', { error, userId }));
};

const createTask = async (title: string, options: {
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

const createTaskOnce = async (title: string, options: {
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

const createOutbox = async (channel: string, recipient: string | null | undefined, message: string, options: {
  scheduledAt?: Date | null;
  entityType?: string | null;
  entityId?: number | null;
}) => {
  const normalizedChannel = nullableText(channel)?.toLowerCase();
  const normalizedRecipient = normalizeOutboxRecipient(
    normalizedChannel,
    recipient,
    appConfig.integrations?.telegram?.leadershipChatId,
  );
  if (!normalizedChannel || !normalizedRecipient) return null;
  return insertRow('academy_notification_outbox', {
    channel: normalizedChannel,
    recipient: normalizedRecipient,
    message,
    status: 'pending',
    scheduledAt: options.scheduledAt ?? new Date(),
    entityType: options.entityType ?? null,
    entityId: options.entityId ?? null });
};

const logIntegration = async (provider: string, direction: string, status: string, payload: unknown, errorMessage?: string | null) =>
  insertRow('academy_integration_logs', {
    provider,
    direction,
    status,
    payload: payload as any,
    errorMessage: errorMessage ?? null,
    retryCount: 0 });

const parseTimeToMinutes = parseScheduleTimeToMinutes;

const calendarDayOrdinal = (year: number, month: number, day: number) =>
  Date.UTC(year, month - 1, day);

const getAcademySlotPosition = (date: Date, durationMinutes = 0) => {
  const parts = getZonedDateTimeParts(date, ACADEMY_TIME_ZONE);
  const nativeDay = new Date(calendarDayOrdinal(parts.year, parts.month, parts.day)).getUTCDay();
  const startMinutes = parts.hour * 60 + parts.minute;
  return {
    dayOfWeek: nativeDay === 0 ? 7 : nativeDay,
    startMinutes,
    endMinutes: startMinutes + durationMinutes,
  };
};

const academyDayOfWeek = (date: Date) => getAcademySlotPosition(date).dayOfWeek;

type NormalizedScheduleItem = NormalizedWeeklyScheduleItem;

const readJsonArray = (value: unknown): Row[] => {
  if (Array.isArray(value)) return value as Row[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeScheduleItems = normalizeWeeklySchedule;
const intervalsOverlap = scheduleIntervalsOverlap;

const dateOnlyDayOrdinal = (date: Date) => calendarDayOrdinal(
  date.getUTCFullYear(),
  date.getUTCMonth() + 1,
  date.getUTCDate(),
);

const academyDayOrdinal = (date: Date) => {
  const parts = getZonedDateTimeParts(date, ACADEMY_TIME_ZONE);
  return calendarDayOrdinal(parts.year, parts.month, parts.day);
};

const dateRangesOverlap = (
  leftStart?: Date | null,
  leftEnd?: Date | null,
  rightStart?: Date | null,
  rightEnd?: Date | null,
) => {
  if (
    (leftStart && Number.isNaN(leftStart.getTime()))
    || (leftEnd && Number.isNaN(leftEnd.getTime()))
    || (rightStart && Number.isNaN(rightStart.getTime()))
    || (rightEnd && Number.isNaN(rightEnd.getTime()))
  ) return false;
  const leftStartDay = leftStart ? dateOnlyDayOrdinal(leftStart) : Number.NEGATIVE_INFINITY;
  const leftEndDay = leftEnd ? dateOnlyDayOrdinal(leftEnd) : Number.POSITIVE_INFINITY;
  const rightStartDay = rightStart ? dateOnlyDayOrdinal(rightStart) : Number.NEGATIVE_INFINITY;
  const rightEndDay = rightEnd ? dateOnlyDayOrdinal(rightEnd) : Number.POSITIVE_INFINITY;
  return leftStartDay <= rightEndDay && leftEndDay >= rightStartDay;
};

const isDateInsideInclusiveDayRange = (
  value: Date,
  start?: Date | null,
  end?: Date | null,
) => {
  if (
    Number.isNaN(value.getTime())
    || (start && Number.isNaN(start.getTime()))
    || (end && Number.isNaN(end.getTime()))
  ) return false;
  const day = academyDayOrdinal(value);
  return day >= (start ? dateOnlyDayOrdinal(start) : Number.NEGATIVE_INFINITY)
    && day <= (end ? dateOnlyDayOrdinal(end) : Number.POSITIVE_INFINITY);
};

const parseDateOnly = (value: unknown) => {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const marker = new Date(calendarDayOrdinal(year, month, day));
  if (
    marker.getUTCFullYear() !== year
    || marker.getUTCMonth() + 1 !== month
    || marker.getUTCDate() !== day
  ) return null;
  return zonedWallClockToInstant({ year, month, day }, ACADEMY_TIME_ZONE);
};

const startOfAcademyDay = (date: Date) =>
  getZonedDayRange(date, ACADEMY_TIME_ZONE).start;

const scheduleCoversSlot = (
  schedule: NormalizedScheduleItem[],
  dayOfWeek: number,
  startMinutes: number,
  endMinutes: number,
  schoolId?: number | null,
) => schedule.some((item) =>
  item.dayOfWeek === dayOfWeek
  && (!schoolId || !item.schoolId || item.schoolId === Number(schoolId))
  && startMinutes >= item.startMinutes
  && endMinutes <= item.endMinutes
);

const scheduleConflictsWithSlot = (
  schedule: NormalizedScheduleItem[],
  dayOfWeek: number,
  startMinutes: number,
  endMinutes: number,
) => schedule.some((item) =>
  item.dayOfWeek === dayOfWeek
  && intervalsOverlap(startMinutes, endMinutes, item.startMinutes, item.endMinutes)
);

const getTeacherAvailability = (teacher: Row, durationMinutes: number) =>
  normalizeScheduleItems(
    readJsonArray(teacher.availability).length > 0 ? teacher.availability : teacher.schedule,
    durationMinutes,
  );

const findAvailableTeacher = async (options: {
  courseId: number;
  schoolId?: number | null;
  scheduledAt: Date;
  durationMinutes: number;
  excludeGroupId?: number | null;
  excludeLessonId?: number | null;
}) => {
  const candidates = await query(
    `SELECT t.*,
        (
          SELECT COUNT(*)::int
          FROM academy_lessons l
          WHERE l.teacher_id = t.id
            AND l.status = 'scheduled'
            AND l.scheduled_at >= NOW()
        ) AS upcoming_lessons
     FROM academy_teachers t
     WHERE t.status = 'active'
       AND t.course_ids @> $1::jsonb
     ORDER BY upcoming_lessons, t.id`,
    [JSON.stringify([options.courseId])],
  );

  const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
    options.scheduledAt,
    options.durationMinutes,
  );
  const lessonEnd = addMinutes(options.scheduledAt, options.durationMinutes);
  const teacherIds = candidates.map((teacher) => Number(teacher.id));
  const existingGroups = teacherIds.length > 0
    ? await query(
      `SELECT * FROM academy_groups
       WHERE teacher_id = ANY($1::int[])
         AND status IN ('open', 'in_progress')
         AND ($2::int IS NULL OR id <> $2)`,
      [teacherIds, options.excludeGroupId ?? null],
    )
    : [];

  for (const teacher of candidates) {
    const schoolIds = Array.isArray(teacher.schoolIds) ? teacher.schoolIds.map(Number) : [];
    if (options.schoolId && schoolIds.length > 0 && !schoolIds.includes(Number(options.schoolId))) {
      continue;
    }

    const availability = Array.isArray(teacher.availability)
      ? teacher.availability
      : Array.isArray(teacher.schedule)
        ? teacher.schedule
        : [];
    const canWork = availability.some((item: Row) => {
      if (Number(item.dayOfWeek) !== dayOfWeek) return false;
      if (options.schoolId && item.schoolId && Number(item.schoolId) !== Number(options.schoolId)) return false;
      const availableStart = parseTimeToMinutes(item.startTime ?? item.time);
      const availableEnd = parseTimeToMinutes(item.endTime ?? item.time);
      if (availableStart === null) return false;
      const resolvedEnd = availableEnd === null || availableEnd === availableStart
        ? availableStart + options.durationMinutes
        : availableEnd;
      return startMinutes >= availableStart && endMinutes <= resolvedEnd;
    });
    if (!canWork) continue;

    const groupConflict = existingGroups
      .filter((group) => Number(group.teacherId) === Number(teacher.id))
      .some((group) =>
        isDateInsideInclusiveDayRange(
          options.scheduledAt,
          group.startDate ? new Date(group.startDate) : null,
          group.endDate ? new Date(group.endDate) : null,
        )
        && scheduleConflictsWithSlot(
          normalizeScheduleItems(group.schedule),
          dayOfWeek,
          startMinutes,
          endMinutes,
        )
      );
    if (groupConflict) continue;

    const conflict = await queryOne(
      `SELECT id
       FROM academy_lessons
       WHERE teacher_id = $1
         AND status <> 'cancelled'
         AND scheduled_at < $3
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
         AND ($4::int IS NULL OR id <> $4)
       LIMIT 1`,
      [teacher.id, options.scheduledAt, lessonEnd, options.excludeLessonId ?? null],
    );
    if (!conflict) return teacher;
  }

  return null;
};

const findTeacherForGroupSchedule = async (options: {
  courseId: number;
  schoolId: number;
  schedule: unknown;
  startDate?: Date | null;
  endDate?: Date | null;
  excludeGroupId?: number | null;
}) => {
  const requestedSchedule = normalizeScheduleItems(options.schedule);
  if (requestedSchedule.length === 0) return null;

  const candidates = await query(
    `SELECT t.*,
        (SELECT COUNT(*)::int FROM academy_groups g
         WHERE g.teacher_id = t.id AND g.status IN ('open', 'in_progress')) AS active_groups
     FROM academy_teachers t
     WHERE t.status = 'active'
       AND t.course_ids @> $1::jsonb
     ORDER BY active_groups, t.id`,
    [JSON.stringify([options.courseId])],
  );

  const teacherIds = candidates.map((teacher) => Number(teacher.id));
  const existingGroups = teacherIds.length > 0
    ? await query(
      `SELECT * FROM academy_groups
       WHERE status IN ('open', 'in_progress')
         AND teacher_id = ANY($1::int[])
         AND ($2::int IS NULL OR id <> $2)`,
      [teacherIds, options.excludeGroupId ?? null],
    )
    : [];
  const rangeStart = options.startDate
    ? getZonedDateOnlyRange(options.startDate, ACADEMY_TIME_ZONE).start
    : startOfAcademyDay(new Date());
  const rangeEnd = options.endDate
    ? getZonedDateOnlyRange(options.endDate, ACADEMY_TIME_ZONE).end
    : null;
  const existingLessons = teacherIds.length > 0
    ? await query(
      `SELECT teacher_id, scheduled_at, duration_minutes
       FROM academy_lessons
       WHERE teacher_id = ANY($1::int[])
         AND status <> 'cancelled'
         AND scheduled_at >= $2
         AND ($3::timestamp IS NULL OR scheduled_at < $3)`,
      [teacherIds, rangeStart, rangeEnd],
    )
    : [];

  for (const teacher of candidates) {
    const schoolIds = readJsonArray(teacher.schoolIds).map(Number);
    if (schoolIds.length > 0 && !schoolIds.includes(options.schoolId)) continue;
    const availability = getTeacherAvailability(teacher, 60);
    const coversSchedule = requestedSchedule.every((item) =>
      scheduleCoversSlot(
        availability,
        item.dayOfWeek,
        item.startMinutes,
        item.endMinutes,
        options.schoolId,
      )
    );
    if (!coversSchedule) continue;

    const hasRecurringConflict = existingGroups
      .filter((group) => Number(group.teacherId) === Number(teacher.id))
      .some((group) => {
        if (!dateRangesOverlap(
          options.startDate,
          options.endDate,
          group.startDate ? new Date(group.startDate) : null,
          group.endDate ? new Date(group.endDate) : null,
        )) return false;
        const groupSchedule = normalizeScheduleItems(group.schedule);
        return requestedSchedule.some((item) =>
          scheduleConflictsWithSlot(
            groupSchedule,
            item.dayOfWeek,
            item.startMinutes,
            item.endMinutes,
          )
        );
      });
    if (hasRecurringConflict) continue;

    const hasLessonConflict = existingLessons
      .filter((lesson) => Number(lesson.teacherId) === Number(teacher.id))
      .some((lesson) => {
        const scheduledAt = new Date(lesson.scheduledAt);
        const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
          scheduledAt,
          Number(lesson.durationMinutes || 60),
        );
        return requestedSchedule.some((item) =>
          item.dayOfWeek === dayOfWeek
          && intervalsOverlap(item.startMinutes, item.endMinutes, startMinutes, endMinutes)
        );
      });
    if (!hasLessonConflict) return teacher;
  }

  return null;
};

const ensureTeacherCourseAssignment = async (teacher: Row, courseId: number) => {
  const currentCourseIds = readJsonArray(teacher.courseIds)
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0);
  if (currentCourseIds.includes(courseId)) return;

  const nextCourseIds = [...new Set([...currentCourseIds, courseId])]
    .sort((left, right) => left - right);
  await updateRow('academy_teachers', Number(teacher.id), { courseIds: nextCourseIds });
};

const assertTeacherCanLeadGroupSchedule = async (options: {
  teacherId: number;
  courseId: number;
  schoolId: number;
  schedule: unknown;
  startDate?: Date | null;
  endDate?: Date | null;
  excludeGroupId?: number | null;
}) => {
  const teacher = await queryOne(`SELECT * FROM academy_teachers WHERE id = $1`, [options.teacherId]);
  if (!teacher) {
    throw Object.assign(new Error('teacherNotFound'), { statusCode: 404 });
  }
  if (teacher.status !== 'active') {
    throw Object.assign(new Error('teacherNotActive'), { statusCode: 400 });
  }

  const requestedSchedule = normalizeScheduleItems(options.schedule);
  const schoolIds = readJsonArray(teacher.schoolIds).map(Number);
  if (schoolIds.length > 0 && !schoolIds.includes(options.schoolId)) {
    throw Object.assign(new Error('teacherUnavailableForGroup'), { statusCode: 409 });
  }

  const availability = getTeacherAvailability(teacher, 60);
  const coversSchedule = requestedSchedule.every((item) =>
    scheduleCoversSlot(
      availability,
      item.dayOfWeek,
      item.startMinutes,
      item.endMinutes,
      options.schoolId,
    )
  );
  if (!coversSchedule) {
    throw Object.assign(new Error('teacherUnavailableForGroup'), { statusCode: 409 });
  }

  const existingGroups = await query(
    `SELECT *
     FROM academy_groups
     WHERE teacher_id = $1
       AND status IN ('open', 'in_progress')
       AND ($2::int IS NULL OR id <> $2)`,
    [options.teacherId, options.excludeGroupId ?? null],
  );
  const recurringConflict = existingGroups.some((group) => {
    if (!dateRangesOverlap(
      options.startDate,
      options.endDate,
      group.startDate ? new Date(group.startDate) : null,
      group.endDate ? new Date(group.endDate) : null,
    )) return false;
    return weeklySchedulesOverlap(requestedSchedule, normalizeScheduleItems(group.schedule));
  });
  if (recurringConflict) {
    throw Object.assign(new Error('teacherUnavailableForGroup'), { statusCode: 409 });
  }

  const rangeStart = options.startDate
    ? getZonedDateOnlyRange(options.startDate, ACADEMY_TIME_ZONE).start
    : startOfAcademyDay(new Date());
  const rangeEnd = options.endDate
    ? getZonedDateOnlyRange(options.endDate, ACADEMY_TIME_ZONE).end
    : null;
  const existingLessons = await query(
    `SELECT scheduled_at, duration_minutes
     FROM academy_lessons
     WHERE teacher_id = $1
       AND status <> 'cancelled'
       AND scheduled_at >= $2
       AND ($3::timestamp IS NULL OR scheduled_at < $3)`,
    [options.teacherId, rangeStart, rangeEnd],
  );
  const lessonConflict = existingLessons.some((lesson) => {
    const scheduledAt = new Date(lesson.scheduledAt);
    const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
      scheduledAt,
      Number(lesson.durationMinutes || 60),
    );
    return requestedSchedule.some((item) =>
      item.dayOfWeek === dayOfWeek
      && intervalsOverlap(item.startMinutes, item.endMinutes, startMinutes, endMinutes)
    );
  });
  if (lessonConflict) {
    throw Object.assign(new Error('teacherUnavailableForGroup'), { statusCode: 409 });
  }

  await ensureTeacherCourseAssignment(teacher, options.courseId);
  return teacher;
};

const assertTeacherCanLeadLesson = async (options: {
  teacherId: number;
  courseId: number;
  schoolId: number;
  scheduledAt: Date;
  durationMinutes: number;
  excludeGroupId?: number | null;
  excludeLessonId?: number | null;
}) => {
  const teacher = await queryOne(`SELECT * FROM academy_teachers WHERE id = $1`, [options.teacherId]);
  if (!teacher) throw Object.assign(new Error('teacherNotFound'), { statusCode: 404 });
  if (teacher.status !== 'active') {
    throw Object.assign(new Error('teacherNotActive'), { statusCode: 400 });
  }

  const courseIds = readJsonArray(teacher.courseIds).map(Number);
  const schoolIds = readJsonArray(teacher.schoolIds).map(Number);
  if (
    (courseIds.length > 0 && !courseIds.includes(options.courseId))
    || (schoolIds.length > 0 && !schoolIds.includes(options.schoolId))
  ) {
    throw Object.assign(new Error('teacherUnavailableForLesson'), { statusCode: 409 });
  }

  const startsAt = new Date(options.scheduledAt);
  const endsAt = addMinutes(startsAt, options.durationMinutes);
  const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
    startsAt,
    options.durationMinutes,
  );
  if (!scheduleCoversSlot(
    getTeacherAvailability(teacher, options.durationMinutes),
    dayOfWeek,
    startMinutes,
    endMinutes,
    options.schoolId,
  )) {
    throw Object.assign(new Error('teacherUnavailableForLesson'), { statusCode: 409 });
  }

  const [lessonConflict, groups] = await Promise.all([
    queryOne(
      `SELECT id
       FROM academy_lessons
       WHERE teacher_id = $1
         AND status <> 'cancelled'
         AND scheduled_at < $3
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
         AND ($4::int IS NULL OR id <> $4)
       LIMIT 1`,
      [options.teacherId, startsAt, endsAt, options.excludeLessonId ?? null],
    ),
    query(
      `SELECT *
       FROM academy_groups
       WHERE teacher_id = $1
         AND status IN ('open', 'in_progress')
         AND ($2::int IS NULL OR id <> $2)`,
      [options.teacherId, options.excludeGroupId ?? null],
    ),
  ]);
  const recurringConflict = groups.some((group) =>
    isDateInsideInclusiveDayRange(
      startsAt,
      group.startDate ? new Date(group.startDate) : null,
      group.endDate ? new Date(group.endDate) : null,
    )
    && scheduleConflictsWithSlot(
      normalizeScheduleItems(group.schedule),
      dayOfWeek,
      startMinutes,
      endMinutes,
    )
  );
  if (lessonConflict || recurringConflict) {
    throw Object.assign(new Error('teacherUnavailableForLesson'), { statusCode: 409 });
  }
  await ensureTeacherCourseAssignment(teacher, options.courseId);
  return teacher;
};

const assertActiveRoomInSchool = async (roomId: number, schoolId: number) => {
  const room = await queryOne(
    `SELECT room.*
     FROM academy_rooms room
     JOIN academy_schools school ON school.id = room.school_id AND school.is_active = true
     WHERE room.id = $1 AND room.school_id = $2 AND room.is_active = true`,
    [roomId, schoolId],
  );
  if (!room) throw Object.assign(new Error('roomNotFound'), { statusCode: 404 });
  return room;
};

const assertRoomScheduleAvailable = async (options: {
  schoolId: number;
  roomId: number;
  schedule: unknown;
  startDate?: Date | null;
  endDate?: Date | null;
  excludeGroupId?: number | null;
}) => {
  await assertActiveRoomInSchool(options.roomId, options.schoolId);
  const validationError = getGroupScheduleValidationError(options.schedule);
  if (validationError) {
    throw Object.assign(new Error(validationError), {
      statusCode: validationError === 'groupScheduleRequired' || validationError === 'groupScheduleInvalid'
        ? 400
        : 409,
    });
  }

  const requestedSchedule = normalizeScheduleItems(options.schedule);

  const existingGroups = await query(
    `SELECT * FROM academy_groups
     WHERE room_id = $1
       AND status IN ('open', 'in_progress')
       AND ($2::int IS NULL OR id <> $2)`,
    [options.roomId, options.excludeGroupId ?? null],
  );

  const recurringConflict = existingGroups.some((group) => {
    if (!dateRangesOverlap(
      options.startDate,
      options.endDate,
      group.startDate ? new Date(group.startDate) : null,
      group.endDate ? new Date(group.endDate) : null,
    )) return false;
    return weeklySchedulesOverlap(requestedSchedule, normalizeScheduleItems(group.schedule));
  });
  if (recurringConflict) {
    throw Object.assign(new Error('roomOccupied'), { statusCode: 409 });
  }

  const rangeStart = options.startDate
    ? getZonedDateOnlyRange(options.startDate, ACADEMY_TIME_ZONE).start
    : startOfAcademyDay(new Date());
  const rangeEnd = options.endDate
    ? getZonedDateOnlyRange(options.endDate, ACADEMY_TIME_ZONE).end
    : null;
  const lessons = await query(
    `SELECT scheduled_at, duration_minutes
     FROM academy_lessons
     WHERE room_id = $1
       AND status <> 'cancelled'
       AND scheduled_at >= $2
       AND ($3::timestamp IS NULL OR scheduled_at < $3)`,
    [options.roomId, rangeStart, rangeEnd],
  );
  const lessonConflict = lessons.some((lesson) => {
    const scheduledAt = new Date(lesson.scheduledAt);
    const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
      scheduledAt,
      Number(lesson.durationMinutes || 60),
    );
    return requestedSchedule.some((item) =>
      item.dayOfWeek === dayOfWeek
      && intervalsOverlap(item.startMinutes, item.endMinutes, startMinutes, endMinutes)
    );
  });
  if (lessonConflict) {
    throw Object.assign(new Error('roomOccupied'), { statusCode: 409 });
  }
};

const assertLessonRoomAvailable = async (options: {
  schoolId: number;
  roomId: number;
  scheduledAt: Date;
  durationMinutes: number;
  excludeLessonId?: number | null;
  excludeGroupId?: number | null;
}) => {
  await assertActiveRoomInSchool(options.roomId, options.schoolId);
  const startsAt = new Date(options.scheduledAt);
  const endsAt = addMinutes(startsAt, options.durationMinutes);
  const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
    startsAt,
    options.durationMinutes,
  );

  const [lessonConflict, groupLessonConflict, groups] = await Promise.all([
    queryOne(
      `SELECT id FROM academy_lessons
       WHERE room_id = $1
         AND status <> 'cancelled'
         AND scheduled_at < $3
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
         AND ($4::int IS NULL OR id <> $4)
       LIMIT 1`,
      [options.roomId, startsAt, endsAt, options.excludeLessonId ?? null],
    ),
    options.excludeGroupId
      ? queryOne(
        `SELECT id
         FROM academy_lessons
         WHERE group_id = $1
           AND status <> 'cancelled'
           AND scheduled_at < $3
           AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $2
           AND ($4::int IS NULL OR id <> $4)
         LIMIT 1`,
        [options.excludeGroupId, startsAt, endsAt, options.excludeLessonId ?? null],
      )
      : Promise.resolve(null),
    query(
      `SELECT * FROM academy_groups
       WHERE room_id = $1
         AND status IN ('open', 'in_progress')
         AND ($2::int IS NULL OR id <> $2)`,
      [options.roomId, options.excludeGroupId ?? null],
    ),
  ]);

  if (lessonConflict) throw Object.assign(new Error('roomOccupied'), { statusCode: 409 });
  if (groupLessonConflict) {
    throw Object.assign(new Error('groupLessonOverlap'), { statusCode: 409 });
  }

  const recurringConflict = groups.some((group) =>
    isDateInsideInclusiveDayRange(
      startsAt,
      group.startDate ? new Date(group.startDate) : null,
      group.endDate ? new Date(group.endDate) : null,
    )
    && scheduleConflictsWithSlot(
      normalizeScheduleItems(group.schedule),
      dayOfWeek,
      startMinutes,
      endMinutes,
    )
  );
  if (recurringConflict) throw Object.assign(new Error('roomOccupied'), { statusCode: 409 });
};

const listAvailableSchoolSlots = async (options: {
  schoolId: number;
  courseId: number;
  from: Date;
  days: number;
  excludeLeadId?: number | null;
  excludeGroupId?: number | null;
  excludeLessonId?: number | null;
}) => {
  const course = await queryOne(`SELECT * FROM academy_courses WHERE id = $1 AND is_active = true`, [options.courseId]);
  if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 });
  const school = await queryOne(`SELECT * FROM academy_schools WHERE id = $1 AND is_active = true`, [options.schoolId]);
  if (!school) throw Object.assign(new Error('School not found'), { statusCode: 404 });

  const durationMinutes = Math.max(15, Number(course.lessonDurationMinutes || 60));
  const rangeStart = startOfAcademyDay(options.from);
  const rangeEnd = getZonedDayRange(rangeStart, ACADEMY_TIME_ZONE, options.days).start;
  const teachers = await query(
    `SELECT t.*,
        (SELECT COUNT(*)::int FROM academy_lessons l
         WHERE l.teacher_id = t.id AND l.status = 'scheduled' AND l.scheduled_at >= NOW()) AS upcoming_lessons
     FROM academy_teachers t
     WHERE t.status = 'active'
       AND t.course_ids @> $1::jsonb
     ORDER BY upcoming_lessons, t.id`,
    [JSON.stringify([options.courseId])],
  );
  const teacherIds = teachers.map((teacher) => Number(teacher.id));

  const [lessons, groups, demos] = await Promise.all([
    query(
      `SELECT * FROM academy_lessons
       WHERE status <> 'cancelled'
         AND scheduled_at < $2
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $1
         AND (school_id = $3 OR teacher_id = ANY($4::int[]))
         AND ($5::int IS NULL OR id <> $5)`,
      [rangeStart, rangeEnd, options.schoolId, teacherIds, options.excludeLessonId ?? null],
    ),
    query(
      `SELECT * FROM academy_groups
       WHERE status IN ('open', 'in_progress')
         AND (school_id = $1 OR teacher_id = ANY($2::int[]))
         AND ($3::int IS NULL OR id <> $3)`,
      [options.schoolId, teacherIds, options.excludeGroupId ?? null],
    ),
    query(
      `SELECT l.id, l.demo_at, COALESCE(c.lesson_duration_minutes, $4)::int AS duration_minutes
       FROM academy_leads l
       LEFT JOIN academy_courses c ON c.id = COALESCE(l.demo_course_id, l.course_id)
       WHERE l.school_id = $1
         AND l.demo_at >= $2
         AND l.demo_at < $3
         AND COALESCE(l.demo_format, 'offline') <> 'online'
         AND COALESCE(l.demo_attended, false) = false
         AND l.status_code <> 'not_now'
         AND COALESCE(l.is_archived, false) = false
         AND ($5::int IS NULL OR l.id <> $5)`,
      [options.schoolId, rangeStart, rangeEnd, durationMinutes, options.excludeLeadId ?? null],
    ),
  ]);

  const slots = new Map<number, Row>();
  const now = new Date();

  for (let offset = 0; offset < options.days; offset += 1) {
    const date = getZonedDayRange(rangeStart, ACADEMY_TIME_ZONE, offset).start;
    const dateParts = getZonedDateTimeParts(date, ACADEMY_TIME_ZONE);
    const dayOfWeek = academyDayOfWeek(date);

    for (const teacher of teachers) {
      const schoolIds = readJsonArray(teacher.schoolIds).map(Number);
      if (schoolIds.length > 0 && !schoolIds.includes(options.schoolId)) continue;
      const availability = getTeacherAvailability(teacher, durationMinutes)
        .filter((item) => item.dayOfWeek === dayOfWeek
          && (!item.schoolId || item.schoolId === options.schoolId));

      for (const window of availability) {
        for (
          let startMinutes = window.startMinutes;
          startMinutes + durationMinutes <= window.endMinutes;
          startMinutes += 30
        ) {
          const startsAt = zonedWallClockToInstant({
            year: dateParts.year,
            month: dateParts.month,
            day: dateParts.day,
            hour: Math.floor(startMinutes / 60),
            minute: startMinutes % 60,
          }, ACADEMY_TIME_ZONE);
          if (startsAt.getTime() <= now.getTime()) continue;
          const endsAt = addMinutes(startsAt, durationMinutes);
          const slotKey = startsAt.getTime();

          const roomBusyByLesson = lessons.some((lesson) => {
            if (Number(lesson.schoolId) !== options.schoolId) return false;
            const lessonStart = new Date(lesson.scheduledAt);
            const lessonEnd = addMinutes(lessonStart, Number(lesson.durationMinutes || 60));
            return startsAt < lessonEnd && endsAt > lessonStart;
          });
          const roomBusyByDemo = demos.some((demo) => {
            const demoStart = new Date(demo.demoAt);
            const demoEnd = addMinutes(demoStart, Number(demo.durationMinutes || durationMinutes));
            return startsAt < demoEnd && endsAt > demoStart;
          });
          const roomBusyByGroup = groups.some((group) => {
            if (Number(group.schoolId) !== options.schoolId) return false;
            if (!isDateInsideInclusiveDayRange(
              startsAt,
              group.startDate ? new Date(group.startDate) : null,
              group.endDate ? new Date(group.endDate) : null,
            )) return false;
            return scheduleConflictsWithSlot(
              normalizeScheduleItems(group.schedule),
              dayOfWeek,
              startMinutes,
              startMinutes + durationMinutes,
            );
          });
          if (roomBusyByLesson || roomBusyByDemo || roomBusyByGroup) continue;

          const teacherBusyByLesson = lessons.some((lesson) => {
            if (Number(lesson.teacherId) !== Number(teacher.id)) return false;
            const lessonStart = new Date(lesson.scheduledAt);
            const lessonEnd = addMinutes(lessonStart, Number(lesson.durationMinutes || 60));
            return startsAt < lessonEnd && endsAt > lessonStart;
          });
          const teacherBusyByGroup = groups.some((group) => {
            if (Number(group.teacherId) !== Number(teacher.id)) return false;
            if (!isDateInsideInclusiveDayRange(
              startsAt,
              group.startDate ? new Date(group.startDate) : null,
              group.endDate ? new Date(group.endDate) : null,
            )) return false;
            return scheduleConflictsWithSlot(
              normalizeScheduleItems(group.schedule),
              dayOfWeek,
              startMinutes,
              startMinutes + durationMinutes,
            );
          });
          if (teacherBusyByLesson || teacherBusyByGroup) continue;

          const existing = slots.get(slotKey);
          if (existing) {
            existing.availableTeacherCount += 1;
          } else {
            slots.set(slotKey, {
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              teacherId: Number(teacher.id),
              teacherName: teacher.fullName,
              availableTeacherCount: 1,
            });
          }
        }
      }
    }
  }

  return {
    school: { id: Number(school.id), name: school.name },
    course: { id: Number(course.id), name: course.name },
    durationMinutes,
    from: rangeStart.toISOString(),
    days: options.days,
    slots: [...slots.values()]
      .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
      .slice(0, 250),
  };
};

const assertBookableOfflineSlot = async (options: {
  schoolId: number;
  courseId: number;
  startsAt: Date;
  excludeLeadId?: number | null;
  excludeGroupId?: number | null;
  excludeLessonId?: number | null;
}) => {
  const result = await listAvailableSchoolSlots({
    schoolId: options.schoolId,
    courseId: options.courseId,
    from: startOfAcademyDay(options.startsAt),
    days: 1,
    excludeLeadId: options.excludeLeadId,
    excludeGroupId: options.excludeGroupId,
    excludeLessonId: options.excludeLessonId,
  });
  const selected = result.slots.find((slot) =>
    new Date(slot.startsAt).getTime() === options.startsAt.getTime()
  );
  if (!selected) {
    throw Object.assign(new Error('slotUnavailable'), { statusCode: 409 });
  }
  return selected;
};

// Template source prefixes from TZ 1.2: the suffix is filled from campaign/referrer name.
const TEMPLATE_SOURCE_PREFIXES = ['instagram_ad', 'blogger', 'school', 'event', 'referral'];

const buildTemplateSourceCode = (prefix: string, suffix: string) => {
  const slug = suffix
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9А-Яа-я]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return slug ? `${prefix}_${slug}` : prefix;
};

const assertValidReferrerStudent = async (
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

const findOrCreateActiveSource = async (values: {
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

const resolveSourceId = async (body: Row, validatedReferrer?: Row | null) => {
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

const resolveCourseByAge = async (age?: number | null) => {
  const slug = suggestCourseSlugByAge(age);
  if (!slug) return null;
  const course = await queryOne(`SELECT * FROM academy_courses WHERE slug = $1`, [slug]);
  return course ?? null;
};

const findDuplicate = async (
  phones: NormalizedLeadPhone[] = [],
  messenger?: string | null,
  options: { excludeLeadId?: number | null } = {},
) => {
  const normalizedPhones = phoneValues(phones);
  if (normalizedPhones.length === 0 && !messenger) return null;
  const excludeLeadId = options.excludeLeadId ?? null;

  const duplicateLead = await queryOne(
    `SELECT 'lead' AS entity_type, l.id, l.contact_name AS name, l.phone, l.messenger,
        l.status_code, l.manager_id, u.full_name AS manager_name,
        ${leadPhoneNumbersSelect('l')}
     FROM academy_leads l
     LEFT JOIN users u ON u.id = l.manager_id
     WHERE ($3::int IS NULL OR l.id <> $3)
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
     LIMIT 1`,
    [normalizedPhones.length > 0 ? normalizedPhones : null, messenger ?? null, excludeLeadId],
  );
  if (duplicateLead) return duplicateLead;

  return queryOne(
    `SELECT 'student' AS entity_type, id, lead_id, student_name AS name, phone, messenger
     FROM academy_students
     WHERE ($3::int IS NULL OR lead_id IS DISTINCT FROM $3)
       AND (
         ($1::text[] IS NOT NULL AND phone = ANY($1::text[]))
         OR (
           $2::text IS NOT NULL
           AND LOWER(BTRIM(messenger)) = LOWER(BTRIM($2))
         )
       )
     LIMIT 1`,
    [normalizedPhones.length > 0 ? normalizedPhones : null, messenger ?? null, excludeLeadId],
  );
};

const getLead = (id: number) =>
  queryOne(
    `SELECT l.*, c.name AS course_name, s.name AS source_name, s.channel AS source_channel, sc.name AS school_name,
        u.full_name AS manager_name,
        archived_by_user.full_name AS archived_by_name,
        ${leadPhoneNumbersSelect('l')}
     FROM academy_leads l
     LEFT JOIN academy_courses c ON c.id = l.course_id
     LEFT JOIN academy_lead_sources s ON s.id = l.source_id
     LEFT JOIN academy_schools sc ON sc.id = l.school_id
     LEFT JOIN users u ON u.id = l.manager_id
     LEFT JOIN users archived_by_user ON archived_by_user.id = l.archived_by
     WHERE l.id = $1`,
    [id],
  );

const createStageHistory = async (leadId: number, fromStatusCode: string | null, toStatusCode: string, changedBy: number, comment?: string | null) =>
  insertRow('academy_lead_stage_history', {
    leadId,
    fromStatusCode,
    toStatusCode,
    changedBy,
    comment: comment ?? null });

const leadContactSummary = (lead: Row) =>
  [lead.contactName, lead.phone || lead.phoneNumbers?.[0] || lead.messenger || 'без телефона'].filter(Boolean).join(': ');

const getActiveSalesManager = async (managerId: number, lockForAssignment = false) => {
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

const syncLeadManagerAssignment = async (
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
  await insertRow('academy_lead_assignment_history', {
    leadId: lead.id,
    fromManagerId: lead.managerId ?? null,
    toManagerId: manager.id,
    changedBy: req.user!.id,
    comment: comment ?? null,
  });
};

const reassignLead = async (
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

const buildLeadStageDurations = (history: Row[]) => {
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

const ensureGroupCapacity = async (groupId?: number | null, excludeLeadId?: number | null) => {
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
     LEFT JOIN academy_students s ON s.group_id = g.id AND s.status = 'studying'
     LEFT JOIN academy_leads reserved
      ON reserved.enrolled_group_id = g.id
      AND reserved.status_code <> 'not_now'
      AND COALESCE(reserved.is_archived, false) = false
      AND ($2::int IS NULL OR reserved.id <> $2)
      AND NOT EXISTS (
        SELECT 1 FROM academy_students existing_student WHERE existing_student.lead_id = reserved.id
      )
     WHERE g.id = $1
     GROUP BY g.id`,
    [groupId, excludeLeadId ?? null],
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

const validateEnrollmentGroup = async (
  groupId?: number | null,
  excludeLeadId?: number | null,
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
  await ensureGroupCapacity(groupId, excludeLeadId);
  return group;
};

const recalculateStudentMetrics = async (studentId: number) => {
  const student = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
  if (!student?.groupId) return;

  const latestGroupEntry = await queryOne<{ createdAt: Date }>(
    `SELECT created_at
     FROM academy_student_transfers
     WHERE student_id = $1 AND to_group_id = $2
     ORDER BY created_at DESC
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

const advanceStudentNextPaymentAt = async (
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

const createStudentFromLead = async (req: any, leadId: number, paymentId?: number | null): Promise<Row> => {
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

  const existingStudent = await queryOne(`SELECT * FROM academy_students WHERE lead_id = $1 FOR UPDATE`, [leadId]);
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

  await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [lead.enrolledGroupId]);
  const enrolledGroup = await validateEnrollmentGroup(Number(lead.enrolledGroupId), lead.id);

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

const ensureReferralBenefit = async (options: {
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

const consumeReferralBenefit = async (
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

const ensureFreeMonthBenefit = async (req: any, options: {
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
const applyReferralRewards = async (req: any, studentId: number, leadId: number | null, paymentId: number) => {
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

const handleLeadAutomation = async (req: any, lead: Row, previousStatus?: string | null) => {
  const managerId = lead.managerId ?? req.user!.id;
  const now = new Date();

  if (lead.statusCode === 'new_request') {
    await createTask('Первый контакт по новой заявке', {
      responsibleId: managerId,
      deadlineAt: addMinutes(now, 15),
      entityType: 'lead',
      entityId: lead.id,
      description: 'Связаться с лидом в течение 15 минут после заявки.' });
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

  if (lead.statusCode === 'demo_attended') {
    await createTask('Follow-up после демо', {
      responsibleId: managerId,
      deadlineAt: addMinutes(now, 240),
      entityType: 'lead',
      entityId: lead.id,
      description: 'Связаться через 2-4 часа после демо и зафиксировать результат.' });
  }

  if (lead.statusCode === 'offer') {
    await createTask('Проверить ответ на предложение', {
      responsibleId: managerId,
      deadlineAt: addDays(now, 3),
      entityType: 'lead',
      entityId: lead.id,
      description: 'Если нет ответа 3 дня, сделать повторный контакт.' });
  }

  if (lead.statusCode === 'thinking') {
    await createTask('Напоминание: лид думает 3 дня', {
      responsibleId: managerId,
      deadlineAt: addDays(now, 3),
      entityType: 'lead',
      entityId: lead.id });
    await createTask('Повторное напоминание: лид думает 7 дней', {
      responsibleId: managerId,
      deadlineAt: addDays(now, 7),
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

interface DatasetActor {
  userId: number;
  workspace: string;
  workspaces?: string[];
  scopeWorkspace?: 'sales' | 'teacher' | 'marketing';
}

const resolveTeacherId = async (userId: number): Promise<number | null> => {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM academy_teachers WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );
  return row ? Number(row.id) : null;
};

const getAcademyDataset = async (actor?: DatasetActor) => {
  // Workspace scoping: teachers see only their own groups; sales employees see only
  // their own leads/students; marketing receives its workspace dataset.
  const actorWorkspaces = getAssignedWorkspaces(actor);
  // Entering the teacher workspace is an explicit context switch. It must
  // always resolve to the actor's teacher profile, even when that user also
  // has administration/leadership permissions.
  const shouldScopeToTeacher = actor?.scopeWorkspace === 'teacher';
  const teacherId = shouldScopeToTeacher
    ? await resolveTeacherId(actor.userId)
    : null;
  // A missing teacher profile must fail closed. Treating a null mapping as an
  // unscoped dataset would expose every teacher's groups and students.
  const isTeacherScoped = shouldScopeToTeacher;
  const isManagerScoped =
    actor?.scopeWorkspace === 'sales' &&
    actorWorkspaces.includes('sales') &&
    !hasLeadershipAccess(actor);

  const managerParams = isManagerScoped ? [actor!.userId] : [];

  const [
    schools,
    rooms,
    courses,
    sources,
    statuses,
    teachers,
    groups,
    leads,
    archivedLeads,
    students,
    lessons,
    attendance,
    payments,
    tasks,
    lessonSurveys,
    parentSurveys,
    expenses,
    projects,
    referrals,
    referralBenefits,
  ] = await Promise.all([
    query(`SELECT * FROM academy_schools ORDER BY is_active DESC, name`),
    query(`SELECT * FROM academy_rooms ORDER BY school_id, is_active DESC, name`),
    query(`SELECT * FROM academy_courses ORDER BY name`),
    query(`SELECT * FROM academy_lead_sources ORDER BY name`),
    query(`SELECT * FROM academy_lead_statuses ORDER BY sort_order`),
    isTeacherScoped
      ? query(`SELECT * FROM academy_teachers WHERE id = $1 ORDER BY full_name`, [teacherId])
      : query(`SELECT * FROM academy_teachers ORDER BY full_name`),
    isTeacherScoped
      ? query(`SELECT g.*, c.name AS course_name, t.full_name AS teacher_name,
          sc.name AS school_name, r.name AS room_name,
          (SELECT COUNT(*)::int FROM academy_students s WHERE s.group_id = g.id AND s.status = 'studying') AS current_students,
          (SELECT COUNT(*)::int FROM academy_leads l
           WHERE l.enrolled_group_id = g.id
             AND l.status_code <> 'not_now'
             AND COALESCE(l.is_archived, false) = false
             AND NOT EXISTS (SELECT 1 FROM academy_students st WHERE st.lead_id = l.id)) AS reserved_students
          FROM academy_groups g
          LEFT JOIN academy_courses c ON c.id = g.course_id
          LEFT JOIN academy_teachers t ON t.id = g.teacher_id
          LEFT JOIN academy_schools sc ON sc.id = g.school_id
          LEFT JOIN academy_rooms r ON r.id = g.room_id
          WHERE g.teacher_id = $1
          ORDER BY g.created_at DESC`, [teacherId])
      : query(`SELECT g.*, c.name AS course_name, t.full_name AS teacher_name,
          sc.name AS school_name, r.name AS room_name,
          (SELECT COUNT(*)::int FROM academy_students s WHERE s.group_id = g.id AND s.status = 'studying') AS current_students,
          (SELECT COUNT(*)::int FROM academy_leads l
           WHERE l.enrolled_group_id = g.id
             AND l.status_code <> 'not_now'
             AND COALESCE(l.is_archived, false) = false
             AND NOT EXISTS (SELECT 1 FROM academy_students st WHERE st.lead_id = l.id)) AS reserved_students
          FROM academy_groups g
          LEFT JOIN academy_courses c ON c.id = g.course_id
          LEFT JOIN academy_teachers t ON t.id = g.teacher_id
          LEFT JOIN academy_schools sc ON sc.id = g.school_id
          LEFT JOIN academy_rooms r ON r.id = g.room_id
          ORDER BY g.created_at DESC`),
    query(`SELECT l.*, c.name AS course_name, s.name AS source_name, s.channel AS source_channel, u.full_name AS manager_name,
        sc.name AS school_name, archived_by_user.full_name AS archived_by_name,
        ${leadPhoneNumbersSelect('l')}
      FROM academy_leads l
      LEFT JOIN academy_courses c ON c.id = l.course_id
      LEFT JOIN academy_lead_sources s ON s.id = l.source_id
      LEFT JOIN users u ON u.id = l.manager_id
      LEFT JOIN academy_schools sc ON sc.id = l.school_id
      LEFT JOIN users archived_by_user ON archived_by_user.id = l.archived_by
      WHERE COALESCE(l.is_archived, false) = false ${isManagerScoped ? 'AND (l.manager_id = $1 OR l.manager_id IS NULL)' : ''} ${isTeacherScoped ? 'AND FALSE' : ''}
      ORDER BY l.created_at DESC`, managerParams),
    isTeacherScoped
      ? Promise.resolve([])
      : query(`SELECT l.*, c.name AS course_name, s.name AS source_name, s.channel AS source_channel, u.full_name AS manager_name,
          sc.name AS school_name, archived_by_user.full_name AS archived_by_name,
          ${leadPhoneNumbersSelect('l')}
        FROM academy_leads l
        LEFT JOIN academy_courses c ON c.id = l.course_id
        LEFT JOIN academy_lead_sources s ON s.id = l.source_id
        LEFT JOIN users u ON u.id = l.manager_id
        LEFT JOIN academy_schools sc ON sc.id = l.school_id
        LEFT JOIN users archived_by_user ON archived_by_user.id = l.archived_by
        WHERE COALESCE(l.is_archived, false) = true
        ORDER BY l.archived_at DESC NULLS LAST, l.updated_at DESC`),
    query(`SELECT st.*, c.name AS course_name, g.name AS group_name, u.full_name AS manager_name,
        sc.name AS school_name,
        (
          SELECT CASE
            WHEN p.status = 'pending' AND p.due_at IS NOT NULL AND p.due_at < NOW() THEN 'overdue'
            ELSE p.status
          END
          FROM academy_payments p
          WHERE p.student_id = st.id
          ORDER BY p.created_at DESC
          LIMIT 1
        ) AS payment_status
      FROM academy_students st
      LEFT JOIN academy_courses c ON c.id = st.course_id
      LEFT JOIN academy_groups g ON g.id = st.group_id
      LEFT JOIN users u ON u.id = st.manager_id
      LEFT JOIN academy_schools sc ON sc.id = st.school_id
      WHERE 1=1 ${isManagerScoped ? 'AND st.manager_id = $1' : ''} ${isTeacherScoped ? 'AND st.group_id IN (SELECT id FROM academy_groups WHERE teacher_id = $1)' : ''}
      ORDER BY st.created_at DESC`, isTeacherScoped ? [teacherId] : managerParams),
    query(`SELECT l.*, g.name AS group_name, t.full_name AS teacher_name, c.name AS course_name,
        sc.name AS school_name
      FROM academy_lessons l
      LEFT JOIN academy_groups g ON g.id = l.group_id
      LEFT JOIN academy_teachers t ON t.id = l.teacher_id
      LEFT JOIN academy_courses c ON c.id = l.course_id
      LEFT JOIN academy_schools sc ON sc.id = l.school_id
      LEFT JOIN academy_rooms r ON r.id = l.room_id
      WHERE 1=1 ${isTeacherScoped ? 'AND l.teacher_id = $1' : ''}
      ORDER BY l.scheduled_at DESC`, isTeacherScoped ? [teacherId] : []),
    query(`SELECT a.*
      FROM academy_attendance a
      JOIN academy_lessons l ON l.id = a.lesson_id
      WHERE l.status = 'conducted' ${isTeacherScoped ? 'AND l.teacher_id = $1' : ''}`,
    isTeacherScoped ? [teacherId] : []),
    query(`SELECT p.*, st.student_name, l.contact_name AS lead_name
      FROM academy_payments p
      LEFT JOIN academy_students st ON st.id = p.student_id
      LEFT JOIN academy_leads l ON l.id = p.lead_id
      WHERE 1=1
        ${isManagerScoped ? 'AND (st.manager_id = $1 OR p.lead_id IN (SELECT id FROM academy_leads WHERE manager_id = $1))' : ''}
        ${isTeacherScoped ? 'AND FALSE' : ''}
      ORDER BY p.created_at DESC`, isTeacherScoped ? [] : managerParams),
    query(`SELECT t.*, u.full_name AS responsible_name
      FROM academy_tasks t
      LEFT JOIN users u ON u.id = t.responsible_id
      WHERE 1=1 ${isManagerScoped || isTeacherScoped ? 'AND t.responsible_id = $1' : ''}
      ORDER BY COALESCE(t.deadline_at, t.created_at)`,
    isTeacherScoped ? [actor!.userId] : managerParams),
    isTeacherScoped
      ? query(`SELECT ls.*, st.student_name, l.topic AS lesson_topic, g.name AS group_name
        FROM academy_lesson_surveys ls
        JOIN academy_lessons l ON l.id = ls.lesson_id
        LEFT JOIN academy_students st ON st.id = ls.student_id
        LEFT JOIN academy_groups g ON g.id = ls.group_id
        WHERE l.teacher_id = $1
        ORDER BY ls.created_at DESC`, [teacherId])
      : query(`SELECT ls.*, st.student_name, l.topic AS lesson_topic, g.name AS group_name
        FROM academy_lesson_surveys ls
        LEFT JOIN academy_students st ON st.id = ls.student_id
        LEFT JOIN academy_lessons l ON l.id = ls.lesson_id
        LEFT JOIN academy_groups g ON g.id = ls.group_id
        ORDER BY ls.created_at DESC`),
    isTeacherScoped
      ? query(`SELECT ps.*
        FROM academy_parent_surveys ps
        JOIN academy_students st ON st.id = ps.student_id
        JOIN academy_groups g ON g.id = st.group_id
        WHERE g.teacher_id = $1
        ORDER BY ps.created_at DESC`, [teacherId])
      : isManagerScoped
        ? query(`SELECT ps.*
          FROM academy_parent_surveys ps
          JOIN academy_students st ON st.id = ps.student_id
          WHERE st.manager_id = $1
          ORDER BY ps.created_at DESC`, managerParams)
        : query(`SELECT * FROM academy_parent_surveys ORDER BY created_at DESC`),
    isManagerScoped || isTeacherScoped
      ? Promise.resolve([])
      : query(`SELECT * FROM academy_marketing_expenses WHERE status = 'approved' ORDER BY period_start DESC`),
    isTeacherScoped
      ? query(`SELECT p.*
        FROM academy_portfolio_projects p
        JOIN academy_groups g ON g.id = p.group_id
        WHERE g.teacher_id = $1
        ORDER BY p.created_at DESC`, [teacherId])
      : isManagerScoped
        ? query(`SELECT p.*
          FROM academy_portfolio_projects p
          JOIN academy_students st ON st.id = p.student_id
          WHERE st.manager_id = $1
          ORDER BY p.created_at DESC`, managerParams)
        : query(`SELECT * FROM academy_portfolio_projects ORDER BY created_at DESC`),
    isManagerScoped
      ? query(`SELECT rr.*
        FROM academy_referral_rewards rr
        LEFT JOIN academy_students referrer ON referrer.id = rr.referrer_student_id
        LEFT JOIN academy_students referred ON referred.id = rr.referred_student_id
        WHERE referrer.manager_id = $1 OR referred.manager_id = $1
        ORDER BY rr.created_at DESC`, managerParams)
      : isTeacherScoped
        ? Promise.resolve([])
        : query(`SELECT * FROM academy_referral_rewards ORDER BY created_at DESC`),
    isManagerScoped
      ? query(`SELECT benefit.*
        FROM academy_referral_benefits benefit
        JOIN academy_students student ON student.id = benefit.student_id
        WHERE student.manager_id = $1
        ORDER BY benefit.created_at DESC`, managerParams)
      : isTeacherScoped
        ? Promise.resolve([])
        : query(`SELECT * FROM academy_referral_benefits ORDER BY created_at DESC`),
  ]);

  const [visibleLeads, visibleArchivedLeads] = await Promise.all([
    redactLeadPhonesForActor(actor, leads),
    redactLeadPhonesForActor(actor, archivedLeads),
  ]);
  return {
    schools,
    rooms,
    courses,
    sources,
    statuses,
    teachers,
    groups,
    leads: visibleLeads,
    archivedLeads: visibleArchivedLeads,
    students,
    lessons,
    attendance,
    payments,
    tasks,
    lessonSurveys,
    parentSurveys,
    expenses,
    projects,
    referrals,
    referralBenefits,
  };
};

const getValidDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const expenseAmountInsidePeriod = (
  expense: Row,
  periodStart: Date,
  periodEndExclusive: Date,
): number => {
  const rawExpenseStart = getValidDate(expense.periodStart);
  const rawExpenseEnd = getValidDate(expense.periodEnd);
  if (!rawExpenseStart || !rawExpenseEnd || rawExpenseEnd < rawExpenseStart) return 0;

  // Marketing expense periods are inclusive calendar dates. Converting the end
  // to an exclusive boundary makes overlapping multi-month expenses contribute
  // proportionally instead of being counted in full in every touched month.
  // These date-only fields are stored as UTC-naive timestamps; map their UTC
  // YYYY-MM-DD fields back to Tashkent midnights before comparing periods.
  const expenseStart = getZonedDateOnlyRange(rawExpenseStart, ACADEMY_TIME_ZONE).start;
  const expenseEndExclusive = getZonedDateOnlyRange(rawExpenseEnd, ACADEMY_TIME_ZONE).end;
  const overlapStart = Math.max(expenseStart.getTime(), periodStart.getTime());
  const overlapEnd = Math.min(expenseEndExclusive.getTime(), periodEndExclusive.getTime());
  if (overlapEnd <= overlapStart) return 0;

  const expenseDuration = expenseEndExclusive.getTime() - expenseStart.getTime();
  if (expenseDuration <= 0) return 0;
  return Number(expense.amountUzs || 0) * ((overlapEnd - overlapStart) / expenseDuration);
};

const hasStudentRiskFlag = (student: Row, flag: string) => {
  if (Array.isArray(student.riskFlags)) return student.riskFlags.includes(flag);
  if (typeof student.riskFlags !== 'string') return false;
  try {
    const parsed = JSON.parse(student.riskFlags);
    return Array.isArray(parsed) && parsed.includes(flag);
  } catch {
    return false;
  }
};

const buildAnalytics = async () => {
  const [data, companySettings] = await Promise.all([getAcademyDataset(), getCompanySettings()]);
  const targets = toAnalyticsTargets(companySettings);
  const now = new Date();
  const weekStart = addDays(now, -7);
  const { start: monthStart, end: nextMonthStart } = getZonedMonthRange(
    now,
    ACADEMY_TIME_ZONE,
  );

  const paidPayments = data.payments.filter((payment) => getComputedPaymentStatus(payment.status, payment.dueAt) === 'paid');
  const studentById = new Map(data.students.map((student) => [Number(student.id), student]));
  const leadById = new Map(data.leads.map((lead) => [Number(lead.id), lead]));
  const leadIdForPayment = (payment: Row): number | null => {
    const directLeadId = Number(payment.leadId);
    if (Number.isInteger(directLeadId) && directLeadId > 0) return directLeadId;
    const studentId = Number(payment.studentId);
    const studentLeadId = Number(studentById.get(studentId)?.leadId);
    return Number.isInteger(studentLeadId) && studentLeadId > 0 ? studentLeadId : null;
  };
  const customerKeyForPayment = (payment: Row): string | null => {
    const leadId = leadIdForPayment(payment);
    if (leadId) return `lead:${leadId}`;
    const studentId = Number(payment.studentId);
    return Number.isInteger(studentId) && studentId > 0 ? `student:${studentId}` : null;
  };
  const firstPaidAtByCustomer = new Map<string, Date>();
  const paidLeadIds = new Set<number>();
  const paidStudentIds = new Set<number>();
  for (const payment of paidPayments) {
    const leadId = leadIdForPayment(payment);
    if (leadId && leadById.has(leadId)) paidLeadIds.add(leadId);
    const studentId = Number(payment.studentId);
    if (Number.isInteger(studentId) && studentId > 0) paidStudentIds.add(studentId);
    const customerKey = customerKeyForPayment(payment);
    const paidAt = getValidDate(payment.paidAt);
    if (!customerKey || !paidAt) continue;
    const previous = firstPaidAtByCustomer.get(customerKey);
    if (!previous || paidAt < previous) firstPaidAtByCustomer.set(customerKey, paidAt);
  }
  const newPaidCustomersThisMonth = new Set(
    [...firstPaidAtByCustomer.entries()]
      .filter(([, paidAt]) => paidAt >= monthStart && paidAt < nextMonthStart)
      .map(([customerKey]) => customerKey),
  );
  const revenueMonth = paidPayments
    .filter((payment) => {
      const paidAt = getValidDate(payment.paidAt);
      return paidAt !== null && paidAt >= monthStart && paidAt < nextMonthStart;
    })
    .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const revenueTotal = paidPayments.reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const avgCheck = calculateAverage(paidPayments.map((payment) => Number(payment.amountUzs || 0))) ?? 0;
  const expensesMonth = data.expenses
    .reduce((sum, expense) => sum + expenseAmountInsidePeriod(expense, monthStart, nextMonthStart), 0);
  const cac = calculateCac(expensesMonth, newPaidCustomersThisMonth.size) ?? 0;
  const roas = calculateRoas(revenueMonth, expensesMonth) ?? 0;
  const ltvByStudent = data.students.map((student) => ({
    studentId: student.id,
    ltv: calculateLtv(paidPayments
      .filter((payment) => Number(payment.studentId) === Number(student.id))
      .map((payment) => Number(payment.amountUzs || 0))) }));
  const averageLtv = calculateAverage(ltvByStudent.map((item) => item.ltv)) ?? 0;
  const overduePayments = data.payments.filter((payment) => getComputedPaymentStatus(payment.status, payment.dueAt) === 'overdue');
  const overdueTasks = data.tasks.filter((task) => task.status !== 'done' && task.deadlineAt && new Date(task.deadlineAt) < now);
  const activeStudentsWithAttendance = data.students.filter((student) => (
    student.status === 'studying'
    && (
      Number(student.attendancePercent || 0) > 0
      || hasStudentRiskFlag(student, 'attendance_below_70')
    )
  ));
  const lowAttendanceStudents = data.students.filter((student) => (
    student.status === 'studying'
    && (
      hasStudentRiskFlag(student, 'attendance_below_70')
      || (Number(student.attendancePercent || 0) > 0 && Number(student.attendancePercent || 0) < targets.attendance)
    )
  ));
  const lowScores = data.lessonSurveys.filter((survey) => Number(survey.score) < 3);
  const longThinkingLeads = data.leads.filter((lead) =>
    lead.statusCode === 'thinking' && lead.updatedAt && new Date(lead.updatedAt) < addDays(now, -7)
  );
  const nps = calculateNps(data.parentSurveys.map((survey) => Number(survey.npsScore)).filter(Number.isFinite)) ?? 0;
  const churnByReason = data.students
    .filter((student) => ['paused', 'expelled'].includes(String(student.status))
      && student.exitReason
      && student.updatedAt
      && new Date(student.updatedAt) >= monthStart
      && new Date(student.updatedAt) < nextMonthStart)
    .reduce<Record<string, number>>((acc, student) => {
      const reason = String(student.exitReason);
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

  const activePipelineStatuses = [...data.statuses]
    .filter((status) => status.isActive !== false && status.isPipeline !== false)
    .sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder));
  const activePipelineStatusCodes = new Set(activePipelineStatuses.map((status) => String(status.code)));
  const activePipelineStatusIndex = new Map(
    activePipelineStatuses.map((status, index) => [String(status.code), index]),
  );
  const reachedStageCount = (leads: Row[], stageIndex: number) => leads.filter((lead) => {
    const currentIndex = activePipelineStatusIndex.get(String(lead.statusCode));
    return currentIndex !== undefined && currentIndex >= stageIndex;
  }).length;
  // A conversion funnel is cumulative: every lead at a later stage has also
  // reached all earlier stages. Exact-status counts could make a later stage
  // larger than the preceding one and produce conversion above 100%.
  const funnel = activePipelineStatuses.map((status, stageIndex) => ({
    ...status,
    count: reachedStageCount(data.leads, stageIndex) }));
  const funnelBySource = Object.fromEntries(data.sources.map((source) => {
    const sourceLeads = data.leads.filter((lead) => Number(lead.sourceId) === Number(source.id));
    return [String(source.id), activePipelineStatuses.map((status, stageIndex) => ({
      ...status,
      count: reachedStageCount(sourceLeads, stageIndex),
    }))];
  }));

  const groupsWithCapacity = data.groups.map((group) => ({
    ...group,
    currentStudents: Number(group.currentStudents || 0),
    capacityLabel: `${Number(group.currentStudents || 0)}/${Number(group.maxStudents || 12)}`,
    isFull: Number(group.currentStudents || 0) >= Number(group.maxStudents || 12) }));

  const teacherHours = data.lessons
    .filter((lesson) => lesson.status === 'conducted')
    .reduce((sum, lesson) => sum + Number(lesson.durationMinutes || 120) / 60, 0);

  // --- Marketing metrics (TZ 4.2): conversions, CPL, deal cycle, warm-base conversion. ---
  const newRequestCount = data.leads.length;
  const invitedToDemoCount = data.leads.filter((lead) =>
    ['demo_invited', 'demo_attended', 'offer', 'thinking', 'enrolled', 'paid'].includes(lead.statusCode)
    || lead.demoAttended).length;
  const paidAfterDemoCount = data.leads.filter((lead) =>
    paidLeadIds.has(Number(lead.id))
    && (['demo_invited', 'demo_attended', 'offer', 'thinking', 'enrolled', 'paid'].includes(lead.statusCode)
      || lead.demoAttended),
  ).length;
  const leadToDemoConversion = newRequestCount > 0 ? Number(((invitedToDemoCount / newRequestCount) * 100).toFixed(1)) : 0;
  const demoToPaidConversion = invitedToDemoCount > 0 ? Number(((paidAfterDemoCount / invitedToDemoCount) * 100).toFixed(1)) : 0;
  const leadToPaidConversion = newRequestCount > 0 ? Number(((paidLeadIds.size / newRequestCount) * 100).toFixed(1)) : 0;
  const newLeadsMonth = data.leads.filter((lead) => {
    const createdAt = getValidDate(lead.createdAt);
    return createdAt !== null && createdAt >= monthStart && createdAt < nextMonthStart;
  });
  const cpl = newLeadsMonth.length > 0 ? Math.round(expensesMonth / newLeadsMonth.length) : 0;
  // Average deal cycle (days) from lead creation to first paid payment.
  const firstPaidAtByLead = new Map<number, Date>();
  for (const payment of paidPayments) {
    const leadId = leadIdForPayment(payment);
    const paidAt = getValidDate(payment.paidAt);
    if (!leadId || !paidAt) continue;
    const previous = firstPaidAtByLead.get(leadId);
    if (!previous || paidAt < previous) firstPaidAtByLead.set(leadId, paidAt);
  }
  const dealCycleDays = data.leads
    .map((lead) => {
      const firstPaidAt = firstPaidAtByLead.get(Number(lead.id));
      const createdAt = getValidDate(lead.createdAt);
      if (!firstPaidAt || !createdAt || firstPaidAt < createdAt) return null;
      return (firstPaidAt.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
    })
    .filter((d): d is number => d !== null && Number.isFinite(d));
  const avgDealCycleDays = calculateAvgDealCycleDays(dealCycleDays) ?? 0;
  // Warm-base reactivation: leads that returned from not_now to an active status (via stage history absent here; approximate via current status).
  const warmReactivated = data.leads.filter((lead) => lead.statusCode !== 'not_now' && lead.warmMovedAt).length;

  // --- Operations metrics (TZ 4.3): lesson NPS by teacher/course/group, progress, teacher hours, retention %. ---
  const lessonScores = data.lessonSurveys.map((survey) => Number(survey.score)).filter(Number.isFinite);
  const avgLessonScore = calculateAverage(lessonScores) ?? 0;
  const byTeacher = data.teachers.map((teacher) => {
    const teacherLessons = data.lessons.filter((lesson) => Number(lesson.teacherId) === Number(teacher.id) && lesson.status === 'conducted');
    const teacherSurveys = data.lessonSurveys.filter((survey) => Number(survey.teacherId) === Number(teacher.id));
    const teacherStudents = activeStudentsWithAttendance.filter((student) =>
      data.groups.filter((group) => Number(group.teacherId) === Number(teacher.id))
        .some((group) => Number(group.id) === Number(student.groupId)));
    const scoresByDate = [...teacherSurveys]
      .sort((left, right) => (getValidDate(left.createdAt)?.getTime() ?? 0) - (getValidDate(right.createdAt)?.getTime() ?? 0))
      .map((survey) => Number(survey.score))
      .filter(Number.isFinite);
    return {
      teacherId: teacher.id,
      teacherName: teacher.fullName,
      hours: teacherLessons.reduce((sum, lesson) => sum + Number(lesson.durationMinutes || 120) / 60, 0),
      avgScore: calculateAverage(scoresByDate) ?? 0,
      attendance: calculateAverage(teacherStudents
        .map((student) => Number(student.attendancePercent || 0))
        .filter(Number.isFinite)) ?? 0,
      groupsCount: data.groups.filter((group) => Number(group.teacherId) === Number(teacher.id)).length,
      trend: calculateTrend(scoresByDate),
    };
  });
  const byCourseLessonNps = data.courses.map((course) => {
    const courseSurveys = data.lessonSurveys.filter((survey) => Number(survey.courseId) === Number(course.id));
    const scores = [...courseSurveys]
      .sort((left, right) => (getValidDate(left.createdAt)?.getTime() ?? 0) - (getValidDate(right.createdAt)?.getTime() ?? 0))
      .map((survey) => Number(survey.score))
      .filter(Number.isFinite);
    return {
      courseId: course.id,
      courseName: course.name,
      avgLessonScore: calculateAverage(scores) ?? 0,
      trend: calculateTrend(scores),
      progressAvg: calculateAverage(
        data.students.filter((student) => Number(student.courseId) === Number(course.id) && student.status === 'studying')
          .map((student) => Number(student.progressPercent || 0)).filter(Number.isFinite),
      ) ?? 0,
    };
  });
  const byGroupProgress = data.groups.map((group) => ({
    groupId: group.id,
    groupName: group.name,
    capacity: Number(group.currentStudents || 0),
    maxCapacity: Number(group.maxStudents || 12),
    attendanceAvg: calculateAverage(
      activeStudentsWithAttendance.filter((student) => (
        Number(student.groupId) === Number(group.id)
      ))
        .map((student) => Number(student.attendancePercent || 0)).filter(Number.isFinite),
    ) ?? 0,
    progressAvg: calculateAverage(
      data.students.filter((student) => (
        Number(student.groupId) === Number(group.id) && student.status === 'studying'
      ))
        .map((student) => Number(student.progressPercent || 0)).filter(Number.isFinite),
    ) ?? 0,
  }));

  // --- Retention by course: completed students are successful outcomes, while
  // paused/expelled students represent churn from the enrolled cohort. ---
  const retentionByCourse = data.courses.map((course) => {
    const courseStudents = data.students.filter((student) => Number(student.courseId) === Number(course.id));
    const retainedStudents = courseStudents.filter((student) => (
      student.status === 'studying' || student.status === 'completed'
    ));
    const monthsValues = courseStudents
      .filter((student) => student.enrolledAt)
      .map((student) => (now.getTime() - new Date(student.enrolledAt).getTime()) / (30 * 24 * 60 * 60 * 1000));
    return {
      courseId: course.id,
      courseName: course.name,
      retentionPercent: courseStudents.length > 0
        ? Math.round((retainedStudents.length / courseStudents.length) * 100)
        : 0,
      avgStudyMonths: calculateAvgStudyMonths(monthsValues) ?? 0,
      studentCount: courseStudents.length,
    };
  });

  return {
    summary: {
      newLeadsWeek: data.leads.filter((lead) => new Date(lead.createdAt) >= weekStart).length,
      newLeadsMonth: newLeadsMonth.length,
      activeLeads: data.leads.filter((lead) => activePipelineStatusCodes.has(String(lead.statusCode))).length,
      warmBaseSize: data.leads.filter((lead) => lead.statusCode === 'not_now').length,
      warmReactivated,
      activeStudents: data.students.filter((student) => student.status === 'studying').length,
      revenueMonth,
      revenueTotal,
      avgCheck,
      cac,
      roas,
      cpl,
      averageLtv,
      ltvCac: cac ? Number((averageLtv / cac).toFixed(2)) : 0,
      avgAttendance: calculateAverage(activeStudentsWithAttendance
        .map((student) => Number(student.attendancePercent || 0))
        .filter(Number.isFinite)) ?? 0,
      avgLessonScore,
      nps,
      npsBelowTarget: nps < targets.nps,
      teacherHours,
      avgDealCycleDays,
      leadToDemoConversion,
      demoToPaidConversion,
      leadToPaidConversion,
      overduePayments: overduePayments.length,
      overdueTasks: overdueTasks.length,
      newPaidStudents: newPaidCustomersThisMonth.size },
    funnel,
    funnelBySource,
    groups: groupsWithCapacity,
    risks: {
      lowAttendanceStudents,
      lowScores,
      overduePayments,
      longThinkingLeads,
      overdueTasks },
    byCourse: data.courses.map((course) => {
      const coursePaidCustomers = new Set(paidPayments
        .filter((payment) => {
          const studentCourseId = studentById.get(Number(payment.studentId))?.courseId;
          const leadCourseId = leadById.get(Number(leadIdForPayment(payment)))?.courseId;
          return Number(studentCourseId ?? leadCourseId) === Number(course.id);
        })
        .map(customerKeyForPayment)
        .filter((key): key is string => Boolean(key)));
      const courseExpenses = data.expenses.reduce((sum, expense) => {
        const sourceLeads = data.leads.filter((lead) => Number(lead.sourceId) === Number(expense.sourceId));
        if (sourceLeads.length === 0) return sum;
        const courseLeadCount = sourceLeads.filter((lead) => Number(lead.courseId) === Number(course.id)).length;
        return sum + (Number(expense.amountUzs || 0) * courseLeadCount) / sourceLeads.length;
      }, 0);
      return {
        courseId: course.id,
        courseName: course.name,
        leads: data.leads.filter((lead) => Number(lead.courseId) === Number(course.id)).length,
        students: data.students.filter((student) => Number(student.courseId) === Number(course.id) && student.status === 'studying').length,
        revenue: paidPayments
          .filter((payment) => {
            const studentCourseId = studentById.get(Number(payment.studentId))?.courseId;
            const leadCourseId = leadById.get(Number(leadIdForPayment(payment)))?.courseId;
            return Number(studentCourseId ?? leadCourseId) === Number(course.id);
          })
          .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0),
        averageLtv: calculateAverage(
          ltvByStudent
            .filter((item) => Number(studentById.get(Number(item.studentId))?.courseId) === Number(course.id))
            .map((item) => item.ltv),
        ) ?? 0,
        ltvTargetMinUzs: course.ltvTargetMinUzs,
        ltvTargetMaxUzs: course.ltvTargetMaxUzs,
        cac: calculateCac(courseExpenses, coursePaidCustomers.size) ?? 0 };
    }),
    bySource: data.sources.map((source) => {
      const sourceLeads = data.leads.filter((lead) => Number(lead.sourceId) === Number(source.id));
      const sourceLeadIds = new Set(sourceLeads.map((lead) => Number(lead.id)));
      const sourceStudents = data.students.filter((student) => sourceLeadIds.has(Number(student.leadId)));
      const paidSourceStudents = sourceStudents.filter((student) => paidStudentIds.has(Number(student.id)));
      const paidSourceLeadIds = new Set([...paidLeadIds].filter((leadId) => sourceLeadIds.has(leadId)));
      const sourceRevenue = paidPayments
        .filter((payment) => {
          const leadId = leadIdForPayment(payment);
          return leadId !== null && sourceLeadIds.has(leadId);
        })
        .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
      const sourceExpenses = data.expenses
        .filter((expense) => Number(expense.sourceId) === Number(source.id))
        .reduce((sum, expense) => sum + Number(expense.amountUzs || 0), 0);
      const sourceCac = calculateCac(sourceExpenses, paidSourceLeadIds.size) ?? 0;
      return {
        sourceId: source.id,
        sourceName: source.name,
        leads: sourceLeads.length,
        paidStudents: paidSourceLeadIds.size,
        revenue: sourceRevenue,
        expenses: sourceExpenses,
        cpl: sourceLeads.length > 0 ? Math.round(sourceExpenses / sourceLeads.length) : 0,
        cac: sourceCac,
        roas: calculateRoas(sourceRevenue, sourceExpenses) ?? 0,
        ltvCac: sourceCac ? Number(((calculateAverage(paidSourceStudents.map((student) => ltvByStudent.find((item) => Number(item.studentId) === Number(student.id))?.ltv || 0)) ?? 0) / sourceCac).toFixed(2)) : 0 };
    }),
    byTeacher,
    byCourseLessonNps,
    byGroupProgress,
    retentionByCourse,
    churnByReason,
    targets,
    data };
};

const buildAdministrationDashboard = async () => {
  const [analytics, users, escalatedTasks] = await Promise.all([
    buildAnalytics(),
    storage.getUsers(),
    query(`SELECT t.id, t.title, t.deadline_at, u.full_name AS responsible_name
           FROM academy_tasks t
           LEFT JOIN users u ON u.id = t.responsible_id
           WHERE t.status <> 'done' AND t.escalated_at IS NOT NULL
           ORDER BY t.escalated_at DESC
           LIMIT 20`),
  ]);
  const data = analytics.data;
  const now = new Date();
  const currentMonth = getZonedMonthRange(now, ACADEMY_TIME_ZONE);
  const previousMonth = getZonedMonthRange(now, ACADEMY_TIME_ZONE, -1);
  const currentMonthStart = currentMonth.start;
  const nextMonthStart = currentMonth.end;
  const previousMonthStart = previousMonth.start;
  const activeGroups = data.groups.filter((group) => ['open', 'in_progress'].includes(group.status));
  const activeTeachers = data.teachers.filter((teacher) => teacher.status === 'active');
  const activeUsers = users.filter((user) => user.isActive);
  const onlineUsers = activeUsers.filter((user) => user.isOnline);

  const percentageChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Number((((current - previous) / previous) * 100).toFixed(1));
  };

  const inRange = (value: unknown, start: Date, end: Date) => {
    if (!value) return false;
    const date = new Date(String(value));
    return !Number.isNaN(date.getTime()) && date >= start && date < end;
  };

  const paidPayments = data.payments.filter(
    (payment) => getComputedPaymentStatus(payment.status, payment.dueAt) === 'paid' && payment.paidAt,
  );
  const currentMonthRevenue = paidPayments
    .filter((payment) => inRange(payment.paidAt, currentMonthStart, nextMonthStart))
    .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const previousMonthRevenue = paidPayments
    .filter((payment) => inRange(payment.paidAt, previousMonthStart, currentMonthStart))
    .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const currentMonthLeads = data.leads.filter(
    (lead) => inRange(lead.createdAt, currentMonthStart, nextMonthStart),
  ).length;
  const previousMonthLeads = data.leads.filter(
    (lead) => inRange(lead.createdAt, previousMonthStart, currentMonthStart),
  ).length;
  const currentMonthStudents = data.students.filter(
    (student) => inRange(student.enrolledAt || student.createdAt, currentMonthStart, nextMonthStart),
  ).length;
  const previousMonthStudents = data.students.filter(
    (student) => inRange(student.enrolledAt || student.createdAt, previousMonthStart, currentMonthStart),
  ).length;

  const monthRanges = getTrailingZonedMonthRanges(now, ACADEMY_TIME_ZONE, 6);
  const trends = monthRanges.map(({ start, end, key }) => {
    return {
      month: key,
      revenue: paidPayments
        .filter((payment) => inRange(payment.paidAt, start, end))
        .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0),
      students: data.students.filter(
        (student) => inRange(student.enrolledAt || student.createdAt, start, end),
      ).length,
      leads: data.leads.filter((lead) => inRange(lead.createdAt, start, end)).length,
    };
  });

  const courseLoad = data.courses
    .map((course) => {
      const courseGroups = activeGroups.filter((group) => Number(group.courseId) === Number(course.id));
      const capacity = courseGroups.reduce((sum, group) => sum + Number(group.maxStudents || 0), 0);
      const students = data.students.filter(
        (student) => Number(student.courseId) === Number(course.id) && student.status === 'studying',
      ).length;
      return {
        courseId: course.id,
        courseName: course.name,
        groups: courseGroups.length,
        students,
        capacity,
        loadPercent: capacity > 0 ? Math.min(100, Math.round((students / capacity) * 100)) : 0,
      };
    })
    .filter((course) => course.groups > 0 || course.students > 0)
    .sort((left, right) => right.students - left.students)
    .slice(0, 6);

  const today = getZonedDayRange(now, ACADEMY_TIME_ZONE);
  const tomorrow = getZonedDayRange(now, ACADEMY_TIME_ZONE, 1);
  const nonCancelledLessons = data.lessons.filter((lesson) =>
    lesson.status !== 'cancelled' && getValidDate(lesson.scheduledAt));
  const scheduledLessons = nonCancelledLessons.filter((lesson) =>
    lesson.status === 'scheduled' && new Date(lesson.scheduledAt) >= now);
  const upcomingLessons = [...scheduledLessons]
    .sort((left, right) =>
      new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime())
    .slice(0, 5)
    .map((lesson) => ({
      id: lesson.id,
      topic: lesson.topic,
      groupName: lesson.groupName,
      courseName: lesson.courseName,
      teacherName: lesson.teacherName,
      schoolName: lesson.schoolName,
      scheduledAt: lesson.scheduledAt,
    }));

  const recentActivity = [
    ...data.payments
      .filter((payment) => payment.status === 'paid' && payment.paidAt)
      .map((payment) => ({
        id: `payment-${payment.id}`,
        type: 'payment',
        occurredAt: payment.paidAt,
        subject: payment.studentName || payment.leadName,
        amountUzs: Number(payment.amountUzs || 0),
      })),
    ...data.leads.map((lead) => ({
      id: `lead-${lead.id}`,
      type: 'lead',
      occurredAt: lead.createdAt,
      subject: lead.contactName,
      meta: lead.courseName,
    })),
    ...data.students.map((student) => ({
      id: `student-${student.id}`,
      type: 'student',
      occurredAt: student.enrolledAt || student.createdAt,
      subject: student.studentName || student.contactName,
      meta: student.courseName,
    })),
    ...data.groups.map((group) => ({
      id: `group-${group.id}`,
      type: 'group',
      occurredAt: group.createdAt,
      subject: group.name,
      meta: group.courseName,
    })),
  ]
    .filter((item) => item.occurredAt)
    .sort((left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, 6);

  const overdueAmount = analytics.risks.overduePayments.reduce(
    (sum: number, payment: Row) => sum + Number(payment.amountUzs || 0),
    0,
  );
  const groupsWithoutTeacher = activeGroups.filter((group) => !group.teacherId).length;
  const totalActiveCapacity = activeGroups.reduce(
    (sum, group) => sum + Number(group.maxStudents || 0),
    0,
  );
  const occupiedActiveSeats = activeGroups.reduce(
    (sum, group) => sum + Number(group.currentStudents || 0),
    0,
  );
  const churnByReason = data.students
    .filter((student) => ['paused', 'expelled'].includes(String(student.status))
      && student.exitReason
      && inRange(student.updatedAt, currentMonthStart, nextMonthStart))
    .reduce<Record<string, number>>((acc, student) => {
      const reason = String(student.exitReason);
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

  return {
    summary: {
      ...analytics.summary,
      activeGroups: activeGroups.length,
      activeTeachers: activeTeachers.length,
      activeUsers: activeUsers.length,
      totalUsers: users.length,
      onlineUsers: onlineUsers.length,
      newStudentsMonth: currentMonthStudents,
      groupLoadPercent: totalActiveCapacity > 0
        ? Math.min(100, Math.round((occupiedActiveSeats / totalActiveCapacity) * 100))
        : 0,
      lessonsToday: nonCancelledLessons.filter((lesson) =>
        inRange(lesson.scheduledAt, today.start, today.end)).length,
      lessonsTomorrow: nonCancelledLessons.filter((lesson) =>
        inRange(lesson.scheduledAt, tomorrow.start, tomorrow.end)).length,
      revenueChangePercent: percentageChange(currentMonthRevenue, previousMonthRevenue),
      leadsChangePercent: percentageChange(currentMonthLeads, previousMonthLeads),
      studentsChangePercent: percentageChange(currentMonthStudents, previousMonthStudents),
      overdueAmount,
      groupsWithoutTeacher,
    },
    trends,
    funnel: analytics.funnel,
    courseLoad,
    targets: analytics.targets,
    alerts: {
      overduePayments: analytics.risks.overduePayments.length,
      lowAttendanceStudents: analytics.risks.lowAttendanceStudents.length,
      overdueTasks: escalatedTasks.length,
      longThinkingLeads: analytics.risks.longThinkingLeads.length,
      groupsWithoutTeacher,
    },
    recentActivity,
    upcomingLessons,
    churnByReason,
    escalatedTasks,
    generatedAt: now.toISOString(),
  };
};

const getMarketingWorkspaceDataset = async () => {
  const [sources, leads, students, expenses, referrals, referralBenefits] = await Promise.all([
    query(`SELECT * FROM academy_lead_sources ORDER BY name`),
    query(`SELECT l.*, c.name AS course_name, s.name AS source_name, s.channel AS source_channel, u.full_name AS manager_name
      FROM academy_leads l
      LEFT JOIN academy_courses c ON c.id = l.course_id
      LEFT JOIN academy_lead_sources s ON s.id = l.source_id
      LEFT JOIN users u ON u.id = l.manager_id
      WHERE COALESCE(l.is_archived, false) = false
      ORDER BY l.created_at DESC`),
    query(`SELECT id, student_name, contact_name, referral_code, referral_level
      FROM academy_students
      ORDER BY created_at DESC`),
    query(`SELECT * FROM academy_marketing_expenses ORDER BY period_start DESC`),
    query(`SELECT * FROM academy_referral_rewards ORDER BY created_at DESC`),
    query(`SELECT * FROM academy_referral_benefits ORDER BY created_at DESC`),
  ]);

  return { sources, leads, students, expenses, referrals, referralBenefits };
};

const buildMarketingAnalyticsPayload = (analytics: Row) => ({
  summary: {
    newLeadsWeek: analytics.summary.newLeadsWeek,
    newLeadsMonth: analytics.summary.newLeadsMonth,
    warmBaseSize: analytics.summary.warmBaseSize,
    warmReactivated: analytics.summary.warmReactivated,
    leadToDemoConversion: analytics.summary.leadToDemoConversion,
    demoToPaidConversion: analytics.summary.demoToPaidConversion,
    leadToPaidConversion: analytics.summary.leadToPaidConversion,
    cpl: analytics.summary.cpl,
    cac: analytics.summary.cac,
    roas: analytics.summary.roas,
    avgDealCycleDays: analytics.summary.avgDealCycleDays,
  },
  funnel: analytics.funnel,
  funnelBySource: analytics.funnelBySource,
  bySource: analytics.bySource,
  warmBaseSize: analytics.summary.warmBaseSize,
  warmReactivated: analytics.summary.warmReactivated,
  leadToDemoConversion: analytics.summary.leadToDemoConversion,
  demoToPaidConversion: analytics.summary.demoToPaidConversion,
  leadToPaidConversion: analytics.summary.leadToPaidConversion,
  cpl: analytics.summary.cpl,
  avgDealCycleDays: analytics.summary.avgDealCycleDays,
  targets: analytics.targets,
});

router.get('/workspaces/administration', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    res.json(await buildAdministrationDashboard());
  } catch (error) {
    logger.error('Failed to fetch administration dashboard', { error });
    res.status(500).json({ error: 'Failed to fetch administration dashboard' });
  }
});

router.get('/workspaces/sales', async (req, res) => {
  if (!ensureSalesWorkspaceAccess(req, res)) return;
  try {
    const actor: DatasetActor = {
      userId: req.user!.id,
      workspace: req.user!.workspace,
      workspaces: getAssignedWorkspaces(req.user),
      scopeWorkspace: 'sales',
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
    logger.error('Failed to fetch sales workspace', { error });
    res.status(500).json({ error: 'Failed to fetch sales workspace' });
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
    const result = await listAvailableSchoolSlots({
      schoolId,
      courseId,
      from: requestedFrom,
      days,
      excludeLeadId: parseId(req.query.excludeLeadId),
    });
    res.json(result);
  } catch (error: any) {
    logger.error('Failed to fetch available slots', { error });
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to fetch available slots',
    });
  }
});

router.get('/workspaces/teacher', async (req, res) => {
  if (!ensureTeacherWorkspaceAccess(req, res)) return;
  try {
    const actor: DatasetActor = {
      userId: req.user!.id,
      workspace: req.user!.workspace,
      workspaces: getAssignedWorkspaces(req.user),
      scopeWorkspace: 'teacher',
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
    logger.error('Failed to fetch teacher workspace', { error });
    res.status(500).json({ error: 'Failed to fetch teacher workspace' });
  }
});

router.get('/configuration', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
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
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    res.json(await getCompanySettings());
  } catch (error) {
    logger.error('Failed to fetch company settings', { error });
    res.status(500).json({ error: 'Failed to fetch company settings' });
  }
});

router.patch('/company-settings', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
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
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
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
      `SELECT a.*, u.full_name AS user_name, u.workspace AS user_workspace
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
      `SELECT id, full_name, workspace FROM users WHERE is_active = true ORDER BY full_name`,
    );
    res.json({ logs, integrationLogs, employees });
  } catch (error) {
    logger.error('Failed to fetch audit trail', { error });
    res.status(500).json({ error: 'Failed to fetch audit trail' });
  }
});

router.post('/dashboard/alerts/:key/task', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const key = String(req.params.key);
    const tasks: Record<string, { title: string; description: string; entityType: string; targetWorkspace: string }> = {
      payments: {
        title: 'Позвонить должникам',
        description: 'Проверить и закрыть просроченные оплаты из CEO Dashboard.',
        entityType: 'payment',
        targetWorkspace: 'sales',
      },
      attendance: {
        title: 'Связаться с учениками с низкой посещаемостью',
        description: 'Разобрать причины посещаемости ниже установленной нормы.',
        entityType: 'student',
        targetWorkspace: 'sales',
      },
      teachers: {
        title: 'Назначить преподавателя в группы',
        description: 'Закрыть группы без назначенного преподавателя.',
        entityType: 'group',
        targetWorkspace: 'teacher',
      },
    };
    const definition = tasks[key];
    if (!definition) return res.status(404).json({ error: 'Unknown dashboard alert' });
    const responsible = await queryOne(
      `SELECT id FROM users WHERE workspace = $1 AND is_active = true ORDER BY id LIMIT 1`,
      [definition.targetWorkspace],
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
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const schoolId = parseId(req.query.schoolId);
    if (!schoolId) return res.status(400).json({ error: 'schoolRequired' });
    const selectedDate = parseDateOnly(req.query.date) ?? startOfAcademyDay(new Date());
    const nextDate = getZonedDayRange(selectedDate, ACADEMY_TIME_ZONE, 1).start;

    const [school, rooms, groups, lessons] = await Promise.all([
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
    ]);
    if (!school) return res.status(404).json({ error: 'resourceNotFound' });

    res.json({
      school,
      date: selectedDate.toISOString(),
      rooms: rooms.map((room) => ({
        ...room,
        groups: groups.filter((group) => Number(group.roomId) === Number(room.id)),
        lessons: lessons.filter((lesson) => Number(lesson.roomId) === Number(room.id)),
      })),
    });
  } catch (error) {
    logger.error('Failed to fetch resource schedule', { error });
    res.status(500).json({ error: 'failedToLoadData' });
  }
});

router.patch('/teachers/me/availability', (_req, res) => {
  res.status(403).json({ error: 'adminAccessRequired' });
});

router.get('/workspaces/marketing', async (req, res) => {
  if (!ensureMarketingWorkspaceAccess(req, res)) return;
  try {
    const [dataset, analytics] = await Promise.all([
      getMarketingWorkspaceDataset(),
      buildAnalytics(),
    ]);
    res.json({
      ...dataset,
      analytics: buildMarketingAnalyticsPayload(analytics),
      constants: academyConstants(),
    });
  } catch (error) {
    logger.error('Failed to fetch marketing workspace', { error });
    res.status(500).json({ error: 'Failed to fetch marketing workspace' });
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
    const assignedWorkspaces = getAssignedWorkspaces(req.user);
    const isLeadershipActor = hasLeadershipAccess(req.user);
    const results: Row[] = [];
    const remaining = () => Math.max(limit - results.length, 0);

    const pushLeads = async (whereSql: string, params: DbValue[], href: string) => {
      if (remaining() <= 0) return;
      const rows = await query(
        `SELECT l.id, l.contact_name, l.phone, l.student_name, c.name AS course_name,
            ${leadPhoneNumbersSelect('l')}
         FROM academy_leads l
         LEFT JOIN academy_courses c ON c.id = l.course_id
         WHERE ${whereSql}
           AND COALESCE(l.is_archived, false) = false
           AND (
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
           )
         ORDER BY l.created_at DESC
         LIMIT $${params.length + 2}`,
        [...params, like, remaining()],
      );
      const visibleRows = await redactLeadPhonesForActor({
        userId: req.user!.id,
        workspace: String(req.user!.workspace),
        workspaces: assignedWorkspaces,
        scopeWorkspace: 'sales',
      }, rows);
      results.push(...visibleRows.map((lead) => ({
        id: `lead-${lead.id}`,
        entityType: 'lead',
        title: lead.contactName,
        subtitle: [lead.phoneNumbers?.[0] ?? lead.phone, lead.studentName, lead.courseName].filter(Boolean).join(' • '),
        href: `${href}&lead=${lead.id}`,
      })));
    };

    const pushStudents = async (whereSql: string, params: DbValue[], href: string) => {
      if (remaining() <= 0) return;
      const rows = await query(
        `SELECT st.id, st.student_name, st.contact_name, st.phone, g.name AS group_name
         FROM academy_students st
         LEFT JOIN academy_groups g ON g.id = st.group_id
         WHERE ${whereSql}
           AND (
             LOWER(COALESCE(st.student_name, '')) LIKE $${params.length + 1}
             OR LOWER(st.contact_name) LIKE $${params.length + 1}
             OR LOWER(st.phone) LIKE $${params.length + 1}
             OR LOWER(COALESCE(st.referral_code, '')) LIKE $${params.length + 1}
           )
         ORDER BY st.created_at DESC
         LIMIT $${params.length + 2}`,
        [...params, like, remaining()],
      );
      results.push(...rows.map((student) => ({
        id: `student-${student.id}`,
        entityType: 'student',
        title: student.studentName || student.contactName,
        subtitle: [student.contactName, student.phone, student.groupName].filter(Boolean).join(' • '),
        href: `${href}&student=${student.id}`,
      })));
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
      await pushGroups(`TRUE`, [], '/teacher-workspace/groups');
      await pushCourses('/teacher-workspace/groups');
      if (remaining() > 0) {
        const sources = await query(
          `SELECT id, name, channel, campaign_name
           FROM academy_lead_sources
           WHERE LOWER(name) LIKE $1 OR LOWER(code) LIKE $1 OR LOWER(COALESCE(channel, '')) LIKE $1 OR LOWER(COALESCE(campaign_name, '')) LIKE $1
           ORDER BY name
           LIMIT $2`,
          [like, remaining()],
        );
        results.push(...sources.map((source) => ({
          id: `source-${source.id}`,
          entityType: 'source',
          title: source.name,
          subtitle: [source.channel, source.campaignName].filter(Boolean).join(' • '),
          href: '/marketing-workspace/sources',
        })));
      }
      if (remaining() > 0) {
        const users = await query(
          `SELECT id, full_name, workspace
           FROM users
           WHERE LOWER(full_name) LIKE $1 OR LOWER(workspace) LIKE $1
           ORDER BY full_name
           LIMIT $2`,
          [like, remaining()],
        );
        results.push(...users.map((user) => ({
          id: `user-${user.id}`,
          entityType: 'user',
          title: user.fullName,
          subtitle: user.workspace,
          href: '/employees',
        })));
      }
    } else {
      if (assignedWorkspaces.includes('sales')) {
        await pushLeads(`(l.manager_id = $1 OR l.manager_id IS NULL)`, [req.user!.id], '/sales/pipeline');
        await pushStudents(`st.manager_id = $1`, [req.user!.id], '/sales/clients');
      }
      if (assignedWorkspaces.includes('teacher')) {
        const teacherId = await resolveTeacherId(req.user!.id);
        if (teacherId) {
          await pushGroups(`g.teacher_id = $1`, [teacherId], '/teacher-workspace/groups');
          await pushStudents(`st.group_id IN (SELECT id FROM academy_groups WHERE teacher_id = $1)`, [teacherId], '/teacher-workspace/groups');
          await pushCourses('/teacher-workspace/groups');
        }
      }
      if (assignedWorkspaces.includes('marketing')) {
        if (remaining() > 0) {
          const sources = await query(
            `SELECT id, name, channel, campaign_name
             FROM academy_lead_sources
             WHERE LOWER(name) LIKE $1 OR LOWER(code) LIKE $1 OR LOWER(COALESCE(channel, '')) LIKE $1 OR LOWER(COALESCE(campaign_name, '')) LIKE $1
             ORDER BY name
             LIMIT $2`,
            [like, remaining()],
          );
          results.push(...sources.map((source) => ({
            id: `source-${source.id}`,
            entityType: 'source',
            title: source.name,
            subtitle: [source.channel, source.campaignName].filter(Boolean).join(' • '),
            href: '/marketing-workspace/sources',
          })));
        }
        await pushLeads(`TRUE`, [], '/marketing-workspace/warm-base');
      }
    }

    res.json(results.slice(0, limit));
  } catch (error) {
    logger.error('Failed to search academy data', { error });
    res.status(500).json({ error: 'Failed to search academy data' });
  }
});

router.get('/leads', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, LEAD_WORKSPACES, 'Lead access required')) return;
  try {
    const conditions: string[] = [];
    const params: DbValue[] = [];
    const assignedWorkspaces = getAssignedWorkspaces(req.user);
    const canSeeAllLeads = hasLeadershipAccess(req.user) || assignedWorkspaces.includes('marketing');
    const wantsArchived = req.query.archived === 'true';

    conditions.push(`COALESCE(l.is_archived, false) = ${wantsArchived ? 'true' : 'false'}`);

    if (assignedWorkspaces.includes('sales') && !canSeeAllLeads && !wantsArchived) {
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
          ${leadPhoneNumbersSelect('l')}
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
    res.json(await redactLeadPhonesForActor(
      {
        userId: req.user!.id,
        workspace: String(req.user!.workspace),
        workspaces: assignedWorkspaces,
        scopeWorkspace: 'sales',
      },
      leads,
    ));
  } catch (error) {
    logger.error('Failed to fetch leads', { error });
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

router.post('/leads', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, LEAD_WORKSPACES, 'Lead write access required')) return;
  try {
    const contactName = nullableText(req.body.contactName);
    const phones = normalizeLeadPhones(req.body.phoneNumbers ?? req.body.phone);
    const primaryPhone = phones[0]?.phone ?? null;
    const messenger = nullableText(req.body.messenger);
    const requestedReferrerStudentId = toIdOrNull(req.body.referrerStudentId, 'referrerStudentId');

    if (!contactName) return res.status(400).json({ error: 'contactPersonRequired' });

    const duplicate = await findDuplicate(phones, messenger);
    if (duplicate) {
      return res.status(409).json({ error: 'clientAlreadyExists', duplicate });
    }
    if (req.body.demoAt) {
      return res.status(400).json({ error: 'leadScheduleThroughGroupOnly' });
    }

    const lead = await withTransaction<Row>(async () => {
      await lockLeadContactIdentities(phones, messenger);
      const lockedDuplicate = await findDuplicate(phones, messenger);
      if (lockedDuplicate) {
        throw Object.assign(new Error('clientAlreadyExists'), {
          statusCode: 409,
          duplicate: lockedDuplicate,
        });
      }
      const referrer = requestedReferrerStudentId
        ? await assertValidReferrerStudent(requestedReferrerStudentId)
        : null;
      const sourceId = await resolveSourceId(req.body, referrer);
      if (!sourceId) {
        throw Object.assign(new Error('sourceRequired'), { statusCode: 400 });
      }
      const studentAge = toIntegerOrNull(req.body.studentAge) as number | null | undefined;
      let courseId = parseId(req.body.courseId);
      if (!courseId && studentAge) {
        courseId = Number((await resolveCourseByAge(studentAge))?.id ?? 0) || null;
      }

      const statusCode = await resolveInitialLeadStatusCode(nullableText(req.body.statusCode));
      if (statusCode === 'paid') {
        throw Object.assign(new Error('paymentRequiredBeforePaid'), { statusCode: 409 });
      }
      const managerId = await resolveLeadManagerId(req, req.body.managerId);
      await getActiveSalesManager(managerId, true);

      const enrolledGroupId = parseId(req.body.enrolledGroupId);
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
        studentName: nullableText(req.body.studentName),
        studentAge: studentAge ?? null,
        courseId,
        enrolledGroupId,
      });
      if (validationError) {
        throw Object.assign(new Error(validationError), { statusCode: 400 });
      }

      const source = await queryOne(`SELECT * FROM academy_lead_sources WHERE id = $1`, [sourceId]);
      const createdLead = await insertRow('academy_leads', {
        contactName,
        phone: primaryPhone,
        messenger: messenger ?? null,
        studentName: nullableText(req.body.studentName) ?? null,
        studentAge: studentAge ?? null,
        courseId: courseId ?? null,
        schoolId,
        sourceId,
        advertisingCampaign: nullableText(req.body.advertisingCampaign) ?? nullableText(source?.campaignName) ?? null,
        acquisitionCostUzs: normalizeMoney(req.body.acquisitionCostUzs ?? source?.costPerLeadUzs),
        statusCode,
        managerId,
        language: nullableText(req.body.language) ?? 'ru',
        comment: nullableText(req.body.comment) ?? null,
        enrolledGroupId,
        referralCode: nullableText(req.body.referralCode) ?? null,
        referrerStudentId: requestedReferrerStudentId,
        createdBy: req.user!.id,
      });
      await syncLeadPhones(createdLead.id, phones);
      await createStageHistory(
        createdLead.id,
        null,
        createdLead.statusCode,
        req.user!.id,
        enrolledGroupId ? 'Создание лида и добавление в группу' : 'Создание лида',
      );
      return { ...createdLead, phoneNumbers: phones.map((phone) => phone.phone) };
    });

    await handleLeadAutomation(req, lead);
    await createAudit(req, 'CREATE_ACADEMY_LEAD', 'academy_lead', lead.id, lead);
    res.status(201).json(lead);
  } catch (error: any) {
    logger.error('Failed to create lead', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create lead' });
  }
});

router.post('/leads/bulk-assign', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
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
      await createAudit(req, 'BULK_ASSIGN_ACADEMY_LEADS', 'academy_lead', 0, {
        leadIds: changedIds,
        managerId: manager.id,
      }, {
        assignments: changedLeads.map((lead) => ({ leadId: lead.id, managerId: lead.managerId ?? null })),
      });
    }

    res.json({ updatedCount: changedLeads.length, manager });
  } catch (error: any) {
    logger.error('Failed to bulk assign leads', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to assign leads' });
  }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadRowAccess(req, res, lead)) return;
    const [history, assignmentHistory, communications, tasks, payments] = await Promise.all([
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
      query(`SELECT * FROM academy_communications WHERE lead_id = $1 ORDER BY created_at DESC`, [id]),
      query(`SELECT * FROM academy_tasks WHERE entity_type = 'lead' AND entity_id = $1 ORDER BY deadline_at`, [id]),
      query(`SELECT * FROM academy_payments WHERE lead_id = $1 ORDER BY created_at DESC`, [id]),
    ]);
    const [visibleLead] = await redactLeadPhonesForActor({
      userId: req.user!.id,
      workspace: String(req.user!.workspace),
      workspaces: getAssignedWorkspaces(req.user),
      scopeWorkspace: 'sales',
    }, [lead]);
    res.json({
      ...visibleLead,
      history,
      assignmentHistory,
      stageDurations: buildLeadStageDurations(history),
      communications,
      tasks,
      payments,
    });
  } catch (error) {
    logger.error('Failed to fetch lead', { error });
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

router.post('/leads/:id/assign', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, new Set(['administration', 'sales']), 'Lead assignment access required')) return;
  try {
    const id = parseId(req.params.id);
    const managerId = parseId(req.body.managerId);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    if (!managerId) return res.status(400).json({ error: 'Active account manager is required' });

    const oldLead = await getLead(id);
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, oldLead)) return;

    const canAssignAnyManager = hasLeadershipAccess(req.user) || canAccessAcademyWorkspace(req.user, 'marketing');
    if (!canAssignAnyManager && Number(managerId) !== Number(req.user!.id)) {
      return res.status(403).json({ error: 'Only leadership can assign a lead to another manager' });
    }

    const manager = await getActiveSalesManager(managerId);
    const lead = await reassignLead(req, oldLead, manager, nullableText(req.body.comment));
    await createAudit(req, 'ASSIGN_ACADEMY_LEAD', 'academy_lead', lead.id, lead, oldLead);
    res.json(await redactLeadForRequest(req, lead));
  } catch (error: any) {
    logger.error('Failed to assign lead', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to assign lead' });
  }
});

router.delete('/leads/:id', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });

    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const deletedTaskRows = await withTransaction(async () => {
      const taskRows = await query<{ id: number }>(
        `DELETE FROM academy_tasks
         WHERE entity_type = 'lead' AND entity_id = $1
         RETURNING id`,
        [id],
      );
      const deletedLead = await queryOne(
        `DELETE FROM academy_leads
         WHERE id = $1
         RETURNING id`,
        [id],
      );
      if (!deletedLead) {
        throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      }
      return taskRows;
    });

    await createAudit(req, 'DELETE_ACADEMY_LEAD', 'academy_lead', id, {
      deletedTaskCount: deletedTaskRows.length,
    }, lead);
    res.json({ ok: true, deletedTaskCount: deletedTaskRows.length });
  } catch (error: any) {
    logger.error('Failed to delete lead', { error });
    const isForeignKeyConflict = error?.code === '23503';
    res.status(error.statusCode || (isForeignKeyConflict ? 409 : 500)).json({
      error: isForeignKeyConflict ? 'resourceInUse' : error.message || 'Failed to delete lead',
    });
  }
});

router.post('/leads/:id/archive', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, LEAD_WORKSPACES, 'Lead write access required')) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });

    const oldLead = await getLead(id);
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadMutationAccess(req, res, oldLead)) return;

    if (oldLead.isArchived) return res.json(oldLead);
    if (oldLead.statusCode === 'paid') return res.status(400).json({ error: 'paidLeadCannotArchive' });

    const archiveReason = nullableText(req.body.reason);
    if (!isValidLeadArchiveReason(archiveReason)) {
      return res.status(400).json({ error: 'archiveReasonRequired' });
    }

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
        await createAudit(req, 'ASSIGN_ACADEMY_LEAD', 'academy_lead', assignedLead.id, assignedLead, leadBeforeArchive);
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

      await createAudit(req, 'ARCHIVE_ACADEMY_LEAD', 'academy_lead', archived.id, archived, leadBeforeArchive);
    });

    res.json(await getLead(id) ?? archived);
  } catch (error: any) {
    logger.error('Failed to archive lead', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to archive lead' });
  }
});

router.post('/leads/:id/restore', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, SALES_WORKSPACES, 'Lead restore access required')) return;
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
      if (['enrolled', 'paid'].includes(targetStatusCode) && oldLead.enrolledGroupId) {
        await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [oldLead.enrolledGroupId]);
        await validateEnrollmentGroup(Number(oldLead.enrolledGroupId), id);
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
      await handleLeadAutomation(req, restored, oldLead.statusCode);
    }

    await createAudit(req, 'RESTORE_ACADEMY_LEAD', 'academy_lead', restored.id, restored, oldLead);
    res.json(await getLead(id) ?? restored);
  } catch (error: any) {
    logger.error('Failed to restore lead', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to restore lead' });
  }
});

router.patch('/leads/:id', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, LEAD_WORKSPACES, 'Lead write access required')) return;
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

    const hasRequestedGroup = req.body.enrolledGroupId !== undefined;
    const requestedGroupId = hasRequestedGroup
      ? toIdOrNull(req.body.enrolledGroupId, 'enrolledGroupId')
      : undefined;
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
      ? await validateEnrollmentGroup(requestedGroupId, id)
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
    const canAssignAnyManager = hasLeadershipAccess(req.user) || canAccessAcademyWorkspace(req.user, 'marketing');
    const hasRequestedManager = req.body.managerId !== undefined;
    const requestedManagerId = hasRequestedManager ? parseId(req.body.managerId) : undefined;
    if (hasRequestedManager && !requestedManagerId) {
      return res.status(400).json({ error: 'Active account manager is required' });
    }
    if (requestedManagerId && !canAssignAnyManager && Number(requestedManagerId) !== Number(req.user!.id)) {
      return res.status(403).json({ error: 'Only leadership can assign a lead to another manager' });
    }
    const managerId = requestedManagerId
      ? await resolveLeadManagerId(req, requestedManagerId)
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
      { excludeLeadId: id },
    );
    if (duplicate) {
      return res.status(409).json({ error: 'clientAlreadyExists', duplicate });
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
      comment: nullableText(req.body.comment),
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
      if (!canMutateLeadRow(req, lockedLead)) {
        throw Object.assign(new Error('Lead access required'), { statusCode: 403 });
      }
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
          { excludeLeadId: id },
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
      const mustValidateCapacity = Boolean(requestedGroupId)
        || ['enrolled', 'paid'].includes(nextStatus);
      if (mustValidateCapacity && groupToReserve) {
        await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupToReserve]);
        const lockedGroup = await validateEnrollmentGroup(groupToReserve, id);
        if (req.body.enrolledGroupId !== undefined && lockedGroup) {
          updates.courseId = Number(lockedGroup.courseId);
          updates.schoolId = Number(lockedGroup.schoolId);
        }
      }
      const updated = await updateRow('academy_leads', id, updates);
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
      await handleLeadAutomation(req, lead, oldLead.statusCode);
    }

    if (lead.statusCode === 'paid') {
      await createStudentFromLead(req, lead.id);
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

    await createAudit(req, 'UPDATE_ACADEMY_LEAD', 'academy_lead', lead.id, lead, oldLead);
    res.json(await redactLeadForRequest(req, lead));
  } catch (error: any) {
    logger.error('Failed to update lead', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update lead' });
  }
});

router.post('/leads/:id/contact', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, LEAD_WORKSPACES, 'Lead write access required')) return;
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

    res.status(201).json({ communication, lead: await redactLeadForRequest(req, updatedLead) });
  } catch (error) {
    logger.error('Failed to add lead contact', { error });
    res.status(500).json({ error: 'Failed to add lead contact' });
  }
});

router.post('/leads/:id/demo', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, LEAD_WORKSPACES, 'Lead write access required')) return;
  res.status(400).json({ error: 'leadScheduleThroughGroupOnly' });
});

router.post('/leads/:id/demo-attendance', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, LEAD_WORKSPACES, 'Lead write access required')) return;
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
      await handleLeadAutomation(req, lead, oldLead.statusCode);
    }
    res.json(await redactLeadForRequest(req, lead));
  } catch (error) {
    logger.error('Failed to mark demo attendance', { error });
    res.status(500).json({ error: 'Failed to mark demo attendance' });
  }
});

router.post('/leads/:id/convert-to-student', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, SALES_WORKSPACES, 'Student conversion access required')) return;
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
      return createStudentFromLead(req, id, Number(paidPayment.id));
    });
    res.status(201).json(student);
  } catch (error: any) {
    logger.error('Failed to convert lead to student', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to convert lead to student' });
  }
});

// Inbound webhooks (ChatPlace, Google Forms) live in ./incoming.routes.ts as
// PUBLIC routes verified by per-provider secrets, not session auth.

const buildCrudScope = async (req: any, table: string, firstParamIndex = 1): Promise<{
  whereSql: string;
  params: DbValue[];
  denied?: boolean;
}> => {
  const assignedWorkspaces = getAssignedWorkspaces(req.user);
  const params: DbValue[] = [];
  const pushParam = (value: DbValue) => {
    params.push(value);
    return `$${firstParamIndex + params.length - 1}`;
  };
  const ownUserParam = () => pushParam(req.user!.id);
  const teacherParam = async () => {
    const teacherId = await resolveTeacherId(req.user!.id);
    return teacherId ? pushParam(teacherId) : null;
  };

  if (table === 'academy_tasks') {
    if (hasLeadershipAccess(req.user)) return { whereSql: '', params };
    if (!assignedWorkspaces.some((workspace) => ['sales', 'teacher', 'marketing'].includes(workspace))) {
      return { whereSql: 'FALSE', params, denied: true };
    }
    return { whereSql: `responsible_id = ${ownUserParam()}`, params };
  }

  if (table === 'academy_lessons') {
    if (hasLeadershipAccess(req.user)) return { whereSql: '', params };
    if (assignedWorkspaces.includes('teacher')) {
      const placeholder = await teacherParam();
      return placeholder ? { whereSql: `teacher_id = ${placeholder}`, params } : { whereSql: 'FALSE', params };
    }
    return { whereSql: 'FALSE', params, denied: true };
  }

  return { whereSql: '', params };
};

const prepareGroupMutation = async (options: {
  values: Row;
  oldRow?: Row | null;
  excludeGroupId?: number | null;
  forceAutoAssign?: boolean;
  allowUnassigned?: boolean;
}) => {
  const courseId = Number(options.values.courseId ?? options.oldRow?.courseId);
  const schoolId = Number(options.values.schoolId ?? options.oldRow?.schoolId);
  const roomId = Number(options.values.roomId ?? options.oldRow?.roomId);
  const schedule = options.values.schedule ?? options.oldRow?.schedule;
  const maxStudents = Number(options.values.maxStudents ?? options.oldRow?.maxStudents ?? 12);
  const status = String(options.values.status ?? options.oldRow?.status ?? 'open');
  if (!courseId || !schoolId) {
    throw Object.assign(new Error('schoolAndCourseRequired'), { statusCode: 400 });
  }
  if (!roomId) {
    throw Object.assign(new Error('roomRequired'), { statusCode: 400 });
  }
  if (!GROUP_STATUSES.some((item) => item.code === status)) {
    throw Object.assign(new Error('Invalid group status'), { statusCode: 400 });
  }
  await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);

  if (
    options.oldRow
    && (
      Number(options.oldRow.courseId) !== courseId
      || Number(options.oldRow.schoolId) !== schoolId
    )
  ) {
    const usage = await queryOne<{ hasEnrollments: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM academy_students WHERE group_id = $1)
         OR EXISTS (SELECT 1 FROM academy_leads WHERE enrolled_group_id = $1)
         OR EXISTS (SELECT 1 FROM academy_lessons WHERE group_id = $1)
       ) AS has_enrollments`,
      [options.oldRow.id],
    );
    if (usage?.hasEnrollments) {
      throw Object.assign(new Error('groupHasEnrollments'), { statusCode: 409 });
    }
  }
  const course = await queryOne(
    `SELECT id, lesson_count, lesson_duration_minutes, duration_days, frequency, is_active
     FROM academy_courses
     WHERE id = $1`,
    [courseId],
  );
  if (!course) {
    throw Object.assign(new Error('Course not found'), { statusCode: 404 });
  }
  if (course.isActive === false) {
    throw Object.assign(new Error('Course is inactive'), { statusCode: 409 });
  }

  const lessonCount = Number(
    options.values.lessonCount !== undefined
      ? options.values.lessonCount
      : Number(options.oldRow?.lessonCount) > 0
        ? options.oldRow?.lessonCount
        : Number(course.lessonCount) > 0
          ? course.lessonCount
          : 10,
  );
  const lessonDurationMinutes = Number(
    options.values.lessonDurationMinutes !== undefined
      ? options.values.lessonDurationMinutes
      : Number(options.oldRow?.lessonDurationMinutes) >= 15
        ? options.oldRow?.lessonDurationMinutes
        : Number(course.lessonDurationMinutes) >= 15
          ? course.lessonDurationMinutes
          : 120,
  );
  const durationDays = Number(
    options.values.durationDays !== undefined
      ? options.values.durationDays
      : Number(options.oldRow?.durationDays) > 0
        ? options.oldRow?.durationDays
        : Number(course.durationDays) > 0
          ? course.durationDays
          : 30,
  );
  if (lessonCount < 1 || lessonDurationMinutes < 15 || durationDays < 1) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  options.values.lessonCount = Math.round(lessonCount);
  options.values.lessonDurationMinutes = Math.round(lessonDurationMinutes);
  options.values.durationDays = Math.round(durationDays);
  options.values.frequency = options.values.frequency !== undefined
    ? nullableText(options.values.frequency)
    : nullableText(options.oldRow?.frequency ?? course.frequency);

  if (maxStudents < 1 || maxStudents > 12) {
    throw Object.assign(new Error('groupCapacityLimit'), { statusCode: 400 });
  }
  if (options.oldRow) {
    const occupancy = await queryOne<{ currentStudents: number; reservedStudents: number }>(
      `SELECT
         COUNT(DISTINCT s.id)::int AS current_students,
         COUNT(DISTINCT CASE WHEN reserved.id IS NOT NULL THEN reserved.id END)::int AS reserved_students
       FROM academy_groups g
       LEFT JOIN academy_students s
         ON s.group_id = g.id AND s.status = 'studying'
       LEFT JOIN academy_leads reserved
         ON reserved.enrolled_group_id = g.id
        AND reserved.status_code <> 'not_now'
        AND COALESCE(reserved.is_archived, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM academy_students existing_student WHERE existing_student.lead_id = reserved.id
        )
       WHERE g.id = $1
       GROUP BY g.id`,
      [options.oldRow.id],
    );
    if (
      Number(occupancy?.currentStudents ?? 0)
      + Number(occupancy?.reservedStudents ?? 0)
      > maxStudents
    ) {
      throw Object.assign(new Error('groupCapacityBelowOccupancy'), { statusCode: 409 });
    }
  }
  options.values.maxStudents = maxStudents;
  const room = await assertActiveRoomInSchool(roomId, schoolId);
  if (maxStudents > Number(room.capacity)) {
    throw Object.assign(new Error('groupExceedsRoomCapacity'), { statusCode: 400 });
  }
  const startDate = (options.values.startDate ?? options.oldRow?.startDate) as Date | null | undefined;
  const endDate = (options.values.endDate ?? options.oldRow?.endDate) as Date | null | undefined;
  if (startDate && endDate && new Date(endDate).getTime() < new Date(startDate).getTime()) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }

  await query(`SELECT pg_advisory_xact_lock($1)`, [roomId]);
  if (status === 'completed') {
    const validationError = getGroupScheduleValidationError(schedule);
    if (validationError) {
      throw Object.assign(new Error(validationError), {
        statusCode: validationError === 'groupScheduleOverlap' ? 409 : 400,
      });
    }
  } else {
    await assertRoomScheduleAvailable({
      schoolId,
      roomId,
      schedule,
      startDate,
      endDate,
      excludeGroupId: options.excludeGroupId,
    });
  }

  const teacherId = Number(options.values.teacherId ?? options.oldRow?.teacherId) || null;
  if (status === 'completed') {
    options.values.teacherId = teacherId;
    return;
  }
  if (options.forceAutoAssign || !teacherId) {
    const teacher = await findTeacherForGroupSchedule({
      courseId,
      schoolId,
      schedule,
      startDate,
      endDate,
      excludeGroupId: options.excludeGroupId,
    });
    if (!teacher && !options.allowUnassigned) {
      throw Object.assign(new Error('noAvailableTeacher'), { statusCode: 404 });
    }
    options.values.teacherId = teacher ? Number(teacher.id) : null;
  } else {
    await query(`SELECT pg_advisory_xact_lock($1)`, [1_000_000 + teacherId]);
    await assertTeacherCanLeadGroupSchedule({
      teacherId,
      courseId,
      schoolId,
      schedule,
      startDate,
      endDate,
      excludeGroupId: options.excludeGroupId,
    });
    options.values.teacherId = teacherId;
  }
};

const normalizedGroupScheduleForComparison = (value: unknown) =>
  normalizeScheduleItems(value)
    .map((item) => ({
      dayOfWeek: item.dayOfWeek,
      startMinutes: item.startMinutes,
      endMinutes: item.endMinutes,
      schoolId: item.schoolId,
    }))
    .sort((left, right) =>
      left.dayOfWeek - right.dayOfWeek
      || left.startMinutes - right.startMinutes
      || left.endMinutes - right.endMinutes
      || Number(left.schoolId ?? 0) - Number(right.schoolId ?? 0));

const groupLessonBackedFieldChanged = (field: string, nextValue: unknown, previousValue: unknown) => {
  if (field === 'schedule') {
    return JSON.stringify(normalizedGroupScheduleForComparison(nextValue))
      !== JSON.stringify(normalizedGroupScheduleForComparison(previousValue));
  }
  if (field === 'startDate' || field === 'endDate') {
    const timestamp = (value: unknown) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = new Date(value as string | number | Date).getTime();
      return Number.isNaN(parsed) ? null : parsed;
    };
    return timestamp(nextValue) !== timestamp(previousValue);
  }
  if (field === 'frequency') {
    return nullableText(nextValue) !== nullableText(previousValue);
  }
  if (field === 'roomId' || field === 'teacherId') {
    const id = (value: unknown) => Number(value) || null;
    return id(nextValue) !== id(previousValue);
  }
  return Number(nextValue) !== Number(previousValue);
};

const assertGroupLifecycleUpdateAllowed = async (options: {
  id: number;
  values: Row;
  row: Row;
  autoAssignRequested: boolean;
}) => {
  const lessonBackedFields = [
    'roomId',
    'teacherId',
    'schedule',
    'startDate',
    'endDate',
    'lessonCount',
    'lessonDurationMinutes',
    'durationDays',
    'frequency',
  ];
  const changesLessonBackedField = lessonBackedFields.some((field) =>
    Object.prototype.hasOwnProperty.call(options.values, field)
    && groupLessonBackedFieldChanged(field, options.values[field], options.row[field]));
  const completesGroup = options.row.status !== 'completed' && options.values.status === 'completed';
  if (!changesLessonBackedField && !completesGroup && !options.autoAssignRequested) return;

  const lifecycle = await queryOne<{
    hasLessons: boolean;
    hasScheduledLessons: boolean;
    hasStudyingStudents: boolean;
    hasReservedLeads: boolean;
  }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM academy_lessons lesson
         WHERE lesson.group_id = $1
       ) AS has_lessons,
       EXISTS (
         SELECT 1 FROM academy_lessons lesson
         WHERE lesson.group_id = $1 AND lesson.status = 'scheduled'
       ) AS has_scheduled_lessons,
       EXISTS (
         SELECT 1 FROM academy_students student
         WHERE student.group_id = $1 AND student.status = 'studying'
       ) AS has_studying_students,
       EXISTS (
         SELECT 1
         FROM academy_leads reserved
         WHERE reserved.enrolled_group_id = $1
           AND reserved.status_code <> 'not_now'
           AND COALESCE(reserved.is_archived, false) = false
           AND NOT EXISTS (
             SELECT 1
             FROM academy_students existing_student
             WHERE existing_student.lead_id = reserved.id
           )
       ) AS has_reserved_leads`,
    [options.id],
  );

  if (lifecycle?.hasLessons && (changesLessonBackedField || options.autoAssignRequested)) {
    throw Object.assign(new Error('groupLessonsLockSchedule'), { statusCode: 409 });
  }
  if (!completesGroup) return;
  if (lifecycle?.hasScheduledLessons) {
    throw Object.assign(new Error('groupHasScheduledLessons'), { statusCode: 409 });
  }
  if (lifecycle?.hasStudyingStudents) {
    throw Object.assign(new Error('groupHasStudyingStudents'), { statusCode: 409 });
  }
  if (lifecycle?.hasReservedLeads) {
    throw Object.assign(new Error('groupHasReservedLeads'), { statusCode: 409 });
  }
};

const prepareLessonMutation = async (options: {
  values: Row;
  oldRow?: Row | null;
  excludeLessonId?: number | null;
  forceAutoAssign?: boolean;
}) => {
  await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
  const groupId = Number(options.values.groupId ?? options.oldRow?.groupId);
  const group = groupId
    ? await queryOne(`SELECT * FROM academy_groups WHERE id = $1 FOR SHARE`, [groupId])
    : null;
  if (!group) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });

  const requestedCourseId = Number(options.values.courseId ?? options.oldRow?.courseId ?? group.courseId);
  const requestedSchoolId = Number(options.values.schoolId ?? options.oldRow?.schoolId ?? group.schoolId);
  if (requestedCourseId !== Number(group.courseId) || requestedSchoolId !== Number(group.schoolId)) {
    throw Object.assign(new Error('lessonGroupMismatch'), { statusCode: 409 });
  }
  const courseId = Number(group.courseId);
  const schoolId = Number(group.schoolId);
  const roomId = Number(options.values.roomId ?? options.oldRow?.roomId ?? group.roomId);
  const scheduledAt = new Date(options.values.scheduledAt ?? options.oldRow?.scheduledAt);
  const status = String(options.values.status ?? options.oldRow?.status ?? 'scheduled');
  const durationMinutes = Number(
    options.values.durationMinutes
      ?? options.oldRow?.durationMinutes
      ?? group.lessonDurationMinutes
      ?? (await queryOne(`SELECT lesson_duration_minutes FROM academy_courses WHERE id = $1`, [courseId]))?.lessonDurationMinutes
      ?? 120,
  );
  const lessonNumber = Number(options.values.lessonNumber ?? options.oldRow?.lessonNumber);

  if (
    !courseId
    || !schoolId
    || !roomId
    || !Number.isSafeInteger(lessonNumber)
    || lessonNumber < 1
    || Number.isNaN(scheduledAt.getTime())
    || durationMinutes < 15
  ) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (!LESSON_STATUSES.some((item) => item.code === status)) {
    throw Object.assign(new Error('Invalid lesson status'), { statusCode: 400 });
  }

  options.values.courseId = courseId;
  options.values.schoolId = schoolId;
  options.values.roomId = roomId;
  options.values.lessonNumber = lessonNumber;
  options.values.durationMinutes = durationMinutes;

  const duplicateLessonNumber = await queryOne(
    `SELECT id
     FROM academy_lessons
     WHERE group_id = $1
       AND lesson_number = $2
       AND ($3::integer IS NULL OR id <> $3)
     LIMIT 1`,
    [groupId, lessonNumber, options.excludeLessonId ?? null],
  );
  if (duplicateLessonNumber) {
    throw Object.assign(new Error('groupLessonNumberDuplicate'), { statusCode: 409 });
  }

  // Cancelling an already conflicting lesson must always be possible.
  if (status === 'cancelled') {
    await assertActiveRoomInSchool(roomId, schoolId);
    return;
  }

  await query(`SELECT pg_advisory_xact_lock($1)`, [roomId]);
  await assertLessonRoomAvailable({
    schoolId,
    roomId,
    scheduledAt,
    durationMinutes,
    excludeLessonId: options.excludeLessonId,
    excludeGroupId: groupId,
  });

  const teacherId = Number(options.values.teacherId ?? options.oldRow?.teacherId ?? group.teacherId) || null;
  if (options.forceAutoAssign || !teacherId) {
    const teacher = await findAvailableTeacher({
      courseId,
      schoolId,
      scheduledAt,
      durationMinutes,
      excludeGroupId: groupId,
      excludeLessonId: options.excludeLessonId,
    });
    if (!teacher) throw Object.assign(new Error('noAvailableTeacher'), { statusCode: 404 });
    options.values.teacherId = Number(teacher.id);
  } else {
    await assertTeacherCanLeadLesson({
      teacherId,
      courseId,
      schoolId,
      scheduledAt,
      durationMinutes,
      excludeGroupId: groupId,
      excludeLessonId: options.excludeLessonId,
    });
    options.values.teacherId = teacherId;
  }
};

const calendarDateFromDateOnly = (value: Date): CalendarDate => ({
  year: value.getUTCFullYear(),
  month: value.getUTCMonth() + 1,
  day: value.getUTCDate(),
});

const calendarDateFromInstant = (value: Date): CalendarDate => {
  const parts = getZonedDateTimeParts(value, ACADEMY_TIME_ZONE);
  return { year: parts.year, month: parts.month, day: parts.day };
};

const calendarDateToUtcMarker = (value: CalendarDate) =>
  new Date(Date.UTC(value.year, value.month - 1, value.day));

const materializeGroupLessons = async (groupId: number): Promise<Row[]> => {
  if (!transactionContext.getStore()) {
    return withTransaction(() => materializeGroupLessons(groupId));
  }

  await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
  const group = await queryOne(
    `SELECT * FROM academy_groups WHERE id = $1 FOR UPDATE`,
    [groupId],
  );
  if (!group) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
  if (!['open', 'in_progress'].includes(String(group.status)) || !group.teacherId) return [];

  const existingLessons = await query<Row>(
    `SELECT id FROM academy_lessons WHERE group_id = $1 ORDER BY scheduled_at, id`,
    [groupId],
  );
  if (existingLessons.length > 0) return existingLessons;

  const [course, membership] = await Promise.all([
    queryOne(`SELECT program FROM academy_courses WHERE id = $1`, [group.courseId]),
    queryOne<{ membershipStart: Date | null }>(
      `SELECT MIN(COALESCE(enrolled_at, created_at)) AS membership_start
       FROM academy_students
       WHERE group_id = $1`,
      [groupId],
    ),
  ]);
  const explicitStartDate = group.startDate ? new Date(group.startDate) : null;
  const fallbackStart = membership?.membershipStart
    ? new Date(membership.membershipStart)
    : new Date(group.createdAt ?? Date.now());
  const startDate = explicitStartDate && !Number.isNaN(explicitStartDate.getTime())
    ? calendarDateFromDateOnly(explicitStartDate)
    : calendarDateFromInstant(fallbackStart);
  const lessonCount = Number(group.lessonCount);
  const generatedSlots = buildRecurringLessonSchedule({
    startDate,
    schedule: group.schedule,
    lessonCount,
    fallbackDurationMinutes: Number(group.lessonDurationMinutes),
    timeZone: ACADEMY_TIME_ZONE,
  });
  if (generatedSlots.length !== lessonCount) {
    throw Object.assign(new Error('groupLessonGenerationFailed'), { statusCode: 409 });
  }

  const program = readJsonArray(course?.program);
  const createdLessons: Row[] = [];
  for (const slot of generatedSlots) {
    const programLesson = program.find(
      (item) => Number(item.lessonNumber) === slot.lessonNumber,
    );
    const values: Row = {
      groupId,
      courseId: Number(group.courseId),
      schoolId: Number(group.schoolId),
      roomId: Number(group.roomId),
      teacherId: Number(group.teacherId),
      lessonNumber: slot.lessonNumber,
      topic: nullableText(programLesson?.topic) ?? `Занятие ${slot.lessonNumber}`,
      materials: nullableText(programLesson?.description) ?? null,
      scheduledAt: slot.scheduledAt,
      durationMinutes: slot.durationMinutes,
      status: 'scheduled',
    };
    await prepareLessonMutation({ values, forceAutoAssign: false });
    createdLessons.push(await insertRow('academy_lessons', values));
  }

  const lastLesson = createdLessons[createdLessons.length - 1];
  const lastLessonDate = calendarDateFromInstant(new Date(lastLesson.scheduledAt));
  await updateRow('academy_groups', groupId, {
    startDate: calendarDateToUtcMarker(startDate),
    endDate: calendarDateToUtcMarker(lastLessonDate),
  });
  return createdLessons;
};

const reconcileAutomaticTeacherAssignments = async (teacherId?: number | null) => {
  const groups = await query<{ id: number }>(
    `SELECT id
     FROM academy_groups
     WHERE status IN ('open', 'in_progress')
       AND (teacher_id IS NULL OR teacher_id = $1)
     ORDER BY created_at, id`,
    [teacherId ?? null],
  );

  let updatedCount = 0;
  for (const group of groups) {
    try {
      const updated = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const lockedGroup = await queryOne(
          `SELECT * FROM academy_groups WHERE id = $1 FOR UPDATE`,
          [group.id],
        );
        if (!lockedGroup) return false;

        const values: Row = {};
        await prepareGroupMutation({
          values,
          oldRow: lockedGroup,
          excludeGroupId: Number(lockedGroup.id),
          forceAutoAssign: true,
          allowUnassigned: true,
        });
        const previousTeacherId = Number(lockedGroup.teacherId) || null;
        const nextTeacherId = Number(values.teacherId) || null;
        if (previousTeacherId === nextTeacherId) return false;

        await updateRow('academy_groups', Number(lockedGroup.id), {
          teacherId: nextTeacherId,
        });
        if (nextTeacherId) {
          await materializeGroupLessons(Number(lockedGroup.id));
        }
        return true;
      });
      if (updated) updatedCount += 1;
    } catch (error) {
      if (transactionContext.getStore()) throw error;
      logger.warn('Skipped automatic teacher assignment reconciliation for group', {
        groupId: group.id,
        error,
      });
    }
  }

  return updatedCount;
};

const registerSimpleCrud = (path: string, table: string, columns: string[], options: {
  orderBy?: string;
  listWhere?: string;
  allowedWorkspaces?: Set<string>;
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
    if (options.allowedWorkspaces && !ensureWorkspaceAccess(req, res, options.allowedWorkspaces, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationWorkspaceAccess(req, res)) return;
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
    if (options.allowedWorkspaces && !ensureWorkspaceAccess(req, res, options.allowedWorkspaces, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationWorkspaceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: `Invalid ${path} id` });
      const scope = await buildCrudScope(req, table, 2);
      if (scope.denied) return res.status(403).json({ error: `${path} access required` });
      const scopedWhere = scope.whereSql ? `AND ${scope.whereSql}` : '';
      const row = await queryOne(`SELECT * FROM ${quoteIdent(table)} WHERE id = $1 ${scopedWhere}`, [id, ...scope.params]);
      if (!row) return res.status(404).json({ error: `${path} not found` });
      res.json(row);
    } catch (error) {
      logger.error(`Failed to fetch ${path}`, { error });
      res.status(500).json({ error: `Failed to fetch ${path}` });
    }
  });

  router.post(`/${path}`, async (req, res) => {
    if (options.allowedWorkspaces && !ensureWorkspaceAccess(req, res, options.allowedWorkspaces, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationWorkspaceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    if (options.allowCreate === false) return res.status(405).json({ error: 'methodNotAllowed' });
    if (options.requireOperations && getAssignedWorkspaces(req.user).includes('teacher') && !hasLeadershipAccess(req.user)) {
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
      res.status(error.statusCode || 500).json({ error: error.message || `Failed to create ${path}` });
    }
  });

  router.patch(`/${path}/:id`, async (req, res) => {
    if (options.allowedWorkspaces && !ensureWorkspaceAccess(req, res, options.allowedWorkspaces, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationWorkspaceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    if (options.allowUpdate === false) return res.status(405).json({ error: 'methodNotAllowed' });
    if (options.requireOperations && getAssignedWorkspaces(req.user).includes('teacher') && !hasLeadershipAccess(req.user)) {
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
          await prepareGroupMutation({
            values,
            oldRow: lockedRow,
            excludeGroupId: id,
            forceAutoAssign: req.body.autoAssign === true,
          });
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
      res.status(error.statusCode || 500).json({ error: error.message || `Failed to update ${path}` });
    }
  });

  router.delete(`/${path}/:id`, async (req, res) => {
    if (options.allowedWorkspaces && !ensureWorkspaceAccess(req, res, options.allowedWorkspaces, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationWorkspaceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    if (options.requireOperations && getAssignedWorkspaces(req.user).includes('teacher') && !hasLeadershipAccess(req.user)) {
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
      res.json({ ok: true });
    } catch (error: any) {
      logger.error(`Failed to delete ${path}`, { error });
      const isForeignKeyConflict = error?.code === '23503';
      res.status(error.statusCode || (isForeignKeyConflict ? 409 : 500)).json({
        error: isForeignKeyConflict ? 'resourceInUse' : error.message || `Failed to delete ${path}`,
      });
    }
  });
};

const getLeadCountForStatusCode = async (statusCode: string) => {
  const usage = await queryOne<{ leadCount: number | string }>(
    `SELECT COUNT(*)::int AS lead_count
     FROM academy_leads
     WHERE status_code = $1`,
    [statusCode],
  );
  return Number(usage?.leadCount ?? 0);
};

const getLessonRoster = async (groupId: number, scheduledAt: Date | string, lock = false) => query(
  `SELECT student.*
   FROM academy_students student
   WHERE COALESCE(student.enrolled_at, student.created_at) <= $2
     AND COALESCE(
       (
         SELECT transfer.to_group_id
         FROM academy_student_transfers transfer
         WHERE transfer.student_id = student.id
           AND transfer.created_at <= $2
         ORDER BY transfer.created_at DESC, transfer.id DESC
         LIMIT 1
       ),
       (
         SELECT first_transfer.from_group_id
         FROM academy_student_transfers first_transfer
         WHERE first_transfer.student_id = student.id
         ORDER BY first_transfer.created_at, first_transfer.id
         LIMIT 1
       ),
       student.group_id
     ) = $1
     AND COALESCE(
       (
         SELECT history.to_status
         FROM academy_student_status_history history
         WHERE history.student_id = student.id
           AND history.created_at <= $2
         ORDER BY history.created_at DESC, history.id DESC
         LIMIT 1
       ),
       'studying'
     ) = 'studying'
   ORDER BY student.id
   ${lock ? 'FOR UPDATE OF student' : ''}`,
  [groupId, scheduledAt],
);

router.get('/lessons/:id/attendance-roster', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const lessonId = parseId(req.params.id);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id' });
    const lesson = await queryOne(
      `SELECT lesson.*, teacher.user_id AS teacher_user_id
       FROM academy_lessons lesson
       LEFT JOIN academy_teachers teacher
         ON teacher.id = lesson.teacher_id AND teacher.status = 'active'
       WHERE lesson.id = $1`,
      [lessonId],
    );
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    if (
      getAssignedWorkspaces(req.user).includes('teacher')
      && !hasLeadershipAccess(req.user)
      && (!lesson.teacherUserId || Number(lesson.teacherUserId) !== Number(req.user!.id))
    ) {
      return res.status(403).json({ error: 'teacherOwnLessonRosterOnly' });
    }
    const [students, attendance] = await Promise.all([
      getLessonRoster(Number(lesson.groupId), lesson.scheduledAt),
      query(`SELECT * FROM academy_attendance WHERE lesson_id = $1 ORDER BY student_id`, [lessonId]),
    ]);
    res.json({ lesson, students, attendance });
  } catch (error: any) {
    logger.error('Failed to load lesson attendance roster', { error, lessonId: req.params.id });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load attendance roster' });
  }
});

router.post('/lessons/:id/reschedule', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const lessonId = parseId(req.params.id);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id' });
    const nextScheduledAt = parseOptionalDate(req.body.scheduledAt, 'scheduledAt');
    if (!(nextScheduledAt instanceof Date)) {
      return res.status(400).json({ error: 'rescheduleDateRequired' });
    }
    if (nextScheduledAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'rescheduleDateMustBeFuture' });
    }
    const reason = nullableText(req.body.reason);
    if (!reason || reason.length > 500) {
      return res.status(400).json({ error: 'rescheduleReasonRequired' });
    }
    const result = await withTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
      const lesson = await queryOne(
        `SELECT lesson.*, teacher.user_id AS teacher_user_id
         FROM academy_lessons lesson
         LEFT JOIN academy_teachers teacher
           ON teacher.id = lesson.teacher_id AND teacher.status = 'active'
         WHERE lesson.id = $1
         FOR UPDATE OF lesson`,
        [lessonId],
      );
      if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
      if (!['scheduled', 'conducted'].includes(String(lesson.status))) {
        throw Object.assign(new Error('onlyReschedulableLessonCanBeRescheduled'), { statusCode: 409 });
      }
      if (
        getAssignedWorkspaces(req.user).includes('teacher')
        && !hasLeadershipAccess(req.user)
        && (!lesson.teacherUserId || Number(lesson.teacherUserId) !== Number(req.user!.id))
      ) {
        throw Object.assign(new Error('teacherOwnLessonRescheduleOnly'), { statusCode: 403 });
      }
      const previousScheduledAt = new Date(lesson.scheduledAt);
      if (nextScheduledAt.getTime() === previousScheduledAt.getTime()) {
        throw Object.assign(new Error('rescheduleDateMustChange'), { statusCode: 400 });
      }
      const deltaMs = nextScheduledAt.getTime() - previousScheduledAt.getTime();
      const affected = await query(
        `SELECT affected_lesson.*, affected_teacher.user_id AS teacher_user_id
         FROM academy_lessons affected_lesson
         LEFT JOIN academy_teachers affected_teacher
           ON affected_teacher.id = affected_lesson.teacher_id
         WHERE affected_lesson.group_id = $1
           AND (
             affected_lesson.id = $3
             OR (
               affected_lesson.status = 'scheduled'
               AND affected_lesson.scheduled_at > $2
             )
           )
         ORDER BY affected_lesson.scheduled_at, affected_lesson.id
         FOR UPDATE OF affected_lesson`,
        [lesson.groupId, previousScheduledAt, lessonId],
      );
      if (!affected.some((item) => Number(item.id) === lessonId)) {
        throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
      }
      if (
        getAssignedWorkspaces(req.user).includes('teacher')
        && !hasLeadershipAccess(req.user)
        && affected.some((item) => Number(item.teacherUserId) !== Number(req.user!.id))
      ) {
        throw Object.assign(new Error('teacherOwnLessonRescheduleOnly'), { statusCode: 403 });
      }
      const affectedLessonIds = affected.map((item) => Number(item.id));
      const lessonWithAttendance = await queryOne(
        `SELECT lesson_id
         FROM academy_attendance
         WHERE lesson_id = ANY($1::int[])
           AND ($2::integer IS NULL OR lesson_id <> $2)
         LIMIT 1`,
        [affectedLessonIds, lesson.status === 'conducted' ? lessonId : null],
      );
      if (lessonWithAttendance) {
        throw Object.assign(new Error('lessonWithAttendanceCannotBeRescheduled'), { statusCode: 409 });
      }

      const reopenedStudentRows = lesson.status === 'conducted'
        ? await query<{ studentId: number }>(
          `DELETE FROM academy_attendance
           WHERE lesson_id = $1
           RETURNING student_id`,
          [lessonId],
        )
        : [];

      const updateOrder = deltaMs > 0 ? [...affected].reverse() : affected;
      const updatedLessons: Row[] = [];
      for (const affectedLesson of updateOrder) {
        const oldDate = new Date(affectedLesson.scheduledAt);
        const newDate = new Date(oldDate.getTime() + deltaMs);
        if (newDate.getTime() <= Date.now()) {
          throw Object.assign(new Error('rescheduleDateMustBeFuture'), { statusCode: 400 });
        }
        const reopensConductedLesson = Number(affectedLesson.id) === lessonId && lesson.status === 'conducted';
        const values: Row = {
          scheduledAt: newDate,
          ...(reopensConductedLesson ? { status: 'scheduled' } : {}),
        };
        await prepareLessonMutation({
          values,
          oldRow: affectedLesson,
          excludeLessonId: Number(affectedLesson.id),
          forceAutoAssign: false,
        });
        const updated = await updateRow('academy_lessons', Number(affectedLesson.id), values);
        if (!updated) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
        await insertRow('academy_lesson_reschedules', {
          lessonId: Number(affectedLesson.id),
          previousScheduledAt: oldDate,
          nextScheduledAt: newDate,
          reason,
          changedBy: req.user!.id,
        });
        if (reopensConductedLesson) {
          await insertRow('academy_lesson_status_history', {
            lessonId,
            fromStatus: 'conducted',
            toStatus: 'scheduled',
            changedBy: req.user!.id,
            comment: reason,
          });
        }
        updatedLessons.push(updated);
      }

      for (const studentId of new Set(reopenedStudentRows.map((row) => Number(row.studentId)))) {
        await recalculateStudentMetrics(studentId);
      }

      await query(
        `UPDATE academy_groups academy_group
         SET end_date = (
               SELECT MAX(group_lesson.scheduled_at)
               FROM academy_lessons group_lesson
               WHERE group_lesson.group_id = academy_group.id
                 AND group_lesson.status <> 'cancelled'
             ),
             updated_at = NOW()
         WHERE academy_group.id = $1`,
        [lesson.groupId],
      );
      updatedLessons.sort((left, right) => (
        new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
      ));
      return {
        previousLesson: lesson,
        lesson: updatedLessons.find((item) => Number(item.id) === lessonId),
        lessons: updatedLessons,
      };
    });

    await createAudit(
      req,
      'RESCHEDULE_ACADEMY_LESSON',
      'academy_lesson',
      lessonId,
      { lesson: result.lesson, shiftedLessonIds: result.lessons.map((lesson) => lesson.id), reason },
      result.previousLesson,
    );
    res.json({
      lesson: result.lesson,
      lessons: result.lessons,
      shiftedCount: result.lessons.length,
    });
  } catch (error: any) {
    logger.error('Failed to reschedule lesson', { error, lessonId: req.params.id });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to reschedule lesson' });
  }
});

router.post('/lessons/:id/attendance', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const lessonId = parseId(req.params.id);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id' });
    if (!Array.isArray(req.body.attendance)) {
      return res.status(400).json({ error: 'Invalid attendance payload' });
    }
    const requestedLessonStatus = nullableText(req.body.lessonStatus) ?? 'conducted';
    if (!['scheduled', 'conducted'].includes(String(requestedLessonStatus))) {
      return res.status(400).json({ error: 'Invalid lesson status' });
    }

    const normalizedItems: Array<Row & {
      studentId: number;
      status: 'present' | 'absent';
      hasProjectUrl: boolean;
      hasNote: boolean;
    }> = [];
    const seenStudentIds = new Set<number>();
    for (const item of req.body.attendance) {
      const studentId = parseId(item?.studentId);
      if (!studentId || !['present', 'absent'].includes(String(item?.status))) {
        return res.status(400).json({ error: 'Invalid attendance item' });
      }
      if (seenStudentIds.has(studentId)) {
        return res.status(400).json({ error: 'Duplicate attendance student' });
      }
      seenStudentIds.add(studentId);
      normalizedItems.push({
        ...item,
        studentId,
        status: item.status,
        hasProjectUrl: Object.prototype.hasOwnProperty.call(item, 'projectUrl'),
        hasNote: Object.prototype.hasOwnProperty.call(item, 'note'),
      });
    }

    const result = await withTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
      const lesson = await queryOne(
        `SELECT l.*, t.user_id AS teacher_user_id
         FROM academy_lessons l
         LEFT JOIN academy_teachers t ON t.id = l.teacher_id AND t.status = 'active'
         WHERE l.id = $1
         FOR UPDATE OF l`,
        [lessonId],
      );
      if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
      if (lesson.status === 'cancelled') {
        throw Object.assign(new Error('cancelledLessonAttendanceNotAllowed'), { statusCode: 400 });
      }
      if (
        getAssignedWorkspaces(req.user).includes('teacher')
        && !hasLeadershipAccess(req.user)
        && (!lesson.teacherUserId || Number(lesson.teacherUserId) !== req.user!.id)
      ) {
        throw Object.assign(new Error('teacherOwnLessonAttendanceOnly'), { statusCode: 403 });
      }
      if (lesson.status === 'conducted' && requestedLessonStatus === 'scheduled') {
        throw Object.assign(new Error('conductedLessonCannotBeReopened'), { statusCode: 409 });
      }
      if (requestedLessonStatus === 'scheduled') {
        throw Object.assign(new Error('attendanceDraftNotSupported'), { statusCode: 400 });
      }
      if (
        requestedLessonStatus === 'conducted'
        && lesson.status !== 'conducted'
        && new Date(lesson.scheduledAt).getTime() > Date.now()
      ) {
        throw Object.assign(new Error('lessonNotStarted'), { statusCode: 409 });
      }
      if (requestedLessonStatus === 'conducted' && lesson.status !== 'conducted') {
        const previousIncompleteLesson = await queryOne(
          `SELECT previous_lesson.id
           FROM academy_lessons previous_lesson
           WHERE previous_lesson.group_id = $1
             AND previous_lesson.status = 'scheduled'
             AND previous_lesson.scheduled_at < $2
           ORDER BY previous_lesson.scheduled_at, previous_lesson.id
           LIMIT 1
           FOR UPDATE`,
          [lesson.groupId, lesson.scheduledAt],
        );
        if (previousIncompleteLesson) {
          throw Object.assign(new Error('previousLessonMustBeCompleted'), { statusCode: 409 });
        }
      }

      const groupStudents = await getLessonRoster(
        Number(lesson.groupId),
        lesson.scheduledAt,
        true,
      );
      if (groupStudents.length > 0 && normalizedItems.length === 0) {
        throw Object.assign(new Error('attendanceRequired'), { statusCode: 400 });
      }
      const studentsById = new Map(groupStudents.map((student) => [Number(student.id), student]));
      if (normalizedItems.some((item) => !studentsById.has(item.studentId))) {
        throw Object.assign(
          new Error('attendanceStudentsOutsideLesson'),
          { statusCode: 403 },
        );
      }
      if (
        requestedLessonStatus === 'conducted'
        && normalizedItems.length !== groupStudents.length
      ) {
        throw Object.assign(new Error('attendanceIncomplete'), { statusCode: 409 });
      }

      const saved: Row[] = [];
      for (const item of normalizedItems) {
        const rows = await query(
          `INSERT INTO academy_attendance (lesson_id, student_id, status, project_url, note, marked_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (lesson_id, student_id)
           DO UPDATE SET
             status = EXCLUDED.status,
             project_url = CASE
               WHEN $7::boolean THEN EXCLUDED.project_url
               ELSE academy_attendance.project_url
             END,
             note = CASE
               WHEN $8::boolean THEN EXCLUDED.note
               ELSE academy_attendance.note
             END,
             marked_by = EXCLUDED.marked_by,
             updated_at = NOW()
           RETURNING *`,
          [
            lessonId,
            item.studentId,
            item.status,
            nullableText(item.projectUrl) ?? null,
            nullableText(item.note) ?? null,
            req.user!.id,
            item.hasProjectUrl,
            item.hasNote,
          ],
        );
        saved.push(rows[0]);
      }

      const updatedLesson = await updateRow('academy_lessons', lessonId, {
        status: requestedLessonStatus,
      });
      if (lesson.status !== updatedLesson?.status) {
        await insertRow('academy_lesson_status_history', {
          lessonId,
          fromStatus: lesson.status ?? null,
          toStatus: updatedLesson?.status ?? requestedLessonStatus,
          changedBy: req.user!.id,
          comment: nullableText(req.body.statusComment) ?? 'Статус изменён при сохранении посещаемости',
        });
      }
      const absenceAlerts: Row[] = [];
      if (requestedLessonStatus === 'conducted') {
        for (const item of normalizedItems) {
          const recentAttendance = await query<{ status: string }>(
            `SELECT a.status
             FROM academy_lessons l
             JOIN academy_attendance a ON a.lesson_id = l.id AND a.student_id = $2
             WHERE l.group_id = $1
               AND l.status = 'conducted'
               AND l.scheduled_at >= COALESCE(
                 (
                   SELECT MAX(transfer.created_at)
                   FROM academy_student_transfers transfer
                   WHERE transfer.student_id = $2 AND transfer.to_group_id = $1
                 ),
                 (
                   SELECT COALESCE(student.enrolled_at, student.created_at)
                   FROM academy_students student
                   WHERE student.id = $2
                 )
               )
             ORDER BY l.scheduled_at DESC
             LIMIT 3`,
            [lesson.groupId, item.studentId],
          );
          const existingTask = await queryOne(
            `SELECT id
             FROM academy_tasks
             WHERE entity_type = 'student'
               AND entity_id = $1
               AND title = '3 пропуска подряд: позвонить родителю'
               AND status <> 'done'
             LIMIT 1`,
            [item.studentId],
          );
          const hasConsecutiveAbsenceRisk = recentAttendance.length === 3
            && recentAttendance.every((row) => row.status === 'absent');
          if (!hasConsecutiveAbsenceRisk) {
            if (existingTask) {
              await query(
                `UPDATE academy_tasks
                 SET status = 'done',
                     completed_at = COALESCE(completed_at, NOW()),
                     updated_at = NOW()
                 WHERE id = $1 AND status <> 'done'`,
                [existingTask.id],
              );
            }
            continue;
          }
          if (existingTask) continue;
          const student = studentsById.get(item.studentId)!;
          await createTask('3 пропуска подряд: позвонить родителю', {
            responsibleId: student.managerId ?? req.user!.id,
            entityType: 'student',
            entityId: item.studentId,
            deadlineAt: addDays(new Date(), 1),
          });
          absenceAlerts.push(student);
        }
      }

      for (const student of groupStudents) {
        await recalculateStudentMetrics(Number(student.id));
      }

      if (lesson.status !== 'conducted' && updatedLesson?.status === 'conducted') {
        const presentStudentIds = new Set(
          normalizedItems
            .filter((item) => item.status === 'present')
            .map((item) => item.studentId),
        );
        for (const student of groupStudents) {
          if (!presentStudentIds.has(Number(student.id))) continue;
          await createOutbox(
            'whatsapp',
            student.phone,
            'Оцените сегодняшний урок 01 Academy: /survey',
            {
              scheduledAt: addMinutes(
                new Date(lesson.scheduledAt),
                Number(lesson.durationMinutes || 120) + 30,
              ),
              entityType: 'lesson',
              entityId: lessonId,
            },
          );
        }
      }
      return { lesson: updatedLesson, attendance: saved, absenceAlerts };
    });

    for (const student of result.absenceAlerts) {
      await createNotification(
        student.managerId ?? req.user!.id,
        'Риск по посещаемости',
        `${student.studentName ?? 'Ученик'} пропустил 3 занятия подряд`,
        'student',
        Number(student.id),
      );
    }
    res.json({ lesson: result.lesson, attendance: result.attendance });
  } catch (error: any) {
    logger.error('Failed to save attendance', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to save attendance' });
  }
});

router.post('/students/:id/transfer', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, OPERATIONS_WORKSPACES, 'Operations access required')) return;
  try {
    const studentId = parseId(req.params.id);
    const toGroupId = parseId(req.body.toGroupId);
    if (!studentId || !toGroupId) return res.status(400).json({ error: 'Student and target group are required' });
    const initialStudent = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
    if (!initialStudent) return res.status(404).json({ error: 'Student not found' });

    const student = await withTransaction(async () => {
      // Payments lock lead -> student -> group. Keep the same order here to
      // avoid deadlocks between a payment and a simultaneous transfer.
      if (initialStudent.leadId) {
        await queryOne(`SELECT id FROM academy_leads WHERE id = $1 FOR UPDATE`, [initialStudent.leadId]);
      }
      const lockedStudent = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [studentId],
      );
      if (!lockedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      if (Number(lockedStudent.groupId) === Number(toGroupId)) return lockedStudent;

      await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [toGroupId]);
      const targetGroup = await validateEnrollmentGroup(toGroupId);
      if (!targetGroup) {
        throw Object.assign(new Error('Group not found'), { statusCode: 404 });
      }

      const updatedStudent = await updateRow('academy_students', studentId, {
        groupId: toGroupId,
        courseId: Number(targetGroup.courseId),
        schoolId: Number(targetGroup.schoolId),
      });
      if (!updatedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }

      if (lockedStudent.leadId) {
        await updateRow('academy_leads', Number(lockedStudent.leadId), {
          enrolledGroupId: toGroupId,
          courseId: Number(targetGroup.courseId),
          schoolId: Number(targetGroup.schoolId),
        });
      }
      await insertRow('academy_student_transfers', {
        studentId,
        fromGroupId: lockedStudent.groupId ?? null,
        toGroupId,
        reason: nullableText(req.body.reason) ?? null,
        createdBy: req.user!.id,
      });
      await recalculateStudentMetrics(studentId);
      return updatedStudent;
    });
    res.json(student);
  } catch (error: any) {
    logger.error('Failed to transfer student', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to transfer student' });
  }
});

router.patch('/students/:id/status', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const id = parseId(req.params.id);
    const status = nullableText(req.body.status);
    const exitReason = nullableText(req.body.exitReason);
    if (!id) return res.status(400).json({ error: 'Invalid student id' });
    if (!status || !STUDENT_STATUSES.some((item) => item.code === status)) {
      return res.status(400).json({ error: 'Invalid student status' });
    }
    if (['paused', 'expelled'].includes(status) && (!exitReason || !CHURN_REASONS.includes(exitReason as typeof CHURN_REASONS[number]))) {
      return res.status(400).json({ error: 'Churn reason is required for paused or expelled students' });
    }
    const { current, student } = await withTransaction(async () => {
      const lockedStudent = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!lockedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      if (getAssignedWorkspaces(req.user).includes('teacher') && !hasLeadershipAccess(req.user)) {
        const teacherId = await resolveTeacherId(req.user!.id);
        const ownsStudent = teacherId && lockedStudent.groupId
          ? await queryOne(
            `SELECT id FROM academy_groups WHERE id = $1 AND teacher_id = $2`,
            [lockedStudent.groupId, teacherId],
          )
          : null;
        if (!ownsStudent) {
          throw Object.assign(
            new Error('Teacher can update only own students'),
            { statusCode: 403 },
          );
        }
      }
      if (status === 'studying' && lockedStudent.status !== 'studying') {
        if (!lockedStudent.groupId) {
          throw Object.assign(new Error('groupRequiredForEnrollment'), { statusCode: 409 });
        }
        await queryOne(
          `SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`,
          [lockedStudent.groupId],
        );
        await validateEnrollmentGroup(Number(lockedStudent.groupId));
      }
      const updatedStudent = await updateRow('academy_students', id, {
        status,
        exitReason: ['paused', 'expelled'].includes(status) ? exitReason : null,
      });
      if (!updatedStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      if (lockedStudent.status !== status) {
        await insertRow('academy_student_status_history', {
          studentId: id,
          fromStatus: lockedStudent.status,
          toStatus: status,
          changedBy: req.user!.id,
          comment: nullableText(req.body.comment) ?? null,
        });
        await recalculateStudentMetrics(id);
      }
      return { current: lockedStudent, student: updatedStudent };
    });
    await createAudit(req, 'UPDATE_ACADEMY_STUDENT_STATUS', 'academy_student', id, student, current);
    res.json(student);
  } catch (error: any) {
    logger.error('Failed to update student status', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update student status' });
  }
});

router.post('/payments', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, SALES_WORKSPACES, 'Payment access required')) return;
  try {
    const amountUzs = normalizeMoney(req.body.amountUzs);
    const leadId = parseId(req.body.leadId);
    const studentId = parseId(req.body.studentId);
    const requestedPaymentId = req.body.paymentId === undefined
      ? null
      : parseId(req.body.paymentId);
    if (req.body.paymentId !== undefined && !requestedPaymentId) {
      return res.status(400).json({ error: 'Invalid payment id' });
    }
    const requestedGroupId = req.body.groupId === undefined || req.body.groupId === null || req.body.groupId === ''
      ? null
      : parseId(req.body.groupId);
    if (req.body.groupId !== undefined && req.body.groupId !== null && req.body.groupId !== '' && !requestedGroupId) {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    if (!amountUzs) return res.status(400).json({ error: 'paymentAmountRequired' });
    if (!leadId && !studentId) return res.status(400).json({ error: 'paymentPartyRequired' });
    const status = nullableText(req.body.status) ?? 'paid';
    if (!['paid', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid payment status' });
    }
    const paymentType = nullableText(req.body.type) ?? 'full';
    const paymentMethod = nullableText(req.body.method) ?? 'transfer';
    const paymentDiscount = nullableText(req.body.discount) ?? 'none';
    if (!PAYMENT_TYPES.includes(paymentType as typeof PAYMENT_TYPES[number])) {
      return res.status(400).json({ error: 'Invalid payment type' });
    }
    if (!PAYMENT_METHODS.includes(paymentMethod as typeof PAYMENT_METHODS[number])) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }
    if (!PAYMENT_DISCOUNTS.includes(paymentDiscount as typeof PAYMENT_DISCOUNTS[number])) {
      return res.status(400).json({ error: 'Invalid payment discount' });
    }

    const requestedPaidAt = parseOptionalDate(req.body.paidAt, 'paidAt');
    const requestedPaidUntil = parseOptionalDate(req.body.paidUntil, 'paidUntil');
    const requestedDueAt = parseOptionalDate(req.body.dueAt, 'dueAt');
    const paymentPeriod = nullableText(req.body.period) ?? 'month_1';
    const paidAt = status === 'paid' ? requestedPaidAt ?? new Date() : requestedPaidAt;
    const paidUntil = requestedPaidUntil
      ?? (status === 'paid' && paidAt instanceof Date ? addDays(paidAt, 30) : null);
    if (
      paidAt instanceof Date
      && paidUntil instanceof Date
      && paidUntil.getTime() < paidAt.getTime()
    ) {
      return res.status(400).json({ error: 'paidUntilBeforePaidAt' });
    }

    const result = await withTransaction(async () => {
      const lead = leadId
        ? await queryOne(`SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`, [leadId])
        : undefined;
      if (leadId && !lead) {
        throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      }
      if (lead?.isArchived) {
        throw Object.assign(new Error('archivedLeadMustBeRestoredBeforePayment'), { statusCode: 409 });
      }

      const existingStudent = studentId
        ? await queryOne(`SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`, [studentId])
        : leadId
          ? await queryOne(`SELECT * FROM academy_students WHERE lead_id = $1 FOR UPDATE`, [leadId])
          : undefined;
      if (studentId && !existingStudent) {
        throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      }
      if (lead && existingStudent && Number(existingStudent.leadId) !== Number(lead.id)) {
        throw Object.assign(new Error('Payment lead and student do not match'), { statusCode: 400 });
      }
      if (getAssignedWorkspaces(req.user).includes('sales') && !hasLeadershipAccess(req.user)) {
        const ownsLead = !lead || Number(lead.managerId) === Number(req.user!.id);
        const ownsStudent = !existingStudent || Number(existingStudent.managerId) === Number(req.user!.id);
        if (!ownsLead || !ownsStudent) {
          throw Object.assign(new Error('Payment access required'), { statusCode: 403 });
        }
      }

      if (lead?.enrolledGroupId) {
        await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [lead.enrolledGroupId]);
      }

      const paymentLeadId = leadId ?? (existingStudent?.leadId ? Number(existingStudent.leadId) : null);
      const resolvedStudentId = existingStudent?.id ?? studentId ?? null;
      let pendingPayment: Row | undefined;
      if (status === 'paid') {
        if (requestedPaymentId) {
          pendingPayment = await queryOne(
            `SELECT * FROM academy_payments WHERE id = $1 FOR UPDATE`,
            [requestedPaymentId],
          );
          if (!pendingPayment) {
            throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
          }
          if (!['pending', 'overdue'].includes(String(pendingPayment.status))) {
            throw Object.assign(new Error('paymentAlreadyFinalized'), { statusCode: 409 });
          }
          const sameLead = !pendingPayment.leadId
            || Number(pendingPayment.leadId) === Number(paymentLeadId);
          const sameStudent = !pendingPayment.studentId
            || Number(pendingPayment.studentId) === Number(resolvedStudentId);
          if (!sameLead || !sameStudent) {
            throw Object.assign(new Error('Payment lead and student do not match'), { statusCode: 400 });
          }
        } else {
          pendingPayment = await queryOne(
            `SELECT *
             FROM academy_payments
             WHERE status IN ('pending', 'overdue')
               AND COALESCE(period, '') = $1
               AND (
                 ($2::int IS NOT NULL AND lead_id = $2)
                 OR ($3::int IS NOT NULL AND student_id = $3)
               )
             ORDER BY due_at NULLS LAST, created_at, id
             LIMIT 1
             FOR UPDATE`,
            [paymentPeriod, paymentLeadId, resolvedStudentId],
          );
        }
      }

      const referralLead = lead ?? (paymentLeadId
        ? await queryOne(
          `SELECT id, referrer_student_id
           FROM academy_leads
           WHERE id = $1`,
          [paymentLeadId],
        )
        : null);
      let effectivePaymentDiscount = req.body.discount === undefined && pendingPayment?.discount
        ? String(pendingPayment.discount)
        : paymentDiscount;
      if (!PAYMENT_DISCOUNTS.includes(effectivePaymentDiscount as typeof PAYMENT_DISCOUNTS[number])) {
        throw Object.assign(new Error('Invalid payment discount'), { statusCode: 400 });
      }

      let firstReferralPaymentEligible = false;
      let pendingDiscountBenefit: Row | undefined;
      if (status === 'paid') {
        const referrerId = referralLead?.referrerStudentId
          ? Number(referralLead.referrerStudentId)
          : null;
        if (referrerId && referrerId !== Number(resolvedStudentId)) {
          const validReferrer = await queryOne(
            `SELECT id FROM academy_students WHERE id = $1 FOR SHARE`,
            [referrerId],
          );
          if (validReferrer) {
            const previousPaidPayment = await queryOne(
              `SELECT id
               FROM academy_payments
               WHERE status = 'paid'
                 AND ($3::int IS NULL OR id <> $3)
                 AND (
                   ($1::int IS NOT NULL AND lead_id = $1)
                   OR ($2::int IS NOT NULL AND student_id = $2)
                 )
               LIMIT 1`,
              [paymentLeadId, resolvedStudentId, pendingPayment?.id ?? null],
            );
            firstReferralPaymentEligible = !previousPaidPayment;
          }
        }

        if (firstReferralPaymentEligible) {
          if (effectivePaymentDiscount === 'none') {
            effectivePaymentDiscount = 'referral_15';
          }
        } else if (
          resolvedStudentId
          && (effectivePaymentDiscount === 'none' || effectivePaymentDiscount === 'referral_15')
        ) {
          pendingDiscountBenefit = await queryOne(
            `SELECT *
             FROM academy_referral_benefits
             WHERE student_id = $1
               AND benefit_type = 'next_payment_discount_15'
               AND status = 'pending'
             LIMIT 1
             FOR UPDATE`,
            [resolvedStudentId],
          );
          if (pendingDiscountBenefit && effectivePaymentDiscount === 'none') {
            effectivePaymentDiscount = 'referral_15';
          }
        }

        if (
          effectivePaymentDiscount === 'referral_15'
          && !firstReferralPaymentEligible
          && !pendingDiscountBenefit
        ) {
          throw Object.assign(new Error('referralDiscountNotAvailable'), { statusCode: 409 });
        }
      } else if (effectivePaymentDiscount === 'referral_15') {
        throw Object.assign(new Error('referralDiscountRequiresPaidPayment'), { statusCode: 409 });
      }

      const paymentValues = {
        leadId: paymentLeadId,
        studentId: resolvedStudentId,
        groupId: existingStudent?.groupId ?? lead?.enrolledGroupId ?? requestedGroupId,
        amountUzs,
        type: paymentType,
        method: paymentMethod,
        paidAt,
        period: paymentPeriod,
        discount: effectivePaymentDiscount,
        status,
        dueAt: requestedDueAt,
        paidUntil,
        comment: nullableText(req.body.comment),
        receiptUrl: nullableText(req.body.receiptUrl),
        confirmedBy: status === 'paid' ? req.user!.id : null,
      };
      const payment = pendingPayment
        ? await updateRow('academy_payments', Number(pendingPayment.id), paymentValues)
        : await insertRow('academy_payments', paymentValues);
      if (!payment) throw Object.assign(new Error('Failed to save payment'), { statusCode: 500 });

      if (pendingDiscountBenefit) {
        await consumeReferralBenefit(Number(pendingDiscountBenefit.id), Number(payment.id));
      }

      if (pendingPayment) {
        await query(
          `UPDATE academy_tasks
           SET status = 'done', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
           WHERE entity_type = 'payment'
             AND entity_id = $1
             AND status <> 'done'`,
          [pendingPayment.id],
        );
      }

      let student = existingStudent ?? null;
      if (status === 'paid' && leadId) {
        student = await createStudentFromLead(req, leadId, payment.id);
      }
      const paidStudentId = student?.id ?? studentId;
      if (status === 'paid' && paidStudentId) {
        if (firstReferralPaymentEligible) {
          await ensureReferralBenefit({
            studentId: Number(paidStudentId),
            benefitType: 'referred_first_payment_discount_15',
            status: effectivePaymentDiscount === 'referral_15' ? 'consumed' : 'superseded',
            sourcePaymentId: Number(payment.id),
            consumedByPaymentId: Number(payment.id),
            consumedAt: new Date(),
          });
        }
        await advanceStudentNextPaymentAt(
          Number(paidStudentId),
          payment.paidUntil ?? paidUntil,
        );
        await applyReferralRewards(req, Number(paidStudentId), paymentLeadId, payment.id);
      }

      await createAudit(
        req,
        pendingPayment ? 'CONFIRM_ACADEMY_PAYMENT' : 'CREATE_ACADEMY_PAYMENT',
        'academy_payment',
        payment.id,
        payment,
        pendingPayment,
      );
      return { payment, student };
    });

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Failed to create payment', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create payment' });
  }
});

router.post('/surveys/lesson', async (req, res) => {
  if (!ensureOperationsAccess(req, res)) return;
  try {
    const score = Number(req.body.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) return res.status(400).json({ error: 'Score must be from 1 to 5' });
    const lessonId = parseId(req.body.lessonId);
    const studentId = parseId(req.body.studentId);
    if (!lessonId || !studentId) return res.status(400).json({ error: 'Lesson and student are required' });
    const result = await withTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`lesson-survey:${lessonId}:${studentId}`]);
      const lesson = await queryOne(
        `SELECT l.*, t.user_id AS teacher_user_id
         FROM academy_lessons l
         LEFT JOIN academy_teachers t ON t.id = l.teacher_id
         WHERE l.id = $1
         FOR UPDATE OF l`,
        [lessonId],
      );
      if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 });
      const student = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [studentId],
      );
      if (!student) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      const membership = await queryOne<{ belongsToGroup: boolean }>(
        `SELECT COALESCE(
           (
             SELECT transfer.to_group_id
             FROM academy_student_transfers transfer
             WHERE transfer.student_id = $1
               AND transfer.created_at <= $3
             ORDER BY transfer.created_at DESC, transfer.id DESC
             LIMIT 1
           ),
           (
             SELECT first_transfer.from_group_id
             FROM academy_student_transfers first_transfer
             WHERE first_transfer.student_id = $1
             ORDER BY first_transfer.created_at, first_transfer.id
             LIMIT 1
           ),
           (SELECT group_id FROM academy_students WHERE id = $1)
         ) = $2 AS belongs_to_group`,
        [studentId, lesson.groupId, lesson.scheduledAt],
      );
      if (membership && membership.belongsToGroup !== true) {
        throw Object.assign(new Error('Student does not belong to this lesson group'), { statusCode: 400 });
      }
      if (
        !hasLeadershipAccess(req.user)
        && (!lesson.teacherUserId || Number(lesson.teacherUserId) !== Number(req.user!.id))
      ) {
        throw Object.assign(new Error('Teacher can submit surveys only for own lessons'), { statusCode: 403 });
      }

      const oldSurvey = await queryOne(
        `SELECT *
         FROM academy_lesson_surveys
         WHERE lesson_id = $1 AND student_id = $2
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [lessonId, studentId],
      );
      const values = {
        groupId: lesson.groupId,
        teacherId: lesson.teacherId,
        courseId: lesson.courseId,
        score,
        liked: nullableText(req.body.liked),
        improve: nullableText(req.body.improve),
      };
      const survey = oldSurvey
        ? await updateRow('academy_lesson_surveys', Number(oldSurvey.id), values)
        : await insertRow('academy_lesson_surveys', { studentId, lessonId, ...values });
      if (!survey) throw Object.assign(new Error('Failed to save lesson survey'), { statusCode: 500 });
      await recalculateStudentMetrics(studentId);

      let notification: { userId: number; taskId: number } | null = null;
      if (score < 3) {
        const leader = await queryOne<{ id: string }>(
          `SELECT u.id FROM users u WHERE ${leadershipUserAccessSql} AND u.is_active=true ORDER BY u.id LIMIT 1`,
        );
        const responsibleId = Number(student.managerId ?? leader?.id ?? req.user!.id);
        const taskResult = await createTaskOnce('Оценка урока ниже 3 — связаться с учеником', {
          responsibleId,
          description: `Ученик поставил ${score}/5. Свяжитесь и узнайте причину.`,
          entityType: 'lesson_survey',
          entityId: Number(survey.id),
          deadlineAt: addMinutes(new Date(), 12 * 60),
        });
        if (taskResult.created && student.managerId) {
          notification = { userId: Number(student.managerId), taskId: Number(taskResult.task.id) };
        }
      }
      return { survey, oldSurvey, created: !oldSurvey, notification };
    });

    if (result.notification) {
      await createNotification(
        result.notification.userId,
        'Низкая оценка урока',
        `Оценка ${score}/5 — задача закрывается за 12 часов.`,
        'academy_task',
        result.notification.taskId,
      );
    }
    await createAudit(
      req,
      result.created ? 'CREATE_ACADEMY_LESSON_SURVEY' : 'UPDATE_ACADEMY_LESSON_SURVEY',
      'academy_lesson_survey',
      Number(result.survey.id),
      result.survey,
      result.oldSurvey,
    );
    res.status(result.created ? 201 : 200).json(result.survey);
  } catch (error: any) {
    logger.error('Failed to save lesson survey', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to save lesson survey' });
  }
});

router.post('/surveys/parent', async (req, res) => {
  if (!ensureSalesAccess(req, res)) return;
  try {
    const studentId = parseId(req.body.studentId);
    if (!studentId) return res.status(400).json({ error: 'Student is required' });
    const rawNpsScore = req.body.npsScore;
    const npsScore = rawNpsScore === undefined || rawNpsScore === null || rawNpsScore === ''
      ? null
      : Number(rawNpsScore);
    if (npsScore !== null && (!Number.isInteger(npsScore) || npsScore < 0 || npsScore > 10)) {
      return res.status(400).json({ error: 'NPS score must be from 0 to 10' });
    }
    let period = nullableText(req.body.period);
    if (!period) {
      const periodRow = await queryOne<{ period: string }>(
        `SELECT to_char(NOW() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS period`,
      );
      period = periodRow?.period;
    }
    if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return res.status(400).json({ error: 'Invalid survey period' });
    }

    const result = await withTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`parent-survey:${studentId}:${period}`]);
      const student = await queryOne(
        `SELECT * FROM academy_students WHERE id = $1 FOR UPDATE`,
        [studentId],
      );
      if (!student) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
      if (
        !hasLeadershipAccess(req.user)
        && Number(student.managerId) !== Number(req.user!.id)
      ) {
        throw Object.assign(new Error('Sales employee can submit surveys only for own students'), { statusCode: 403 });
      }

      const oldSurvey = await queryOne(
        `SELECT *
         FROM academy_parent_surveys
         WHERE student_id = $1 AND period = $2
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [studentId, period],
      );
      const values = {
        groupId: student.groupId ?? null,
        courseId: student.courseId ?? null,
        progressAnswer: nullableText(req.body.progressAnswer),
        joyAnswer: nullableText(req.body.joyAnswer),
        continueAnswer: nullableText(req.body.continueAnswer),
        npsScore,
        comment: nullableText(req.body.comment),
        period,
      };
      const survey = oldSurvey
        ? await updateRow('academy_parent_surveys', Number(oldSurvey.id), values)
        : await insertRow('academy_parent_surveys', { studentId, ...values });
      if (!survey) throw Object.assign(new Error('Failed to save parent survey'), { statusCode: 500 });
      await updateRow('academy_students', studentId, { parentFeedback: values.comment });

      const notifications: Array<{ userId: number; taskId: number; title: string; message: string }> = [];
      const responsibleId = Number(student.managerId ?? req.user!.id);
      if (npsScore !== null && npsScore <= 6) {
        const leader = await queryOne<{ id: string }>(
          `SELECT u.id FROM users u WHERE ${leadershipUserAccessSql} AND u.is_active=true ORDER BY u.id LIMIT 1`,
        );
        const lowNpsTask = await createTaskOnce('Низкий NPS родителя — связаться с семьёй', {
          responsibleId: Number(student.managerId ?? leader?.id ?? req.user!.id),
          description: `Родитель поставил NPS ${npsScore}/10. Уточните причину и зафиксируйте решение.`,
          entityType: 'parent_survey',
          entityId: Number(survey.id),
          deadlineAt: addMinutes(new Date(), 12 * 60),
        });
        if (lowNpsTask.created && student.managerId) {
          notifications.push({
            userId: Number(student.managerId),
            taskId: Number(lowNpsTask.task.id),
            title: 'Низкий NPS родителя',
            message: 'Создана задача со сроком 12 часов.',
          });
        }
      }
      if (['Не уверен', 'Нет', 'not_sure', 'no'].includes(String(req.body.continueAnswer))) {
        await createTaskOnce('Родитель сомневается в продолжении', {
          responsibleId,
          description: 'Позвонить и узнать причину.',
          entityType: 'parent_survey',
          entityId: Number(survey.id),
          deadlineAt: addDays(new Date(), 1),
        });
      }
      return { survey, oldSurvey, created: !oldSurvey, notifications };
    });

    for (const notification of result.notifications) {
      await createNotification(
        notification.userId,
        notification.title,
        notification.message,
        'academy_task',
        notification.taskId,
      );
    }
    await createAudit(
      req,
      result.created ? 'CREATE_ACADEMY_PARENT_SURVEY' : 'UPDATE_ACADEMY_PARENT_SURVEY',
      'academy_parent_survey',
      Number(result.survey.id),
      result.survey,
      result.oldSurvey,
    );
    res.status(result.created ? 201 : 200).json(result.survey);
  } catch (error: any) {
    logger.error('Failed to save parent survey', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to save parent survey' });
  }
});

router.get('/integrations/status', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const logs = await query(
      `SELECT DISTINCT ON (provider) provider, direction, status, error_message, updated_at, created_at
       FROM academy_integration_logs
       ORDER BY provider, created_at DESC`,
      [],
    );
    const instagramAccounts = await query<{ connectedCount: number }>(
      `SELECT COUNT(*)::int AS connected_count
       FROM instagram_accounts
       WHERE status = 'connected'`,
    );
    const integ = appConfig.integrations ?? {};
    const hasSuccessfulInboundLog = (provider: string) =>
      logs.some((log) =>
        log.provider === provider
        && log.direction === 'inbound'
        && ['received', 'duplicate'].includes(String(log.status))
      );
    const providers = [
      {
        provider: 'instagram',
        connected: Number(instagramAccounts[0]?.connectedCount ?? 0) > 0,
        note: 'Instagram Login, Direct messages and automatic lead creation',
      },
      { provider: 'website', connected: Boolean(integ.website?.webhookSecret) || hasSuccessfulInboundLog('website'), note: 'Website lead inbound webhook' },
    ];
    res.json(providers.map((entry) => ({
      provider: entry.provider,
      mode: entry.connected ? 'live' : 'stub',
      connected: entry.connected,
      lastLog: logs.find((log) => log.provider === entry.provider) ?? null,
      message: entry.connected
        ? `${entry.note}: подключено.`
        : `${entry.note}: режим-заглушка. Заполните ключи в config/app.config.json.`,
    })));
  } catch (error) {
    logger.error('Failed to fetch integrations status', { error });
    res.status(500).json({ error: 'Failed to fetch integrations status' });
  }
});

router.post('/integrations/:provider/test', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const provider = String(req.params.provider);
    // Actually exercise the channel so the test reflects real connectivity.
    if (provider === 'telegram') {
      const { sendTelegramMessage } = await import('../services/telegram');
      const recipient = nullableText(req.body.recipient) ?? appConfig.integrations?.telegram?.leadershipChatId ?? 'leadership';
      const result = await sendTelegramMessage(recipient, '01 Academy: тест интеграции Telegram ✅');
      const log = await logIntegration('telegram', 'outbound', result.ok ? (result.simulated ? 'simulated' : 'sent') : 'failed', { result }, result.error ?? null);
      return res.json({ ok: result.ok, simulated: result.simulated, error: result.error, log });
    }
    if (provider === 'whatsapp') {
      const { sendWhatsAppMessage } = await import('../services/whatsapp');
      const recipient = nullableText(req.body.recipient) ?? '+998901234567';
      const result = await sendWhatsAppMessage(recipient, '01 Academy: тест интеграции WhatsApp ✅');
      const log = await logIntegration('whatsapp', 'outbound', result.ok ? (result.simulated ? 'simulated' : 'sent') : 'failed', { result }, result.error ?? null);
      return res.json({ ok: result.ok, simulated: result.simulated, error: result.error, log });
    }
    const log = await logIntegration(provider, 'outbound', 'stub_sent', req.body ?? {});
    res.json({ ok: true, mode: 'safe_stub', log });
  } catch (error) {
    logger.error('Failed to test integration', { error });
    res.status(500).json({ error: 'Failed to test integration' });
  }
});

router.post('/automations/run', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, OPERATIONS_WORKSPACES, 'Operations access required')) return;
  try {
    // Manual and scheduled runs must share the same locking/idempotency rules.
    // Keeping a second implementation here previously produced duplicate tasks
    // and mailings that the scheduled worker correctly avoided.
    const actions = await runAutomations(req.user!.id);
    res.json({ ok: true, actions });
  } catch (error) {
    logger.error('Failed to run academy automations', { error });
    res.status(500).json({ error: 'Failed to run academy automations' });
  }
});

router.post('/mailings/:id/event', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid mailing id' });
    const outbox = await queryOne(`SELECT * FROM academy_notification_outbox WHERE id = $1`, [id]);
    if (!outbox) return res.status(404).json({ error: 'Mailing not found' });

    const eventType = nullableText(req.body.eventType) ?? 'opened';
    await logIntegration(`mailing_${outbox.channel}`, 'inbound', eventType, {
      outboxId: id,
      entityType: outbox.entityType,
      entityId: outbox.entityId,
      payload: req.body });

    if (eventType === 'reply' && outbox.entityType === 'lead' && outbox.entityId) {
      const lead = await getLead(Number(outbox.entityId));
      if (lead?.statusCode === 'not_now' && !lead.isArchived) {
        const updated = await updateRow('academy_leads', lead.id, {
          statusCode: 'first_contact',
          warmReason: null });
        await createStageHistory(lead.id, 'not_now', 'first_contact', req.user!.id, 'Отклик на рассылку');
        await createTask('Лид откликнулся из тёплой базы', {
          responsibleId: updated?.managerId ?? req.user!.id,
          entityType: 'lead',
          entityId: lead.id,
          deadlineAt: addDays(new Date(), 1) });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    logger.error('Failed to record mailing event', { error });
    res.status(500).json({ error: 'Failed to record mailing event' });
  }
});

router.all(
  [
    '/finance',
    '/payroll',
    '/payroll/*',
    '/exports/:entity',
    '/groups/profitability',
  ],
  (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  },
);

const parseCourseWithTeachersPayload = (body: Row) => {
  const name = nullableText(body.name);
  const slug = nullableText(body.slug);
  const ageCategory = nullableText(body.ageCategory);
  const description = nullableText(body.description) ?? null;
  const basePriceUzs = Number(body.basePriceUzs);
  if (!name || name.length > 255) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (!slug || slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (!ageCategory || ageCategory.length > 100) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (!Number.isSafeInteger(basePriceUzs) || basePriceUzs < 0 || basePriceUzs > 2_147_483_647) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (typeof body.isActive !== 'boolean') {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  if (!Array.isArray(body.teacherIds) || body.teacherIds.length > 1_000) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  const parsedTeacherIds = body.teacherIds.map(parseId);
  if (parsedTeacherIds.some((id) => !id)) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  const teacherIds = [...new Set(parsedTeacherIds as number[])].sort((left, right) => left - right);
  return {
    courseValues: { name, slug, ageCategory, description, basePriceUzs, isActive: body.isActive },
    teacherIds,
  };
};

const readTeacherCourseIds = (value: unknown): number[] => {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0))]
    .sort((left, right) => left - right);
};

const syncCourseTeacherAssignments = async (courseId: number, selectedTeacherIds: number[]) => {
  // Keep course capabilities in sync with live teaching obligations. The same
  // scheduling lock is used by group/lesson mutations, so a new obligation
  // cannot appear between this dependency check and the teacher updates.
  await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
  const requiredAssignments = await query<{ teacherId: number }>(
    `SELECT DISTINCT assignment.teacher_id
     FROM (
       SELECT teacher_id
       FROM academy_groups
       WHERE course_id = $1
         AND status IN ('open', 'in_progress')
         AND teacher_id IS NOT NULL
       UNION
       SELECT teacher_id
       FROM academy_lessons
       WHERE course_id = $1
         AND status = 'scheduled'
         AND teacher_id IS NOT NULL
     ) assignment
     ORDER BY assignment.teacher_id`,
    [courseId],
  );
  const teachers = await query(
    `SELECT * FROM academy_teachers ORDER BY id FOR UPDATE`,
  );
  const teacherIds = new Set(teachers.map((teacher) => Number(teacher.id)));
  if (selectedTeacherIds.some((teacherId) => !teacherIds.has(teacherId))) {
    throw Object.assign(new Error('One or more teachers were not found'), { statusCode: 400 });
  }
  const selected = new Set(selectedTeacherIds);
  const required = new Set(requiredAssignments.map((assignment) => Number(assignment.teacherId)));
  for (const teacher of teachers) {
    const previousIds = readTeacherCourseIds(teacher.courseIds);
    const nextIds = previousIds.filter((id) => id !== courseId);
    if (selected.has(Number(teacher.id)) || required.has(Number(teacher.id))) nextIds.push(courseId);
    nextIds.sort((left, right) => left - right);
    if (
      previousIds.length !== nextIds.length
      || previousIds.some((id, index) => id !== nextIds[index])
    ) {
      await updateRow('academy_teachers', Number(teacher.id), { courseIds: nextIds });
    }
  }
};

const saveCourseWithTeachers = async (req: any, courseId?: number) => {
  const { courseValues, teacherIds } = parseCourseWithTeachersPayload(req.body ?? {});
  return withTransaction(async () => {
    const oldCourse = courseId
      ? await queryOne(`SELECT * FROM academy_courses WHERE id = $1 FOR UPDATE`, [courseId])
      : null;
    if (courseId && !oldCourse) {
      throw Object.assign(new Error('courses not found'), { statusCode: 404 });
    }
    if (courseId && oldCourse?.isActive !== false && courseValues.isActive === false) {
      const activeGroup = await queryOne(
        `SELECT id
         FROM academy_groups
         WHERE course_id = $1 AND status IN ('open', 'in_progress')
         LIMIT 1
         FOR SHARE`,
        [courseId],
      );
      if (activeGroup) {
        throw Object.assign(new Error('courseHasActiveGroups'), { statusCode: 409 });
      }
    }
    const course = courseId
      ? await updateRow('academy_courses', courseId, courseValues)
      : await insertRow('academy_courses', courseValues);
    if (!course) throw Object.assign(new Error('Failed to save courses'), { statusCode: 500 });
    await syncCourseTeacherAssignments(Number(course.id), teacherIds);
    return { course, oldCourse };
  });
};

router.post('/courses/with-teachers', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const result = await saveCourseWithTeachers(req);
    await createAudit(req, 'CREATE_ACADEMY_COURSE_WITH_TEACHERS', 'academy_course', Number(result.course.id), result.course);
    res.status(201).json(result.course);
  } catch (error: any) {
    logger.error('Failed to create course with teacher assignments', { error });
    const duplicateSlug = error?.code === '23505' && String(error?.constraint ?? '').includes('academy_courses_slug');
    res.status(duplicateSlug ? 409 : error.statusCode || 500).json({
      error: duplicateSlug ? 'courseSlugAlreadyExists' : error.message || 'Failed to create courses',
    });
  }
});

router.patch('/courses/:id/with-teachers', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  const courseId = parseId(req.params.id);
  if (!courseId) return res.status(400).json({ error: 'Invalid courses id' });
  try {
    const result = await saveCourseWithTeachers(req, courseId);
    await createAudit(
      req,
      'UPDATE_ACADEMY_COURSE_WITH_TEACHERS',
      'academy_course',
      courseId,
      result.course,
      result.oldCourse,
    );
    res.json(result.course);
  } catch (error: any) {
    logger.error('Failed to update course with teacher assignments', { error, courseId });
    const duplicateSlug = error?.code === '23505' && String(error?.constraint ?? '').includes('academy_courses_slug');
    res.status(duplicateSlug ? 409 : error.statusCode || 500).json({
      error: duplicateSlug ? 'courseSlugAlreadyExists' : error.message || 'Failed to update courses',
    });
  }
});

router.delete('/courses/:id', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  const courseId = parseId(req.params.id);
  if (!courseId) return res.status(400).json({ error: 'Invalid courses id' });
  try {
    const oldCourse = await withTransaction(async () => {
      const course = await queryOne(`SELECT * FROM academy_courses WHERE id = $1 FOR UPDATE`, [courseId]);
      if (!course) throw Object.assign(new Error('courses not found'), { statusCode: 404 });
      await syncCourseTeacherAssignments(courseId, []);
      await query(`DELETE FROM academy_courses WHERE id = $1`, [courseId]);
      return course;
    });
    await createAudit(req, 'DELETE_ACADEMY_COURSE', 'academy_course', courseId, undefined, oldCourse);
    res.json({ ok: true });
  } catch (error: any) {
    logger.error('Failed to delete course', { error, courseId });
    const isForeignKeyConflict = error?.code === '23503';
    res.status(error.statusCode || (isForeignKeyConflict ? 409 : 500)).json({
      error: isForeignKeyConflict ? 'resourceInUse' : error.message || 'Failed to delete courses',
    });
  }
});

router.put('/pipeline-statuses/reorder', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    if (!Array.isArray(req.body.orderedStatusIds) || req.body.orderedStatusIds.length === 0) {
      return res.status(400).json({ error: 'invalidData' });
    }
    const parsedIds = req.body.orderedStatusIds.map(parseId);
    if (parsedIds.some((id: number | null) => !id) || new Set(parsedIds).size !== parsedIds.length) {
      return res.status(400).json({ error: 'invalidData' });
    }
    const orderedStatusIds = parsedIds as number[];
    const statuses = await withTransaction(async () => {
      const locked = await query(
        `SELECT * FROM academy_lead_statuses ORDER BY id FOR UPDATE`,
      );
      const actualIds = new Set(locked.map((status) => Number(status.id)));
      if (
        actualIds.size !== orderedStatusIds.length
        || orderedStatusIds.some((statusId) => !actualIds.has(statusId))
      ) {
        throw Object.assign(new Error('pipelineConfigurationChanged'), { statusCode: 409 });
      }
      await query(
        `UPDATE academy_lead_statuses AS status
         SET sort_order = (ordered.position * 10)::int,
             updated_at = NOW()
         FROM UNNEST($1::int[]) WITH ORDINALITY AS ordered(id, position)
         WHERE status.id = ordered.id`,
        [orderedStatusIds],
      );
      return query(`SELECT * FROM academy_lead_statuses ORDER BY sort_order, id`);
    });
    await createAudit(req, 'REORDER_ACADEMY_LEAD_STATUSES', 'academy_lead_statuses', 0, {
      orderedStatusIds,
    });
    res.json(statuses);
  } catch (error: any) {
    logger.error('Failed to reorder pipeline statuses', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to reorder pipeline statuses' });
  }
});

router.get('/pipeline-statuses/:id/usage', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid pipeline stage id' });

    const status = await queryOne(
      `SELECT id, code, name
       FROM academy_lead_statuses
       WHERE id = $1`,
      [id],
    );
    if (!status) return res.status(404).json({ error: 'pipeline-statuses not found' });

    res.json({
      id: Number(status.id),
      code: status.code,
      name: status.name,
      leadCount: await getLeadCountForStatusCode(String(status.code)),
    });
  } catch (error) {
    logger.error('Failed to fetch pipeline stage usage', { error, statusId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch pipeline stage usage' });
  }
});

router.post('/pipeline-statuses/:id/transfer-leads-and-delete', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const id = parseId(req.params.id);
    const targetStatusId = parseId(req.body.targetStatusId);
    if (!id) return res.status(400).json({ error: 'Invalid pipeline stage id' });
    if (!targetStatusId) return res.status(400).json({ error: 'targetPipelineStageRequired' });
    if (Number(targetStatusId) === Number(id)) {
      return res.status(400).json({ error: 'targetPipelineStageMustDiffer' });
    }

    const result = await withTransaction(async () => {
      const lockedStatuses = await query(
        `SELECT *
         FROM academy_lead_statuses
         WHERE id = ANY($1::int[])
         ORDER BY id
         FOR UPDATE`,
        [[id, targetStatusId]],
      );
      const source = lockedStatuses.find((status) => Number(status.id) === Number(id));
      if (!source) {
        throw Object.assign(new Error('pipeline-statuses not found'), { statusCode: 404 });
      }
      if (source.isPipeline !== true) {
        throw Object.assign(new Error('sourcePipelineStageRequired'), { statusCode: 400 });
      }
      if (source.isSystem === true) {
        throw Object.assign(new Error('systemPipelineStageCannotBeDeleted'), { statusCode: 409 });
      }

      const target = lockedStatuses.find(
        (status) => Number(status.id) === Number(targetStatusId),
      );
      if (!target) {
        throw Object.assign(new Error('targetPipelineStageRequired'), { statusCode: 400 });
      }
      if (target.isActive === false) {
        throw Object.assign(new Error('targetPipelineStageMustBeActive'), { statusCode: 400 });
      }
      if (target.isPipeline !== true) {
        throw Object.assign(new Error('targetPipelineStageRequired'), { statusCode: 400 });
      }
      const transitionError = validateLeadStatusTransition(String(source.code), String(target.code));
      if (transitionError) {
        throw Object.assign(new Error(transitionError), { statusCode: 409 });
      }

      const leads = await query<Row>(
        `SELECT *
         FROM academy_leads
         WHERE status_code = $1
         ORDER BY id
         FOR UPDATE`,
        [source.code],
      );
      const leadIds = leads.map((lead) => Number(lead.id));

      for (const lead of leads) {
        const validationError = validateLeadForStatusChange({
          nextStatus: String(target.code),
          studentName: lead.studentName,
          studentAge: lead.studentAge,
          courseId: lead.courseId,
          enrolledGroupId: lead.enrolledGroupId,
        });
        if (validationError) {
          throw Object.assign(new Error(validationError), {
            statusCode: 409,
            leadId: lead.id,
          });
        }
      }

      const enrollmentGroupIds = [...new Set(
        leads
          .filter(() => ['enrolled', 'paid'].includes(String(target.code)))
          .map((lead) => Number(lead.enrolledGroupId))
          .filter((groupId) => Number.isInteger(groupId) && groupId > 0),
      )].sort((left, right) => left - right);
      for (const groupId of enrollmentGroupIds) {
        await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupId]);
        const leadsInGroup = leads.filter(
          (lead) => Number(lead.enrolledGroupId) === Number(groupId),
        );
        for (const lead of leadsInGroup) {
          await validateEnrollmentGroup(groupId, Number(lead.id));
        }
      }

      if (leadIds.length > 0) {
        await query(
          `INSERT INTO academy_lead_stage_history
            (lead_id, from_status_code, to_status_code, changed_by, comment)
           SELECT id, $1, $2, $3, $4
           FROM academy_leads
           WHERE id = ANY($5::int[])`,
          [
            source.code,
            target.code,
            req.user!.id,
            'Массовый перенос перед удалением этапа воронки',
            leadIds,
          ],
        );

        await query(
          `UPDATE academy_leads
           SET status_code = $1,
               updated_at = NOW()
           WHERE id = ANY($2::int[])`,
          [target.code, leadIds],
        );
        for (const lead of leads) {
          await handleLeadAutomation(
            req,
            { ...lead, statusCode: target.code },
            String(source.code),
          );
        }
      }

      await query(`DELETE FROM academy_lead_statuses WHERE id = $1`, [id]);

      return {
        deletedStatus: source,
        targetStatus: target,
        movedCount: leadIds.length,
      };
    });

    await createAudit(
      req,
      'DELETE_ACADEMY_LEAD_STATUS_WITH_TRANSFER',
      'academy_lead_statuses',
      id,
      {
        targetStatusId: result.targetStatus.id,
        targetStatusCode: result.targetStatus.code,
        movedCount: result.movedCount,
      },
      result.deletedStatus,
    );

    res.json({
      ok: true,
      movedCount: result.movedCount,
      targetStatus: result.targetStatus,
    });
  } catch (error: any) {
    logger.error('Failed to transfer leads and delete pipeline stage', { error, statusId: req.params.id });
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to transfer leads and delete pipeline stage',
    });
  }
});

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
  beforeUpdate: async ({ id, values, row, req }) => {
    await assertGroupLifecycleUpdateAllowed({
      id,
      values,
      row,
      autoAssignRequested: req.body.autoAssign === true,
    });
  },
  beforeDelete: async ({ id }) => {
    const usage = await queryOne<{ inUse: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM academy_students WHERE group_id = $1)
         OR EXISTS (SELECT 1 FROM academy_leads WHERE enrolled_group_id = $1)
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
  allowedWorkspaces: SOURCE_MANAGEMENT_WORKSPACES,
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

export default router;
