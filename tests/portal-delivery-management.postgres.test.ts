import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import { isolatePortalWorkerFixture } from './portal-worker-fixture-pool';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { portalDeliveryQuerySchema, type PortalDeliveryFailure } from "@shared/contracts/portal-delivery-management";
import { PortalIdentityService, createPostgresPortalRepository, createPortalCrypto, PortalIdentityMailWorker } from "../server/modules/portal-identity";
import { PortalNotificationWorker } from "../server/modules/portal-resources/infrastructure/notification-worker";
import { PortalDeliveryManagement } from "../server/modules/portal-resources/application/delivery-management";
import { createPortalDeliveryManagementRouter } from "../server/modules/portal-resources/http/delivery-management-router";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `portal_delivery_it_${randomBytes(8).toString("hex")}`;
const NOW = new Date("2026-10-12T05:00:00Z").getTime();
const key = randomBytes(32).toString("base64");
const actor = { staffId: 1, modules: ["administration"], canManageAccess: true };
let admin: Pool, pool: Pool, identity: PortalIdentityService, identityMail: PortalIdentityMailWorker, resourceMail: PortalNotificationWorker, service: PortalDeliveryManagement;
let enabled: boolean, emailEnabled: boolean, allowedGroups: boolean, now: number;
let identitySend: ReturnType<typeof vi.fn<() => Promise<boolean>>>, resourceSend: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
const query = (input: object = {}) => portalDeliveryQuerySchema.parse(input);
const command = (row: PortalDeliveryFailure) => ({ version: row.version, idempotencyKey: randomUUID() });
const app = (staff = actor) => {
  const server = express(); server.use(express.json());
  server.use("/api/lms-management", createPortalDeliveryManagementRouter({ service, resolveStaffActor: () => staff }));
  return server;
};
async function materialFailure() {
  return Number((await pool.query(`INSERT INTO lms_resource_outbox(account_id,link_id,category,code,params,href,event_key,required_permission,channel,state,attempts,deliver_after,last_error_code,created_at)
    VALUES(2,2,'learning','portalNoticeMaterialPublished','{"sourceType":"material_published","runId":1,"publicationId":1}','/learn/courses/1/materials/1',$1,'learning.read','email','failed',5,$2,'delivery_failed',$3) RETURNING id`,
    [randomUUID(),new Date(now+60_000),new Date(now-60_000)])).rows[0].id);
}
async function invitationFailure() {
  await identity.createInvitation(actor,2,{ account: { login:"new.student", fullName:"New Student", email:"new@example.invalid", locale:"en" }, kind:"self", relationship:null, permissions:[], verificationMethod:"in_person", verificationBasis:"Fixture identity confirmed", channel:"email", idempotencyKey:randomUUID() });
  return Number((await pool.query("UPDATE portal_identity_mail_outbox SET status='failed',attempts=5,last_error_code='delivery_failed',created_at=$1 WHERE template='invitation' RETURNING id",[new Date(now-30_000)])).rows[0].id);
}
const failure = async (kind: "identity" | "resource", id: number) => (await service.list(actor,query())).items.find((row) => row.kind===kind && row.id===id)!;
const auditCount = async () => Number((await pool.query("SELECT count(*) FROM portal_access_audit WHERE action='EMAIL_DELIVERY_RETRIED'")).rows[0].count);

