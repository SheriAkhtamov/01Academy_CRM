import { pool } from '../db';
import { logger } from '../lib/logger';

export type SalesPhoneVisibility = 'own_leads' | 'mask_until_assigned';

export interface WorkforcePolicy {
  salesPhoneVisibility: SalesPhoneVisibility;
}

export const defaultWorkforcePolicy: WorkforcePolicy = {
  salesPhoneVisibility: 'own_leads',
};

export const toWorkforcePolicy = (value: Record<string, unknown> | undefined | null): WorkforcePolicy => ({
  salesPhoneVisibility: value?.salesPhoneVisibility === 'mask_until_assigned' ? 'mask_until_assigned' : 'own_leads',
});

export const getWorkforcePolicy = async (): Promise<WorkforcePolicy> => {
  try {
    const result = await pool.query(
      `SELECT sales_phone_visibility
       FROM academy_company_settings ORDER BY id LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) return defaultWorkforcePolicy;
    return toWorkforcePolicy({
      salesPhoneVisibility: row.sales_phone_visibility,
    });
  } catch (error) {
    // New installations may receive their application code before the migration.
    logger.warn('Unable to read workforce policy; using safe defaults', { error });
    return defaultWorkforcePolicy;
  }
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
