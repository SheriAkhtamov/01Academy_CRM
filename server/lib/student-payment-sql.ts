export const studentPaymentAmountSql = "COALESCE(allocation.amount_uzs,payment.amount_uzs)";

/** A cancelled invoice was a debt record, never money received. */
export const livePaymentSql = (alias = "payment") => `${alias}.status<>'cancelled'`;

/** An allocated payment replaces its direct attribution; never count both. */
export const studentPaymentSourceSql = (studentId = "$1") => `
  FROM academy_payments payment
  LEFT JOIN academy_payment_student_allocations allocation
    ON allocation.payment_id=payment.id AND allocation.student_id=${studentId}
  WHERE (allocation.student_id=${studentId} OR (payment.student_id=${studentId}
    AND NOT EXISTS(SELECT 1 FROM academy_payment_student_allocations any_allocation
      WHERE any_allocation.payment_id=payment.id)))
    AND ${livePaymentSql()}`;
