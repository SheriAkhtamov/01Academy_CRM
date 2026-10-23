import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(() => ({ query:vi.fn(),viewer:{ id:7,module:'sales',modules:['sales'] } as {
  id:number; module:string; modules:string[];
} }));
vi.mock('../server/db',() => ({ pool:{ query:mocks.query,connect:vi.fn() } }));
vi.mock('../server/middleware/auth.middleware',() => ({ requireAuth:((req,_res,next) => {
  req.user=mocks.viewer as never;next();
}) satisfies RequestHandler }));
import telephonyRoutes from '../server/routes/telephony.routes';
import { VoiceReminderCallHistory } from '../server/services/voice-reminder-call-history';

const url=process.env.PORTAL_TEST_DATABASE_URL;
const schema=`combined_calls_${randomUUID().replace(/-/g,'')}`;
const app=express();app.use('/api/telephony',telephonyRoutes);
const botId=(id:number) => `10000000-0000-4000-8000-${String(id).padStart(12,'0')}`;

describe.skipIf(!url)('combined call histories on isolated PostgreSQL',() => {
  let admin:Pool;
  let database:Pool;
  const managerCall=async (id:number,leadId=1,userId:number|null=7,started='2026-10-17T10:00:00Z',
    direction='outgoing',status='ended',talk=10,phone=`+99890000${String(id).padStart(4,'0')}`) => {
    await database.query(`INSERT INTO telephony_calls(id,lead_id,user_id,started_at,direction,status,talk_seconds,phone,
      duration_seconds,extension,contact_type,contact_id,note) VALUES($1,$2,$3,$4::timestamp,$5,$6,$7,$8,$7+5,'101','lead',$2,'Manager note')`,
    [id,leadId,userId,started,direction,status,talk,phone]);
  };
  const reminderCall=async (id:number,leadId=1,started='2026-10-17T10:01:00Z',talk=20,answered=true,response:string|null=null) => {
    await database.query(`INSERT INTO voice_reminder_call_attempts(call_id,phone,started_at,extension)
      VALUES($1,'+998901234567',$2,'101')`,[botId(id),started]);
    await database.query(`INSERT INTO voice_reminder_call_details(call_id,lead_id,status,answered_at,ended_at,duration_seconds,
      talk_seconds,reminder_outcome,reminder_response,recording_storage_key)
      VALUES($1,$2,$3,CASE WHEN $4 THEN $5::timestamptz ELSE NULL END,$5::timestamptz+interval '30 seconds',30,$6,$7,$8,$9)`,
    [botId(id),leadId,answered?'ended':'failed',answered,started,talk,response?'played':answered?'delivered_no_response':'unanswered',response,answered?'private.mp3':null]);
  };
  const journal=async (query='') => {
    const response=await request(app).get(`/api/telephony/calls/journal${query ? `?${query}` : ''}`);
    expect(response.status,response.text).toBe(200);return response.body;
  };
  const widget=async (query='') => {
    const response=await request(app).get(`/api/telephony/calls${query ? `?${query}` : ''}`);
    expect(response.status,response.text).toBe(200);return response.body;
  };
  beforeAll(async () => {
    if (!url || !['localhost','127.0.0.1','::1','[::1]'].includes(new URL(url).hostname)) throw new Error('Local PostgreSQL required');
    admin=new Pool({ connectionString:url });await admin.query(`CREATE SCHEMA ${schema}`);
    database=new Pool({ connectionString:url,options:`-c search_path=${schema} -c timezone=Asia/Tashkent` });
    await database.query(`CREATE TABLE users(id integer PRIMARY KEY,full_name text);
      CREATE TABLE academy_leads(id integer PRIMARY KEY,manager_id integer,funnel_id integer,status_code text,student_name text,contact_name text);
      CREATE TABLE academy_students(lead_id integer,student_name text);
      CREATE TABLE academy_sales_funnels(id integer PRIMARY KEY,is_default boolean,initial_stage_code text);
      CREATE TABLE academy_sales_funnel_users(user_id integer,funnel_id integer);
      CREATE TABLE academy_company_settings(auto_lead_distribution_enabled boolean);
      CREATE TABLE telephony_calls(id integer PRIMARY KEY,client_call_id text,provider_call_id text,user_id integer,
        extension text,direction text,status text,phone text,lead_id integer,contact_type text,contact_id integer,contact_name text,
        started_at timestamp,answered_at timestamp,ended_at timestamp,duration_seconds integer,talk_seconds integer,hangup_cause text,
        note text,recording_url text);
      CREATE TABLE voice_reminder_call_attempts(call_id uuid PRIMARY KEY,phone text,extension text,started_at timestamptz,provider_id text);
      CREATE TABLE voice_reminder_call_details(call_id uuid PRIMARY KEY,lead_id integer,status text,answered_at timestamptz,
        ended_at timestamptz,duration_seconds integer,talk_seconds integer,hangup_cause text,reminder_outcome text,reminder_response text,reminder_reason text,
        recording_storage_key text,recording_url text,recording_provider_id text,recording_mime_type text)`);
  });
  beforeEach(async () => {
    mocks.viewer={ id:7,module:'sales',modules:['sales'] };
    mocks.query.mockImplementation((sql:string,params:unknown[]) => database.query(sql,params));
    await database.query(`TRUNCATE users,academy_leads,academy_students,academy_sales_funnels,academy_sales_funnel_users,
      academy_company_settings,telephony_calls,voice_reminder_call_attempts,voice_reminder_call_details;
      INSERT INTO users VALUES(1,'Admin'),(7,'Owner'),(8,'Other');
      INSERT INTO academy_sales_funnels VALUES(1,true,'new'),(2,false,'new');
      INSERT INTO academy_sales_funnel_users VALUES(7,1),(8,2);
      INSERT INTO academy_company_settings VALUES(true);
      INSERT INTO academy_leads VALUES(1,7,1,'qualified','Own pupil','Own parent'),(2,8,1,'qualified','Other pupil','Other parent'),
        (3,NULL,1,'qualified','Shared pupil','Shared parent'),(4,NULL,1,'new','Shared intake','Shared intake parent'),
        (5,NULL,2,'qualified','Foreign funnel','Foreign parent'),(6,8,2,'qualified','Other pupil2','Other parent2')`);
  });
  afterAll(async () => {
    await database?.end();if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end(); }
  });

  it('carries the real reminder reason through both histories without assigning it to manager calls', async () => {
    await managerCall(1);
    await reminderCall(2, 1, undefined, 12, true);
    await database.query("UPDATE voice_reminder_call_details SET reminder_outcome='failed',reminder_reason='interrupted' WHERE call_id=$1", [botId(2)]);
    for (const payload of [(await journal()).items, await widget()]) {
      expect(payload.find((call: { source: string }) => call.source === 'voice_reminder')).toMatchObject({ reminderOutcome: 'failed', reminderReason: 'interrupted' });
      expect(payload.find((call: { source: string }) => call.source === 'manager')).toMatchObject({ reminderReason: null });
    }
  });

  it('sorts and paginates the union before limiting, preserving numeric human IDs and UUID robot IDs',async () => {
    for (let id=1;id<=6;id++) {
      await managerCall(id,1,7,`2026-10-17T10:${String(id*2).padStart(2,'0')}:00Z`);
      await reminderCall(id,1,`2026-10-17T10:${String(id*2+1).padStart(2,'0')}:00Z`);
    }
    const first=await journal('limit=3');const second=await journal('limit=3&page=2');
    expect(first.total).toBe(12);expect(first.summary).toEqual({ missed:0,answered:12,talkSeconds:180 });
    expect(first.items.map((call:{ id:number|string }) => call.id)).toEqual([botId(6),6,botId(5)]);
    expect(second.items.map((call:{ id:number|string }) => call.id)).toEqual([5,botId(4),4]);
    expect(typeof first.items[0].id).toBe('string');expect(typeof first.items[1].id).toBe('number');
    expect(first.items[0]).toMatchObject({ source:'voice_reminder',voiceReminderCallId:botId(6),userId:null,userName:null,
      extension:null,note:null,requiresCallback:false,hasRecording:true,reminderOutcome:'delivered_no_response' });
    expect(first.items[1]).toMatchObject({ source:'manager',voiceReminderCallId:null,note:'Manager note' });
    expect(first.items[0]).not.toHaveProperty('_sortKey');
    expect(first.items[0]).not.toHaveProperty('recordingUrl');
    expect(first.items[0]).not.toHaveProperty('recordingStorageKey');
    expect((await widget('limit=3&offset=3')).map((call:{ id:number|string }) => call.id)).toEqual([5,botId(4),4]);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_calls')).rows[0].count).toBe(6);
  });
  it('keeps tied ordering stable and retains native numeric ordering of human IDs',async () => {
    await managerCall(2);await managerCall(10);await reminderCall(2,1,'2026-10-17T10:00:00Z');await reminderCall(10,1,'2026-10-17T10:00:00Z');
    const expected=[10,2,botId(10),botId(2)];
    expect((await journal()).items.map((call:{id:number|string}) => call.id)).toEqual(expected);
    expect((await widget()).map((call:{id:number|string}) => call.id)).toEqual(expected);
  });
  it('applies current lead visibility to bots without granting access through their borrowed extension',async () => {
    for (let lead=1;lead<=6;lead++) await reminderCall(lead,lead);
    await managerCall(1,2,7);await managerCall(2,1,8);
    const result=await journal();
    expect(result.items.filter((call:{source:string}) => call.source==='voice_reminder').map((call:{leadId:number}) => call.leadId).sort()).toEqual([1,3,4]);
    expect((await widget()).map((call:{id:number|string}) => call.id)).toEqual([botId(4),botId(3),botId(1),1]);
    const history=new VoiceReminderCallHistory(database);
    for (const id of [1,3,4]) expect(await history.readAuthorized(botId(id),mocks.viewer)).not.toBeNull();
    for (const id of [2,5,6]) expect(await history.readAuthorized(botId(id),mocks.viewer)).toBeNull();

    await database.query("UPDATE academy_leads SET status_code='new' WHERE id=5");
    expect(await history.readAuthorized(botId(5),mocks.viewer)).toBeNull();
    await database.query('DELETE FROM academy_sales_funnel_users WHERE user_id=7 AND funnel_id=1');
    expect((await journal()).items.filter((call:{source:string}) => call.source==='voice_reminder').map((call:{leadId:number}) => call.leadId)).toEqual([1]);
    expect((await widget()).map((call:{id:number|string}) => call.id)).toEqual([botId(1),1]);
    expect(await history.readAuthorized(botId(1),mocks.viewer)).not.toBeNull();
    for (const id of [2,3,4,5,6]) expect(await history.readAuthorized(botId(id),mocks.viewer)).toBeNull();
  });
  it('filters bot calls by the selected lead manager while preserving the viewer ACL',async () => {
    await reminderCall(1,1);await reminderCall(2,2);await reminderCall(3,3);await managerCall(8,1,8);
    expect((await journal('userId=8')).items.map((call:{id:number|string}) => call.id)).toEqual([8]);
    expect((await journal('userId=unassigned')).items.map((call:{id:number|string}) => call.id)).toEqual([botId(3)]);
    mocks.viewer={ id:1,module:'administration',modules:['administration','sales'] };
    expect((await journal('userId=8')).items.map((call:{id:number|string}) => call.id)).toEqual([botId(2),8]);
  });
  it('keeps administrator human widget history personal and adds all visible bot leads',async () => {
    await managerCall(1,1,1);await managerCall(2,1,7);await reminderCall(1,2);
    mocks.viewer={ id:1,module:'administration',modules:['administration','sales'] };
    expect((await widget()).map((call:{id:number|string}) => call.id)).toEqual([botId(1),1]);
    expect((await journal()).total).toBe(3);
  });
  it('normalizes both timestamp types to UTC even with a non-UTC database session',async () => {
    await managerCall(1,1,7,'2026-10-16T19:00:00Z');await reminderCall(1,1,'2026-10-16T19:00:00Z');
    await managerCall(2,1,7,'2026-10-16T18:59:59Z');await reminderCall(2,1,'2026-10-16T18:59:59Z');
    await managerCall(3,1,7,'2026-10-17T19:00:00Z');await reminderCall(3,1,'2026-10-17T19:00:00Z');
    const result=await journal('from=2026-10-17&to=2026-10-17');
    expect(result.total).toBe(2);
    expect(result.items.map((call:{startedAt:string}) => new Date(call.startedAt).toISOString())).toEqual(['2026-10-16T19:00:00.000Z','2026-10-16T19:00:00.000Z']);
    expect((await widget()).slice(2,4).map((call:{startedAt:string}) => call.startedAt)).toEqual(['2026-10-16T19:00:00.000Z','2026-10-16T19:00:00.000Z']);
  });
  it('immediately follows lead ownership changes without exposing the previous borrowed line owner',async () => {
    await reminderCall(1,1);
    expect((await widget()).map((call:{id:string}) => call.id)).toEqual([botId(1)]);
    await database.query('UPDATE academy_leads SET manager_id=8 WHERE id=1');
    expect((await widget())).toEqual([]);expect((await journal()).total).toBe(0);
    expect(await new VoiceReminderCallHistory(database).readAuthorized(botId(1),mocks.viewer)).toBeNull();
    mocks.viewer={ id:8,module:'sales',modules:['sales'] };
    expect((await widget()).map((call:{id:string}) => call.id)).toEqual([botId(1)]);
  });
  it('keeps per-attempt replies separate and clamps a stale page using the entire combined total',async () => {
    await reminderCall(1,1,'2026-10-17T10:00:00Z',20,true,null);
    await reminderCall(2,1,'2026-10-17T10:10:00Z',20,true,'yes');await managerCall(1);
    const result=await journal('limit=2&page=99');
    expect(result.page).toBe(2);expect(result.total).toBe(3);expect(result.items).toHaveLength(1);
    const rows=(await journal()).items;
    expect(rows.find((call:{id:number|string}) => call.id===botId(1)).reminderResponse).toBeNull();
    expect(rows.find((call:{id:number|string}) => call.id===botId(2)).reminderResponse).toBe('yes');
  });
  it('returns the existing empty-page contract for a combined search without results',async () => {
    expect(await journal('q=NoSuchContact&page=99')).toEqual({ items:[],page:1,limit:50,total:0,summary:{ missed:0,answered:0,talkSeconds:0 } });
    expect(await widget()).toEqual([]);
  });
  it('counts positive answer proof with zero rounded talk time and filters both sources by text/status',async () => {
    await reminderCall(1,1,'2026-10-17T10:00:00Z',0,true,'yes');await managerCall(1,1);
    const result=await journal('q=Own%20pupil&status=ended&direction=outgoing');
    expect(result.total).toBe(2);expect(result.summary).toEqual({ missed:0,answered:2,talkSeconds:10 });
    expect(result.items.find((call:{source:string}) => call.source==='voice_reminder').reminderResponse).toBe('yes');
  });
  it('does not add robots to incoming/missed/callback results or let a robot resolve a manual callback',async () => {
    await managerCall(1,1,null,'2026-10-17T10:00:00Z','incoming','missed',0,'+998901234567');
    await reminderCall(1,1);
    for (const status of ['missed','callback']) {
      const result=await journal(`status=${status}`);expect(result.total).toBe(1);expect(result.items[0].id).toBe(1);
      expect(result.summary.missed).toBe(1);
    }
    expect((await widget('filter=missed')).map((call:{id:number|string}) => call.id)).toEqual([1]);
    expect((await widget('filter=incoming')).map((call:{id:number|string}) => call.id)).toEqual([1]);
    expect((await request(app).get('/api/telephony/calls/missed/unread')).body.count).toBe(1);
    await managerCall(2,1,7,'2026-10-17T10:02:00Z','outgoing','ended',1,'+998901234567');
    expect((await journal('status=callback')).total).toBe(0);
    expect((await request(app).get('/api/telephony/calls/missed/unread')).body.count).toBe(0);
  });
  it('denies teacher access to both lists before the database query',async () => {
    mocks.viewer={ id:9,module:'teacher',modules:['teacher'] };mocks.query.mockClear();
    expect((await request(app).get('/api/telephony/calls')).status).toBe(403);
    expect((await request(app).get('/api/telephony/calls/journal')).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
