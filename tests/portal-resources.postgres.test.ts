import express from 'express';
import request from 'supertest';
import {createPortalResourceRouter,createPublicPortfolioRouter,createStaffResourceRouter} from '../server/modules/portal-resources/http/router';
import {LearningFeatureController} from '../server/infrastructure/learning-flags';
import {createLearningConfigurationRouter} from '../server/modules/portal-resources/http/configuration-router';
import {appConfig} from '../server/config';
import {DEFAULT_LEARNING_SCHOOL_SETTINGS} from '@shared/contracts/learning-settings';
import {PortalResourceError} from '../server/modules/portal-resources/domain/policy';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalResourceService } from '../server/modules/portal-resources/application/resource-service';
import { PostgresPortalResourceRepository } from '../server/modules/portal-resources/infrastructure/postgres-repository';
import { createResourceTokenCodec,LocalResourceFileStore } from '../server/modules/portal-resources/infrastructure/file-store';
import { portalProjectSchema, portalShareSchema } from '@shared/contracts/portal-resources';
import type { PortalActorContext } from '../server/modules/portal-identity';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `lms_resources_it_${randomBytes(8).toString('hex')}`;
let admin: Pool, pool: Pool, repository: PostgresPortalResourceRepository, service: PortalResourceService;
let shareEnabled = true;
const inspectedFile = () => ({ mime: 'text/plain', size: 5, sha256: 'a'.repeat(64) });
const store = { inspect: vi.fn(async () => inspectedFile()), commit: async () => {}, remove: async () => {}, location: (key: string) => `/tmp/${key}` };
const self: PortalActorContext = { portalAccountId: 1, linkId: 1, studentId: 1, sessionId: 'one', kind: 'self', studentClassification: 'minor', permissions: ['learning.read','feedback.read','assignments.submit','portfolio.edit','communication.create'] };
const parent: PortalActorContext = { ...self, portalAccountId: 3, linkId: 3, kind: 'representative', permissions: ['portfolio.approve'] };
const adult: PortalActorContext = { ...self, portalAccountId: 2, linkId: 2, studentId: 2, studentClassification: 'adult', permissions: [...self.permissions,'finance.read'] };
const stranger: PortalActorContext = { ...adult, portalAccountId: 4, linkId: 4, studentId: 3 };
const teacher = { userId: 1, modules: ['teacher'], isLeadership: false };
const otherTeacher = { userId: 2, modules: ['teacher'], isLeadership: false };
const finance = { userId: 3, modules: ['finance'], isLeadership: false };
const project = (changes = {}) => portalProjectSchema.parse({ title: 'Project', description: 'Private description', runId: 1, version: 0, ...changes });
const share = (version: number, changes = {}) => portalShareSchema.parse({ projectVersion: version, displayName: 'Chosen name', includeDescription: false, includeReview: false, fileIds: [], consent: true, ...changes });
const publicToken = (url: string | null) => url!.split('/').at(-1)!;

