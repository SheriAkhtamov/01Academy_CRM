import type { PoolClient } from 'pg';
import { DEFAULT_ACADEMY_TIME_ZONE } from '@shared/scheduling';

const academyTimeZone = process.env.ACADEMY_TIME_ZONE?.trim() || DEFAULT_ACADEMY_TIME_ZONE;

// Call while the employee row is locked and before deleting it. Keeping the
// cutoff separately also covers salary changes scheduled after offboarding,
// whose effective_to cannot precede effective_from under the existing check.
export const closeEmployeeSalaryAccrual = async (
  executor: Pick<PoolClient, 'query'>,
  userId: number,
) => {
  await executor.query(
    `UPDATE academy_salary_rates sr
     SET employment_ended_on = cutoff.ended_on,
         effective_to = CASE WHEN sr.effective_from <= cutoff.ended_on
           THEN LEAST(sr.effective_to, cutoff.ended_on) ELSE sr.effective_to END,
         updated_at = NOW()
     FROM (
       SELECT id,
              (COALESCE(archived_at, NOW() AT TIME ZONE 'UTC')
               AT TIME ZONE 'UTC' AT TIME ZONE $2)::date AS ended_on
       FROM users WHERE id = $1
     ) cutoff
     WHERE sr.employee_user_id = cutoff.id`,
    [userId, academyTimeZone],
  );
};
