import { Router } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { appConfig } from '../config';
import { requireAuth } from '../middleware/auth.middleware';
import { storage } from '../storage';
import { logger } from '../lib/logger';
import { getWorkforcePolicy, isRestrictedAtCurrentTime, maskPhone } from '../services/workforce-policy';
import {
  ACTIVE_PIPELINE_STATUSES,
  CHURN_REASONS,
  FINAL_PROJECT_STATUSES,
  GROUP_STATUSES,
  LEAD_STATUSES,
  LESSON_STATUSES,
  PAYMENT_DISCOUNTS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
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
  calculateRetentionPercent,
  calculateRoas,
  calculateTrend,
  getComputedPaymentStatus,
  normalizeMoney,
  resolveReferralLevel,
  suggestCourseSlugByAge,
  validateLeadForStatusChange,
  validateLeadStatusTransition } from '@shared/academy';
import {
  getGroupScheduleValidationError,
  normalizeWeeklySchedule,
  parseScheduleTimeToMinutes,
  scheduleDateRangesOverlap,
  scheduleIntervalsOverlap,
  weeklySchedulesOverlap,
  type NormalizedWeeklyScheduleItem,
} from '@shared/scheduling';

const router = Router();

router.use(requireAuth);

type DbValue = string | number | boolean | Date | null | unknown[] | Record<string, unknown>;
type Row = Record<string, any>;
const transactionContext = new AsyncLocalStorage<PoolClient>();

const ADMINISTRATION_WORKSPACES = new Set(['administration']);
const FINANCE_WORKSPACES = new Set(['analytics', 'administration']);
const OPERATIONS_WORKSPACES = new Set(['analytics', 'administration']);
const ANALYTICS_WORKSPACES = new Set(['analytics', 'administration']);
const MARKETING_WORKSPACES = new Set(['marketing', 'administration']);
const SALES_WORKSPACES = new Set(['sales', 'administration']);
const LEAD_WORKSPACES = new Set(['administration', 'sales', 'marketing']);
const SOURCE_MANAGEMENT_WORKSPACES = new Set(['administration', 'marketing']);

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
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const nullableText = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const nullableDate = (value: unknown) => {
  const text = nullableText(value);
  if (text === undefined || text === null) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIntegerOrNull = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
};

const safeJson = (value: unknown, fallback: unknown[] = []) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null || value === '') return JSON.stringify(fallback);
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return JSON.stringify(fallback);
    }
  }
  return JSON.stringify(value);
};

const toBoolean = (value: unknown, fallback?: boolean) => {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
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

const normalizeDbValue = (value: DbValue) => {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value);
  return value;
};

const resolveLeadManagerId = async (req: any, requestedValue: unknown): Promise<number> => {
  if (req.user?.workspace === 'sales') {
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
       FROM users
       WHERE id = $1 AND workspace = 'sales' AND is_active = true`,
      [requestedId],
    );
    if (!manager) {
      throw Object.assign(new Error('Active account manager is required'), { statusCode: 400 });
    }
    return Number(manager.id);
  }

  const manager = await queryOne<{ id: string }>(
    `SELECT u.id
     FROM users u
     LEFT JOIN academy_leads l
       ON l.manager_id = u.id
      AND l.status_code NOT IN ('paid', 'not_now')
     WHERE u.workspace = 'sales' AND u.is_active = true
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
  await pool.query(`DELETE FROM ${quoteIdent(table)} WHERE id = $1`, [id]);
};

const ensureFinanceAccess = (req: any, res: any) => {
  if (req.user?.workspace === 'administration' || FINANCE_WORKSPACES.has(req.user?.workspace)) return true;
  res.status(403).json({ error: 'Finance access required' });
  return false;
};

const ensureOperationsAccess = (req: any, res: any) => {
  if (req.user?.workspace === 'administration' || OPERATIONS_WORKSPACES.has(req.user?.workspace) || req.user?.workspace === 'teacher') return true;
  res.status(403).json({ error: 'Operations access required' });
  return false;
};

const ensureMarketingAccess = (req: any, res: any) => {
  if (MARKETING_WORKSPACES.has(req.user?.workspace)) return true;
  res.status(403).json({ error: 'Marketing access required' });
  return false;
};

const ensureWorkspaceAccess = (req: any, res: any, workspaces: Set<string>, message: string) => {
  if (req.user?.workspace === 'administration' || workspaces.has(String(req.user?.workspace))) return true;
  res.status(403).json({ error: message });
  return false;
};

const ensureSalesAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, SALES_WORKSPACES, 'Sales access required');

const ensureSalesWorkspaceAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, SALES_WORKSPACES, 'Sales workspace access required');

const ensureTeacherWorkspaceAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, new Set(['teacher']), 'Teacher workspace access required');

const ensureAnalyticsWorkspaceAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, ANALYTICS_WORKSPACES, 'Analytics workspace access required');

const ensureMarketingWorkspaceAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, MARKETING_WORKSPACES, 'Marketing workspace access required');

const ensureAdministrationWorkspaceAccess = (req: any, res: any) =>
  ensureWorkspaceAccess(req, res, ADMINISTRATION_WORKSPACES, 'Admin access required');

const canAccessLeadRow = (req: any, lead?: Row | null) => {
  if (!lead) return false;
  const workspace = String(req.user?.workspace);
  if (workspace === 'administration' || workspace === 'marketing') return true;
  return workspace === 'sales' && Number(lead.managerId) === Number(req.user?.id);
};

const ensureLeadRowAccess = (req: any, res: any, lead?: Row | null) => {
  if (canAccessLeadRow(req, lead)) return true;
  res.status(403).json({ error: 'Lead access required' });
  return false;
};

const redactLeadPhonesForActor = async (actor: DatasetActor | undefined, leads: Row[]) => {
  if (actor?.workspace !== 'sales') return leads;
  const policy = await getWorkforcePolicy();
  return leads.map((lead) => {
    const ownsLead = Number(lead.managerId) === Number(actor.userId);
    const shouldMask = policy.salesPhoneVisibility === 'own_leads'
      ? !ownsLead
      : !lead.managerId || !ownsLead;
    return shouldMask ? { ...lead, phone: maskPhone(lead.phone) } : lead;
  });
};

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
  salesCommissionPercent: 0,
  groupMinFillPercent: 60,
  currentCashBalanceUzs: 0,
  salesPhoneVisibility: 'own_leads',
  workdayStartHour: 8,
  workdayEndHour: 20,
  workdays: [1, 2, 3, 4, 5],
};

const getCompanySettings = async () => {
  const existing = await queryOne(`SELECT * FROM academy_company_settings ORDER BY id LIMIT 1`);
  if (existing) return existing;
  return insertRow('academy_company_settings', defaultCompanyTargets);
};

const payrollPeriodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

const getPayrollPeriodBounds = (period: unknown) => {
  const normalized = String(period ?? '');
  if (!payrollPeriodPattern.test(normalized)) return null;
  const [year, month] = normalized.split('-').map(Number);
  return {
    period: normalized,
    from: new Date(year, month - 1, 1),
    to: new Date(year, month, 1),
  };
};

const currentPayrollPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const calculatePayroll = async (periodValue: unknown) => {
  const bounds = getPayrollPeriodBounds(periodValue);
  if (!bounds) {
    throw Object.assign(new Error('Payroll period must use YYYY-MM format'), { statusCode: 400 });
  }

  const [settings, teachers, managers, recordedEntries] = await Promise.all([
    getCompanySettings(),
    query(
      `SELECT t.id AS teacher_id, t.user_id AS employee_user_id, t.full_name AS employee_name,
              t.rate_per_lesson_uzs,
              COUNT(l.id)::int AS conducted_lessons
       FROM academy_teachers t
       LEFT JOIN academy_lessons l
         ON l.teacher_id = t.id
        AND l.status = 'conducted'
        AND l.scheduled_at >= $1
        AND l.scheduled_at < $2
       WHERE t.status = 'active'
       GROUP BY t.id, t.user_id, t.full_name, t.rate_per_lesson_uzs
       ORDER BY t.full_name`,
      [bounds.from, bounds.to],
    ),
    query(
      `SELECT u.id AS employee_user_id, u.full_name AS employee_name, u.base_salary_uzs,
              COALESCE(SUM(p.amount_uzs), 0)::int AS commission_base_uzs
       FROM users u
       LEFT JOIN academy_payments p
         ON p.status = 'paid'
        AND p.paid_at >= $1
        AND p.paid_at < $2
        AND COALESCE(
          (SELECT st.manager_id FROM academy_students st WHERE st.id = p.student_id),
          (SELECT l.manager_id FROM academy_leads l WHERE l.id = p.lead_id)
        ) = u.id
       WHERE u.workspace = 'sales' AND u.is_active = true
       GROUP BY u.id, u.full_name, u.base_salary_uzs
       ORDER BY u.full_name`,
      [bounds.from, bounds.to],
    ),
    query(
      `SELECT * FROM academy_payroll_entries WHERE period = $1`,
      [bounds.period],
    ),
  ]);

  const paidEntries = new Map(
    recordedEntries.map((entry) => [
      `${entry.entryType}:${entry.entryType === 'teacher' ? entry.teacherId : entry.employeeUserId}`,
      entry,
    ]),
  );
  const commissionPercent = Math.min(100, Math.max(0, Number(settings.salesCommissionPercent || 0)));
  const entries = [
    ...teachers.map((teacher) => {
      const conductedLessons = Number(teacher.conductedLessons || 0);
      const ratePerLessonUzs = Number(teacher.ratePerLessonUzs || 0);
      const calculatedAmountUzs = conductedLessons * ratePerLessonUzs;
      const paid = paidEntries.get(`teacher:${teacher.teacherId}`);
      return {
        id: paid?.id ?? null,
        entryType: 'teacher',
        teacherId: Number(teacher.teacherId),
        employeeUserId: teacher.employeeUserId ? Number(teacher.employeeUserId) : null,
        employeeName: teacher.employeeName,
        conductedLessons,
        ratePerLessonUzs,
        baseSalaryUzs: 0,
        commissionPercent: 0,
        commissionBaseUzs: 0,
        calculatedAmountUzs,
        amountUzs: Number(paid?.amountUzs ?? calculatedAmountUzs),
        status: paid?.status ?? 'pending',
        paidAt: paid?.paidAt ?? null,
      };
    }),
    ...managers.map((manager) => {
      const baseSalaryUzs = Number(manager.baseSalaryUzs || 0);
      const commissionBaseUzs = Number(manager.commissionBaseUzs || 0);
      const calculatedAmountUzs = baseSalaryUzs + Math.round((commissionBaseUzs * commissionPercent) / 100);
      const paid = paidEntries.get(`manager:${manager.employeeUserId}`);
      return {
        id: paid?.id ?? null,
        entryType: 'manager',
        teacherId: null,
        employeeUserId: Number(manager.employeeUserId),
        employeeName: manager.employeeName,
        conductedLessons: 0,
        ratePerLessonUzs: 0,
        baseSalaryUzs,
        commissionPercent,
        commissionBaseUzs,
        calculatedAmountUzs,
        amountUzs: Number(paid?.amountUzs ?? calculatedAmountUzs),
        status: paid?.status ?? 'pending',
        paidAt: paid?.paidAt ?? null,
      };
    }),
  ];

  return {
    period: bounds.period,
    entries,
    summary: {
      pendingAmountUzs: entries.filter((entry) => entry.status !== 'paid').reduce((sum, entry) => sum + entry.amountUzs, 0),
      paidAmountUzs: entries.filter((entry) => entry.status === 'paid').reduce((sum, entry) => sum + entry.amountUzs, 0),
      totalAmountUzs: entries.reduce((sum, entry) => sum + entry.amountUzs, 0),
      teacherCount: teachers.length,
      managerCount: managers.length,
      commissionPercent,
    },
  };
};

