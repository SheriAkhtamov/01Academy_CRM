import type { KpiSaleReview } from '@shared/sales-kpi';
import { kpiMonth } from '@shared/sales-kpi-time';
import { kpiError, kpiTransaction, type KpiActor } from './kpi-repository';

export async function reviewKpiSale(actor: KpiActor, paymentId: number, input: KpiSaleReview) {
  return kpiTransaction(async (client) => {
    const { rows: [sale] } = await client.query<{
      closer_id: number | null; kind: string; cycle_key: string | null; referral_initiated: boolean;
      student_id: number; group_id: number | null; status: string; paid_at: Date; referrer_student_id: number | null;
    }>(`SELECT tracked.*, payment.student_id, payment.group_id, payment.status,
        COALESCE(payment.paid_at, payment.created_at) AS paid_at, lead.referrer_student_id
       FROM academy_sales_kpi_sales tracked JOIN academy_payments payment ON payment.id = tracked.payment_id
       JOIN academy_students student ON student.id = payment.student_id
       LEFT JOIN academy_leads lead ON lead.id = COALESCE(payment.lead_id, student.lead_id)
       WHERE tracked.payment_id = $1 FOR UPDATE OF tracked, payment`, [paymentId]);
    if (!sale) throw kpiError(new Error('resourceNotFound'), 404);
    if (!actor.isAdministration && sale.closer_id !== actor.id) throw kpiError(new Error('accessDenied'), 403);
    if (sale.status !== 'paid') throw kpiError(new Error('kpiConfirmedPaymentRequired'));
    if (kpiMonth(sale.paid_at) !== kpiMonth()) throw kpiError(new Error('kpiPastPeriodLocked'), 409);
    await client.query('SELECT id FROM academy_students WHERE id = $1 FOR UPDATE', [sale.student_id]);
    // New/existing classification is established from payment history, never
    // from a user's checkbox. Review can only distinguish subsequent sales.
    if ((sale.kind === 'new') !== (input.kind === 'new')) throw kpiError(new Error('kpiFirstPaymentImmutable'));
    if (sale.kind === 'installment' && input.kind !== 'installment') throw kpiError(new Error('kpiInstallmentImmutable'));
    if (input.referralInitiated && !sale.referrer_student_id) throw kpiError(new Error('kpiReferrerRequired'));
    if (['renewal', 'upsell'].includes(input.kind)) {
      const { rows: duplicates } = await client.query(
        `SELECT 1 FROM academy_sales_kpi_sales other
         JOIN academy_payments payment ON payment.id = other.payment_id
         WHERE payment.student_id = $1 AND payment.group_id IS NOT DISTINCT FROM $2
           AND other.cycle_key = $3 AND other.kind IN ('renewal', 'upsell')
           AND payment.status = 'paid' AND payment.id <> $4 LIMIT 1`,
        [sale.student_id, sale.group_id, input.cycleKey, paymentId],
      );
      if (duplicates.length) throw kpiError(new Error('kpiDuplicateCycle'), 409);
    }
    await client.query(
      `UPDATE academy_sales_kpi_sales SET kind = $2, cycle_key = $3, referral_initiated = $4,
        reviewed_by = $5, reviewed_at = timezone('UTC', now()) WHERE payment_id = $1`,
      [paymentId, input.kind, ['renewal', 'upsell'].includes(input.kind) ? input.cycleKey : null, input.referralInitiated, actor.id],
    );
    await client.query(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
      VALUES ($1, 'CLASSIFY_SALES_KPI_PAYMENT', 'academy_payment', $2, $3::jsonb, $4::jsonb)`,
    [actor.id, paymentId, JSON.stringify({ kind: sale.kind, cycleKey: sale.cycle_key, referralInitiated: sale.referral_initiated }), JSON.stringify(input)]);
  });
}
