export const studentPaymentAmountSql = "COALESCE(allocation.amount_uzs,payment.amount_uzs)";
// A family allocation records an amount, not an individual coverage period.
export const studentPaymentPaidUntilSql = "CASE WHEN allocation.payment_id IS NULL THEN payment.paid_until END";

/** An allocated payment replaces its direct attribution; never count both. */
export const studentPaymentSourceSql = (studentId = "$1") => `
  FROM academy_payments payment
  LEFT JOIN academy_payment_student_allocations allocation
    ON allocation.payment_id=payment.id AND allocation.student_id=${studentId}
  WHERE (allocation.student_id=${studentId} OR (payment.student_id=${studentId}
    AND NOT EXISTS(SELECT 1 FROM academy_payment_student_allocations any_allocation
      WHERE any_allocation.payment_id=payment.id)))`;
