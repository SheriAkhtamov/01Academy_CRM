import { studentLeadPaymentRequestSchema, type StudentLeadPaymentRequest } from '@shared/contracts/academy-leads';
import { actorContextFrom, type ActorSource } from '../leads/domain/actor-context';
import { canActorMutateLead } from '../leads/domain/access-policy';
import { createAudit, updateRow, type Row } from './academy-core';

export const parseStudentLeadPayment = (body: unknown): StudentLeadPaymentRequest => {
  const result = studentLeadPaymentRequestSchema.safeParse(body);
  if (!result.success) throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  return result.data;
};

// The caller holds the lead lock and saves the student in the same transaction.
export const saveStudentLeadPayment = async (
  lead: Row | null | undefined,
  payment: StudentLeadPaymentRequest,
  actor: ActorSource,
) => {
  if (payment.expectedPaymentUzs === undefined) return;
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  if (!canActorMutateLead(actorContextFrom(actor), lead)) {
    throw Object.assign(new Error('accessDenied'), { statusCode: 403 });
  }
  if ((lead.expectedPaymentUzs ?? null) === payment.expectedPaymentUzs) return;
  if (payment.expectedLeadUpdatedAt && lead.updatedAt
    && new Date(payment.expectedLeadUpdatedAt).getTime() !== new Date(lead.updatedAt).getTime()) {
    throw Object.assign(new Error('leadChangedConcurrently'), { statusCode: 409 });
  }
  const updated = await updateRow('academy_leads', Number(lead.id), {
    expectedPaymentUzs: payment.expectedPaymentUzs,
  });
  if (!updated) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  await createAudit(actor, 'UPDATE_ACADEMY_LEAD', 'academy_lead', Number(lead.id), updated, lead);
};