const getGroupProfitability = async () => {
  const [settings, groups] = await Promise.all([
    getCompanySettings(),
    query(
      `SELECT g.id, g.name, g.max_students, g.status,
              c.name AS course_name, sc.name AS school_name, r.name AS room_name,
              COALESCE((SELECT COUNT(*) FROM academy_students st
                        WHERE st.group_id = g.id AND st.status = 'studying'), 0)::int AS current_students,
              COALESCE((SELECT SUM(p.amount_uzs) FROM academy_payments p
                        WHERE p.group_id = g.id AND p.status = 'paid'), 0)::int AS revenue_uzs,
              COALESCE((SELECT COUNT(*) FROM academy_lessons lesson
                        WHERE lesson.group_id = g.id AND lesson.status = 'conducted'), 0)::int AS conducted_lessons,
              COALESCE((SELECT SUM(COALESCE(teacher.rate_per_lesson_uzs, 0))
                        FROM academy_lessons lesson
                        LEFT JOIN academy_teachers teacher ON teacher.id = lesson.teacher_id
                        WHERE lesson.group_id = g.id AND lesson.status = 'conducted'), 0)::int AS teacher_cost_uzs,
              COALESCE((SELECT ROUND(SUM((lesson.duration_minutes::numeric / 60) * COALESCE(room.rent_per_hour_uzs, 0)))
                        FROM academy_lessons lesson
                        LEFT JOIN academy_rooms room ON room.id = lesson.room_id
                        WHERE lesson.group_id = g.id AND lesson.status = 'conducted'), 0)::int AS rent_cost_uzs
       FROM academy_groups g
       LEFT JOIN academy_courses c ON c.id = g.course_id
       LEFT JOIN academy_schools sc ON sc.id = g.school_id
       LEFT JOIN academy_rooms r ON r.id = g.room_id
       ORDER BY g.created_at DESC`,
    ),
  ]);
  const minFillPercent = Math.min(100, Math.max(0, Number(settings.groupMinFillPercent || 0)));
  return groups.map((group) => {
    const maxStudents = Math.max(1, Number(group.maxStudents || 1));
    const currentStudents = Number(group.currentStudents || 0);
    const revenueUzs = Number(group.revenueUzs || 0);
    const teacherCostUzs = Number(group.teacherCostUzs || 0);
    const rentCostUzs = Number(group.rentCostUzs || 0);
    const totalCostsUzs = teacherCostUzs + rentCostUzs;
    const profitUzs = revenueUzs - totalCostsUzs;
    const fillPercent = Math.round((currentStudents / maxStudents) * 100);
    return {
      ...group,
      maxStudents,
      currentStudents,
      revenueUzs,
      teacherCostUzs,
      rentCostUzs,
      totalCostsUzs,
      profitUzs,
      fillPercent,
      isLossMaking: fillPercent < minFillPercent && profitUzs < 0,
    };
  });
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

const createOutbox = async (channel: string, recipient: string, message: string, options: {
  scheduledAt?: Date | null;
  entityType?: string | null;
  entityId?: number | null;
}) => insertRow('academy_notification_outbox', {
  channel,
  recipient,
  message,
  status: 'pending',
  scheduledAt: options.scheduledAt ?? new Date(),
  entityType: options.entityType ?? null,
  entityId: options.entityId ?? null });

const logIntegration = async (provider: string, direction: string, status: string, payload: unknown, errorMessage?: string | null) =>
  insertRow('academy_integration_logs', {
    provider,
    direction,
    status,
    payload: payload as any,
    errorMessage: errorMessage ?? null,
    retryCount: 0 });

const getSourceByCode = async (code: string) =>
  queryOne(`SELECT * FROM academy_lead_sources WHERE code = $1`, [code]);

const parseTimeToMinutes = parseScheduleTimeToMinutes;

const academyDayOfWeek = (date: Date) => {
  const day = date.getDay();
  return day === 0 ? 7 : day;
};

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
const dateRangesOverlap = scheduleDateRangesOverlap;

const isDateInsideRange = (date: Date, start?: Date | null, end?: Date | null) => {
  const value = date.getTime();
  return value >= (start?.getTime() ?? Number.NEGATIVE_INFINITY)
    && value <= (end?.getTime() ?? Number.POSITIVE_INFINITY);
};

const parseDateOnly = (value: unknown) => {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

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

  const startMinutes = options.scheduledAt.getHours() * 60 + options.scheduledAt.getMinutes();
  const endMinutes = startMinutes + options.durationMinutes;
  const dayOfWeek = academyDayOfWeek(options.scheduledAt);
  const lessonEnd = addMinutes(options.scheduledAt, options.durationMinutes);
  const teacherIds = candidates.map((teacher) => Number(teacher.id));
  const existingGroups = teacherIds.length > 0
    ? await query(
      `SELECT * FROM academy_groups
       WHERE teacher_id = ANY($1::int[]) AND status IN ('open', 'in_progress')`,
      [teacherIds],
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
        isDateInsideRange(
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
       LIMIT 1`,
      [teacher.id, options.scheduledAt, lessonEnd],
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
  const rangeStart = startOfDay(options.startDate ?? new Date());
  const rangeEnd = options.endDate ? addDays(startOfDay(options.endDate), 1) : null;
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
        const startMinutes = scheduledAt.getHours() * 60 + scheduledAt.getMinutes();
        const endMinutes = startMinutes + Number(lesson.durationMinutes || 60);
        return requestedSchedule.some((item) =>
          item.dayOfWeek === academyDayOfWeek(scheduledAt)
          && intervalsOverlap(item.startMinutes, item.endMinutes, startMinutes, endMinutes)
        );
      });
    if (!hasLessonConflict) return teacher;
  }

  return null;
};

const assertActiveRoomInSchool = async (roomId: number, schoolId: number) => {
  const room = await queryOne(
    `SELECT * FROM academy_rooms WHERE id = $1 AND school_id = $2 AND is_active = true`,
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

  const rangeStart = startOfDay(options.startDate ?? new Date());
  const rangeEnd = options.endDate ? addDays(startOfDay(options.endDate), 1) : null;
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
    const startMinutes = scheduledAt.getHours() * 60 + scheduledAt.getMinutes();
    const endMinutes = startMinutes + Number(lesson.durationMinutes || 60);
    return requestedSchedule.some((item) =>
      item.dayOfWeek === academyDayOfWeek(scheduledAt)
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
  const dayOfWeek = academyDayOfWeek(startsAt);
  const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const endMinutes = startMinutes + options.durationMinutes;

  const [lessonConflict, groups] = await Promise.all([
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
    query(
      `SELECT * FROM academy_groups
       WHERE room_id = $1
         AND status IN ('open', 'in_progress')
         AND ($2::int IS NULL OR id <> $2)`,
      [options.roomId, options.excludeGroupId ?? null],
    ),
  ]);

  if (lessonConflict) throw Object.assign(new Error('roomOccupied'), { statusCode: 409 });

  const recurringConflict = groups.some((group) =>
    isDateInsideRange(
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
  const rangeStart = startOfDay(options.from);
  const rangeEnd = addDays(rangeStart, options.days);
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
         AND ($5::int IS NULL OR l.id <> $5)`,
      [options.schoolId, rangeStart, rangeEnd, durationMinutes, options.excludeLeadId ?? null],
    ),
  ]);

  const slots = new Map<number, Row>();
  const now = new Date();

  for (let offset = 0; offset < options.days; offset += 1) {
    const date = addDays(rangeStart, offset);
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
          const startsAt = new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            Math.floor(startMinutes / 60),
            startMinutes % 60,
            0,
            0,
          );
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
            if (!isDateInsideRange(
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
            if (!isDateInsideRange(
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
    from: startOfDay(options.startsAt),
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

const resolveSourceId = async (body: Row) => {
  const explicitSourceId = parseId(body.sourceId);
  if (explicitSourceId) return explicitSourceId;

  // Referral leads: tag becomes referral_<referrer name> (TZ 1.2 / 5.1).
  const referrerStudentId = parseId(body.referrerStudentId);
  if (referrerStudentId) {
    const referrer = await queryOne(`SELECT student_name FROM academy_students WHERE id = $1`, [referrerStudentId]);
    const referrerName = nullableText(referrer?.studentName) ?? `id${referrerStudentId}`;
    const code = buildTemplateSourceCode('referral', referrerName);
    const existing = await getSourceByCode(code);
    if (existing) return Number(existing.id);
    const created = await insertRow('academy_lead_sources', {
      code, name: `Реферал: ${referrerName}`, channel: 'referral', isSystem: false, isActive: true });
    return Number(created.id);
  }

  const rawSourceCode = nullableText(body.sourceCode);
  const campaignName = nullableText(body.advertisingCampaign);
  // Expand template prefixes (instagram_ad_<name>, blogger_<name>, etc.) from TZ 1.2.
  const sourceCode = rawSourceCode && campaignName && TEMPLATE_SOURCE_PREFIXES.includes(rawSourceCode)
    ? buildTemplateSourceCode(rawSourceCode, campaignName)
    : rawSourceCode;

  if (sourceCode) {
    const source = await getSourceByCode(sourceCode);
    if (source) return Number(source.id);
    const created = await insertRow('academy_lead_sources', {
      code: sourceCode,
      name: sourceCode,
      channel: sourceCode.split('_')[0],
      campaignName: campaignName ?? null,
      isSystem: false,
      isActive: true });
    return Number(created.id);
  }

  return null;
};

const resolveCourseByAge = async (age?: number | null) => {
  const slug = suggestCourseSlugByAge(age);
  if (!slug) return null;
  const course = await queryOne(`SELECT * FROM academy_courses WHERE slug = $1`, [slug]);
  return course ?? null;
};

const findDuplicate = async (phone?: string | null, messenger?: string | null) => {
  if (!phone && !messenger) return null;

  const duplicateLead = await queryOne(
    `SELECT 'lead' AS entity_type, id, contact_name AS name, phone, messenger
     FROM academy_leads
     WHERE (($1::text IS NOT NULL AND phone = $1) OR ($2::text IS NOT NULL AND messenger = $2))
     LIMIT 1`,
    [phone ?? null, messenger ?? null],
  );
  if (duplicateLead) return duplicateLead;

  return queryOne(
    `SELECT 'student' AS entity_type, id, student_name AS name, phone, messenger
     FROM academy_students
     WHERE (($1::text IS NOT NULL AND phone = $1) OR ($2::text IS NOT NULL AND messenger = $2))
     LIMIT 1`,
    [phone ?? null, messenger ?? null],
  );
};

const getLead = (id: number) =>
  queryOne(
    `SELECT l.*, c.name AS course_name, s.name AS source_name, sc.name AS school_name,
        u.full_name AS manager_name
     FROM academy_leads l
     LEFT JOIN academy_courses c ON c.id = l.course_id
     LEFT JOIN academy_lead_sources s ON s.id = l.source_id
     LEFT JOIN academy_schools sc ON sc.id = l.school_id
     LEFT JOIN users u ON u.id = l.manager_id
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

const getActiveSalesManager = async (managerId: number) => {
  const manager = await queryOne<{ id: number; fullName: string }>(
    `SELECT id, full_name
     FROM users
     WHERE id = $1 AND workspace = 'sales' AND is_active = true`,
    [managerId],
  );
  if (!manager) {
    throw Object.assign(new Error('Active account manager is required'), { statusCode: 400 });
  }
  return manager;
};

const reassignLead = async (
  req: any,
  lead: Row,
  manager: { id: number; fullName: string },
  comment?: string | null,
): Promise<Row> => {
  if (Number(lead.managerId) === Number(manager.id)) {
    return { ...lead, managerId: manager.id, managerName: manager.fullName };
  }

  const updatedLead = await withTransaction(async () => {
    const updated = await updateRow('academy_leads', lead.id, { managerId: manager.id });
    if (!updated) {
      throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
    }

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

    return { ...updated, managerName: manager.fullName };
  });

  await createNotification(
    manager.id,
    'Вам назначен лид',
    `${lead.contactName}: ${lead.phone}`,
    'lead',
    lead.id,
  );
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
  await ensureGroupCapacity(groupId, excludeLeadId);
  return group;
};

const recalculateStudentMetrics = async (studentId: number) => {
  const student = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
  if (!student?.groupId) return;

  const conductedLessons = await query<{ id: number }>(
    `SELECT id FROM academy_lessons WHERE group_id = $1 AND status = 'conducted'`,
    [student.groupId],
  );
  const presentRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM academy_attendance a
     JOIN academy_lessons l ON l.id = a.lesson_id
     WHERE a.student_id = $1 AND a.status = 'present' AND l.status = 'conducted'`,
    [studentId],
  );
  const course = student.courseId
    ? await queryOne(`SELECT lesson_count FROM academy_courses WHERE id = $1`, [student.courseId])
    : null;
  const surveyRows = await query<{ score: number }>(
    `SELECT score FROM academy_lesson_surveys WHERE student_id = $1`,
    [studentId],
  );

  const presentCount = Number(presentRows[0]?.count ?? 0);
  const attendancePercent = calculateAttendancePercent(presentCount, conductedLessons.length);
  const progressPercent = calculateProgressPercent(presentCount, Number(course?.lessonCount ?? conductedLessons.length));
  const satisfactionAvg = calculateAverage(surveyRows.map((row) => Number(row.score))) ?? 0;
  const riskFlags = [
    attendancePercent > 0 && attendancePercent < 70 ? 'attendance_below_70' : null,
    attendancePercent > 0 && attendancePercent < 50 ? 'churn_risk' : null,
    satisfactionAvg > 0 && satisfactionAvg < 3 ? 'low_satisfaction' : null,
  ].filter(Boolean);

  await updateRow('academy_students', studentId, {
    attendancePercent,
    progressPercent,
    satisfactionAvg,
    riskFlags });
};

const createStudentFromLead = async (req: any, leadId: number, paymentId?: number | null) => {
  const lead = await getLead(leadId);
  if (!lead) {
    throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  }

  const existingStudent = await queryOne(`SELECT * FROM academy_students WHERE lead_id = $1`, [leadId]);
  if (existingStudent) {
    if (paymentId) {
      await updateRow('academy_payments', paymentId, { studentId: existingStudent.id });
    }
    if (lead.statusCode !== 'paid') {
      await updateRow('academy_leads', lead.id, { statusCode: 'paid' });
      await createStageHistory(lead.id, lead.statusCode, 'paid', req.user!.id, 'Подтверждена оплата существующего клиента');
    }
    return existingStudent;
  }
  if (!lead.enrolledGroupId) {
    throw Object.assign(new Error('groupRequiredForEnrollment'), { statusCode: 409 });
  }

  await ensureGroupCapacity(lead.enrolledGroupId, lead.id);

  const course = lead.courseId
    ? await queryOne(`SELECT * FROM academy_courses WHERE id = $1`, [lead.courseId])
    : await resolveCourseByAge(lead.studentAge);
  const enrolledGroup = lead.enrolledGroupId
    ? await queryOne(`SELECT * FROM academy_groups WHERE id = $1`, [lead.enrolledGroupId])
    : null;

  const referralCode = buildReferralCode(lead.studentName || lead.contactName, lead.id);
  const student = await insertRow('academy_students', {
    leadId: lead.id,
    contactName: lead.contactName,
    phone: lead.phone,
    messenger: lead.messenger ?? null,
    studentName: lead.studentName || lead.contactName,
    studentAge: lead.studentAge ?? null,
    courseId: lead.courseId ?? course?.id ?? null,
    schoolId: lead.schoolId ?? enrolledGroup?.schoolId ?? null,
    groupId: lead.enrolledGroupId ?? null,
    managerId: lead.managerId ?? req.user!.id,
    status: 'studying',
    enrolledAt: new Date(),
    nextPaymentAt: addDays(new Date(), 30),
    referralCode,
    riskFlags: [] });

  if (paymentId) {
    await updateRow('academy_payments', paymentId, { studentId: student.id });
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

  await createOutbox('telegram', lead.messenger || lead.phone, `Добро пожаловать в 01 Academy, ${student.studentName}!`, {
    entityType: 'student',
    entityId: student.id });
  await createAudit(req, 'CREATE_ACADEMY_STUDENT_FROM_LEAD', 'academy_student', student.id, student);
  return student;
};

// TZ 5.1 referral mechanics: when a referred student pays, the referrer earns a 15%
// discount on the next month and the new student gets 15% off the first month.
// Referrer tier is recomputed from the count of paid referrals (1 → 15%, 3 → free month, 5+ → AI Ambassador).
const applyReferralRewards = async (req: any, studentId: number, leadId: number | null, _paymentId: number) => {
  // referrerStudentId lives on the lead (academy_leads.referrer_student_id), not on the student.
  const lead = leadId ? await getLead(leadId) : null;
  const referrerId = lead?.referrerStudentId ? Number(lead.referrerStudentId) : null;

  if (!referrerId || referrerId === studentId) return;

  // 1. Mark any pending reward for this referral as applied.
  await query(
    `UPDATE academy_referral_rewards SET status = 'applied', applied_at = NOW()
     WHERE referred_student_id = $1 AND referrer_student_id = $2 AND status = 'pending'`,
    [studentId, referrerId],
  );

  // 2. Recompute the referrer's tier from paid referrals count.
  const paidCountRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM academy_referral_rewards
     WHERE referrer_student_id = $1 AND status = 'applied'`,
    [referrerId],
  );
  const paidReferrals = Number(paidCountRow?.count ?? 0);
  const level = resolveReferralLevel(paidReferrals);
  await updateRow('academy_students', referrerId, { referralLevel: level });

  // 3. Free month tier (3+ paid referrals) → create a zero-amount payment for the referrer's next month.
  if (level === 'free_month' || level === 'ai_ambassador') {
    const existingFree = await queryOne(
      `SELECT id FROM academy_payments WHERE student_id = $1 AND discount = 'referral_15' AND amount_uzs = 0 AND comment = 'Бесплатный месяц по реферальной программе' LIMIT 1`,
      [referrerId],
    );
    if (!existingFree) {
      await insertRow('academy_payments', {
        studentId: referrerId,
        amountUzs: 0,
        type: 'full',
        method: 'transfer',
        paidAt: new Date(),
        period: 'referral_bonus',
        discount: 'referral_15',
        status: 'paid',
        paidUntil: addDays(new Date(), 30),
        comment: 'Бесплатный месяц по реферальной программе',
        confirmedBy: req.user!.id,
      });
    }
  } else {
    // discount_15 tier → enqueue a notification to the referrer about their earned discount.
    const referrer = await queryOne(`SELECT messenger, phone, student_name FROM academy_students WHERE id = $1`, [referrerId]);
    if (referrer) {
      await createOutbox('telegram', referrer.messenger || referrer.phone,
        `${referrer.studentName}, вы получили скидку 15% на следующий месяц за рекомендацию 01 Academy! 🎁`,
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
    await createNotification(managerId, 'Новая заявка 01 Academy', `${lead.contactName}: ${lead.phone}`, 'lead', lead.id);
    await createOutbox('telegram', String(managerId), `Новая заявка: ${lead.contactName}, ${lead.phone}`, {
      scheduledAt: now,
      entityType: 'lead',
      entityId: lead.id });
  }

  if (lead.statusCode === 'first_contact' && !lead.firstContactAt) {
    await updateRow('academy_leads', lead.id, { firstContactAt: now });
  }

  if (lead.statusCode === 'demo_invited' && lead.demoAt) {
    const demoAt = new Date(lead.demoAt);
    await createOutbox('telegram', lead.messenger || lead.phone, `Напоминание: демо-урок 01 Academy через 24 часа`, {
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
    await createOutbox('telegram', lead.messenger || lead.phone, 'Реквизиты для оплаты 01 Academy: карта/перевод/наличные у администратора. После оплаты отправьте чек менеджеру.', {
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
}

const resolveTeacherId = async (userId: number): Promise<number | null> => {
  const row = await queryOne<{ id: string }>(`SELECT id FROM academy_teachers WHERE user_id = $1`, [userId]);
  return row ? Number(row.id) : null;
};

const getAcademyDataset = async (actor?: DatasetActor) => {
  // Workspace scoping: teachers see only their own groups; sales employees see only
  // their own leads/students; analytics and marketing receive their workspace datasets.
  const teacherId = actor?.workspace === 'teacher' ? await resolveTeacherId(actor.userId) : null;
  const isTeacherScoped = teacherId !== null;
  const isManagerScoped = actor?.workspace === 'sales';

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
          sc.name AS school_name,
          (SELECT COUNT(*)::int FROM academy_students s WHERE s.group_id = g.id AND s.status = 'studying') AS current_students,
          (SELECT COUNT(*)::int FROM academy_leads l
           WHERE l.enrolled_group_id = g.id
             AND l.status_code <> 'not_now'
             AND NOT EXISTS (SELECT 1 FROM academy_students st WHERE st.lead_id = l.id)) AS reserved_students
          FROM academy_groups g
          LEFT JOIN academy_courses c ON c.id = g.course_id
          LEFT JOIN academy_teachers t ON t.id = g.teacher_id
          LEFT JOIN academy_schools sc ON sc.id = g.school_id
          LEFT JOIN academy_rooms r ON r.id = g.room_id
          WHERE g.teacher_id = $1
          ORDER BY g.created_at DESC`, [teacherId])
      : query(`SELECT g.*, c.name AS course_name, t.full_name AS teacher_name,
          sc.name AS school_name,
          (SELECT COUNT(*)::int FROM academy_students s WHERE s.group_id = g.id AND s.status = 'studying') AS current_students,
          (SELECT COUNT(*)::int FROM academy_leads l
           WHERE l.enrolled_group_id = g.id
             AND l.status_code <> 'not_now'
             AND NOT EXISTS (SELECT 1 FROM academy_students st WHERE st.lead_id = l.id)) AS reserved_students
          FROM academy_groups g
          LEFT JOIN academy_courses c ON c.id = g.course_id
          LEFT JOIN academy_teachers t ON t.id = g.teacher_id
          LEFT JOIN academy_schools sc ON sc.id = g.school_id
          LEFT JOIN academy_rooms r ON r.id = g.room_id
          ORDER BY g.created_at DESC`),
    query(`SELECT l.*, c.name AS course_name, s.name AS source_name, u.full_name AS manager_name,
        sc.name AS school_name
      FROM academy_leads l
      LEFT JOIN academy_courses c ON c.id = l.course_id
      LEFT JOIN academy_lead_sources s ON s.id = l.source_id
      LEFT JOIN users u ON u.id = l.manager_id
      LEFT JOIN academy_schools sc ON sc.id = l.school_id
      WHERE 1=1 ${isManagerScoped ? 'AND l.manager_id = $1' : ''} ${isTeacherScoped ? 'AND FALSE' : ''}
      ORDER BY l.created_at DESC`, managerParams),
    query(`SELECT st.*, c.name AS course_name, g.name AS group_name, u.full_name AS manager_name,
        sc.name AS school_name,
        (
          SELECT CASE
            WHEN p.status <> 'paid' AND p.due_at IS NOT NULL AND p.due_at < NOW() THEN 'overdue'
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
    query(`SELECT a.* FROM academy_attendance a ${isTeacherScoped ? 'JOIN academy_lessons l ON l.id = a.lesson_id WHERE l.teacher_id = $1' : ''}`, isTeacherScoped ? [teacherId] : []),
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
      WHERE 1=1 ${isManagerScoped ? 'AND t.responsible_id = $1' : ''}
      ORDER BY COALESCE(t.deadline_at, t.created_at)`, managerParams),
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
  ]);

  const visibleLeads = await redactLeadPhonesForActor(actor, leads);
  return { schools, rooms, courses, sources, statuses, teachers, groups, leads: visibleLeads, students, lessons, attendance, payments, tasks, lessonSurveys, parentSurveys, expenses, projects, referrals };
};

const buildAnalytics = async () => {
  const [data, companySettings] = await Promise.all([getAcademyDataset(), getCompanySettings()]);
  const targets = toAnalyticsTargets(companySettings);
  const now = new Date();
  const weekStart = addDays(now, -7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const paidPayments = data.payments.filter((payment) => getComputedPaymentStatus(payment.status, payment.dueAt) === 'paid');
  const revenueMonth = paidPayments
    .filter((payment) => payment.paidAt && new Date(payment.paidAt) >= monthStart && new Date(payment.paidAt) <= monthEnd)
    .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const revenueTotal = paidPayments.reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const avgCheck = calculateAverage(paidPayments.map((payment) => Number(payment.amountUzs || 0))) ?? 0;
  const newPaidStudents = new Set(paidPayments.map((payment) => payment.studentId).filter(Boolean));
  const expensesMonth = data.expenses
    .filter((expense) => new Date(expense.periodStart) <= monthEnd && new Date(expense.periodEnd) >= monthStart)
    .reduce((sum, expense) => sum + Number(expense.amountUzs || 0), 0);
  const cac = calculateCac(expensesMonth, newPaidStudents.size) ?? 0;
  const roas = calculateRoas(revenueMonth, expensesMonth) ?? 0;
  const ltvByStudent = data.students.map((student) => ({
    studentId: student.id,
    ltv: calculateLtv(paidPayments.filter((payment) => payment.studentId === student.id).map((payment) => Number(payment.amountUzs || 0))) }));
  const averageLtv = calculateAverage(ltvByStudent.map((item) => item.ltv)) ?? 0;
  const overduePayments = data.payments.filter((payment) => getComputedPaymentStatus(payment.status, payment.dueAt) === 'overdue');
  const overdueTasks = data.tasks.filter((task) => task.status !== 'done' && task.deadlineAt && new Date(task.deadlineAt) < now);
  const lowAttendanceStudents = data.students.filter((student) => Number(student.attendancePercent || 0) > 0 && Number(student.attendancePercent || 0) < targets.attendance);
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
      && new Date(student.updatedAt) <= monthEnd)
    .reduce<Record<string, number>>((acc, student) => {
      const reason = String(student.exitReason);
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

  const funnel = LEAD_STATUSES.map((status) => ({
    ...status,
    count: data.leads.filter((lead) => lead.statusCode === status.code).length }));

  const groupsWithCapacity = data.groups.map((group) => ({
    ...group,
    currentStudents: Number(group.currentStudents || 0),
    capacityLabel: `${Number(group.currentStudents || 0)}/${Number(group.maxStudents || 12)}`,
    isFull: Number(group.currentStudents || 0) >= Number(group.maxStudents || 12) }));

  const teacherHours = data.lessons
    .filter((lesson) => lesson.status === 'conducted')
    .reduce((sum, lesson) => sum + Number(lesson.durationMinutes || 120) / 60, 0);

  // --- Marketing metrics (TZ 4.2): conversions, CPL, deal cycle, warm-base conversion. ---
  const newRequestCount = data.leads.filter((lead) => lead.statusCode !== 'new_request' || true).length;
  const invitedToDemoCount = data.leads.filter((lead) =>
    ['demo_invited', 'demo_attended', 'offer', 'thinking', 'enrolled', 'paid'].includes(lead.statusCode)
    || lead.demoAttended).length;
  const leadToDemoConversion = newRequestCount > 0 ? Number(((invitedToDemoCount / newRequestCount) * 100).toFixed(1)) : 0;
  const demoToPaidConversion = invitedToDemoCount > 0 ? Number(((newPaidStudents.size / invitedToDemoCount) * 100).toFixed(1)) : 0;
  const cpl = data.leads.length > 0 ? Math.round(expensesMonth / data.leads.filter((lead) => new Date(lead.createdAt) >= monthStart).length) : 0;
  // Average deal cycle (days) from lead creation to first paid payment.
  const dealCycleDays = data.leads
    .filter((lead) => lead.statusCode === 'paid')
    .map((lead) => {
      const firstPaid = paidPayments.find((payment) => payment.leadId === lead.id || payment.studentId === lead.id);
      if (!firstPaid?.paidAt) return null;
      return (new Date(firstPaid.paidAt).getTime() - new Date(lead.createdAt).getTime()) / (24 * 60 * 60 * 1000);
    })
    .filter((d): d is number => d !== null && Number.isFinite(d));
  const avgDealCycleDays = calculateAvgDealCycleDays(dealCycleDays) ?? 0;
  // Warm-base reactivation: leads that returned from not_now to an active status (via stage history absent here; approximate via current status).
  const warmReactivated = data.leads.filter((lead) => lead.statusCode !== 'not_now' && lead.warmMovedAt).length;

  // --- Operations metrics (TZ 4.3): lesson NPS by teacher/course/group, progress, teacher hours, retention %. ---
  const lessonScores = data.lessonSurveys.map((survey) => Number(survey.score)).filter(Number.isFinite);
  const avgLessonScore = calculateAverage(lessonScores) ?? 0;
  const byTeacher = data.teachers.map((teacher) => {
    const teacherLessons = data.lessons.filter((lesson) => lesson.teacherId === teacher.id && lesson.status === 'conducted');
    const teacherSurveys = data.lessonSurveys.filter((survey) => survey.teacherId === teacher.id);
    const teacherStudents = data.students.filter((student) =>
      data.groups.filter((group) => group.teacherId === teacher.id).some((group) => group.id === student.groupId));
    const scoresByDate = teacherSurveys
      .map((survey) => Number(survey.score))
      .filter(Number.isFinite);
    return {
      teacherId: teacher.id,
      teacherName: teacher.fullName,
      hours: teacherLessons.reduce((sum, lesson) => sum + Number(lesson.durationMinutes || 120) / 60, 0),
      avgScore: calculateAverage(scoresByDate) ?? 0,
      attendance: calculateAverage(teacherStudents.map((student) => Number(student.attendancePercent || 0)).filter(Boolean)) ?? 0,
      groupsCount: data.groups.filter((group) => group.teacherId === teacher.id).length,
      trend: calculateTrend(scoresByDate),
    };
  });
  const byCourseLessonNps = data.courses.map((course) => {
    const courseSurveys = data.lessonSurveys.filter((survey) => survey.courseId === course.id);
    const scores = courseSurveys.map((survey) => Number(survey.score)).filter(Number.isFinite);
    return {
      courseId: course.id,
      courseName: course.name,
      avgLessonScore: calculateAverage(scores) ?? 0,
      trend: calculateTrend(scores),
      progressAvg: calculateAverage(
        data.students.filter((student) => student.courseId === course.id && student.status === 'studying')
          .map((student) => Number(student.progressPercent || 0)).filter(Boolean),
      ) ?? 0,
    };
  });
  const byGroupProgress = data.groups.map((group) => ({
    groupId: group.id,
    groupName: group.name,
    capacity: Number(group.currentStudents || 0),
    maxCapacity: Number(group.maxStudents || 12),
    attendanceAvg: calculateAverage(
      data.students.filter((student) => student.groupId === group.id).map((student) => Number(student.attendancePercent || 0)).filter(Boolean),
    ) ?? 0,
    progressAvg: calculateAverage(
      data.students.filter((student) => student.groupId === group.id).map((student) => Number(student.progressPercent || 0)).filter(Boolean),
    ) ?? 0,
  }));

  // --- Cohort retention (TZ 3.4) as percentages. ---
  const retentionByCourse = data.courses.map((course) => {
    const courseStudents = data.students.filter((student) => student.courseId === course.id);
    const monthsValues = courseStudents
      .filter((student) => student.enrolledAt)
      .map((student) => (now.getTime() - new Date(student.enrolledAt).getTime()) / (30 * 24 * 60 * 60 * 1000));
    return {
      courseId: course.id,
      courseName: course.name,
      avgStudyMonths: calculateAvgStudyMonths(monthsValues) ?? 0,
      studentCount: courseStudents.length,
    };
  });

  return {
    summary: {
      newLeadsWeek: data.leads.filter((lead) => new Date(lead.createdAt) >= weekStart).length,
      newLeadsMonth: data.leads.filter((lead) => new Date(lead.createdAt) >= monthStart).length,
      activeLeads: data.leads.filter((lead) => ACTIVE_PIPELINE_STATUSES.includes(lead.statusCode)).length,
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
      avgAttendance: calculateAverage(data.students.map((student) => Number(student.attendancePercent || 0)).filter(Boolean)) ?? 0,
      avgLessonScore,
      nps,
      npsBelowTarget: nps < targets.nps,
      teacherHours,
      avgDealCycleDays,
      leadToDemoConversion,
      demoToPaidConversion,
      overduePayments: overduePayments.length,
      overdueTasks: overdueTasks.length,
      newPaidStudents: newPaidStudents.size },
    funnel,
    groups: groupsWithCapacity,
    risks: {
      lowAttendanceStudents,
      lowScores,
      overduePayments,
      longThinkingLeads,
      overdueTasks },
    byCourse: data.courses.map((course) => {
      const courseStudentIds = data.students.filter((student) => student.courseId === course.id).map((student) => student.id);
      const coursePaidStudents = new Set(paidPayments.filter((payment) => payment.studentId && courseStudentIds.includes(payment.studentId)).map((payment) => payment.studentId));
      const courseExpenses = data.expenses
        .filter((expense) => data.sources.find((source) => source.id === expense.sourceId)?.channel === course.slug
          || data.leads.find((lead) => lead.courseId === course.id && lead.sourceId === data.sources.find((s) => s.id === data.expenses.find((e) => e.id === expense.id)?.sourceId)?.id))
        .reduce((sum, expense) => sum + Number(expense.amountUzs || 0), 0);
      return {
        courseId: course.id,
        courseName: course.name,
        leads: data.leads.filter((lead) => lead.courseId === course.id).length,
        students: data.students.filter((student) => student.courseId === course.id && student.status === 'studying').length,
        revenue: paidPayments
          .filter((payment) => data.students.find((student) => student.id === payment.studentId)?.courseId === course.id)
          .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0),
        averageLtv: calculateAverage(
          ltvByStudent
            .filter((item) => data.students.find((student) => student.id === item.studentId)?.courseId === course.id)
            .map((item) => item.ltv),
        ) ?? 0,
        ltvTargetMinUzs: course.ltvTargetMinUzs,
        ltvTargetMaxUzs: course.ltvTargetMaxUzs,
        cac: calculateCac(courseExpenses, coursePaidStudents.size) ?? 0 };
    }),
    bySource: data.sources.map((source) => {
      const sourceLeads = data.leads.filter((lead) => lead.sourceId === source.id);
      const sourceStudents = data.students.filter((student) => sourceLeads.some((lead) => lead.id === student.leadId));
      const sourceRevenue = paidPayments
        .filter((payment) => sourceStudents.some((student) => student.id === payment.studentId))
        .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
      const sourceExpenses = data.expenses
        .filter((expense) => expense.sourceId === source.id)
        .reduce((sum, expense) => sum + Number(expense.amountUzs || 0), 0);
      const sourceCac = calculateCac(sourceExpenses, sourceStudents.length) ?? 0;
      return {
        sourceId: source.id,
        sourceName: source.name,
        leads: sourceLeads.length,
        paidStudents: sourceStudents.length,
        revenue: sourceRevenue,
        expenses: sourceExpenses,
        cpl: sourceLeads.length > 0 ? Math.round(sourceExpenses / sourceLeads.length) : 0,
        cac: sourceCac,
        roas: calculateRoas(sourceRevenue, sourceExpenses) ?? 0,
        ltvCac: sourceCac ? Number(((calculateAverage(sourceStudents.map((student) => ltvByStudent.find((item) => item.studentId === student.id)?.ltv || 0)) ?? 0) / sourceCac).toFixed(2)) : 0 };
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
  const [analytics, users, profitability, escalatedTasks] = await Promise.all([
    buildAnalytics(),
    storage.getUsers(),
    getGroupProfitability(),
    query(`SELECT t.id, t.title, t.deadline_at, u.full_name AS responsible_name
           FROM academy_tasks t
           LEFT JOIN users u ON u.id = t.responsible_id
           WHERE t.status <> 'done' AND t.escalated_at IS NOT NULL
           ORDER BY t.escalated_at DESC
           LIMIT 20`),
  ]);
  const data = analytics.data;
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
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

  const monthStarts = Array.from({ length: 6 }, (_, index) =>
    new Date(now.getFullYear(), now.getMonth() - (5 - index), 1));
  const trends = monthStarts.map((start) => {
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return {
      month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
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

  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const dayAfterTomorrowStart = addDays(todayStart, 2);
  const scheduledLessons = data.lessons.filter((lesson) =>
    lesson.status === 'scheduled' && lesson.scheduledAt && new Date(lesson.scheduledAt) >= now);
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
  const discountsMonth = paidPayments
    .filter((payment) => inRange(payment.paidAt, currentMonthStart, nextMonthStart) && payment.discount !== 'none')
    .reduce((sum, payment) => {
      const student = data.students.find((item) => Number(item.id) === Number(payment.studentId));
      const course = data.courses.find((item) => Number(item.id) === Number(student?.courseId));
      return sum + Math.max(0, Number(course?.basePriceUzs || 0) - Number(payment.amountUzs || 0));
    }, 0);
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
        ? Math.round((occupiedActiveSeats / totalActiveCapacity) * 100)
        : 0,
      lessonsToday: scheduledLessons.filter((lesson) =>
        inRange(lesson.scheduledAt, todayStart, tomorrowStart)).length,
      lessonsTomorrow: scheduledLessons.filter((lesson) =>
        inRange(lesson.scheduledAt, tomorrowStart, dayAfterTomorrowStart)).length,
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
    discountsMonth,
    churnByReason,
    escalatedTasks,
    lossMakingGroups: profitability.filter((group) => group.isLossMaking),
    generatedAt: now.toISOString(),
  };
};

const getMarketingWorkspaceDataset = async () => {
  const [sources, leads, students, expenses, referrals] = await Promise.all([
    query(`SELECT * FROM academy_lead_sources ORDER BY name`),
    query(`SELECT l.*, c.name AS course_name, s.name AS source_name, u.full_name AS manager_name
      FROM academy_leads l
      LEFT JOIN academy_courses c ON c.id = l.course_id
      LEFT JOIN academy_lead_sources s ON s.id = l.source_id
      LEFT JOIN users u ON u.id = l.manager_id
      ORDER BY l.created_at DESC`),
    query(`SELECT id, student_name, contact_name, referral_code, referral_level
      FROM academy_students
      ORDER BY created_at DESC`),
    query(`SELECT * FROM academy_marketing_expenses ORDER BY period_start DESC`),
    query(`SELECT * FROM academy_referral_rewards ORDER BY created_at DESC`),
  ]);

  return { sources, leads, students, expenses, referrals };
};

const buildMarketingAnalyticsPayload = (analytics: Row) => ({
  summary: {
    newLeadsWeek: analytics.summary.newLeadsWeek,
    newLeadsMonth: analytics.summary.newLeadsMonth,
    warmBaseSize: analytics.summary.warmBaseSize,
    warmReactivated: analytics.summary.warmReactivated,
    leadToDemoConversion: analytics.summary.leadToDemoConversion,
    demoToPaidConversion: analytics.summary.demoToPaidConversion,
    cpl: analytics.summary.cpl,
    cac: analytics.summary.cac,
    roas: analytics.summary.roas,
    avgDealCycleDays: analytics.summary.avgDealCycleDays,
  },
  funnel: analytics.funnel,
  bySource: analytics.bySource,
  warmBaseSize: analytics.summary.warmBaseSize,
  warmReactivated: analytics.summary.warmReactivated,
  leadToDemoConversion: analytics.summary.leadToDemoConversion,
  demoToPaidConversion: analytics.summary.demoToPaidConversion,
  cpl: analytics.summary.cpl,
  avgDealCycleDays: analytics.summary.avgDealCycleDays,
  targets: analytics.targets,
});

const createCsv = (rows: Row[]) => {
  if (rows.length === 0) return 'нет данных\n';
  const columns = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [columns.join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n');
};

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
    const actor: DatasetActor = { userId: req.user!.id, workspace: req.user!.workspace };
    const [dataset, companySettings] = await Promise.all([getAcademyDataset(actor), getCompanySettings()]);

    res.json({
      schools: dataset.schools,
      rooms: dataset.rooms,
      courses: dataset.courses,
      groups: dataset.groups,
      sources: dataset.sources,
      statuses: dataset.statuses,
      leads: dataset.leads,
      students: dataset.students,
      lessons: dataset.lessons,
      payments: dataset.payments,
      tasks: dataset.tasks,
      projects: dataset.projects,
      referrals: dataset.referrals,
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
    const requestedFrom = parseDateOnly(req.query.from) ?? startOfDay(new Date());
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
    const actor: DatasetActor = { userId: req.user!.id, workspace: req.user!.workspace };
    const dataset = await getAcademyDataset(actor);
    res.json({
      schools: dataset.schools,
      rooms: dataset.rooms,
      courses: dataset.courses,
      teacher: req.user!.workspace === 'teacher' ? dataset.teachers[0] ?? null : null,
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
      salesCommissionPercent: Math.min(100, Math.max(0, Number(req.body.salesCommissionPercent ?? current.salesCommissionPercent) || 0)),
      groupMinFillPercent: Math.min(100, Math.max(0, Number(req.body.groupMinFillPercent ?? current.groupMinFillPercent) || 0)),
      currentCashBalanceUzs: Math.max(0, Number(req.body.currentCashBalanceUzs ?? current.currentCashBalanceUzs) || 0),
      salesPhoneVisibility: ['own_leads', 'mask_until_assigned'].includes(String(req.body.salesPhoneVisibility ?? current.salesPhoneVisibility))
        ? String(req.body.salesPhoneVisibility ?? current.salesPhoneVisibility)
        : 'own_leads',
      workdayStartHour: Math.min(23, Math.max(0, Number(req.body.workdayStartHour ?? current.workdayStartHour) || 0)),
      workdayEndHour: Math.min(24, Math.max(0, Number(req.body.workdayEndHour ?? current.workdayEndHour) || 0)),
      workdays: safeJson(
        Array.isArray(req.body.workdays)
          ? req.body.workdays.map(Number).filter((day: number) => Number.isInteger(day) && day >= 1 && day <= 7)
          : current.workdays,
        [1, 2, 3, 4, 5],
      ),
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

router.get('/finance', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const [payments, expenses, payrollPayouts] = await Promise.all([
      query(`SELECT p.*, st.student_name, st.contact_name, l.contact_name AS lead_name,
                    c.base_price_uzs
             FROM academy_payments p
             LEFT JOIN academy_students st ON st.id = p.student_id
             LEFT JOIN academy_leads l ON l.id = p.lead_id
             LEFT JOIN academy_courses c ON c.id = st.course_id
             ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.id DESC`),
      query(`SELECT e.*, s.name AS source_name, creator.full_name AS created_by_name,
                    approver.full_name AS approved_by_name
             FROM academy_marketing_expenses e
             LEFT JOIN academy_lead_sources s ON s.id = e.source_id
             LEFT JOIN users creator ON creator.id = e.created_by
             LEFT JOIN users approver ON approver.id = e.approved_by
             ORDER BY e.period_start DESC, e.id DESC`),
      query(`SELECT pe.*, payer.full_name AS paid_by_name
             FROM academy_payroll_entries pe
             LEFT JOIN users payer ON payer.id = pe.paid_by
             WHERE pe.status = 'paid'
             ORDER BY pe.paid_at DESC, pe.id DESC`),
    ]);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const inCurrentMonth = (value: unknown) => {
      const date = new Date(String(value));
      return !Number.isNaN(date.getTime()) && date >= monthStart && date < nextMonthStart;
    };
    const approvedExpenses = expenses
      .filter((expense) => expense.status === 'approved')
      .reduce((sum, expense) => sum + Number(expense.amountUzs || 0), 0);
    const confirmedRevenue = payments
      .filter((payment) => payment.status === 'paid')
      .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
    const paidPayroll = payrollPayouts.reduce((sum, entry) => sum + Number(entry.amountUzs || 0), 0);
    const discountsMonth = payments
      .filter((payment) => payment.status === 'paid' && payment.discount !== 'none' && inCurrentMonth(payment.paidAt || payment.createdAt))
      .reduce((sum, payment) => sum + Math.max(0, Number(payment.basePriceUzs || 0) - Number(payment.amountUzs || 0)), 0);
    res.json({
      payments,
      expenses,
      payrollPayouts,
      summary: {
        confirmedRevenue,
        approvedExpenses,
        paidPayroll,
        pnl: confirmedRevenue - approvedExpenses - paidPayroll,
        discountsMonth,
        pendingExpenses: expenses.filter((expense) => expense.status === 'pending').length,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch finance register', { error });
    res.status(500).json({ error: 'Failed to fetch finance register' });
  }
});

router.post('/expenses/:id/approve', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid expense id' });
    const current = await queryOne(`SELECT * FROM academy_marketing_expenses WHERE id = $1`, [id]);
    if (!current) return res.status(404).json({ error: 'Expense not found' });
    if (current.status === 'approved') return res.json(current);
    const expense = await updateRow('academy_marketing_expenses', id, {
      status: 'approved',
      approvedBy: req.user!.id,
      approvedAt: new Date(),
      approvalComment: nullableText(req.body.comment) ?? null,
    });
    await createAudit(req, 'APPROVE_MARKETING_EXPENSE', 'academy_marketing_expense', id, expense, current);
    res.json(expense);
  } catch (error) {
    logger.error('Failed to approve marketing expense', { error });
    res.status(500).json({ error: 'Failed to approve marketing expense' });
  }
});

router.post('/payments/:id/refund', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const id = parseId(req.params.id);
    const comment = nullableText(req.body.comment);
    if (!id) return res.status(400).json({ error: 'Invalid payment id' });
    if (!comment) return res.status(400).json({ error: 'Refund comment is required' });
    const current = await queryOne(`SELECT * FROM academy_payments WHERE id = $1`, [id]);
    if (!current) return res.status(404).json({ error: 'Payment not found' });
    if (current.status !== 'paid') return res.status(409).json({ error: 'Only paid payments can be refunded' });
    const payment = await updateRow('academy_payments', id, {
      status: 'refunded',
      refundedBy: req.user!.id,
      refundedAt: new Date(),
      refundComment: comment,
    });
    await createAudit(req, 'REFUND_ACADEMY_PAYMENT', 'academy_payment', id, payment, current);
    res.json(payment);
  } catch (error) {
    logger.error('Failed to refund payment', { error });
    res.status(500).json({ error: 'Failed to refund payment' });
  }
});

router.get('/payroll', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const period = String(req.query.period ?? currentPayrollPeriod());
    res.json(await calculatePayroll(period));
  } catch (error: any) {
    logger.error('Failed to calculate payroll', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to calculate payroll' });
  }
});

router.post('/payroll/payout', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const period = String(req.body.period ?? currentPayrollPeriod());
    const entryType = String(req.body.entryType ?? '');
    const employeeUserId = parseId(req.body.employeeUserId);
    const teacherId = parseId(req.body.teacherId);
    if (!['teacher', 'manager'].includes(entryType)) {
      return res.status(400).json({ error: 'Invalid payroll entry type' });
    }
    if (entryType === 'teacher' && !teacherId) {
      return res.status(400).json({ error: 'Teacher is required' });
    }
    if (entryType === 'manager' && !employeeUserId) {
      return res.status(400).json({ error: 'Manager is required' });
    }

    const entry = await withTransaction(async () => {
      const payroll = await calculatePayroll(period);
      const calculated = payroll.entries.find((item) => (
        item.entryType === entryType
        && (entryType === 'teacher' ? item.teacherId === teacherId : item.employeeUserId === employeeUserId)
      ));
      if (!calculated) {
        throw Object.assign(new Error('Payroll entry not found'), { statusCode: 404 });
      }
      if (calculated.status === 'paid' && calculated.id) {
        return queryOne(`SELECT * FROM academy_payroll_entries WHERE id = $1`, [calculated.id]);
      }
      if (calculated.amountUzs <= 0) {
        throw Object.assign(new Error('No payable amount for this employee'), { statusCode: 409 });
      }
      return insertRow('academy_payroll_entries', {
        period: payroll.period,
        entryType,
        employeeUserId: calculated.employeeUserId,
        teacherId: calculated.teacherId,
        employeeName: calculated.employeeName,
        baseSalaryUzs: calculated.baseSalaryUzs,
        commissionPercent: calculated.commissionPercent,
        commissionBaseUzs: calculated.commissionBaseUzs,
        conductedLessons: calculated.conductedLessons,
        ratePerLessonUzs: calculated.ratePerLessonUzs,
        amountUzs: calculated.amountUzs,
        status: 'paid',
        paidBy: req.user!.id,
        paidAt: new Date(),
      });
    });
    if (!entry) return res.status(500).json({ error: 'Failed to record payroll payout' });
    await createAudit(req, 'PAY_ACADEMY_PAYROLL', 'academy_payroll_entry', Number(entry.id), entry);
    res.status(201).json(entry);
  } catch (error: any) {
    if (error?.code === '23505') {
      const period = String(req.body.period ?? currentPayrollPeriod());
      const entryType = String(req.body.entryType ?? '');
      const id = entryType === 'teacher' ? parseId(req.body.teacherId) : parseId(req.body.employeeUserId);
      const column = entryType === 'teacher' ? 'teacher_id' : 'employee_user_id';
      const existing = id
        ? await queryOne(`SELECT * FROM academy_payroll_entries WHERE period = $1 AND entry_type = $2 AND ${column} = $3`, [period, entryType, id])
        : undefined;
      if (existing) return res.json(existing);
    }
    logger.error('Failed to pay payroll entry', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to pay payroll entry' });
  }
});

router.get('/groups/profitability', async (req, res) => {
  if (!ensureFinanceAccess(req, res)) return;
  try {
    const groups = await getGroupProfitability();
    const settings = await getCompanySettings();
    res.json({
      groups,
      minFillPercent: Number(settings.groupMinFillPercent || 0),
      lossMakingGroups: groups.filter((group) => group.isLossMaking),
    });
  } catch (error) {
    logger.error('Failed to calculate group profitability', { error });
    res.status(500).json({ error: 'Failed to calculate group profitability' });
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
    const selectedDate = parseDateOnly(req.query.date) ?? startOfDay(new Date());
    const nextDate = addDays(selectedDate, 1);

    const [school, rooms, groups, lessons] = await Promise.all([
      queryOne(`SELECT id, name FROM academy_schools WHERE id = $1`, [schoolId]),
      query(`SELECT * FROM academy_rooms WHERE school_id = $1 AND is_active = true ORDER BY name`, [schoolId]),
      query(
        `SELECT g.*, c.name AS course_name, c.lesson_duration_minutes AS duration_minutes,
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

router.patch('/teachers/me/availability', async (req, res) => {
  if (!ensureTeacherWorkspaceAccess(req, res)) return;
  try {
    const teacherId = await resolveTeacherId(req.user!.id);
    if (!teacherId) return res.status(404).json({ error: 'Teacher profile not found' });
    const oldTeacher = await queryOne(`SELECT * FROM academy_teachers WHERE id = $1`, [teacherId]);
    const teacher = await updateRow('academy_teachers', teacherId, {
      availability: safeJson(req.body.availability, []),
      schoolIds: safeJson(req.body.schoolIds, []),
    });
    await reconcileAutomaticTeacherAssignments(teacherId);
    await createAudit(req, 'UPDATE_TEACHER_AVAILABILITY', 'academy_teacher', teacherId, teacher, oldTeacher);
    res.json(teacher);
  } catch (error: any) {
    logger.error('Failed to update teacher availability', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update availability' });
  }
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

router.get('/workspaces/analytics', async (req, res) => {
  if (!ensureAnalyticsWorkspaceAccess(req, res)) return;
  try {
    const [analytics, dataset] = await Promise.all([
      buildAnalytics(),
      getAcademyDataset(),
    ]);
    res.json({
      analytics,
      payments: dataset.payments,
      constants: academyConstants(),
    });
  } catch (error) {
    logger.error('Failed to fetch analytics workspace', { error });
    res.status(500).json({ error: 'Failed to fetch analytics workspace' });
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
    const workspace = String(req.user?.workspace);
    const results: Row[] = [];
    const remaining = () => Math.max(limit - results.length, 0);

    const pushLeads = async (whereSql: string, params: DbValue[], href: string) => {
      if (remaining() <= 0) return;
      const rows = await query(
        `SELECT l.id, l.contact_name, l.phone, l.student_name, c.name AS course_name
         FROM academy_leads l
         LEFT JOIN academy_courses c ON c.id = l.course_id
         WHERE ${whereSql}
           AND (
             LOWER(l.contact_name) LIKE $${params.length + 1}
             OR LOWER(COALESCE(l.student_name, '')) LIKE $${params.length + 1}
             OR LOWER(l.phone) LIKE $${params.length + 1}
             OR LOWER(COALESCE(l.messenger, '')) LIKE $${params.length + 1}
           )
         ORDER BY l.created_at DESC
         LIMIT $${params.length + 2}`,
        [...params, like, remaining()],
      );
      results.push(...rows.map((lead) => ({
        id: `lead-${lead.id}`,
        entityType: 'lead',
        title: lead.contactName,
        subtitle: [lead.phone, lead.studentName, lead.courseName].filter(Boolean).join(' • '),
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

    if (workspace === 'sales') {
      await pushLeads(`l.manager_id = $1`, [req.user!.id], '/sales/pipeline');
      await pushStudents(`st.manager_id = $1`, [req.user!.id], '/sales/clients');
    } else if (workspace === 'teacher') {
      const teacherId = await resolveTeacherId(req.user!.id);
      if (!teacherId) return res.json([]);
      await pushGroups(`g.teacher_id = $1`, [teacherId], '/teacher-workspace/groups');
      await pushStudents(`st.group_id IN (SELECT id FROM academy_groups WHERE teacher_id = $1)`, [teacherId], '/teacher-workspace/groups');
      await pushCourses('/teacher-workspace/groups');
    } else if (workspace === 'analytics') {
      await pushGroups(`TRUE`, [], '/analytics-workspace/groups');
      if (remaining() > 0) {
        const teachers = await query(
          `SELECT id, full_name, status
           FROM academy_teachers
           WHERE LOWER(full_name) LIKE $1
           ORDER BY full_name
           LIMIT $2`,
          [like, remaining()],
        );
        results.push(...teachers.map((teacher) => ({
          id: `teacher-${teacher.id}`,
          entityType: 'teacher',
          title: teacher.fullName,
          subtitle: teacher.status,
          href: '/analytics-workspace/teachers',
        })));
      }
      await pushCourses('/analytics-workspace/courses');
    } else if (workspace === 'marketing') {
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
    } else if (workspace === 'administration') {
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
    }

    res.json(results.slice(0, limit));
  } catch (error) {
    logger.error('Failed to search academy data', { error });
    res.status(500).json({ error: 'Failed to search academy data' });
  }
});

router.get('/analytics/cohorts', async (req, res) => {
  if (!ensureAnalyticsWorkspaceAccess(req, res)) return;
  try {
    const filters: string[] = [];
    const params: DbValue[] = [];
    if (req.query.courseId) {
      params.push(Number(req.query.courseId));
      filters.push(`s.course_id = $${params.length}`);
    }
    if (req.query.sourceId) {
      params.push(Number(req.query.sourceId));
      filters.push(`l.source_id = $${params.length}`);
    }
    if (req.query.managerId) {
      params.push(Number(req.query.managerId));
      filters.push(`s.manager_id = $${params.length}`);
    }
    const filterSql = filters.length ? `AND ${filters.join(' AND ')}` : '';
    const rows = await query(
      `WITH first_payments AS (
        SELECT student_id, MIN(paid_at) AS first_paid_at
        FROM academy_payments
        WHERE status = 'paid' AND student_id IS NOT NULL
        GROUP BY student_id
      )
      SELECT
        TO_CHAR(DATE_TRUNC('month', fp.first_paid_at), 'YYYY-MM') AS cohort,
        COUNT(DISTINCT fp.student_id)::int AS students,
        COUNT(DISTINCT CASE WHEN p.paid_at < fp.first_paid_at + INTERVAL '2 months' THEN p.student_id END)::int AS month_2,
        COUNT(DISTINCT CASE WHEN p.paid_at < fp.first_paid_at + INTERVAL '3 months' THEN p.student_id END)::int AS month_3,
        COUNT(DISTINCT CASE WHEN p.paid_at < fp.first_paid_at + INTERVAL '4 months' THEN p.student_id END)::int AS month_4,
        COALESCE(SUM(p.amount_uzs), 0)::int AS revenue,
        COALESCE(SUM(CASE WHEN p.paid_at < fp.first_paid_at + INTERVAL '2 months' THEN p.amount_uzs ELSE 0 END), 0)::int AS revenue_month_2,
        COALESCE(SUM(CASE WHEN p.paid_at < fp.first_paid_at + INTERVAL '3 months' THEN p.amount_uzs ELSE 0 END), 0)::int AS revenue_month_3,
        COALESCE(SUM(CASE WHEN p.paid_at < fp.first_paid_at + INTERVAL '4 months' THEN p.amount_uzs ELSE 0 END), 0)::int AS revenue_month_4,
        COALESCE(ROUND(AVG(p.amount_uzs) * COUNT(DISTINCT fp.student_id)), 0)::int AS forecast_revenue
      FROM first_payments fp
      LEFT JOIN academy_payments p ON p.student_id = fp.student_id AND p.status = 'paid'
      LEFT JOIN academy_students s ON s.id = fp.student_id
      LEFT JOIN academy_leads l ON l.id = s.lead_id
      ${filterSql ? `WHERE ${filterSql.replace(/^AND /, '')}` : ''}
      GROUP BY 1
      ORDER BY 1 DESC`,
      params,
    );
    // Enrich with retention percentages (TZ 3.4: "Retention rate по месяцам (% оставшихся)").
    const enriched = rows.map((row) => ({
      ...row,
      retentionMonth2Percent: calculateRetentionPercent(Number(row.month2), Number(row.students)),
      retentionMonth3Percent: calculateRetentionPercent(Number(row.month3), Number(row.students)),
      retentionMonth4Percent: calculateRetentionPercent(Number(row.month4), Number(row.students)),
    }));
    res.json(enriched);
  } catch (error) {
    logger.error('Failed to fetch cohorts', { error });
    res.status(500).json({ error: 'Failed to fetch cohorts' });
  }
});

router.get('/leads', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, LEAD_WORKSPACES, 'Lead access required')) return;
  try {
    const conditions: string[] = [];
    const params: DbValue[] = [];
    const workspace = String(req.user?.workspace);

    if (workspace === 'sales') {
      params.push(req.user!.id);
      conditions.push(`l.manager_id = $${params.length}`);
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
        OR LOWER(l.phone) LIKE $${params.length}
        OR LOWER(COALESCE(l.messenger, '')) LIKE $${params.length}
      )`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const leads = await query(
      `SELECT l.*, c.name AS course_name, s.name AS source_name, u.full_name AS manager_name,
          sc.name AS school_name
       FROM academy_leads l
       LEFT JOIN academy_courses c ON c.id = l.course_id
       LEFT JOIN academy_lead_sources s ON s.id = l.source_id
       LEFT JOIN users u ON u.id = l.manager_id
       LEFT JOIN academy_schools sc ON sc.id = l.school_id
       ${whereSql}
       ORDER BY l.created_at DESC`,
      params,
    );
    res.json(await redactLeadPhonesForActor(
      { userId: req.user!.id, workspace: String(req.user!.workspace) },
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
    const phone = nullableText(req.body.phone);
    const messenger = nullableText(req.body.messenger);
    const sourceId = await resolveSourceId(req.body);

    if (!contactName) return res.status(400).json({ error: 'contactPersonRequired' });
    if (!phone) return res.status(400).json({ error: 'phoneRequired' });
    if (!sourceId) return res.status(400).json({ error: 'sourceRequired' });

    const duplicate = await findDuplicate(phone, messenger);
    if (duplicate) {
      return res.status(409).json({ error: 'Duplicate lead or student', duplicate });
    }
    if (req.body.demoAt) {
      return res.status(400).json({ error: 'leadScheduleThroughGroupOnly' });
    }

    const lead = await withTransaction(async () => {
      const studentAge = toIntegerOrNull(req.body.studentAge) as number | null | undefined;
      let courseId = parseId(req.body.courseId);
      if (!courseId && studentAge) {
        courseId = Number((await resolveCourseByAge(studentAge))?.id ?? 0) || null;
      }

      const enrolledGroupId = parseId(req.body.enrolledGroupId);
      const enrolledGroup = await validateEnrollmentGroup(enrolledGroupId);
      if (enrolledGroup) {
        courseId = Number(enrolledGroup.courseId);
      }
      const schoolId = enrolledGroup?.schoolId ? Number(enrolledGroup.schoolId) : null;
      const statusCode = nullableText(req.body.statusCode) ?? 'new_request';
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
      const managerId = await resolveLeadManagerId(req, req.body.managerId);
      const createdLead = await insertRow('academy_leads', {
        contactName,
        phone,
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
        referrerStudentId: parseId(req.body.referrerStudentId),
        createdBy: req.user!.id,
      });
      await createStageHistory(
        createdLead.id,
        null,
        createdLead.statusCode,
        req.user!.id,
        enrolledGroupId ? 'Создание лида и добавление в группу' : 'Создание лида',
      );
      return createdLead;
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
    const manager = await getActiveSalesManager(managerId);
    const comment = nullableText(req.body.comment) ?? 'Массовое переназначение администратором';
    const leads = await query(
      `SELECT l.*, u.full_name AS manager_name
       FROM academy_leads l
       LEFT JOIN users u ON u.id = l.manager_id
       WHERE l.id = ANY($1::int[])`,
      [leadIds],
    );
    if (leads.length !== leadIds.length) {
      return res.status(404).json({ error: 'One or more leads were not found' });
    }

    const changedLeads = leads.filter((lead) => Number(lead.managerId) !== Number(manager.id));
    if (changedLeads.length > 0) {
      const changedIds = changedLeads.map((lead) => Number(lead.id));
      await withTransaction(async () => {
        await query(
          `UPDATE academy_leads
           SET manager_id = $1, updated_at = NOW()
           WHERE id = ANY($2::int[])`,
          [manager.id, changedIds],
        );
        await query(
          `UPDATE academy_students
           SET manager_id = $1, updated_at = NOW()
           WHERE lead_id = ANY($2::int[])`,
          [manager.id, changedIds],
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
          [manager.id, changedIds],
        );
        for (const lead of changedLeads) {
          await insertRow('academy_lead_assignment_history', {
            leadId: lead.id,
            fromManagerId: lead.managerId ?? null,
            toManagerId: manager.id,
            changedBy: req.user!.id,
            comment,
          });
        }
      });

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
    res.json({
      ...lead,
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
    if (!ensureLeadRowAccess(req, res, oldLead)) return;

    const manager = await getActiveSalesManager(managerId);
    const lead = await reassignLead(req, oldLead, manager, nullableText(req.body.comment));
    await createAudit(req, 'ASSIGN_ACADEMY_LEAD', 'academy_lead', lead.id, lead, oldLead);
    res.json(lead);
  } catch (error: any) {
    logger.error('Failed to assign lead', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to assign lead' });
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
    const oldLead = await getLead(id);
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });
    if (!ensureLeadRowAccess(req, res, oldLead)) return;

    const requestedGroupId = req.body.enrolledGroupId === undefined
      ? undefined
      : parseId(req.body.enrolledGroupId);
    const requestedGroup = requestedGroupId
      ? await validateEnrollmentGroup(requestedGroupId, id)
      : null;
    const nextStatus = nullableText(req.body.statusCode) ?? oldLead.statusCode;
    const transitionError = validateLeadStatusTransition(oldLead.statusCode, nextStatus);
    if (transitionError) return res.status(400).json({ error: transitionError });
    const merged = {
      nextStatus,
      studentName: nullableText(req.body.studentName) ?? oldLead.studentName,
      studentAge: toIntegerOrNull(req.body.studentAge) ?? oldLead.studentAge,
      courseId: requestedGroup?.courseId
        ? Number(requestedGroup.courseId)
        : parseId(req.body.courseId) ?? oldLead.courseId,
      enrolledGroupId: req.body.enrolledGroupId === undefined
        ? oldLead.enrolledGroupId
        : requestedGroupId,
    };
    const validationError = validateLeadForStatusChange(merged);
    if (validationError) return res.status(400).json({ error: validationError });
    const managerId = req.user!.workspace !== 'sales' && req.body.managerId !== undefined
      ? await resolveLeadManagerId(req, req.body.managerId)
      : undefined;
    const updates: Row = {
      contactName: nullableText(req.body.contactName) ?? oldLead.contactName,
      phone: nullableText(req.body.phone) ?? oldLead.phone,
      messenger: nullableText(req.body.messenger),
      studentName: nullableText(req.body.studentName),
      studentAge: toIntegerOrNull(req.body.studentAge),
      courseId: req.body.enrolledGroupId !== undefined
        ? requestedGroup?.courseId
          ? Number(requestedGroup.courseId)
          : req.body.courseId !== undefined
            ? parseId(req.body.courseId)
            : oldLead.courseId
        : req.body.courseId !== undefined
          ? parseId(req.body.courseId)
          : undefined,
      schoolId: req.body.enrolledGroupId === undefined
        ? undefined
        : requestedGroup?.schoolId
          ? Number(requestedGroup.schoolId)
          : null,
      sourceId: parseId(req.body.sourceId) ?? oldLead.sourceId,
      advertisingCampaign: nullableText(req.body.advertisingCampaign),
      acquisitionCostUzs: toIntegerOrNull(req.body.acquisitionCostUzs),
      statusCode: nullableText(req.body.statusCode),
      managerId,
      language: nullableText(req.body.language),
      comment: nullableText(req.body.comment),
      firstContactAt: nullableDate(req.body.firstContactAt),
      firstContactChannel: nullableText(req.body.firstContactChannel),
      firstContactResult: nullableText(req.body.firstContactResult),
      demoAttended: req.body.demoAttended === undefined ? undefined : Boolean(req.body.demoAttended),
      demoResult: nullableText(req.body.demoResult),
      offerCourseId: parseId(req.body.offerCourseId),
      offerPriceUzs: toIntegerOrNull(req.body.offerPriceUzs),
      offerDiscount: nullableText(req.body.offerDiscount),
      offerAt: nullableDate(req.body.offerAt),
      enrolledGroupId: req.body.enrolledGroupId === undefined ? undefined : requestedGroupId,
      expectedPaymentUzs: toIntegerOrNull(req.body.expectedPaymentUzs),
      paymentMethod: nullableText(req.body.paymentMethod),
      warmReason: nullableText(req.body.warmReason),
      warmMovedAt: nullableDate(req.body.warmMovedAt),
      noMailing: req.body.noMailing === undefined ? undefined : Boolean(req.body.noMailing),
      referralCode: nullableText(req.body.referralCode),
      referrerStudentId: parseId(req.body.referrerStudentId) };

    const lead = await withTransaction(async () => {
      const groupToReserve = Number(merged.enrolledGroupId || 0);
      const mustValidateCapacity = Boolean(requestedGroupId)
        || ['enrolled', 'paid'].includes(nextStatus);
      if (mustValidateCapacity && groupToReserve) {
        await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [groupToReserve]);
        await validateEnrollmentGroup(groupToReserve, id);
      }
      return updateRow('academy_leads', id, updates);
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (oldLead.statusCode !== lead.statusCode) {
      await createStageHistory(lead.id, oldLead.statusCode, lead.statusCode, req.user!.id, nullableText(req.body.statusComment));
      await handleLeadAutomation(req, lead, oldLead.statusCode);
    }

    if (lead.statusCode === 'paid') {
      await createStudentFromLead(req, lead.id);
    }

    await createAudit(req, 'UPDATE_ACADEMY_LEAD', 'academy_lead', lead.id, lead, oldLead);
    res.json(lead);
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
    if (!ensureLeadRowAccess(req, res, lead)) return;

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

    res.status(201).json({ communication, lead: updatedLead });
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
    if (!ensureLeadRowAccess(req, res, oldLead)) return;

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
    res.json(lead);
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
    if (!ensureLeadRowAccess(req, res, lead)) return;
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
  const workspace = String(req.user?.workspace);
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
    if (workspace === 'analytics' || workspace === 'administration') return { whereSql: '', params };
    if (!['sales', 'teacher', 'marketing'].includes(workspace)) {
      return { whereSql: 'FALSE', params, denied: true };
    }
    return { whereSql: `responsible_id = ${ownUserParam()}`, params };
  }

  if (table === 'academy_lessons') {
    if (workspace === 'analytics' || workspace === 'administration') return { whereSql: '', params };
    if (workspace === 'teacher') {
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
  if (maxStudents < 1 || maxStudents > 12) {
    throw Object.assign(new Error('groupCapacityLimit'), { statusCode: 400 });
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

  if (options.forceAutoAssign || (!options.values.teacherId && !options.oldRow?.teacherId)) {
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
  }
};

const prepareLessonMutation = async (options: {
  values: Row;
  oldRow?: Row | null;
  excludeLessonId?: number | null;
  forceAutoAssign?: boolean;
}) => {
  const groupId = Number(options.values.groupId ?? options.oldRow?.groupId);
  const group = groupId
    ? await queryOne(`SELECT * FROM academy_groups WHERE id = $1`, [groupId])
    : null;
  if (!group) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });

  const courseId = Number(options.values.courseId ?? options.oldRow?.courseId ?? group.courseId);
  const schoolId = Number(options.values.schoolId ?? options.oldRow?.schoolId ?? group.schoolId);
  const roomId = Number(options.values.roomId ?? options.oldRow?.roomId ?? group.roomId);
  const scheduledAt = new Date(options.values.scheduledAt ?? options.oldRow?.scheduledAt);
  const durationMinutes = Number(
    options.values.durationMinutes
      ?? options.oldRow?.durationMinutes
      ?? (await queryOne(`SELECT lesson_duration_minutes FROM academy_courses WHERE id = $1`, [courseId]))?.lessonDurationMinutes
      ?? 120,
  );

  if (!courseId || !schoolId || !roomId || Number.isNaN(scheduledAt.getTime()) || durationMinutes < 15) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }

  options.values.courseId = courseId;
  options.values.schoolId = schoolId;
  options.values.roomId = roomId;
  options.values.durationMinutes = durationMinutes;
  await query(`SELECT pg_advisory_xact_lock($1)`, [roomId]);
  await assertLessonRoomAvailable({
    schoolId,
    roomId,
    scheduledAt,
    durationMinutes,
    excludeLessonId: options.excludeLessonId,
    excludeGroupId: groupId,
  });

  if (options.forceAutoAssign || (!options.values.teacherId && !options.oldRow?.teacherId)) {
    const teacher = await findAvailableTeacher({
      courseId,
      schoolId,
      scheduledAt,
      durationMinutes,
    });
    if (!teacher) throw Object.assign(new Error('noAvailableTeacher'), { statusCode: 404 });
    options.values.teacherId = Number(teacher.id);
  }
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
        return true;
      });
      if (updated) updatedCount += 1;
    } catch (error) {
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
  requireFinance?: boolean;
  requireOperations?: boolean;
  requireMarketing?: boolean;
} = {}) => {
  router.get(`/${path}`, async (req, res) => {
    if (options.allowedWorkspaces && !ensureWorkspaceAccess(req, res, options.allowedWorkspaces, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationWorkspaceAccess(req, res)) return;
    if (options.requireFinance && !ensureFinanceAccess(req, res)) return;
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
    if (options.requireFinance && !ensureFinanceAccess(req, res)) return;
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
    if (options.requireFinance && !ensureFinanceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    if (options.requireOperations && req.user?.workspace === 'teacher') {
      return res.status(403).json({ error: 'Operations mutation access required' });
    }
    if (table === 'academy_tasks' && !['analytics', 'administration'].includes(String(req.user?.workspace))) {
      const responsibleId = parseId(req.body.responsibleId) ?? req.user!.id;
      if (Number(responsibleId) !== Number(req.user!.id)) {
        return res.status(403).json({ error: 'Task mutation access required' });
      }
    }
    try {
      const values: Row = {  };
      for (const column of columns) {
        const value = req.body[column];
        if (column.endsWith('At') || column.endsWith('Date') || column === 'periodStart' || column === 'periodEnd') {
          values[column] = nullableDate(value);
        } else if (column.endsWith('Id') || column.endsWith('Uzs') || column.endsWith('Count') || column.endsWith('Minutes') || column.endsWith('Days') || column === 'age' || column === 'score' || column === 'npsScore' || column === 'maxStudents' || column === 'capacity' || column === 'lessonNumber' || column === 'sortOrder') {
          values[column] = toIntegerOrNull(value);
        } else if (column === 'program' || column === 'schedule' || column === 'availability' || column === 'courseIds' || column === 'schoolIds' || column === 'riskFlags' || column === 'rooms') {
          values[column] = safeJson(value, []);
        } else if (['isActive', 'isSystem', 'isPipeline'].includes(column)) {
          values[column] = toBoolean(value);
        } else {
          values[column] = nullableText(value);
        }
      }

      if (table === 'academy_marketing_expenses') {
        values.createdBy = req.user!.id;
        values.status = 'pending';
        values.approvedBy = null;
        values.approvedAt = null;
      }
      const row = table === 'academy_groups'
        ? await withTransaction(async () => {
          await prepareGroupMutation({ values, forceAutoAssign: true });
          return insertRow(table, values);
        })
        : table === 'academy_lessons'
          ? await withTransaction(async () => {
            await prepareLessonMutation({ values, forceAutoAssign: true });
            return insertRow(table, values);
          })
        : await insertRow(table, values);
      await createAudit(req, `CREATE_${table.toUpperCase()}`, table, row.id, row);
      if (table === 'academy_teachers') {
        await reconcileAutomaticTeacherAssignments(Number(row.id));
      }
      res.status(201).json(row);
    } catch (error: any) {
      logger.error(`Failed to create ${path}`, { error });
      res.status(error.statusCode || 500).json({ error: error.message || `Failed to create ${path}` });
    }
  });

  router.patch(`/${path}/:id`, async (req, res) => {
    if (options.allowedWorkspaces && !ensureWorkspaceAccess(req, res, options.allowedWorkspaces, `${path} access required`)) return;
    if (options.requireAdministration && !ensureAdministrationWorkspaceAccess(req, res)) return;
    if (options.requireFinance && !ensureFinanceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    if (options.requireOperations && req.user?.workspace === 'teacher') {
      return res.status(403).json({ error: 'Operations mutation access required' });
    }
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: `Invalid ${path} id` });
      const oldRow = await queryOne(`SELECT * FROM ${quoteIdent(table)} WHERE id = $1`, [id]);
      if (!oldRow) return res.status(404).json({ error: `${path} not found` });
      if (table === 'academy_tasks' && !['analytics', 'administration'].includes(String(req.user?.workspace)) && Number(oldRow.responsibleId) !== Number(req.user!.id)) {
        return res.status(403).json({ error: 'Task mutation access required' });
      }
      const values: Row = {};
      for (const column of columns) {
        if (!(column in req.body)) continue;
        const value = req.body[column];
        if (column.endsWith('At') || column.endsWith('Date') || column === 'periodStart' || column === 'periodEnd') {
          values[column] = nullableDate(value);
        } else if (column.endsWith('Id') || column.endsWith('Uzs') || column.endsWith('Count') || column.endsWith('Minutes') || column.endsWith('Days') || column === 'age' || column === 'score' || column === 'npsScore' || column === 'maxStudents' || column === 'capacity' || column === 'lessonNumber' || column === 'sortOrder') {
          values[column] = toIntegerOrNull(value);
        } else if (column === 'program' || column === 'schedule' || column === 'availability' || column === 'courseIds' || column === 'schoolIds' || column === 'riskFlags' || column === 'rooms') {
          values[column] = safeJson(value, []);
        } else if (['isActive', 'isSystem', 'isPipeline'].includes(column)) {
          values[column] = toBoolean(value);
        } else {
          values[column] = nullableText(value);
        }
      }
      const row = table === 'academy_groups'
        ? await withTransaction(async () => {
          const lockedRow = await queryOne(
            `SELECT * FROM academy_groups WHERE id = $1 FOR UPDATE`,
            [id],
          );
          if (!lockedRow) {
            throw Object.assign(new Error(`${path} not found`), { statusCode: 404 });
          }
          await prepareGroupMutation({
            values,
            oldRow: lockedRow,
            excludeGroupId: id,
            forceAutoAssign: req.body.autoAssign === true,
          });
          return updateRow(table, id, values);
        })
        : table === 'academy_lessons'
          ? await withTransaction(async () => {
            const lockedRow = await queryOne(
              `SELECT * FROM academy_lessons WHERE id = $1 FOR UPDATE`,
              [id],
            );
            if (!lockedRow) {
              throw Object.assign(new Error(`${path} not found`), { statusCode: 404 });
            }
            await prepareLessonMutation({
              values,
              oldRow: lockedRow,
              excludeLessonId: id,
              forceAutoAssign: req.body.autoAssign === true,
            });
            return updateRow(table, id, values);
          })
        : await updateRow(table, id, values);
      if (table === 'academy_lessons' && values.status !== undefined && oldRow.status !== row?.status) {
        await insertRow('academy_lesson_status_history', {
                    lessonId: id,
          fromStatus: oldRow.status ?? null,
          toStatus: row?.status ?? String(values.status),
          changedBy: req.user!.id,
          comment: nullableText(req.body.statusComment) ?? null });
      }
      if (
        table === 'academy_teachers'
        && ['courseIds', 'schoolIds', 'availability', 'schedule', 'status']
          .some((field) => field in req.body)
      ) {
        await reconcileAutomaticTeacherAssignments(id);
      }
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
    if (options.requireFinance && !ensureFinanceAccess(req, res)) return;
    if (options.requireOperations && !ensureOperationsAccess(req, res)) return;
    if (options.requireMarketing && !ensureMarketingAccess(req, res)) return;
    if (options.requireOperations && req.user?.workspace === 'teacher') {
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
      await deleteRow(table, id);
      res.json({ ok: true });
    } catch (error: any) {
      logger.error(`Failed to delete ${path}`, { error });
      const isForeignKeyConflict = error?.code === '23503';
      res.status(isForeignKeyConflict ? 409 : 500).json({
        error: isForeignKeyConflict ? 'resourceInUse' : `Failed to delete ${path}`,
      });
    }
  });
};

router.post('/lessons/:id/attendance', async (req, res) => {
  try {
    const lessonId = parseId(req.params.id);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id' });
    const lesson = await queryOne(
      `SELECT l.*, t.user_id AS teacher_user_id
       FROM academy_lessons l
       LEFT JOIN academy_teachers t ON t.id = l.teacher_id
       WHERE l.id = $1`,
      [lessonId],
    );
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    if (lesson.status === 'cancelled') return res.status(400).json({ error: 'cancelledLessonAttendanceNotAllowed' });
    if (req.user!.workspace === 'teacher' && (!lesson.teacherUserId || Number(lesson.teacherUserId) !== req.user!.id)) {
      return res.status(403).json({ error: 'Teacher can mark only own lessons' });
    }

    const items = Array.isArray(req.body.attendance) ? req.body.attendance : [];
    const saved = [];
    for (const item of items) {
      const studentId = parseId(item.studentId);
      if (!studentId) continue;
      const student = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
      if (!student || Number(student.groupId) !== Number(lesson.groupId)) {
        return res.status(403).json({ error: 'Attendance can include only students from this lesson group' });
      }
      const status = item.status === 'present' ? 'present' : 'absent';
      const result = await pool.query(
        `INSERT INTO academy_attendance (lesson_id, student_id, status, project_url, note, marked_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (lesson_id, student_id)
         DO UPDATE SET status = EXCLUDED.status, project_url = EXCLUDED.project_url, note = EXCLUDED.note, marked_by = EXCLUDED.marked_by, updated_at = NOW()
         RETURNING *`,
        [lessonId, studentId, status, nullableText(item.projectUrl), nullableText(item.note), req.user!.id],
      );
      saved.push(camelize(result.rows[0]));

      const recentAbsences = await query<{ status: string }>(
        `SELECT COALESCE(a.status, 'absent') AS status
         FROM academy_lessons l
         LEFT JOIN academy_attendance a ON a.lesson_id = l.id AND a.student_id = $2
         WHERE l.group_id = $1 AND l.status = 'conducted'
         ORDER BY l.scheduled_at DESC
         LIMIT 3`,
        [lesson.groupId, studentId],
      );
      if (recentAbsences.length === 3 && recentAbsences.every((row) => row.status === 'absent')) {
        await createTask('3 пропуска подряд: позвонить родителю', {
          responsibleId: student?.managerId ?? req.user!.id,
          entityType: 'student',
          entityId: studentId,
          deadlineAt: addDays(new Date(), 1) });
        await createNotification(student?.managerId ?? req.user!.id, 'Риск по посещаемости', `${student?.studentName ?? 'Ученик'} пропустил 3 занятия подряд`, 'student', studentId);
      }
    }

    const updatedLesson = await updateRow('academy_lessons', lessonId, {
      status: nullableText(req.body.lessonStatus) ?? 'conducted' });

    const groupStudents = await query(
      `SELECT * FROM academy_students WHERE group_id = $1 AND status = 'studying'`,
      [lesson.groupId],
    );
    for (const student of groupStudents) {
      await recalculateStudentMetrics(Number(student.id));
    }

    if (updatedLesson?.status === 'conducted') {
      for (const student of groupStudents) {
        await createOutbox(Number(student.age || 0) <= 10 ? 'whatsapp' : 'telegram', student.messenger || student.phone, 'Оцените сегодняшний урок 01 Academy: /survey', {
          scheduledAt: addMinutes(new Date(lesson.scheduledAt), Number(lesson.durationMinutes || 120) + 30),
          entityType: 'lesson',
          entityId: lessonId });
      }
    }

    res.json({ lesson: updatedLesson, attendance: saved });
  } catch (error) {
    logger.error('Failed to save attendance', { error });
    res.status(500).json({ error: 'Failed to save attendance' });
  }
});

router.post('/students/:id/transfer', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, OPERATIONS_WORKSPACES, 'Operations access required')) return;
  try {
    const studentId = parseId(req.params.id);
    const toGroupId = parseId(req.body.toGroupId);
    if (!studentId || !toGroupId) return res.status(400).json({ error: 'Student and target group are required' });
    await ensureGroupCapacity(toGroupId);
    const oldStudent = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
    if (!oldStudent) return res.status(404).json({ error: 'Student not found' });
    await insertRow('academy_student_transfers', {
      studentId,
      fromGroupId: oldStudent.groupId ?? null,
      toGroupId,
      reason: nullableText(req.body.reason) ?? null,
      createdBy: req.user!.id });
    const student = await updateRow('academy_students', studentId, { groupId: toGroupId });
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
    const current = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [id]);
    if (!current) return res.status(404).json({ error: 'Student not found' });
    const student = await updateRow('academy_students', id, {
      status,
      exitReason: ['paused', 'expelled'].includes(status) ? exitReason : null,
    });
    if (current.status !== status) {
      await insertRow('academy_student_status_history', {
        studentId: id,
        fromStatus: current.status,
        toStatus: status,
        changedBy: req.user!.id,
        comment: nullableText(req.body.comment) ?? null,
      });
    }
    await createAudit(req, 'UPDATE_ACADEMY_STUDENT_STATUS', 'academy_student', id, student, current);
    res.json(student);
  } catch (error) {
    logger.error('Failed to update student status', { error });
    res.status(500).json({ error: 'Failed to update student status' });
  }
});

router.post('/payments', async (req, res) => {
  if (!ensureWorkspaceAccess(req, res, new Set([...FINANCE_WORKSPACES, ...SALES_WORKSPACES]), 'Payment access required')) return;
  try {
    const amountUzs = normalizeMoney(req.body.amountUzs);
    const leadId = parseId(req.body.leadId);
    const studentId = parseId(req.body.studentId);
    if (!amountUzs) return res.status(400).json({ error: 'paymentAmountRequired' });
    if (!leadId && !studentId) return res.status(400).json({ error: 'paymentPartyRequired' });
    const status = nullableText(req.body.status) ?? 'paid';
    if (!PAYMENT_STATUSES.some((item) => item.code === status)) {
      return res.status(400).json({ error: 'Invalid payment status' });
    }

    const result = await withTransaction(async () => {
      const lead = leadId
        ? await queryOne(`SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`, [leadId])
        : undefined;
      if (leadId && !lead) {
        throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
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
      if (req.user!.workspace === 'sales') {
        const ownsLead = !lead || Number(lead.managerId) === Number(req.user!.id);
        const ownsStudent = !existingStudent || Number(existingStudent.managerId) === Number(req.user!.id);
        if (!ownsLead || !ownsStudent) {
          throw Object.assign(new Error('Payment access required'), { statusCode: 403 });
        }
      }

      if (lead?.enrolledGroupId) {
        await queryOne(`SELECT id FROM academy_groups WHERE id = $1 FOR UPDATE`, [lead.enrolledGroupId]);
      }

      const paidAt = status === 'paid' ? nullableDate(req.body.paidAt) ?? new Date() : nullableDate(req.body.paidAt);
      const payment = await insertRow('academy_payments', {
        leadId,
        studentId: existingStudent?.id ?? studentId,
        groupId: existingStudent?.groupId ?? lead?.enrolledGroupId ?? parseId(req.body.groupId),
        amountUzs,
        type: nullableText(req.body.type) ?? 'full',
        method: nullableText(req.body.method) ?? 'transfer',
        paidAt,
        period: nullableText(req.body.period) ?? 'month_1',
        discount: nullableText(req.body.discount) ?? 'none',
        status,
        dueAt: nullableDate(req.body.dueAt),
        paidUntil: nullableDate(req.body.paidUntil) ?? (status === 'paid' ? addDays(new Date(), 30) : null),
        comment: nullableText(req.body.comment),
        receiptUrl: nullableText(req.body.receiptUrl),
        confirmedBy: status === 'paid' ? req.user!.id : null });

      let student = existingStudent ?? null;
      if (status === 'paid' && leadId) {
        student = await createStudentFromLead(req, leadId, payment.id);
      }
      const resolvedStudentId = student?.id ?? studentId;
      if (status === 'paid' && resolvedStudentId) {
        await updateRow('academy_students', Number(resolvedStudentId), {
          nextPaymentAt: payment.paidUntil ?? addDays(new Date(), 30) });
        await applyReferralRewards(req, Number(resolvedStudentId), leadId, payment.id);
      }

      await createAudit(req, 'CREATE_ACADEMY_PAYMENT', 'academy_payment', payment.id, payment);
      return { payment, student };
    });

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Failed to create payment', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create payment' });
  }
});

router.post('/surveys/lesson', async (req, res) => {
  try {
    const score = Number(req.body.score);
    if (!Number.isFinite(score) || score < 1 || score > 5) return res.status(400).json({ error: 'Score must be from 1 to 5' });
    const lessonId = parseId(req.body.lessonId);
    const studentId = parseId(req.body.studentId);
    if (!lessonId || !studentId) return res.status(400).json({ error: 'Lesson and student are required' });
    const lesson = await queryOne(`SELECT * FROM academy_lessons WHERE id = $1`, [lessonId]);
    const survey = await insertRow('academy_lesson_surveys', {
      studentId,
      lessonId,
      groupId: lesson?.groupId ?? parseId(req.body.groupId),
      teacherId: lesson?.teacherId ?? parseId(req.body.teacherId),
      courseId: lesson?.courseId ?? parseId(req.body.courseId),
      score,
      liked: nullableText(req.body.liked),
      improve: nullableText(req.body.improve) });
    await recalculateStudentMetrics(studentId);
    if (score < 3) {
      const student = await queryOne(`SELECT manager_id FROM academy_students WHERE id = $1`, [studentId]);
      const leader = await queryOne<{ id: string }>(
        `SELECT id FROM users WHERE workspace = 'administration' AND is_active=true ORDER BY id LIMIT 1`);
      const responsibleId = Number(student?.managerId ?? leader?.id ?? req.user!.id);
      const task = await createTask('Оценка урока ниже 3 — связаться с учеником', {
        responsibleId,
        description: `Ученик поставил ${score}/5. Свяжитесь и узнайте причину.`,
        entityType: 'lesson_survey',
        entityId: Number(survey.id),
        deadlineAt: addMinutes(new Date(), 12 * 60) });
      if (student?.managerId) {
        await createNotification(Number(student.managerId), 'Низкая оценка урока', `Оценка ${score}/5 — задача закрывается за 12 часов.`, 'academy_task', Number(task.id));
      }
    }
    res.status(201).json(survey);
  } catch (error) {
    logger.error('Failed to save lesson survey', { error });
    res.status(500).json({ error: 'Failed to save lesson survey' });
  }
});

router.post('/surveys/parent', async (req, res) => {
  try {
    const studentId = parseId(req.body.studentId);
    if (!studentId) return res.status(400).json({ error: 'Student is required' });
    const student = await queryOne(`SELECT * FROM academy_students WHERE id = $1`, [studentId]);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const period = nullableText(req.body.period) ?? new Date().toISOString().slice(0, 7);
    const survey = await insertRow('academy_parent_surveys', {
      studentId,
      groupId: student.groupId ?? null,
      courseId: student.courseId ?? null,
      progressAnswer: nullableText(req.body.progressAnswer),
      joyAnswer: nullableText(req.body.joyAnswer),
      continueAnswer: nullableText(req.body.continueAnswer),
      npsScore: toIntegerOrNull(req.body.npsScore),
      comment: nullableText(req.body.comment),
      period });
    await updateRow('academy_students', studentId, { parentFeedback: nullableText(req.body.comment) });
    const npsScore = Number(survey.npsScore);
    if (Number.isFinite(npsScore) && npsScore <= 6) {
      const leader = await queryOne<{ id: string }>(
        `SELECT id FROM users WHERE workspace = 'administration' AND is_active=true ORDER BY id LIMIT 1`);
      const responsibleId = Number(student.managerId ?? leader?.id ?? req.user!.id);
      const task = await createTask('Низкий NPS родителя — связаться с семьёй', {
        responsibleId,
        description: `Родитель поставил NPS ${npsScore}/10. Уточните причину и зафиксируйте решение.`,
        entityType: 'parent_survey',
        entityId: Number(survey.id),
        deadlineAt: addMinutes(new Date(), 12 * 60),
      });
      if (student.managerId) {
        await createNotification(Number(student.managerId), 'Низкий NPS родителя', `Создана задача со сроком 12 часов.`, 'academy_task', Number(task.id));
      }
    }
    if (['Не уверен', 'Нет', 'not_sure', 'no'].includes(String(req.body.continueAnswer))) {
      await createTask('Родитель сомневается в продолжении', {
        responsibleId: student.managerId ?? req.user!.id,
        description: 'Позвонить и узнать причину.',
        entityType: 'student',
        entityId: studentId,
        deadlineAt: addDays(new Date(), 1) });
    }
    res.status(201).json(survey);
  } catch (error) {
    logger.error('Failed to save parent survey', { error });
    res.status(500).json({ error: 'Failed to save parent survey' });
  }
});

router.get('/integrations/status', async (req, res) => {
  if (!ensureAdministrationWorkspaceAccess(req, res)) return;
  try {
    const logs = await query(
      `SELECT DISTINCT ON (provider) provider, status, error_message, updated_at, created_at
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
    const providers = [
      {
        provider: 'instagram',
        connected: Number(instagramAccounts[0]?.connectedCount ?? 0) > 0,
        note: 'Instagram Login, Direct messages and automatic lead creation',
      },
      { provider: 'chatplace', connected: Boolean(integ.chatplace?.webhookSecret), note: 'Instagram DM inbound webhook' },
      { provider: 'telegram', connected: Boolean(integ.telegram?.botToken), note: 'Outbound bot messages + leadership reports' },
      { provider: 'whatsapp', connected: Boolean(integ.whatsapp?.apiToken && integ.whatsapp?.phoneNumberId), note: 'WhatsApp Business Cloud API' },
      { provider: 'google_forms', connected: Boolean(integ.chatplace?.webhookSecret), note: 'Demo registration inbound webhook' },
      { provider: 'meta_ads', connected: Boolean(integ.metaAds?.accessToken && integ.metaAds?.adAccountId), note: 'Ad spend import (manual expenses until connected)' },
      { provider: 'google_sheets', connected: Boolean(integ.googleSheets?.spreadsheetId), note: 'CSV export available; Sheets sync requires credentials' },
      { provider: 'notion', connected: Boolean(integ.notion?.token && integ.notion?.databaseId), note: 'CSV export available; Notion pages require token' },
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
    const now = new Date();
    const actions: string[] = [];

    const staleLeads = await query(
      `SELECT * FROM academy_leads
       WHERE status_code <> 'not_now'
         AND status_code <> 'paid'
         AND updated_at < NOW() - INTERVAL '14 days'`,
      [],
    );

    for (const lead of staleLeads) {
      const updated = await updateRow('academy_leads', lead.id, {
        statusCode: 'not_now',
        warmMovedAt: now,
        warmReason: 'Нет ответа 14+ дней' });
      await createStageHistory(lead.id, lead.statusCode, 'not_now', req.user!.id, 'Автоматический перенос: нет ответа 14+ дней');
      actions.push(`lead:${lead.id}:not_now`);
      if (updated?.managerId) {
        await createTask('Лид автоматически перенесён в тёплую базу', {
          responsibleId: updated.managerId,
          entityType: 'lead',
          entityId: lead.id,
          deadlineAt: addDays(now, 1) });
      }
    }

    const renewalPayments = await query(
      `SELECT p.*, s.manager_id, s.phone, s.messenger, s.student_name
       FROM academy_payments p
       LEFT JOIN academy_students s ON s.id = p.student_id
       WHERE p.status = 'paid'
         AND p.paid_until BETWEEN NOW() AND NOW() + INTERVAL '5 days'`,
      [],
    );

    for (const payment of renewalPayments) {
      await createTask('Напоминание о продлении оплаты', {
        responsibleId: payment.managerId ?? req.user!.id,
        description: 'Позвонить и уточнить продление.',
        entityType: 'payment',
        entityId: payment.id,
        deadlineAt: addDays(now, 1) });
      await createOutbox('whatsapp', payment.phone || payment.messenger || 'unknown', `01 Academy: оплаченный период ${payment.studentName ?? 'ученика'} скоро заканчивается.`, {
        scheduledAt: new Date(payment.paidUntil),
        entityType: 'payment',
        entityId: payment.id });
      actions.push(`payment:${payment.id}:renewal_reminder`);
    }

    const overduePayments = await query(
      `SELECT p.*, s.manager_id
       FROM academy_payments p
       LEFT JOIN academy_students s ON s.id = p.student_id
       WHERE p.status <> 'paid'
         AND p.due_at < NOW() - INTERVAL '3 days'`,
      [],
    );

    for (const payment of overduePayments) {
      await updateRow('academy_payments', payment.id, { status: 'overdue' });
      await createTask('Просрочена оплата', {
        responsibleId: payment.managerId ?? req.user!.id,
        entityType: 'payment',
        entityId: payment.id,
        deadlineAt: addDays(now, 1) });
      actions.push(`payment:${payment.id}:overdue`);
    }

    const warmLeads = await query(
      `SELECT * FROM academy_leads
       WHERE status_code = 'not_now' AND no_mailing = false`,
      [],
    );

    for (const lead of warmLeads) {
      await createOutbox('telegram', lead.messenger || lead.phone, '01 Academy: результат недели и новые проекты учеников. Хотите прийти на демо?', {
        scheduledAt: now,
        entityType: 'lead',
        entityId: lead.id });
      await createOutbox('telegram', lead.messenger || lead.phone, '01 Academy приглашает на демо-урок. Подберём курс по возрасту.', {
        scheduledAt: addDays(now, 14),
        entityType: 'lead',
        entityId: lead.id });
      await createOutbox('whatsapp', lead.phone, 'Специальное предложение 01 Academy на этот месяц.', {
        scheduledAt: addDays(now, 30),
        entityType: 'lead',
        entityId: lead.id });
      actions.push(`lead:${lead.id}:warm_mailings`);
    }

    await logIntegration('academy_automation', 'internal', 'completed', { actions });
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
      if (lead?.statusCode === 'not_now') {
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

router.get('/exports/:entity', async (req, res) => {
  try {
    const workspace = String(req.user?.workspace);
    if (!['administration', 'analytics', 'sales'].includes(workspace)) {
      return res.status(403).json({ error: 'Export access required' });
    }
    if (await isRestrictedAtCurrentTime(workspace)) {
      return res.status(403).json({ error: 'Exports are unavailable outside configured working hours' });
    }
    const entityMap: Record<string, string> = {
      leads: 'academy_leads',
      students: 'academy_students',
      payments: 'academy_payments',
      attendance: 'academy_attendance',
      surveys: 'academy_lesson_surveys',
      marketing: 'academy_marketing_expenses' };
    const table = entityMap[req.params.entity];
    if (!table) return res.status(404).json({ error: 'Export entity not found' });
    if (workspace === 'sales' && !['leads', 'students'].includes(req.params.entity)) {
      return res.status(403).json({ error: 'Sales exports are limited to own leads and students' });
    }
    if (['payments', 'marketing'].includes(req.params.entity) && !ensureFinanceAccess(req, res)) return;
    const rows = workspace === 'sales'
      ? await query(
        req.params.entity === 'leads'
          ? `SELECT * FROM academy_leads WHERE manager_id = $1 ORDER BY id DESC`
          : `SELECT * FROM academy_students WHERE manager_id = $1 ORDER BY id DESC`,
        [req.user!.id],
      )
      : await query(`SELECT * FROM ${quoteIdent(table)} ORDER BY id DESC`, []);
    await createAudit(req, 'EXPORT_ACADEMY_DATA', req.params.entity, 0, { count: rows.length });
    if (workspace === 'sales') {
      const message = `⚠️ Экспорт базы: менеджер ${req.user!.fullName} выгрузил ${rows.length} записей (${req.params.entity}).`;
      const { sendTelegramMessage } = await import('../services/telegram');
      const result = await sendTelegramMessage('leadership', message);
      await logIntegration('telegram', 'outbound', result.ok ? (result.simulated ? 'simulated' : 'sent') : 'failed', {
        kind: 'sales_export_alert',
        employeeId: req.user!.id,
        entity: req.params.entity,
        count: rows.length,
      }, result.error ?? null);
      const leaders = await query<{ id: number }>(
        `SELECT id FROM users WHERE workspace = 'administration' AND is_active = true`,
      );
      await Promise.all(leaders.map((leader) => createNotification(
        Number(leader.id),
        'Экспорт клиентской базы',
        `${req.user!.fullName}: ${rows.length} записей (${req.params.entity}).`,
        'export',
      )));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}.csv"`);
    res.send(createCsv(rows));
  } catch (error) {
    logger.error('Failed to export academy data', { error });
    res.status(500).json({ error: 'Failed to export academy data' });
  }
});

registerSimpleCrud('schools', 'academy_schools', [
  'name', 'code', 'address', 'timezone', 'isActive',
], { orderBy: 'is_active DESC, name', requireAdministration: true });

registerSimpleCrud('rooms', 'academy_rooms', [
  'schoolId', 'name', 'capacity', 'rentPerHourUzs', 'isActive',
], { orderBy: 'school_id, is_active DESC, name', requireAdministration: true });

registerSimpleCrud('courses', 'academy_courses', [
  'name', 'slug', 'ageCategory', 'lessonCount', 'lessonDurationMinutes', 'durationDays',
  'description', 'frequency', 'basePriceUzs', 'discountedPriceUzs',
  'ltvTargetMinUzs', 'ltvTargetMaxUzs', 'program', 'isActive',
], { orderBy: 'is_active DESC, name', requireAdministration: true });

registerSimpleCrud('pipeline-statuses', 'academy_lead_statuses', [
  'code', 'name', 'color', 'sortOrder', 'isPipeline', 'isSystem', 'isActive',
], { orderBy: 'sort_order, id', requireAdministration: true });

registerSimpleCrud('teachers', 'academy_teachers', [
  'userId', 'fullName', 'courseIds', 'schoolIds', 'availability', 'schedule', 'ratePerLessonUzs', 'status',
], { orderBy: 'full_name', requireAdministration: true });

registerSimpleCrud('groups', 'academy_groups', [
  'name', 'courseId', 'schoolId', 'roomId', 'teacherId', 'schedule', 'maxStudents', 'status', 'startDate', 'endDate',
], { orderBy: 'created_at DESC', requireAdministration: true });

registerSimpleCrud('sources', 'academy_lead_sources', [
  'code', 'name', 'channel', 'campaignName', 'costPerLeadUzs', 'isSystem', 'isActive',
], {
  orderBy: 'name',
  listWhere: 'is_active = true',
  allowedWorkspaces: SOURCE_MANAGEMENT_WORKSPACES,
});

registerSimpleCrud('lessons', 'academy_lessons', [
  'groupId', 'courseId', 'schoolId', 'roomId', 'teacherId', 'lessonNumber', 'topic', 'materials', 'scheduledAt', 'durationMinutes', 'status',
], { orderBy: 'scheduled_at DESC', requireOperations: true });

registerSimpleCrud('tasks', 'academy_tasks', [
  'title', 'description', 'responsibleId', 'deadlineAt', 'status', 'entityType', 'entityId', 'completedAt',
], { orderBy: 'COALESCE(deadline_at, created_at)' });

registerSimpleCrud('expenses', 'academy_marketing_expenses', [
  'sourceId', 'channel', 'campaignName', 'periodStart', 'periodEnd', 'amountUzs', 'createdBy',
], { orderBy: 'period_start DESC', requireMarketing: true });

export default router;
