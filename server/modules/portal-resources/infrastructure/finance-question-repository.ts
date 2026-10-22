import crypto from 'node:crypto';
import { learningSubjectHref } from '@shared/platform-routes';
import type { PortalActorContext } from '../../portal-identity';
import type { PortalFinanceQuestionDto, PortalFinanceQuestionDetailDto, PortalFinanceQuestionInput, PortalFinanceMessageDto } from '@shared/contracts/portal-resources';
import { ProjectRepository } from './project-repository';
import { resourceRows, resourceOne, resourceTransaction, resourceAudit, checkResourceLink, type ResourceSql } from './sql';
import { PortalResourceError, type ResourceStaffActor } from '../domain/policy';
import { learningNotificationCopy } from '../../../lib/learning-notification-copy';
const columns = 'question.id,question.payment_id,question.subject,question.status,question.created_at,question.updated_at';
const staff = (actor: ResourceStaffActor) => { if (!actor.modules.includes('finance')) throw new PortalResourceError('portalAccessDenied',403); };
const detail = async (sql: ResourceSql, question: PortalFinanceQuestionDto): Promise<PortalFinanceQuestionDetailDto> => ({ ...question, messages: await resourceRows<PortalFinanceMessageDto>(sql,"SELECT id,body,CASE WHEN user_id IS NULL THEN 'account' ELSE 'staff' END AS author,created_at FROM portal_finance_question_messages WHERE question_id=$1 ORDER BY id",[question.id]) });
const notifyStaff = async (sql: ResourceSql, questionId: number, subject: string, eventKey: string) => {
  const users = await resourceRows<{ id: number }>(sql,"SELECT employee.id FROM users employee WHERE employee.is_active=true AND employee.is_archived=false AND (employee.module='finance' OR EXISTS(SELECT 1 FROM user_modules grant_row WHERE grant_row.user_id=employee.id AND grant_row.module='finance'))");
  const title = learningNotificationCopy('lmsNoticeHelpRequested',{title:subject});
  for (const user of users) if (await resourceOne(sql,'INSERT INTO lms_staff_notification_events(user_id,event_key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id',[user.id,eventKey])) await sql.query("INSERT INTO notifications(user_id,type,title,message,related_entity_type,related_entity_id) VALUES($1,'lms',$2::text,$2::text,'portal_finance_question',$3)",[user.id,title.slice(0,255),questionId]);
};
export class FinanceQuestionRepository extends ProjectRepository {
  async financeQuestions(actor: PortalActorContext,cursor:number|null=null,limit=100) {
    return resourceTransaction(this.pool,async sql => { await checkResourceLink(sql,actor,'finance.read'); return resourceRows<PortalFinanceQuestionDto>(sql,`SELECT ${columns} FROM portal_finance_questions question WHERE question.account_id=$1 AND question.student_id=$2 AND ($3::bigint IS NULL OR question.id<$3) ORDER BY question.id DESC LIMIT $4`,[actor.portalAccountId,actor.studentId,cursor,limit]); });
  }
  async financeQuestion(actor: PortalActorContext,id: number) {
    return resourceTransaction(this.pool,async sql => {
      await checkResourceLink(sql,actor,'finance.read');
      const question = await resourceOne<PortalFinanceQuestionDto>(sql,`SELECT ${columns} FROM portal_finance_questions question WHERE question.id=$1 AND question.account_id=$2 AND question.student_id=$3`,[id,actor.portalAccountId,actor.studentId]);
      if (!question) throw new PortalResourceError('portalNotFound',404); return detail(sql,question);
    });
  }
  async createFinanceQuestion(actor: PortalActorContext,input: PortalFinanceQuestionInput) {
    const requestKey = input.idempotencyKey ?? crypto.randomUUID();
    const hash = crypto.createHash('sha256').update(JSON.stringify({studentId:actor.studentId,paymentId:input.paymentId,subject:input.subject,body:input.body})).digest('hex');
    const id = await resourceTransaction(this.pool,async sql => {
      await checkResourceLink(sql,actor,'finance.read');
      await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`finance-question:${actor.portalAccountId}:${requestKey}`]);
      const replay = await resourceOne<{id:number;requestHash:string}>(sql,'SELECT id,request_hash FROM portal_finance_questions WHERE account_id=$1 AND request_key=$2',[actor.portalAccountId,requestKey]);
      if (replay) { if (replay.requestHash !== hash) throw new PortalResourceError('portalVersionConflict',409); return replay.id; }
      if (input.paymentId && !await resourceOne(sql,`SELECT payment.id FROM academy_payments payment WHERE payment.id=$1 AND ((payment.student_id=$2 AND NOT EXISTS(SELECT 1 FROM academy_payment_student_allocations any_allocation WHERE any_allocation.payment_id=payment.id)) OR EXISTS(SELECT 1 FROM academy_payment_student_allocations allocation WHERE allocation.payment_id=payment.id AND allocation.student_id=$2))`,[input.paymentId,actor.studentId])) throw new PortalResourceError('portalNotFound',404);
      const question = await resourceOne<{id:number}>(sql,'INSERT INTO portal_finance_questions(student_id,payment_id,account_id,link_id,subject,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[actor.studentId,input.paymentId,actor.portalAccountId,actor.linkId,input.subject,requestKey,hash]);
      await sql.query('INSERT INTO portal_finance_question_messages(question_id,account_id,body,request_key) VALUES($1,$2,$3,$4)',[question!.id,actor.portalAccountId,input.body,requestKey]);
      await notifyStaff(sql,question!.id,input.subject,`finance-question:${question!.id}`); await resourceAudit(sql,actor,'finance.question_created','finance_question',question!.id);
      return question!.id;
    });
    return this.financeQuestion(actor,id);
  }
  async financeMessage(actor: PortalActorContext,id: number,body: string,requestKey = crypto.randomUUID()) {
    await resourceTransaction(this.pool,async sql => {
      await checkResourceLink(sql,actor,'finance.read');
      const question = await resourceOne<{subject:string}>(sql,'SELECT subject FROM portal_finance_questions WHERE id=$1 AND account_id=$2 AND student_id=$3 FOR UPDATE',[id,actor.portalAccountId,actor.studentId]);
      if (!question) throw new PortalResourceError('portalNotFound',404);
      const replay = await resourceOne<{body:string}>(sql,'SELECT body FROM portal_finance_question_messages WHERE question_id=$1 AND account_id=$2 AND request_key=$3',[id,actor.portalAccountId,requestKey]);
      if (replay) { if (replay.body !== body) throw new PortalResourceError('portalVersionConflict',409); return; }
      const message = await resourceOne<{id:number}>(sql,'INSERT INTO portal_finance_question_messages(question_id,account_id,body,request_key) VALUES($1,$2,$3,$4) RETURNING id',[id,actor.portalAccountId,body,requestKey]);
      await sql.query("UPDATE portal_finance_questions SET status='open',updated_at=now() WHERE id=$1",[id]);
      await notifyStaff(sql,id,question.subject,`finance-message:${message!.id}`);
    }); return this.financeQuestion(actor,id);
  }
  async staffFinanceQuestions(actor: ResourceStaffActor,cursor:number|null=null,limit=100) {
    staff(actor); return resourceRows<PortalFinanceQuestionDto>(this.pool,`SELECT ${columns},COALESCE(student.student_name,student.contact_name) AS student_name FROM portal_finance_questions question JOIN academy_students student ON student.id=question.student_id WHERE ($1::bigint IS NULL OR question.id<$1) ORDER BY question.id DESC LIMIT $2`,[cursor,limit]);
  }
  async staffFinanceQuestion(actor: ResourceStaffActor,id:number) {
    staff(actor); const question = await resourceOne<PortalFinanceQuestionDto>(this.pool,`SELECT ${columns} FROM portal_finance_questions question WHERE question.id=$1`,[id]);
    if (!question) throw new PortalResourceError('portalNotFound',404); return detail(this.pool,question);
  }
  async staffFinanceReply(actor: ResourceStaffActor,id:number,body:string,requestKey = crypto.randomUUID()) {
    staff(actor); await resourceTransaction(this.pool,async sql => {
      const question = await resourceOne<{accountId:number;linkId:number;studentId:number;subject:string;linkKind:"self"|"representative"}>(sql,'SELECT question.account_id,question.link_id,question.student_id,question.subject,link.kind AS link_kind FROM portal_finance_questions question JOIN portal_student_links link ON link.id=question.link_id AND link.account_id=question.account_id WHERE question.id=$1 FOR UPDATE OF question',[id]);
      if (!question) throw new PortalResourceError('portalNotFound',404);
      const replay = await resourceOne<{body:string}>(sql,'SELECT body FROM portal_finance_question_messages WHERE question_id=$1 AND user_id=$2 AND request_key=$3',[id,actor.userId,requestKey]);
      if (replay) { if (replay.body !== body) throw new PortalResourceError('portalVersionConflict',409); return; }
      const message = await resourceOne<{id:number}>(sql,'INSERT INTO portal_finance_question_messages(question_id,user_id,body,request_key) VALUES($1,$2,$3,$4) RETURNING id',[id,actor.userId,body,requestKey]);
      await sql.query("UPDATE portal_finance_questions SET status='answered',updated_at=now() WHERE id=$1",[id]);
      const href = learningSubjectHref(`/learn/payments?question=${id}`, { kind: question.linkKind, linkId: question.linkId });
      await sql.query(`INSERT INTO lms_resource_outbox(account_id,link_id,category,code,params,href,event_key,required_permission,channel) VALUES($1,$2,'finance','portalNoticeThreadAnswered',$3::jsonb,$4,$5,'finance.read','in_app') ON CONFLICT(account_id,event_key,channel) DO NOTHING`,[question.accountId,question.linkId,JSON.stringify({title:question.subject,sourceType:'finance_question_answered',questionId:id,messageId:message!.id}),href,`finance-reply:${message!.id}`]);
      await resourceAudit(sql,actor,'finance.question_answered','finance_question',id);
    }); return this.staffFinanceQuestion(actor,id);
  }
}
