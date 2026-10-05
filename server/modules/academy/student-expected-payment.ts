import { studentExpectedPaymentRequestSchema, type StudentExpectedPaymentRequest } from '@shared/contracts/academy-leads';
import { actorContextFrom, type ActorSource } from '../leads/domain/actor-context';
import { canActorMutateLead } from '../leads/domain/access-policy';
import type { Row } from './academy-core';

export const parseStudentExpectedPayment = (body: unknown): StudentExpectedPaymentRequest => {
  const result = studentExpectedPaymentRequestSchema.safeParse(body);
  if (!result.success) throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  return result.data;
};

export const assertStudentVersion = (student: Row, payment: StudentExpectedPaymentRequest) => {
  if (payment.expectedStudentUpdatedAt && student.updatedAt
    && new Date(payment.expectedStudentUpdatedAt).getTime() !== new Date(student.updatedAt).getTime()) {
    throw Object.assign(new Error('studentChangedConcurrently'), { statusCode: 409 });
  }
};

// Call after locking the lead, before creating or updating the student.
export const assertStudentLeadAccess = (lead: Row | null | undefined, actor: ActorSource) => {
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  if (!canActorMutateLead(actorContextFrom(actor), lead)) {
    throw Object.assign(new Error('accessDenied'), { statusCode: 403 });
  }
};

// Keep legacy amounts intact; they only describe leads without students now.
// SUM ignores unspecified amounts and remains null when none are entered.
export const leadExpectedPaymentTotalSelect = (alias: string) => `CASE
  WHEN EXISTS (SELECT 1 FROM academy_students forecast WHERE forecast.lead_id = ${alias}.id)
  THEN (SELECT SUM(forecast.expected_payment_uzs)::double precision
        FROM academy_students forecast WHERE forecast.lead_id = ${alias}.id)
  ELSE ${alias}.expected_payment_uzs
  END AS expected_payment_total_uzs`;
