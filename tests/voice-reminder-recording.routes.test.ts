import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(() => ({ query:vi.fn(),getCallHistory:vi.fn(),getCallRecordingUrl:vi.fn(),save:vi.fn(),resolve:vi.fn(),
  actor:{ id:7,module:'sales',modules:['sales'] } as { id:number;module:string;modules:string[] } | null }));
vi.mock('../server/db',() => ({ pool:{ query:mocks.query,connect:vi.fn() } }));
vi.mock('../server/services/onlinepbx',async original => ({ ...await original<typeof import('../server/services/onlinepbx')>(),
  onlinePbxClient:{ getCallHistory:mocks.getCallHistory,getCallRecordingUrl:mocks.getCallRecordingUrl } }));
vi.mock('../server/services/voice-reminder-recording-archive',() => ({ LocalVoiceReminderRecordingArchive:class {
  save=mocks.save; resolve=mocks.resolve;
} }));
vi.mock('../server/middleware/auth.middleware',() => ({ requireAuth:((req,res,next) => {
  if (!mocks.actor) return res.status(401).json({ error:'Unauthorized' });
  req.user=mocks.actor as never; next();
}) satisfies RequestHandler }));
import reminderRoutes from '../server/routes/voice-reminder-recording.routes';

const callId=randomUUID();
const at=new Date('2026-10-17T10:00:00Z');
const row={ callId,leadId:42,phone:'+998901234567',extension:'100',providerId:null,startedAt:at,
  status:'ended',answeredAt:at,endedAt:new Date(at.getTime()+40_000),talkSeconds:20,recordingUrl:null,
  recordingProviderId:null,recordingStorageKey:null,recordingMimeType:null };
const app=express(); app.use('/api/telephony',reminderRoutes);
const directories:string[]=[];
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor={ id:7,module:'sales',modules:['sales'] };
  mocks.query.mockResolvedValue({ rows:[],rowCount:0 });
  mocks.getCallHistory.mockResolvedValue([]);
  mocks.getCallRecordingUrl.mockResolvedValue(null);
});
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory,{ recursive:true,force:true }); });

describe('private reminder call recordings',() => {
  it.each(['recording','recording/media'])('denies hidden lead access before any provider or disk access through %s',async endpoint => {
    const result=await request(app).get(`/api/telephony/reminder-calls/${callId}/${endpoint}`);
    expect(result.status).toBe(404);
    expect(mocks.getCallHistory).not.toHaveBeenCalled();
    expect(mocks.getCallRecordingUrl).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[0][0]).toContain('lead.manager_id = $2');
    expect(mocks.query.mock.calls[0][0]).toContain('assignment.funnel_id = lead.funnel_id');
    expect(mocks.query.mock.calls[0][1]).toEqual([callId,7]);
  });

  it('rejects unauthenticated, teacher and malformed UUID requests without reading private calls',async () => {
    mocks.actor=null;
    expect((await request(app).get(`/api/telephony/reminder-calls/${callId}/recording`)).status).toBe(401);
    mocks.actor={ id:3,module:'teacher',modules:['teacher'] };
    expect((await request(app).get(`/api/telephony/reminder-calls/${callId}/recording`)).status).toBe(403);
    mocks.actor={ id:7,module:'sales',modules:['sales'] };
    expect((await request(app).get('/api/telephony/reminder-calls/../../private/recording')).status).toBe(404);
    expect((await request(app).get('/api/telephony/reminder-calls/not-a-uuid/recording')).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('returns only an authenticated media reference for a leadership-visible archived call',async () => {
    mocks.actor={ id:1,module:'administration',modules:['administration'] };
    mocks.query.mockResolvedValue({ rows:[{ ...row,recordingStorageKey:`${callId}.mp3`,recordingMimeType:'audio/mpeg' }],rowCount:1 });
    const result=await request(app).get(`/api/telephony/reminder-calls/${callId}/recording`);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ url:`/api/telephony/reminder-calls/${callId}/recording/media` });
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(mocks.query.mock.calls[0][0]).toContain('AND TRUE');
    expect(mocks.query.mock.calls[0][1]).toEqual([callId]);
    expect(mocks.getCallHistory).not.toHaveBeenCalled();
  });

  it('streams the private archived file with range support after current lead authorization',async () => {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'reminder-private-media-')); directories.push(directory);
    const file=path.join(directory,'call.mp3'); await fs.writeFile(file,Buffer.from('0123456789'));
    mocks.resolve.mockResolvedValue(file);
    mocks.query.mockResolvedValue({ rows:[{ ...row,recordingStorageKey:`${callId}.mp3`,recordingMimeType:'audio/mpeg' }],rowCount:1 });
    const result=await request(app).get(`/api/telephony/reminder-calls/${callId}/recording/media`).set('Range','bytes=2-5');
    expect(result.status).toBe(206);
    expect(result.headers['content-range']).toBe('bytes 2-5/10');
    expect(result.headers['content-type']).toBe('audio/mpeg');
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(mocks.resolve).toHaveBeenCalledWith(`${callId}.mp3`);
    expect(mocks.getCallHistory).not.toHaveBeenCalled();
  });

  it('rechecks visibility after exact provider hydration and does not expose audio after reassignment',async () => {
    let authorizedReads=0;
    mocks.query.mockImplementation(async (sql:string) => {
      if (sql.includes('JOIN academy_leads lead')) return { rows:++authorizedReads===1 ? [row] : [],rowCount:authorizedReads===1 ? 1 : 0 };
      if (sql.startsWith('SELECT')) return { rows:[row],rowCount:1 };
      return { rows:[],rowCount:1 };
    });
    const result=await request(app).get(`/api/telephony/reminder-calls/${callId}/recording`);
    expect(mocks.getCallHistory).toHaveBeenCalledWith({ uuid:callId });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error:'onlinePbxCallNotFound' });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it.each([
    { provider:null,answer:null,error:'onlinePbxRecordingPending' },
    { provider:callId,answer:null,error:'onlinePbxRecordingUnavailable' },
    { provider:callId,answer:at,error:'onlinePbxRecordingPending' },
  ])('distinguishes a delayed CDR from a proven unanswered call ($error/$answer)',async value => {
    mocks.query.mockResolvedValue({ rows:[{ ...row,talkSeconds:0,answeredAt:value.answer,recordingProviderId:value.provider }],rowCount:1 });
    const result=await request(app).get(`/api/telephony/reminder-calls/${callId}/recording`);
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error:value.error });
  });
});