describe.skipIf(!databaseUrl)("Administrative delivery failures and retry PostgreSQL + HTTP", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    if (!["127.0.0.1","localhost","::1","[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("Delivery tests require local PostgreSQL");
    admin = new Pool({ connectionString: databaseUrl }); await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options:`-c search_path=${schema} -c timezone=UTC -c lock_timeout=2000 -c statement_timeout=5000 -c idle_in_transaction_session_timeout=5000`, max:10 });
    isolatePortalWorkerFixture(pool, schema);
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY,full_name text,module text,is_active boolean DEFAULT true,is_archived boolean DEFAULT false);
      CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text,manager_id integer REFERENCES users(id));
      CREATE TABLE academy_courses(id serial PRIMARY KEY,name text);
      CREATE TABLE academy_groups(id serial PRIMARY KEY,name text,course_id integer REFERENCES academy_courses(id));
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer REFERENCES academy_students(id),group_id integer REFERENCES academy_groups(id),status text DEFAULT 'active',enrolled_at timestamptz,ended_at timestamptz);
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer REFERENCES academy_groups(id),scheduled_at timestamptz,status text);
      CREATE TABLE academy_payments(id serial PRIMARY KEY,student_id integer REFERENCES academy_students(id),group_id integer REFERENCES academy_groups(id),amount_uzs integer,status text,due_at timestamptz);
      CREATE TABLE academy_portfolio_projects(id serial PRIMARY KEY);`);
    for (const name of ["0134_portal_identity","0135_lms_learning","0136_portal_resources"]) await pool.query(readFileSync(new URL(`../migrations/${name}.sql`,import.meta.url),"utf8"));
    const codec = createPortalCrypto(key);
    identity = new PortalIdentityService(createPostgresPortalRepository(pool),{...codec,hashPassword:async()=>"fixture-hash"},{appUrl:"https://academy.invalid",emailEnabled:true,allowInvitations:true,now:()=>now,emailEnabledForAccount:()=>emailEnabled});
    identitySend = vi.fn(async()=>true); resourceSend = vi.fn(async()=>true);
    identityMail = new PortalIdentityMailWorker({ pool,encryptionKey:key,send:identitySend,now:()=>now,canDeliver:()=>emailEnabled&&allowedGroups });
    resourceMail = new PortalNotificationWorker({ pool,mode:"email",enabled:()=>enabled,emailEnabled:()=>emailEnabled,now:()=>now,
      enabledForGroup:()=>allowedGroups,enabledForStudent:()=>allowedGroups,emailEnabledForStudent:()=>emailEnabled&&allowedGroups,emailEnabledForAccount:()=>emailEnabled&&allowedGroups,
      authorizeLink:(accountId,linkId,permission)=>identity.resolveAccountActor(accountId,linkId,permission),sendEmail:resourceSend });
    service = new PortalDeliveryManagement({ pool,enabled:()=>enabled,now:()=>now,canRetryIdentity:(id,sql)=>identityMail.canRetryFailedEmail(id,sql),canRetryResource:(id,sql)=>resourceMail.canRetryFailedEmail(id,sql) });
  });
  beforeEach(async () => {
    now=NOW; enabled=true; emailEnabled=true; allowedGroups=true; vi.clearAllMocks();
    const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1",[schema])).rows.map((row)=>`"${schema}"."${row.tablename}"`).join(",");
    await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE;
      INSERT INTO users(full_name,module) VALUES('Admin','administration');
      INSERT INTO academy_students(student_name,contact_name,manager_id) VALUES('Child','Parent',1),('New Child','New Parent',1);
      INSERT INTO academy_courses(name) VALUES('Course'); INSERT INTO academy_groups(name,course_id) VALUES('Group',1);
      INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(1,1,'2026-09-01'),(2,1,'2026-09-01');
      INSERT INTO portal_student_identity(student_id,classification,verified_at,verified_by,verification_method) VALUES(1,'minor',now(),1,'in_person'),(2,'minor',now(),1,'in_person');
      INSERT INTO portal_accounts(login,full_name,email,email_verified_at,status,password_hash,locale) VALUES('child.login','Child','child@example.invalid',now(),'active','hash','en'),('parent.login','Parent','parent@example.invalid',now(),'active','hash','en');
      INSERT INTO portal_student_links(account_id,student_id,kind,relationship,permissions,status,verified_at,verified_by) VALUES(1,1,'self',NULL,'["learning.read","feedback.read"]','active',now(),1),(2,1,'representative','parent','["learning.read","feedback.read","finance.read"]','active',now(),1);
      INSERT INTO portal_notification_preferences(account_id,categories) VALUES(2,'{"learning":{"inApp":true,"email":true}}');
      INSERT INTO lms_course_versions(course_id,version,created_by) VALUES(1,1,1);
      INSERT INTO lms_group_runs(group_id,course_version_id,format) VALUES(1,1,'offline');
      INSERT INTO lms_materials(run_id,state,created_by) VALUES(1,'published',1);
      INSERT INTO lms_material_versions(material_id,version,title,body,category,created_by) VALUES(1,1,'Material','Never expose body','lesson',1);
      INSERT INTO lms_material_publications(material_id,material_version_id,enrollment_id,publish_at) VALUES(1,1,1,'2026-10-01');`);
  });
  afterAll(async()=>{if(pool)await pool.end();if(admin){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}});
  it("lists stable pages and only safe fields for administrative staff",async()=>{
    const materialId=await materialFailure(), invitationId=await invitationFailure();
    await pool.query("INSERT INTO lms_resource_outbox(account_id,link_id,category,code,event_key,channel,state,attempts) VALUES(2,2,'learning','portalNoticeMaterialPublished','in-app-failed','in_app','failed',5)");
    const first=await request(app()).get("/api/lms-management/delivery-failures?limit=1");
    expect(first.status).toBe(200);expect(first.headers['cache-control']).toBe("private, no-store");expect(first.body.items).toHaveLength(1);expect(first.body.hasMore).toBe(true);
    expect(first.body.items[0]).toMatchObject({id:invitationId,kind:"identity",canRetry:true,template:"invitation"});
    const second=await request(app()).get(`/api/lms-management/delivery-failures?limit=1&cursor=${first.body.nextCursor}`);
    expect(second.body.items[0]).toMatchObject({id:materialId,kind:"resource",canRetry:true});expect(second.body.hasMore).toBe(false);
    expect(JSON.stringify([first.body,second.body])).not.toMatch(/encrypted_payload|token_hash|password|Never expose body|params|payload_signature/);
    expect((await request(app()).get("/api/lms-management/delivery-failures?kind=identity")).body.items).toHaveLength(1);
    expect((await request(app({...actor,modules:["finance"]})).get("/api/lms-management/delivery-failures")).status).toBe(403);
    expect((await request(app({...actor,modules:["sales"]})).get("/api/lms-management/delivery-failures")).status).toBe(403);
    expect((await request(app({...actor,canManageAccess:false})).get("/api/lms-management/delivery-failures")).status).toBe(403);
    expect((await request(app()).get("/api/lms-management/delivery-failures?limit=101")).status).toBe(400);
    expect((await request(app()).get("/api/lms-management/delivery-failures?cursor=e30")).status).toBe(400);
    enabled=false;expect((await request(app()).get("/api/lms-management/delivery-failures")).status).toBe(404);
  });
  it("queues a failed row once with atomic audit, CAS and idempotency under concurrent requests",async()=>{
    const id=await materialFailure(),row=await failure("resource",id),input=command(row);
    const before=(await pool.query("SELECT params,event_key FROM lms_resource_outbox WHERE id=$1",[id])).rows[0];
    const results=await Promise.all([service.retry(actor,"resource",id,input),service.retry(actor,"resource",id,input)]);
    expect(results.filter(result=>result.replayed)).toHaveLength(1);expect(await auditCount()).toBe(1);
    const after=(await pool.query("SELECT * FROM lms_resource_outbox WHERE id=$1",[id])).rows[0];
    expect(after).toMatchObject({state:"pending",attempts:0,locked_at:null,last_error_code:null,params:before.params,event_key:before.event_key});
    expect(after.deliver_after.getTime()).toBe(now);expect(resourceSend).not.toHaveBeenCalled();expect(identitySend).not.toHaveBeenCalled();
    await expect(service.retry(actor,"resource",id,{...input,version:"a".repeat(64)})).rejects.toMatchObject({code:"portalDeliveryConflict",status:409});
    expect(await service.retry(actor,"resource",id,input)).toEqual({queued:true,replayed:true});
    const audited=(await pool.query("SELECT details FROM portal_access_audit WHERE action='EMAIL_DELIVERY_RETRIED'")).rows[0].details;
    expect(audited).toMatchObject({kind:"resource",deliveryId:id,priorAttempts:5,idempotencyKey:input.idempotencyKey});expect(JSON.stringify(audited)).not.toMatch(/email|parent|body/i);
  });
  it("rejects stale payloads and every state except failed without overwriting a worker lease",async()=>{
    const id=await materialFailure(),row=await failure("resource",id);
    await pool.query("UPDATE lms_resource_outbox SET params=params||'{\"title\":\"Changed\"}'::jsonb WHERE id=$1",[id]);
    expect((await request(app()).post(`/api/lms-management/delivery-failures/resource/${id}/retry`).send(command(row))).status).toBe(409);
    for(const state of ["pending","delivered","cancelled"]){await pool.query("UPDATE lms_resource_outbox SET state=$2 WHERE id=$1",[id,state]);await expect(service.retry(actor,"resource",id,command(row))).rejects.toMatchObject({code:"portalDeliveryConflict"});}
    await pool.query("UPDATE lms_resource_outbox SET state='failed',locked_at=$2 WHERE id=$1",[id,new Date(now)]);
    expect((await failure("resource",id)).canRetry).toBe(false);
    await expect(service.retry(actor,"resource",id,command(await failure("resource",id)))).rejects.toMatchObject({code:"portalDeliveryConflict"});
    expect(await auditCount()).toBe(0);
    const inApp=(await pool.query("INSERT INTO lms_resource_outbox(account_id,category,code,event_key,channel,state) VALUES(2,'learning','portalNoticeMaterialPublished','only-inapp','in_app','failed') RETURNING id")).rows[0].id;
    expect((await request(app()).post(`/api/lms-management/delivery-failures/resource/${inApp}/retry`).send(command(row))).status).toBe(404);
  });
  it("rechecks permissions, cohort, mail settings and the current publication before requeue",async()=>{
    const id=await materialFailure(),row=await failure("resource",id);
    await pool.query("UPDATE portal_student_links SET permissions='[\"feedback.read\"]' WHERE id=2");
    await expect(service.retry(actor,"resource",id,command(row))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});
    await pool.query("UPDATE portal_student_links SET permissions='[\"learning.read\",\"feedback.read\",\"finance.read\"]' WHERE id=2");
    allowedGroups=false;await expect(service.retry(actor,"resource",id,command(row))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});allowedGroups=true;
    emailEnabled=false;expect((await failure("resource",id)).canRetry).toBe(false);await expect(service.retry(actor,"resource",id,command(row))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});emailEnabled=true;
    await pool.query("UPDATE lms_material_publications SET revoked_at=$1 WHERE id=1",[new Date(now)]);
    expect((await failure("resource",id)).canRetry).toBe(false);await expect(service.retry(actor,"resource",id,command(row))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});
    expect((await pool.query("SELECT state FROM lms_resource_outbox WHERE id=$1",[id])).rows[0].state).toBe("failed");expect(await auditCount()).toBe(0);
  });
  it("revalidates after requeue and cancels a revoked recipient before any SMTP call",async()=>{
    const id=await materialFailure(),row=await failure("resource",id);
    await service.retry(actor,"resource",id,command(row));await pool.query("UPDATE portal_student_links SET status='revoked' WHERE id=2");
    expect(await resourceMail.runOnce()).toMatchObject({delivered:0,cancelled:1});expect(resourceSend).not.toHaveBeenCalled();
    expect((await pool.query("SELECT state,delivered_at FROM lms_resource_outbox WHERE id=$1",[id])).rows[0]).toEqual({state:"cancelled",delivered_at:null});
  });
  it("revalidates a result after requeue and rejects notifications for another student's object",async()=>{
    const award=Number((await pool.query("INSERT INTO lms_achievements(student_id,run_id,rule,event_key,title,reason) VALUES(1,1,'manual','award','Award','Reason') RETURNING id")).rows[0].id);
    const id=Number((await pool.query("INSERT INTO lms_resource_outbox(account_id,link_id,category,code,params,event_key,required_permission,channel,state,attempts) VALUES(2,2,'feedback','portalNoticeAchievementAwarded',$1::jsonb,'award-mail','feedback.read','email','failed',5) RETURNING id",[JSON.stringify({sourceType:"achievement_awarded",runId:1,objectId:award})])).rows[0].id);
    const row=await failure("resource",id);expect(row.canRetry).toBe(true);await service.retry(actor,"resource",id,command(row));
    await pool.query("UPDATE lms_achievements SET revoked_at=$1 WHERE id=$2",[new Date(now),award]);
    expect(await resourceMail.runOnce()).toMatchObject({cancelled:1,delivered:0});expect(resourceSend).not.toHaveBeenCalled();
    const report=Number((await pool.query("INSERT INTO lms_reports(student_id,run_id,period_from,period_to,version,metrics,comment,next_steps,published_by,published_at) VALUES(2,1,$1,$2,1,'{}','Other child private report','Next',1,$2) RETURNING id",[new Date(now-86400_000),new Date(now)])).rows[0].id);
    const wrong=Number((await pool.query("INSERT INTO lms_resource_outbox(account_id,link_id,category,code,params,event_key,required_permission,channel,state,attempts) VALUES(2,2,'feedback','portalNoticeReportPublished',$1::jsonb,'wrong-report','feedback.read','email','failed',5) RETURNING id",[JSON.stringify({sourceType:"report_published",runId:1,objectId:report})])).rows[0].id);
    const wrongRow=await failure("resource",wrong);expect(wrongRow.canRetry).toBe(false);await expect(service.retry(actor,"resource",wrong,command(wrongRow))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});
    expect(JSON.stringify(await service.list(actor,query()))).not.toContain("Other child private report");
  });
  it("rechecks unpaid reminders and rejects an already paid charge",async()=>{
    const dueAt=new Date(now+3*24*60*60_000);
    await pool.query("INSERT INTO academy_payments(student_id,group_id,amount_uzs,status,due_at) VALUES(1,1,500000,'pending',$1)",[dueAt]);
    const id=Number((await pool.query("INSERT INTO lms_resource_outbox(account_id,link_id,category,code,params,event_key,required_permission,channel,state,attempts) VALUES(2,2,'finance','portalNoticePaymentDue',$1::jsonb,'payment','finance.read','email','failed',5) RETURNING id",[JSON.stringify({sourceType:"payment_due",paymentId:1,dueAt:dueAt.toISOString(),amountUzs:500000})])).rows[0].id);
    const row=await failure("resource",id);expect(row.canRetry).toBe(true);
    await pool.query("UPDATE academy_payments SET status='paid' WHERE id=1");await expect(service.retry(actor,"resource",id,command(row))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});expect(resourceSend).not.toHaveBeenCalled();
  });
  it("retries identity envelopes without extending token expiry or recreating the invitation",async()=>{
    const id=await invitationFailure(),row=await failure("identity",id),input=command(row);
    const before=(await pool.query("SELECT expires_at,encrypted_payload,invitation_id FROM portal_identity_mail_outbox WHERE id=$1",[id])).rows[0];
    const response=await request(app()).post(`/api/lms-management/delivery-failures/identity/${id}/retry`).send(input);
    expect(response.status).toBe(200);expect(response.body).toEqual({queued:true,replayed:false});
    const after=(await pool.query("SELECT expires_at,encrypted_payload,invitation_id,status,attempts FROM portal_identity_mail_outbox WHERE id=$1",[id])).rows[0];
    expect(after).toEqual({...before,status:"pending",attempts:0});expect(identitySend).not.toHaveBeenCalled();
    expect(await identityMail.runOnce()).toMatchObject({sent:1,failed:0});expect(identitySend).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT status,encrypted_payload FROM portal_identity_mail_outbox WHERE id=$1",[id])).rows[0]).toEqual({status:"sent",encrypted_payload:null});
    expect((await pool.query("SELECT count(*) FROM portal_invitations")).rows[0].count).toBe("1");
    expect((await request(app()).post(`/api/lms-management/delivery-failures/identity/${id}/retry`).send(input)).body.replayed).toBe(true);
  });
  it("does not retry expired, revoked, blocked or corrupt identity envelopes",async()=>{
    const id=await invitationFailure(),row=await failure("identity",id);
    allowedGroups=false;expect((await failure("identity",id)).canRetry).toBe(false);await expect(service.retry(actor,"identity",id,command(row))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});allowedGroups=true;
    await pool.query("UPDATE portal_invitations SET status='revoked' WHERE id=1");await expect(service.retry(actor,"identity",id,command(row))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});
    await pool.query("UPDATE portal_invitations SET status='delivery_failed' WHERE id=1; UPDATE portal_accounts SET status='suspended' WHERE id=3");expect((await failure("identity",id)).canRetry).toBe(false);
    await pool.query("UPDATE portal_accounts SET status='pending' WHERE id=3; UPDATE portal_identity_mail_outbox SET encrypted_payload='broken' WHERE id=1");expect((await failure("identity",id)).canRetry).toBe(false);
    await expect(service.retry(actor,"identity",id,command(await failure("identity",id)))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});
    await pool.query("UPDATE portal_identity_mail_outbox SET expires_at=$1 WHERE id=1",[new Date(now-1)]);expect((await failure("identity",id)).canRetry).toBe(false);expect(await auditCount()).toBe(0);expect(identitySend).not.toHaveBeenCalled();
  });
  it("checks recovery token consumption and atomically rolls back a retry if audit cannot be recorded",async()=>{
    await identity.requestRecovery("parent.login","fixture-ip");
    const id=Number((await pool.query("UPDATE portal_identity_mail_outbox SET status='failed',attempts=5,last_error_code='delivery_failed' WHERE template='recovery' RETURNING id")).rows[0].id);
    const row=await failure("identity",id);expect(row.canRetry).toBe(true);
    await pool.query("UPDATE portal_recovery_tokens SET consumed_at=$1",[new Date(now)]);await expect(service.retry(actor,"identity",id,command(row))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});
    const materialId=await materialFailure(),materialRow=await failure("resource",materialId);
    await expect(service.retry({...actor,staffId:9999},"resource",materialId,command(materialRow))).rejects.toMatchObject({code:"23503"});
    expect((await pool.query("SELECT state,attempts FROM lms_resource_outbox WHERE id=$1",[materialId])).rows[0]).toEqual({state:"failed",attempts:5});expect(await auditCount()).toBe(0);
  });
  it("rejects changed email confirmation targets and never extends a one-time email token",async()=>{
    const codec=createPortalCrypto(key),token=codec.randomToken(),expiry=new Date(now+30*60_000);
    await pool.query("UPDATE portal_accounts SET pending_email='new-parent@example.invalid' WHERE id=2");
    await pool.query("INSERT INTO portal_recovery_tokens(account_id,purpose,token_hash,expires_at,payload) VALUES(2,'email',$1,$2,'new-parent@example.invalid')",[codec.hashToken(token),expiry]);
    const id=Number((await pool.query("INSERT INTO portal_identity_mail_outbox(account_id,recipient,template,encrypted_payload,expires_at,dedupe_key,status,attempts,last_error_code) VALUES(2,'new-parent@example.invalid','email_change',$1,$2,'email-confirmation','failed',5,'delivery_failed') RETURNING id",[codec.encrypt({token,url:`https://academy.invalid/learn/verify-email#token=${token}`,locale:"en"}),expiry])).rows[0].id);
    const row=await failure("identity",id);expect(row.canRetry).toBe(true);
    await pool.query("UPDATE portal_accounts SET pending_email='different@example.invalid' WHERE id=2");
    expect((await failure("identity",id)).canRetry).toBe(false);await expect(service.retry(actor,"identity",id,command(row))).rejects.toMatchObject({code:"portalDeliveryRetryUnavailable"});
    expect((await pool.query("SELECT expires_at FROM portal_identity_mail_outbox WHERE id=$1",[id])).rows[0].expires_at).toEqual(expiry);expect(identitySend).not.toHaveBeenCalled();
  });
  it("rejects unauthorized HTTP retries, invalid paths and extra fields before changing the queue",async()=>{
    const id=await materialFailure(),row=await failure("resource",id),input=command(row);
    expect((await request(app({...actor,modules:["teacher"]})).post(`/api/lms-management/delivery-failures/resource/${id}/retry`).send(input)).status).toBe(403);
    expect((await request(app()).post(`/api/lms-management/delivery-failures/resource/${id}/retry`).send({...input,recipient:"attacker@example.invalid"})).status).toBe(400);
    expect((await request(app()).post(`/api/lms-management/delivery-failures/unknown/${id}/retry`).send(input)).status).toBe(400);
    expect((await request(app()).post("/api/lms-management/delivery-failures/resource/0/retry").send(input)).status).toBe(400);
    expect(await auditCount()).toBe(0);expect(resourceSend).not.toHaveBeenCalled();
  });
});