describe.skipIf(!databaseUrl)('Portal resource PostgreSQL authorization and snapshots', () => {
  beforeAll(async () => {
    if (!databaseUrl || !['localhost','127.0.0.1','::1','[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Resource tests require local PostgreSQL');
    admin = new Pool({ connectionString: databaseUrl }); await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC`, max: 10 });
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY,full_name text,module text DEFAULT 'teacher',is_active boolean DEFAULT true,is_archived boolean DEFAULT false);
      CREATE TABLE user_modules(user_id integer,module text);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,user_id integer,action text,entity_type text,entity_id integer,old_values jsonb,new_values jsonb);
      CREATE TABLE notifications(id serial PRIMARY KEY,user_id integer,type varchar(50),title varchar(255),message text,related_entity_type varchar(50),related_entity_id integer);
      CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text,manager_id integer,lead_id integer,next_payment_at timestamptz);
      CREATE TABLE academy_courses(id serial PRIMARY KEY,name text,program jsonb DEFAULT '[]');
      CREATE TABLE academy_teachers(id serial PRIMARY KEY,user_id integer,full_name text,status text DEFAULT 'active');
      CREATE TABLE academy_groups(id serial PRIMARY KEY,name text,course_id integer,teacher_id integer,status text DEFAULT 'open');
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer,group_id integer,status text DEFAULT 'active',enrolled_at timestamptz,ended_at timestamptz);
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer,lesson_number integer,topic text,materials text,scheduled_at timestamptz,duration_minutes integer DEFAULT 120,status text);
      CREATE TABLE academy_attendance(id serial PRIMARY KEY,lesson_id integer,student_id integer,status text);
      CREATE TABLE academy_portfolio_projects(id serial PRIMARY KEY,student_id integer,title text,group_id integer,course_id integer,url text,file_url text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_payments(id serial PRIMARY KEY,student_id integer,lead_id integer,amount_uzs bigint,status text,method text,type text,period text,paid_at timestamptz,due_at timestamptz,paid_until timestamptz,created_at timestamptz DEFAULT now());`);
    for (const file of ['0134_portal_identity','0135_lms_learning','0136_portal_resources']) await pool.query(readFileSync(`migrations/${file}.sql`,'utf8'));
    repository = new PostgresPortalResourceRepository(pool, async () => true);
    service = new PortalResourceService(repository, store, createResourceTokenCodec(randomBytes(32).toString('base64')), { appUrl: 'https://academy.example', publicPortfolioEnabled: () => shareEnabled });
  });
  beforeEach(async () => {
    shareEnabled = true;
    store.inspect.mockReset().mockImplementation(async () => inspectedFile());
    const tables = (await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[schema])).rows.map(row => `"${schema}"."${row.tablename}"`).join(',');
    await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    await pool.query(`INSERT INTO users(full_name,module) VALUES('Teacher','teacher'),('Other teacher','teacher'),('Finance','finance');
      INSERT INTO academy_students(student_name,contact_name,lead_id) VALUES('Child','Child',10),('Adult','Adult',10),('Stranger','Stranger',20);
      INSERT INTO academy_courses(name) VALUES('Course'); INSERT INTO academy_teachers(user_id) VALUES(1),(2);
      INSERT INTO academy_groups(name,course_id,teacher_id) VALUES('Group one',1,1),('Group two',1,2);
      INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(1,1,now()-interval '1 month'),(2,1,now()-interval '1 month'),(3,2,now()-interval '1 month');
      INSERT INTO lms_course_versions(course_id,version,state,created_by) VALUES(1,1,'published',1);
      INSERT INTO lms_group_runs(group_id,course_version_id) VALUES(1,1),(2,1);
      INSERT INTO portal_accounts(login,full_name,status,password_hash) VALUES('child.login','Child','active','hash'),('adult.login','Adult','active','hash'),('parent.login','Parent','active','hash'),('other.login','Other','active','hash');
      INSERT INTO portal_student_identity(student_id,classification,verification_method,verified_at,verified_by) VALUES(1,'minor','in_person',now(),1),(2,'adult','in_person',now(),1),(3,'adult','in_person',now(),1);
      INSERT INTO portal_student_links(account_id,student_id,kind,relationship,permissions,status,verified_at) VALUES(1,1,'self',NULL,'["learning.read","feedback.read","assignments.submit","portfolio.edit","communication.create"]','active',now()),(2,2,'self',NULL,'["learning.read","feedback.read","portfolio.edit","finance.read"]','active',now()),(3,1,'representative','parent','["portfolio.approve"]','active',now()),(4,3,'self',NULL,'["learning.read","portfolio.edit","finance.read"]','active',now());`);
  });
  afterAll(async () => { if (pool) await pool.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
  it('requires guardian approval and teacher moderation for a minor, hiding personal metadata publicly', async () => {
    const value = await service.saveProject(self,null,project()); const requested = await service.createShare(self,value.id,share(value.version));
    expect(requested.status).toBe('awaiting_approval'); expect(requested.publicUrl).toBeNull();
    const approved = await service.approveShare(parent,requested.id,requested.version,true); expect(approved.status).toBe('awaiting_moderation');
    await expect(service.moderateShare(otherTeacher,approved.id,approved.version,true)).rejects.toMatchObject({ code: 'portalNotFound' });
    const published = await service.moderateShare(teacher,approved.id,approved.version,true);
    const output = await service.publicProject(publicToken(published.publicUrl));
    expect(output).toMatchObject({ title: 'Project', displayName: 'Chosen name', description: null, teacherReview: null });
    for (const key of ['studentId','accountId','runId','groupId','studentName','tokenHash','tokenEnvelope']) expect(output).not.toHaveProperty(key);
  });
  it('shows an approval-only parent the selected immutable preview, excluding later private edits', async () => {
    const value = await service.saveProject(self,null,project()); await service.createShare(self,value.id,share(value.version));
    await service.saveProject(self,value.id,project({ version: value.version, title: 'Private new title', description: 'Private new text' }));
    expect((await service.projects(parent))[0]).toMatchObject({ title: 'Project', description: '', runId: null, sourceSubmissionId: null });
  });
  it('keeps published snapshots unchanged and revokes the public link immediately', async () => {
    const value = await service.saveProject(adult,null,project()); const published = await service.createShare(adult,value.id,share(value.version,{ includeDescription: true }));
    await service.saveProject(adult,value.id,project({ version: value.version, title: 'New title', description: 'New description' }));
    expect(await service.publicProject(publicToken(published.publicUrl))).toMatchObject({ title: 'Project', description: 'Private description' });
    await service.revokeShare(adult,published.id); await expect(service.publicProject(publicToken(published.publicUrl))).rejects.toMatchObject({ code: 'portalNotFound' });
  });
  it('denies a foreign project and closes public shares on access revocation, classification change or feature disable', async () => {
    const value = await service.saveProject(adult,null,project()); const published = await service.createShare(adult,value.id,share(value.version));
    await expect(service.project(stranger,value.id)).rejects.toMatchObject({ code: 'portalNotFound' });
    shareEnabled = false; await expect(service.publicProject(publicToken(published.publicUrl))).rejects.toMatchObject({ code: 'portalNotFound' }); shareEnabled = true;
    await pool.query("UPDATE portal_student_links SET status='revoked' WHERE id=2"); await expect(service.publicProject(publicToken(published.publicUrl))).rejects.toMatchObject({ code: 'portalNotFound' });
  });
  it('rejects stale project versions without overwriting current edits and removes legacy links explicitly', async () => {
    const value = await service.saveProject(self,null,project({ links: ['https://example.com'] }));
    await service.saveProject(self,value.id,project({ version: value.version, title: 'Latest', links: [] }));
    await expect(service.saveProject(self,value.id,project({ version: value.version, title: 'Stale' }))).rejects.toMatchObject({ code: 'portalVersionConflict' });
    expect(await service.project(self,value.id)).toMatchObject({ title: 'Latest', links: [] });
    expect((await pool.query('SELECT url,group_id,course_id FROM academy_portfolio_projects WHERE id=$1',[value.id])).rows[0]).toEqual({ url: null, group_id: 1, course_id: 1 });
  });
  it('quarantines uploaded files, rejects download until validated and strips storage metadata from DTOs', async () => {
    const file = await service.upload(self,'/tmp/upload','work.txt',1); expect(file.state).toBe('checking');
    for (const key of ['storageKey','sha256','ownerAccountId','ownerUserId','studentId','runId']) expect(file).not.toHaveProperty(key);
    await expect(service.file(self,file.id)).rejects.toMatchObject({ code: 'portalFileNotReady' });
    await expect(service.file(stranger,file.id)).rejects.toMatchObject({ code: 'portalNotFound' });
    store.inspect.mockRejectedValueOnce(new PortalResourceError('portalFileTypeUnsupported'));
    await service.validateFiles(); expect((await service.fileStatus(self,file.id)).state).toBe('rejected');
    await expect(service.file(self,file.id)).rejects.toMatchObject({ code: 'portalFileNotReady' });
  });
  it('retries unavailable storage without marking the file ready and cannot attach another student file', async () => {
    const file = await service.upload(self,'/tmp/upload','work.txt',1); store.inspect.mockRejectedValueOnce(new Error('storage unavailable')); await service.validateFiles();
    expect((await service.fileStatus(self,file.id)).state).toBe('checking');
    await expect(service.saveProject(adult,null,project({ fileIds: [file.id] }))).rejects.toMatchObject({ code: 'portalFileNotReady' });
  });
  it('prevents a teacher assigned to another course of the same pupil from reviewing this project', async () => {
    await pool.query("INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(1,2,now())");
    const value = await service.saveProject(self,null,project()); await expect(service.reviewProject(otherTeacher,value.id,value.version,'Review')).rejects.toMatchObject({ code: 'portalNotFound' });
    await service.reviewProject(teacher,value.id,value.version,'Review'); expect(await service.project(self,value.id)).toMatchObject({ teacherReview: 'Review' });
  });
  it('does not attribute a shared lead payment to both children and requires an explicit finance allocation', async () => {
    await pool.query("INSERT INTO academy_payments(lead_id,amount_uzs,status,method,type) VALUES(10,100000,'paid','cash','tuition')");
    expect(await service.payments(adult)).toMatchObject({ state: 'needs_review', items: [], summary: null });
    await expect(service.payments(self)).rejects.toMatchObject({ code: 'portalAccessDenied' });
    await expect(service.allocatePayment(teacher,1,{ version: 0, allocations: [{ studentId: 1, amountUzs: 40000 },{ studentId: 2, amountUzs: 60000 }], reason: 'Confirmed allocation' })).rejects.toMatchObject({ code: 'portalAccessDenied' });
    await service.allocatePayment(finance,1,{ version: 0, allocations: [{ studentId: 1, amountUzs: 40000 },{ studentId: 2, amountUzs: 60000 }], reason: 'Confirmed allocation' });
    expect(await service.payments(adult)).toMatchObject({ state: 'ready', items: [{ amountUzs: 60000 }], summary: { paidUzs: 60000 } });
    expect(await service.payments(stranger)).toMatchObject({ state: 'ready', items: [] });
    await expect(pool.query('UPDATE academy_payments SET amount_uzs=90000 WHERE id=1')).rejects.toMatchObject({ code: '23514' });
  });
  it('serializes allocation changes and rejects any sum exceeding the actual payment', async () => {
    await pool.query("INSERT INTO academy_payments(lead_id,amount_uzs,status,method,type) VALUES(10,100000,'paid','cash','tuition')");
    await expect(service.allocatePayment(finance,1,{ version: 0, allocations: [{ studentId: 1, amountUzs: 70000 },{ studentId: 2, amountUzs: 70000 }], reason: 'Confirmed allocation' })).rejects.toMatchObject({ code: 'portalAllocationExceedsAmount' });
    expect((await pool.query('SELECT count(*)::int AS count FROM academy_payment_student_allocations')).rows[0].count).toBe(0);
  });
  it('hides cached notifications immediately after rights or consent withdrawal', async () => {
    await pool.query("INSERT INTO portal_notifications(account_id,link_id,category,code,event_key,required_permission) VALUES(3,3,'family','portfolio','one','portfolio.approve')");
    expect((await service.notifications(3,null,30)).unreadCount).toBe(1);
    await pool.query("UPDATE portal_student_links SET permissions='[]' WHERE id=3");
    expect(await service.notifications(3,null,30)).toMatchObject({ items: [], unreadCount: 0 });
  });
  it('keeps parent question attachments private to that parent instead of other family accounts', async () => {
    const file = (await pool.query("INSERT INTO lms_files(owner_user_id,run_id,name,mime,size_bytes,storage_key,state) VALUES(1,1,'private.txt','text/plain',5,'abcdefghijklmnopqrstuv','ready') RETURNING id")).rows[0];
    const thread = (await pool.query("INSERT INTO lms_threads(student_id,run_id,title,audience,author_account_id) VALUES(1,1,'Private question','representative_teacher',3) RETURNING id")).rows[0];
    await pool.query("INSERT INTO lms_comments(student_id,run_id,thread_id,staff_user_id,audience,body,file_ids) VALUES(1,1,$1,1,'representative_teacher','Private reply',$2::jsonb)",[thread.id,JSON.stringify([Number(file.id)])]);
    expect(await service.fileStatus(parent,Number(file.id))).toMatchObject({ name:'private.txt' });
    await expect(service.fileStatus(self,Number(file.id))).rejects.toMatchObject({ code:'portalNotFound' });
    await expect(service.fileStatus({...parent,portalAccountId:4,linkId:5},Number(file.id))).rejects.toMatchObject({ code:'portalNotFound' });
  });
  it('replays a financial question once, scopes it to its author, and queues only the author’s reply notification', async () => {
    const input = { paymentId:null,subject:'Payment date',body:'Please confirm the date',idempotencyKey:'a778a0f6-51f0-4fd3-9739-54dcd8be3f18' };
    const question = await service.createFinanceQuestion(adult,input);
    expect((await service.createFinanceQuestion(adult,input)).id).toBe(question.id);
    expect((await pool.query('SELECT count(*)::int AS count FROM portal_finance_questions')).rows[0].count).toBe(1);
    await expect(service.createFinanceQuestion(adult,{...input,body:'Changed request'})).rejects.toMatchObject({ code:'portalVersionConflict' });
    await expect(service.financeQuestion(stranger,question.id)).rejects.toMatchObject({ code:'portalNotFound' });
    await expect(service.staffFinanceReply(teacher,question.id,'Reply')).rejects.toMatchObject({ code:'portalAccessDenied' });
    const reply = await service.staffFinanceReply(finance,question.id,'Confirmed','1b02a913-6d38-4563-a40c-125d1fc8e77b');
    expect(reply).toMatchObject({status:'answered',messages:[{author:'account'},{author:'staff',body:'Confirmed'}]});
    await service.staffFinanceReply(finance,question.id,'Confirmed','1b02a913-6d38-4563-a40c-125d1fc8e77b');
    expect((await pool.query('SELECT account_id,link_id,channel FROM lms_resource_outbox ORDER BY channel')).rows).toEqual([{account_id:'2',link_id:'2',channel:'email'},{account_id:'2',link_id:'2',channel:'in_app'}]);
    await pool.query("UPDATE portal_student_links SET status='revoked' WHERE id=2");
    await expect(service.financeQuestion(adult,question.id)).rejects.toMatchObject({ code:'portalAccessDenied' });
  });
  it('persists immutable same-course comparisons, checks authorship and rejects conflicting selection', async () => {
    const first=await service.saveProject(self,null,project({title:'First'})),latest=await service.saveProject(self,null,project({title:'Latest'}));
    const selected=await service.saveProjectComparison(self,{runId:1,firstProjectId:first.id,latestProjectId:latest.id,version:0});
    expect(selected).toMatchObject({version:1,selectedByName:'Child',selectedByRole:'student',firstProject:{title:'First'},latestProject:{title:'Latest'}});
    await service.saveProject(self,latest.id,project({title:'Edited later',version:latest.version}));
    expect(await service.projectComparison(self,1)).toMatchObject({latestProject:{title:'Latest'}});
    await expect(service.saveProjectComparison(self,{runId:1,firstProjectId:latest.id,latestProjectId:first.id,version:0})).rejects.toMatchObject({code:'portalVersionConflict'});
    await expect(service.saveProjectComparison(parent,{runId:1,firstProjectId:first.id,latestProjectId:latest.id,version:1})).rejects.toMatchObject({code:'portalAccessDenied'});
    await expect(service.staffProjectComparison(otherTeacher,1,1)).rejects.toMatchObject({code:'portalNotFound'});
    await expect(service.saveProjectComparison(stranger,{runId:1,firstProjectId:first.id,latestProjectId:latest.id,version:0})).rejects.toMatchObject({code:'portalNotFound'});
    await pool.query("UPDATE academy_portfolio_projects SET lms_run_id=NULL,group_id=NULL,course_id=NULL WHERE id=$1",[latest.id]);
    await expect(service.saveProjectComparison(self,{runId:null,firstProjectId:first.id,latestProjectId:latest.id,version:0})).rejects.toMatchObject({code:'portalInvalidData'});
  });
  it('serializes concurrent financial distribution and preserves other managers’ allocations', async () => {
    await pool.query("INSERT INTO academy_payments(lead_id,amount_uzs,status,method,type) VALUES(10,100000,'paid','cash','tuition')");
    const input={version:0,allocations:[{studentId:1,amountUzs:40000},{studentId:2,amountUzs:60000}],reason:'Confirmed by finance'};
    const results=await Promise.allSettled([service.allocatePayment(finance,1,input),service.allocatePayment(finance,1,input)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{code:'portalVersionConflict'}});
    expect(await service.paymentAllocation(finance,1)).toMatchObject({version:1,students:[{id:1,amountUzs:40000},{id:2,amountUzs:60000}]});
    expect((await pool.query('SELECT old_values,new_values FROM audit_logs')).rows).toHaveLength(1);
    await pool.query('UPDATE academy_students SET manager_id=CASE WHEN id=1 THEN 1 ELSE 2 END');
    await expect(service.allocatePayment({userId:1,modules:['sales'],isLeadership:false},1,{version:1,allocations:[{studentId:1,amountUzs:100000}],reason:'Replace family allocation'})).rejects.toMatchObject({code:'portalAccessDenied'});
    expect((await service.paymentAllocation(finance,1)).students.map(student=>student.amountUzs)).toEqual([40000,60000]);
    await expect(service.paymentAllocation({userId:1,modules:['administration'],isLeadership:true},1)).rejects.toMatchObject({code:'portalAccessDenied'});
    await expect(service.staffFinanceQuestions({userId:1,modules:['administration'],isLeadership:true})).rejects.toMatchObject({code:'portalAccessDenied'});
  });
  it('copies staff attachment bytes once across courses and retains files referenced by reports', async () => {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lms-copy-it-'));
    try {
      const store=new LocalResourceFileStore(path.join(directory,'files'),directory),codec=createResourceTokenCodec(randomBytes(32).toString('base64'));
      const copyService=new PortalResourceService(repository,store,codec,{appUrl:'https://academy.example',publicPortfolioEnabled:()=>true});
      const sourceKey='s'.repeat(24),temporary=path.join(directory,'upload');await fs.writeFile(temporary,'Lesson attachment');await store.commit(temporary,sourceKey);
      const original=(await pool.query("INSERT INTO lms_files(owner_user_id,run_id,name,mime,size_bytes,storage_key,state,sha256) VALUES(1,1,'lesson.txt','text/plain',17,$1,'ready',$2) RETURNING id",[sourceKey,'a'.repeat(64)])).rows[0];
      const adminActor={...teacher,isLeadership:true};
      const copied=await copyService.cloneStaffFiles(adminActor,[Number(original.id)],1,2,'copy-request-one');
      const replay=await copyService.cloneStaffFiles(adminActor,[Number(original.id)],1,2,'copy-request-one');
      expect(replay.fileIds).toEqual(copied.fileIds);
      expect((await pool.query('SELECT count(*)::int AS count FROM lms_staff_file_copies')).rows[0].count).toBe(1);
      const clone=(await repository.filesByIds(copied.fileIds))[0];expect(await fs.readFile(store.location(clone.storageKey),'utf8')).toBe('Lesson attachment');
      await pool.query("INSERT INTO lms_reports(student_id,run_id,period_from,period_to,version,metrics,comment,next_steps,published_by,best_projects) VALUES(3,2,now()-interval '1 month',now(),1,'{}','Review','Next',1,$1::jsonb)",[JSON.stringify([{id:11,fileIds:copied.fileIds}])]);
      await pool.query("UPDATE lms_files SET created_at=now()-interval '2 days' WHERE id=ANY($1::bigint[])",[copied.fileIds]);
      await copied.discardUnused();expect(await repository.filesByIds(copied.fileIds)).toHaveLength(1);
      expect((await repository.cleanupFiles()).map(file=>file.id)).not.toContain(clone.id);
      await expect(copyService.cloneStaffFiles(otherTeacher,[Number(original.id)],1,2,'foreign-copy')).rejects.toMatchObject({code:'portalNotFound'});
    } finally {await fs.rm(directory,{recursive:true,force:true});}
  });

  it('rejects resource ID substitution across HTTP projects, shares, files, finances and public snapshots', async()=>{
    const own=await service.saveProject(adult,null,project({title:'Own'}));
    const foreign=await service.saveProject(stranger,null,project({runId:2,title:'Foreign'}));
    const foreignShare=await service.createShare(stranger,foreign.id,share(foreign.version));
    const ownShare=await service.createShare(adult,own.id,share(own.version));
    const file=(await pool.query("INSERT INTO lms_files(owner_account_id,student_id,run_id,name,mime,size_bytes,storage_key,state) VALUES(4,3,2,'foreign.txt','text/plain',5,'foreign-file-abcdefghijkl','ready') RETURNING id")).rows[0];
    const app=express();app.use(express.json());app.use('/api/portal',createPortalResourceRouter(service,{actor:async(_req,linkId)=>{if(linkId!==adult.linkId)throw new PortalResourceError('portalNotFound',404);return adult;},account:async()=>adult.portalAccountId},(_req,_res,next)=>next()));app.use('/api/public/portfolio',createPublicPortfolioRouter(service));app.use('/api/lms-management',createStaffResourceRouter(service,async()=>teacher,(_req,_res,next)=>next()));
    for(const path of [`/api/portal/subjects/2/projects/${foreign.id}`,`/api/portal/subjects/2/shares/${foreignShare.id}`,`/api/portal/files/${file.id}/status?linkId=2`,`/api/portal/files/${file.id}/download?linkId=2`,`/api/lms-management/files/${file.id}/status`,`/api/public/portfolio/${publicToken(ownShare.publicUrl)}/files/${file.id}`]){
      const response=await request(app).get(path);expect(response.status).toBe(404);expect(response.body).not.toHaveProperty('storageKey');expect(response.text).not.toContain('foreign-file-abcdefghijkl');
    }
    await request(app).patch(`/api/portal/subjects/2/projects/${foreign.id}`).send(project({runId:2,version:foreign.version,title:'Overwrite'})).expect(404);
    await request(app).post(`/api/portal/subjects/2/shares/${foreignShare.id}/revoke`).send({}).expect(404);
    await pool.query("INSERT INTO academy_payments(student_id,amount_uzs,status,method,type) VALUES(3,100,'paid','cash','tuition')");
    await request(app).post('/api/portal/subjects/2/finance-questions').send({paymentId:1,subject:'Foreign payment',body:'Read it'}).expect(404);
    await request(app).get('/api/portal/subjects/4/payments').expect(404);
    await request(app).get(`/api/public/portfolio/${publicToken(ownShare.publicUrl)}`).expect('X-Robots-Tag','noindex, nofollow').expect('Cache-Control','private, no-store').expect(200);
  });
  it('paginates portal projects and payment history without losing the aggregate totals',async()=>{
    await pool.query("INSERT INTO academy_portfolio_projects(student_id,lms_run_id,group_id,course_id,title) SELECT 2,1,1,1,'Project '||n FROM generate_series(1,125) n");
    await pool.query("INSERT INTO academy_payments(student_id,amount_uzs,status,method,type) SELECT 2,100,'paid','cash','tuition' FROM generate_series(1,125)");
    const first=await service.projectsPage(adult,null,100),second=await service.projectsPage(adult,first.nextCursor,100);
    expect(first.items).toHaveLength(100);expect(second.items).toHaveLength(25);expect(second.nextCursor).toBeNull();expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(125);
    const payments=await service.payments(adult,null,100),older=await service.payments(adult,payments.nextCursor,100);
    expect(payments.items).toHaveLength(100);expect(older.items).toHaveLength(25);expect(payments.summary?.paidUzs).toBe(12500);expect(older.summary?.paidUzs).toBe(12500);expect(older.nextCursor).toBeNull();
    const app=express();app.use('/api/portal',createPortalResourceRouter(service,{actor:async()=>adult,account:async()=>adult.portalAccountId},(_req,_res,next)=>next()));
    const firstPage=await request(app).get('/api/portal/subjects/2/projects').expect(200);
    expect(firstPage.body.items).toHaveLength(30);expect(firstPage.body.hasMore).toBe(true);expect(firstPage.body.nextCursor).toBe(firstPage.body.items[29].id);expect(firstPage.headers['x-next-cursor']).toBeUndefined();
    const seen=new Set(firstPage.body.items.map((item:{id:number})=>item.id));let cursor=firstPage.body.nextCursor;
    while(cursor!==null){const reply=await request(app).get(`/api/portal/subjects/2/projects?cursor=${cursor}`).expect(200);expect(reply.body.hasMore).toBe(reply.body.nextCursor!==null);for(const item of reply.body.items)seen.add(item.id);cursor=reply.body.nextCursor;}
    expect(seen.size).toBe(125);
    const paidPage=await request(app).get('/api/portal/subjects/2/payments').expect(200);
    expect(paidPage.body).toMatchObject({state:'ready',hasMore:true,summary:{paidUzs:12500}});expect(paidPage.body.items).toHaveLength(30);
    const nextPaid=await request(app).get(`/api/portal/subjects/2/payments?cursor=${paidPage.body.nextCursor}&limit=100`).expect(200);
    expect(nextPaid.body.items).toHaveLength(95);expect(nextPaid.body).toMatchObject({nextCursor:null,hasMore:false,summary:{paidUzs:12500}});
  });
  it('preserves a changed school policy and feature scope on concurrent stale settings updates',async()=>{
    await pool.query("INSERT INTO lms_feature_flags(key) VALUES('learning'),('invitations'),('public_portfolio'),('email')");
    const config={...appConfig,portal:{enabled:true,learningEnabled:true,emailEnabled:false,allowInvitations:true,publicPortfolioEnabled:true}};
    const flags=new LearningFeatureController(pool,config);await flags.refresh();
    const first=structuredClone(DEFAULT_LEARNING_SCHOOL_SETTINGS);first.studentQuotaGiB=2;
    const second=structuredClone(DEFAULT_LEARNING_SCHOOL_SETTINGS);second.studentQuotaGiB=3;
    const results=await Promise.allSettled([flags.updateSettings(1,first,0),flags.updateSettings(1,second,0)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{code:'portalVersionConflict'}});
    expect((await pool.query("SELECT count(*)::int AS count FROM lms_learning_audit WHERE entity_type='school_settings'")).rows[0].count).toBe(1);
    await flags.update(1,{key:'learning',enabled:true,allGroups:false,groupIds:[1],version:0});
    expect(await flags.enabledForStudent('learning',2)).toBe(true);expect(await flags.enabledForStudent('learning',3)).toBe(false);
    await expect(flags.update(1,{key:'learning',enabled:true,allGroups:true,groupIds:[],version:0})).rejects.toMatchObject({code:'portalVersionConflict'});
  });
  it('correlates both HTTP configuration changes with the resolved staff request without exposing it in settings',async()=>{
    await pool.query("INSERT INTO lms_feature_flags(key) VALUES('learning'),('invitations'),('public_portfolio'),('email')");
    const config={...appConfig,portal:{enabled:true,learningEnabled:true,emailEnabled:false,allowInvitations:true,publicPortfolioEnabled:true}};
    const flags=new LearningFeatureController(pool,config);await flags.refresh();
    const app=express();app.use(express.json());app.use(createLearningConfigurationRouter(flags,async req=>({...teacher,modules:['administration'],requestId:req.get('X-Request-Id')})));
    const settingsId=randomUUID(),flagId=randomUUID(),settings=structuredClone(DEFAULT_LEARNING_SCHOOL_SETTINGS);settings.studentQuotaGiB=2;
    const saved=await request(app).put('/school-settings').set('X-Request-Id',settingsId).send({settings,version:0}).expect(200);
    const updated=await request(app).put('/configuration').set('X-Request-Id',flagId).send({key:'learning',enabled:true,allGroups:false,groupIds:[1],version:0}).expect(200);
    expect((await pool.query("SELECT entity_type,request_id FROM lms_learning_audit WHERE entity_type IN('school_settings','feature_flag') ORDER BY entity_type")).rows).toEqual([{entity_type:'feature_flag',request_id:flagId},{entity_type:'school_settings',request_id:settingsId}]);
    for(const output of [saved.body,updated.body])for(const id of [settingsId,flagId])expect(JSON.stringify(output)).not.toContain(id);
  });
  it('deduplicates concurrent project and share creation and rejects a changed replay payload', async () => {
    const input=project({idempotencyKey:randomUUID()});
    const created=await Promise.all([service.saveProject(adult,null,input),service.saveProject(adult,null,input)]);
    expect(created[0].id).toBe(created[1].id);
    expect((await pool.query('SELECT count(*)::int AS count FROM academy_portfolio_projects')).rows[0].count).toBe(1);
    await expect(service.saveProject(adult,null,{...input,title:'Changed'})).rejects.toMatchObject({code:'portalVersionConflict'});
    const publication=share(created[0].version,{idempotencyKey:randomUUID()});
    const published=await Promise.all([service.createShare(adult,created[0].id,publication),service.createShare(adult,created[0].id,publication)]);
    expect(published[0].id).toBe(published[1].id);expect(published[0].publicUrl).toBe(published[1].publicUrl);
    expect((await pool.query('SELECT count(*)::int AS count FROM lms_portfolio_shares')).rows[0].count).toBe(1);
    await service.saveProject(adult,created[0].id,project({title:'Later edit',version:created[0].version}));
    expect((await service.createShare(adult,created[0].id,publication)).id).toBe(published[0].id);
    await expect(service.createShare(adult,created[0].id,{...publication,displayName:'Changed'})).rejects.toMatchObject({code:'portalVersionConflict'});
    await pool.query("UPDATE portal_student_links SET status='revoked' WHERE id=2");
    await expect(service.saveProject(adult,null,input)).rejects.toMatchObject({code:'portalAccessDenied'});
  });
  it('correlates portal and staff changes with their HTTP request without exposing it in a project DTO',async()=>{
    const requestId=randomUUID(),value=await service.saveProject({...adult,requestId},null,project());
    expect(value).not.toHaveProperty('requestId');expect((await pool.query("SELECT request_id FROM lms_resource_audit WHERE action='project.created'")).rows[0].request_id).toBe(requestId);
    const staffRequest=randomUUID();await service.reviewProject({...teacher,requestId:staffRequest},value.id,value.version,'Reviewed');
    expect((await pool.query("SELECT request_id FROM lms_resource_audit WHERE action='project.reviewed'")).rows[0].request_id).toBe(staffRequest);
  });
  it('correlates anonymous public file delivery without recording a public bearer token',async()=>{
    await pool.query(`UPDATE portal_student_links SET permissions=permissions||'["assignments.submit"]'::jsonb WHERE id=2`);
    const file=await repository.registerFile(adult,{name:'Published.txt',mime:'text/plain',size:5,sha256:'a'.repeat(64),storageKey:'public-file-abcdefghijkl',runId:1});
    await pool.query("UPDATE lms_files SET state='ready' WHERE id=$1",[file.id]);
    const value=await service.saveProject(adult,null,project({fileIds:[file.id]}));
    const published=await service.createShare(adult,value.id,share(value.version,{fileIds:[file.id]}));
    const requestId=randomUUID(),token=publicToken(published.publicUrl);
    await service.publicFile(token,file.id,requestId);
    const audit=(await pool.query("SELECT request_id,details FROM portal_access_audit WHERE action='portfolio.file_downloaded'")).rows[0];
    expect(audit.request_id).toBe(requestId);expect(audit.details).toEqual({shareId:published.id,fileId:file.id});
    expect(JSON.stringify(audit)).not.toContain(token);
  });
  it('completes comparison and moderation transactions with one database connection', async () => {
    const first=await service.saveProject(self,null,project({title:'First'})),latest=await service.saveProject(self,null,project({title:'Latest'}));
    const requested=await service.createShare(self,latest.id,share(latest.version));
    const approved=await service.approveShare(parent,requested.id,requested.version,true);
    const single=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`,max:1,connectionTimeoutMillis:2000});
    try {
      const singleRepository=new PostgresPortalResourceRepository(single,async()=>true);
      expect(await singleRepository.saveProjectComparison(self,{runId:1,firstProjectId:first.id,latestProjectId:latest.id,version:0})).toMatchObject({firstProjectId:first.id,latestProjectId:latest.id});
      expect(await singleRepository.moderateShare(teacher,approved.id,approved.version,true)).toMatchObject({status:'published'});
    } finally {await single.end();}
  });
  it('rechecks that an employee is active before accepting uploaded or copied attachments', async () => {
    await pool.query('UPDATE users SET is_active=false WHERE id=1');
    await expect(repository.registerStaffFile(teacher,1,{name:'lesson.txt',mime:'text/plain',size:1,storageKey:'a'.repeat(24),sha256:'b'.repeat(64)})).rejects.toMatchObject({code:'portalAccessDenied'});
    expect((await pool.query('SELECT count(*)::int AS count FROM lms_files')).rows[0].count).toBe(0);
  });
  it('closes direct assignment attachment access outside enrollment publication dates and preserves an older submitted version', async () => {
    const file=(await pool.query("INSERT INTO lms_files(owner_user_id,run_id,name,mime,size_bytes,storage_key,state) VALUES(1,1,'lesson.txt','text/plain',5,'lesson-abcdefghijklmnopqr','ready') RETURNING id")).rows[0];
    const assignment=(await pool.query("INSERT INTO lms_assignments(run_id,state,created_by) VALUES(1,'published',1) RETURNING id")).rows[0];
    const version=(await pool.query("INSERT INTO lms_assignment_versions(assignment_id,version,title,body,required,allowed_answers,file_ids,grading_mode) VALUES($1,1,'Assignment','Complete',true,'[\"text\"]',$2::jsonb,'acceptance') RETURNING id",[assignment.id,JSON.stringify([Number(file.id)])])).rows[0];
    const recipient=(await pool.query("INSERT INTO lms_assignment_recipients(assignment_id,assignment_version_id,enrollment_id,student_id,opens_at) VALUES($1,$2,1,1,now()-interval '1 day') RETURNING id",[assignment.id,version.id])).rows[0];
    expect(await service.fileStatus(self,Number(file.id))).toMatchObject({name:'lesson.txt'});
    await pool.query("UPDATE academy_student_group_enrollments SET ended_at=now()-interval '2 days',status='completed' WHERE id=1");
    await expect(service.fileStatus(self,Number(file.id))).rejects.toMatchObject({code:'portalNotFound'});
    await pool.query("UPDATE academy_student_group_enrollments SET ended_at=now()-interval '12 hours' WHERE id=1");
    await pool.query("INSERT INTO lms_submissions(recipient_id,assignment_version_id,account_id,attempt_number,text,links,file_ids,idempotency_key,late) VALUES($1,$2,1,1,'Work','[]','[]','old-work',false)",[recipient.id,version.id]);
    const revised=(await pool.query("INSERT INTO lms_assignment_versions(assignment_id,version,title,body,required,allowed_answers,file_ids,grading_mode) VALUES($1,2,'Revision','Complete',true,'[\"text\"]','[]','acceptance') RETURNING id",[assignment.id])).rows[0];
    await pool.query('UPDATE lms_assignment_recipients SET assignment_version_id=$1 WHERE id=$2',[revised.id,recipient.id]);
    expect(await service.fileStatus(self,Number(file.id))).toMatchObject({name:'lesson.txt'});
    await pool.query("UPDATE lms_group_runs SET access_until=now()-interval '1 second' WHERE id=1");
    await expect(service.fileStatus(self,Number(file.id))).rejects.toMatchObject({code:'portalNotFound'});
  });
  it('claims different files across validation replicas while one inspection is unresolved', async () => {
    const firstFile = await service.upload(self, '/tmp/one', 'one.txt', 1);
    const secondFile = await service.upload(self, '/tmp/two', 'two.txt', 1);
    const replicaPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 2 });
    const replica = new PortalResourceService(new PostgresPortalResourceRepository(replicaPool, async () => true), {
      inspect: async () => { throw new PortalResourceError('portalFileTypeUnsupported'); }, commit: async () => {}, remove: async () => {}, location: key => `/tmp/${key}`,
    }, createResourceTokenCodec(randomBytes(32).toString('base64')), { appUrl: 'https://academy.example', publicPortfolioEnabled: () => false });
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    store.inspect.mockImplementationOnce(async () => { started(); await held; return inspectedFile(); });
    const running = service.validateFiles();
    try {
      await entered;
      expect(await replica.validateFiles()).toBe(1);
      expect((await service.fileStatus(self, firstFile.id)).state).toBe('checking');
      expect((await service.fileStatus(self, secondFile.id)).state).toBe('rejected');
    } finally { release(); await running; await replicaPool.end(); }
    expect((await service.fileStatus(self, firstFile.id)).state).toBe('ready');
    expect((await pool.query('SELECT scan_attempts FROM lms_files ORDER BY id')).rows).toEqual([{ scan_attempts: 1 }, { scan_attempts: 1 }]);
  });
  it('recovers an expired validation claim and fences both expired and previously owned completion tokens', async () => {
    const file = await service.upload(self, '/tmp/file', 'work.txt', 1);
    const initial = (await repository.scanningFiles())[0];
    expect(initial.file.id).toBe(file.id); expect(await repository.scanningFiles()).toEqual([]);
    const expired = (await pool.query("UPDATE lms_files SET scan_after=clock_timestamp()-interval '1 second' WHERE id=$1 RETURNING scan_after::text AS token", [file.id])).rows[0].token;
    await repository.scanned(file.id, 'ready', undefined, expired);
    expect((await service.fileStatus(self, file.id)).state).toBe('checking');
    const reclaimed = (await repository.scanningFiles())[0];
    expect(reclaimed.file.id).toBe(file.id); expect(reclaimed.leaseToken).not.toBe(expired);
    await repository.scanned(file.id, 'ready', undefined, expired);
    await repository.scanned(file.id, 'rejected', 'portalFileRejected', reclaimed.leaseToken);
    await repository.scanned(file.id, 'ready', undefined, initial.leaseToken);
    expect((await service.fileStatus(self, file.id))).toMatchObject({ state: 'rejected', rejectionCode: 'portalFileRejected' });
    expect((await pool.query('SELECT scan_attempts FROM lms_files WHERE id=$1', [file.id])).rows[0].scan_attempts).toBe(1);
  });
  it('validates committed bytes without an external service, rejects changed checksums and protects downloads', async () => {
    const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-validation-'));
    const physicalStore = new LocalResourceFileStore(path.join(uploads,'lms','files'),uploads);
    const resources = new PortalResourceService(repository,physicalStore,createResourceTokenCodec(randomBytes(32).toString('base64')),{appUrl:'https://academy.example',publicPortfolioEnabled:()=>false});
    try {
      const temporary = path.join(uploads,'work.txt'); await fs.writeFile(temporary,'hello');
      const file = await resources.upload(self,temporary,'work.txt',1);
      expect(file.state).toBe('checking');
      await expect(resources.file(self,file.id)).rejects.toMatchObject({code:'portalFileNotReady'});
      expect(await resources.validateFiles()).toBe(1);
      expect(await resources.fileStatus(self,file.id)).toMatchObject({state:'ready',rejectionCode:null,downloadUrl:expect.any(String)});
      expect(await fs.readFile((await resources.file(self,file.id)).path,'utf8')).toBe('hello');
      await expect(resources.file(stranger,file.id)).rejects.toMatchObject({code:'portalNotFound'});
      await fs.writeFile(temporary,'hello'); const changed = await resources.upload(self,temporary,'changed.txt',1);
      const stored = (await repository.filesByIds([changed.id]))[0]; await fs.writeFile(physicalStore.location(stored.storageKey),'other');
      expect(await resources.validateFiles()).toBe(1);
      expect(await resources.fileStatus(self,changed.id)).toMatchObject({state:'rejected',rejectionCode:'portalFileRejected',downloadUrl:null});
      await expect(resources.file(self,changed.id)).rejects.toMatchObject({code:'portalFileNotReady'});
      expect(await resources.validateFiles()).toBe(0);
    } finally { await fs.rm(uploads,{recursive:true,force:true}); }
  });
  it('retries interrupted physical cleanup and records one receipt only after removal, preserving the retained backup', async () => {
    const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-cleanup-recovery-'));
    const store = new LocalResourceFileStore(path.join(uploads, 'lms', 'files'), uploads);
    const replicaRepository = new PostgresPortalResourceRepository(pool, async () => true);
    const replica = new PortalResourceService(replicaRepository, store, createResourceTokenCodec(randomBytes(32).toString('base64')), { appUrl: 'https://academy.example', publicPortfolioEnabled: () => false });
    const temporary = path.join(uploads, 'work.txt'); await fs.writeFile(temporary, 'hello');
    const file = await replica.upload(self, temporary, 'work.txt', 1);
    const key = (await pool.query('SELECT storage_key FROM lms_files WHERE id=$1', [file.id])).rows[0].storage_key;
    await pool.query("UPDATE lms_files SET created_at=now()-interval '2 days' WHERE id=$1", [file.id]);
    const physicalRemove = store.remove.bind(store), receipt = replicaRepository.fileStorageRemoved.bind(replicaRepository);
    let removeInterrupted = true, receiptInterrupted = true, removals = 0;
    store.remove = async storageKey => { removals++; if (removeInterrupted) { removeInterrupted = false; throw new Error('Removal interrupted'); } await physicalRemove(storageKey); };
    replicaRepository.fileStorageRemoved = async id => { if (receiptInterrupted) { receiptInterrupted = false; throw new Error('Receipt interrupted'); } await receipt(id); };
    const receipts = async () => (await pool.query("SELECT actor_kind,staff_id,account_id,details FROM portal_access_audit WHERE action='file.storage_removed' AND details->>'fileId'=$1::text", [file.id])).rows;
    try {
      await expect(replica.cleanupFiles()).rejects.toThrow('Removal interrupted');
      expect(await fs.readFile(store.location(key), 'utf8')).toBe('hello'); expect(await receipts()).toEqual([]);
      await expect(replica.cleanupFiles()).rejects.toThrow('Receipt interrupted');
      await expect(fs.stat(store.location(key))).rejects.toMatchObject({ code: 'ENOENT' }); expect(await receipts()).toEqual([]);
      const retained = path.join(uploads, '.retained', 'lms', 'files', key);
      expect(await fs.readFile(retained, 'utf8')).toBe('hello');
      await replica.cleanupFiles(); await replica.cleanupFiles();
      expect(await receipts()).toEqual([{ actor_kind: 'anonymous', staff_id: null, account_id: null, details: { fileId: file.id } }]); expect(removals).toBe(3);
      expect(await fs.readFile(retained, 'utf8')).toBe('hello');
    } finally { await fs.rm(uploads, { recursive: true, force: true }); }
  });
});
