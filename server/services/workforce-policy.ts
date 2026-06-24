import { pool } from '../db';
import { logger } from '../lib/logger';

export type SalesPhoneVisibility = 'own_leads' | 'mask_until_assigned';

export interface WorkforcePolicy {
  salesPhoneVisibility: SalesPhoneVisibility;
  workdayStartHour: number;
  workdayEndHour: number;
  workdays: number[];
}

export const defaultWorkforcePolicy: WorkforcePolicy = {
  salesPhoneVisibility: 'own_leads',
  workdayStartHour: 8,
  workdayEndHour: 20,
  workdays: [1, 2, 3, 4, 5],
};

const asHour = (value: unknown, fallback: number, max: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : fallback;
};

const normalizeWorkdays = (value: unknown) => {
  const candidate = Array.isArray(value) ? value : defaultWorkforcePolicy.workdays;
  const days = candidate.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  return days.length > 0 ? [...new Set(days)] : defaultWorkforcePolicy.workdays;
};

export const toWorkforcePolicy = (value: Record<string, unknown> | undefined | null): WorkforcePolicy => ({
  salesPhoneVisibility: value?.salesPhoneVisibility === 'mask_until_assigned' ? 'mask_until_assigned' : 'own_leads',
  workdayStartHour: asHour(value?.workdayStartHour, defaultWorkforcePolicy.workdayStartHour, 23),
  workdayEndHour: asHour(value?.workdayEndHour, defaultWorkforcePolicy.workdayEndHour, 24),
  workdays: normalizeWorkdays(value?.workdays),
});

export const getWorkforcePolicy = async (): Promise<WorkforcePolicy> => {
  try {
    const result = await pool.query(
      `SELECT sales_phone_visibility, workday_start_hour, workday_end_hour, workdays
       FROM academy_company_settings ORDER BY id LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) return defaultWorkforcePolicy;
    return toWorkforcePolicy({
      salesPhoneVisibility: row.sales_phone_visibility,
      workdayStartHour: row.workday_start_hour,
      workdayEndHour: row.workday_end_hour,
      workdays: row.workdays,
    });
  } catch (error) {
    // New installations may receive their application code before the migration;
    // fail open to avoid locking every employee out during a deployment.
    logger.warn('Unable to read workforce policy; using safe defaults', { error });
    return defaultWorkforcePolicy;
  }
};

const localWorkTime = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayByName: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return { weekday: weekdayByName[values.weekday] ?? 1, hour: Number(values.hour) || 0 };
};

export const isWithinWorkingHours = (date: Date, policy: WorkforcePolicy) => {
  const { weekday, hour } = localWorkTime(date);
  if (!policy.workdays.includes(weekday)) return false;
  if (policy.workdayStartHour === policy.workdayEndHour) return true;
  if (policy.workdayStartHour < policy.workdayEndHour) {
    return hour >= policy.workdayStartHour && hour < policy.workdayEndHour;
  }
  return hour >= policy.workdayStartHour || hour < policy.workdayEndHour;
};

export const isRestrictedAtCurrentTime = async (workspace: string, now = new Date()) => {
  if (workspace === 'administration') return false;
  return !isWithinWorkingHours(now, await getWorkforcePolicy());
};

export const maskPhone = (phone: string | null | undefined) => {
  const value = String(phone ?? '').trim();
  if (!value) return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  const country = digits.slice(0, Math.min(3, digits.length - 4));
  const operator = digits.slice(country.length, country.length + 2);
  const tail = digits.slice(-2);
  return `+${country}${operator ? ` ${operator}` : ''} *** ** ${tail}`;
};
