import type { PortalPaymentAllocationDto, PortalPaymentAllocationInput,PortalUnallocatedPaymentsDto } from '@shared/contracts/portal-resources';
import { PortalResourceError, type ResourceStaffActor } from '../domain/policy';
import { FinanceQuestionRepository } from './finance-question-repository';
import { resourceRows, resourceOne, resourceTransaction, resourceAudit, type ResourceSql } from './sql';

type Payment = { amountUzs: number; leadId: number | null; studentId: number | null; allocationVersion: number };
type Student = { id: number; name: string; managerId: number | null; amountUzs: number };
function staff(actor: ResourceStaffActor) {
  if (!actor.modules.includes('finance') && !actor.modules.includes('sales')) throw new PortalResourceError('portalAccessDenied',403);
}
async function students(sql: ResourceSql, actor: ResourceStaffActor, paymentId: number, payment: Payment) {
  const rows = await resourceRows<Student>(sql, `SELECT student.id,COALESCE(student.student_name,student.contact_name) AS name,student.manager_id,COALESCE(allocation.amount_uzs,0) AS amount_uzs
    FROM academy_students student LEFT JOIN academy_payment_student_allocations allocation ON allocation.student_id=student.id AND allocation.payment_id=$1
    WHERE ($2::integer IS NOT NULL AND student.lead_id=$2) OR ($2::integer IS NULL AND student.id=$3) ORDER BY student.id`,[paymentId,payment.leadId,payment.studentId]);
  if (!actor.modules.includes('finance') && (!rows.length || rows.some(row => row.managerId !== actor.userId))) throw new PortalResourceError('portalAccessDenied',403);
  return rows;
}
export class PaymentAllocationRepository extends FinanceQuestionRepository {
  async unallocatedPayments(actor:ResourceStaffActor,cursor:number|null,limit=30):Promise<PortalUnallocatedPaymentsDto> {
    staff(actor);
    const values = await resourceRows<{id:number;amountUzs:number;name:string|null}>(this.pool,`SELECT payment.id,payment.amount_uzs,
      (SELECT string_agg(COALESCE(student.student_name,student.contact_name),', ' ORDER BY student.id) FROM academy_students student WHERE student.lead_id=payment.lead_id) AS name
      FROM academy_payments payment WHERE payment.student_id IS NULL AND payment.lead_id IS NOT NULL AND ($1::integer IS NULL OR payment.id<$1)
      AND (SELECT COALESCE(sum(allocation.amount_uzs),0) FROM academy_payment_student_allocations allocation WHERE allocation.payment_id=payment.id)<payment.amount_uzs
      AND ($2 OR (EXISTS(SELECT 1 FROM academy_students student WHERE student.lead_id=payment.lead_id AND student.manager_id=$3)
        AND NOT EXISTS(SELECT 1 FROM academy_students student WHERE student.lead_id=payment.lead_id AND student.manager_id IS DISTINCT FROM $3)))
      ORDER BY payment.id DESC LIMIT $4`,[cursor,actor.modules.includes('finance'),actor.userId,limit+1]);
    return {items:values.slice(0,limit).map(row=>({...row,amountUzs:Number(row.amountUzs)})),nextCursor:values.length>limit?values[limit-1].id:null};
  }
  async paymentAllocation(actor: ResourceStaffActor, paymentId: number): Promise<PortalPaymentAllocationDto> {
    staff(actor);
    return resourceTransaction(this.pool, async sql => {
      const payment = await resourceOne<Payment>(sql,'SELECT amount_uzs,lead_id,student_id,allocation_version FROM academy_payments WHERE id=$1 FOR SHARE',[paymentId]);
      if (!payment) throw new PortalResourceError('portalNotFound',404);
      const related = await students(sql,actor,paymentId,payment);
      return { paymentId,amountUzs:Number(payment.amountUzs),version:payment.allocationVersion,students:related.map(row=>({id:row.id,name:row.name,amountUzs:Number(row.amountUzs)})) };
    });
  }
  async allocatePayment(actor: ResourceStaffActor, paymentId: number, input: PortalPaymentAllocationInput) {
    staff(actor);
    await resourceTransaction(this.pool, async sql => {
      const payment = await resourceOne<Payment>(sql,'SELECT amount_uzs,lead_id,student_id,allocation_version FROM academy_payments WHERE id=$1 FOR UPDATE',[paymentId]);
      if (!payment) throw new PortalResourceError('portalNotFound',404);
      if (payment.allocationVersion !== input.version) throw new PortalResourceError('portalVersionConflict',409);
      const related = await students(sql,actor,paymentId,payment);
      const total = input.allocations.reduce((sum,row)=>sum+row.amountUzs,0);
      if (total > Number(payment.amountUzs)) throw new PortalResourceError('portalAllocationExceedsAmount');
      if (input.allocations.some(row => !related.some(student=>student.id===row.studentId))) throw new PortalResourceError('portalAllocationPartyMismatch');
      const old = related.filter(row=>row.amountUzs>0).map(row=>({studentId:row.id,amountUzs:Number(row.amountUzs)}));
      await sql.query('DELETE FROM academy_payment_student_allocations WHERE payment_id=$1',[paymentId]);
      for (const row of input.allocations) await sql.query('INSERT INTO academy_payment_student_allocations(payment_id,student_id,amount_uzs,assigned_by,reason) VALUES($1,$2,$3,$4,$5)',[paymentId,row.studentId,row.amountUzs,actor.userId,input.reason]);
      await sql.query('UPDATE academy_payments SET allocation_version=allocation_version+1 WHERE id=$1',[paymentId]);
      await sql.query("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,old_values,new_values) VALUES($1,'payment.allocated','academy_payment',$2,$3::jsonb,$4::jsonb)",[actor.userId,paymentId,JSON.stringify({allocations:old,version:input.version}),JSON.stringify(input)]);
      await resourceAudit(sql,actor,'payment.allocated','payment',paymentId,{allocations:input.allocations,reason:input.reason});
    });
  }
}
