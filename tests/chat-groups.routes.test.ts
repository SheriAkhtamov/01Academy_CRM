import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), detail: vi.fn(), rename: vi.fn(), addParticipants: vi.fn(),
  removeParticipant: vi.fn(), leave: vi.fn(), memberIds: vi.fn(), messages: vi.fn(), send: vi.fn(), markRead: vi.fn(), attachment: vi.fn(), publish: vi.fn(),
  actor: { id: 7, module: 'sales' } }));
vi.mock('../server/middleware/auth.middleware', () => ({ requireAuth: (req: any, _res: any, next: () => void) => { req.user=mocks.actor; next(); } }));
vi.mock('../server/realtime/realtime-hub', () => ({ publishRealtimeEvent: mocks.publish }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn() } }));
import { createChatGroupRouter } from '../server/routes/chat-groups.routes';
const app = express(); app.use(express.json()); app.use('/api/chat-groups', createChatGroupRouter(mocks));
beforeEach(() => {
  vi.resetAllMocks(); mocks.actor = { id: 7, module: 'sales' }; mocks.list.mockResolvedValue([]); mocks.memberIds.mockResolvedValue([7,8]);
  mocks.detail.mockResolvedValue({ id: 4, name: 'Teachers', createdBy: 7, participantCount: 2, unreadCount: 0, participants: [], canManage: true });
  mocks.rename.mockResolvedValue([7, 8]); mocks.addParticipants.mockResolvedValue([7, 8, 9]);
  mocks.removeParticipant.mockResolvedValue([7, 8]); mocks.leave.mockResolvedValue([7, 8]);
  mocks.create.mockResolvedValue({id:4,name:'Teachers',participantCount:2,unreadCount:0});
  mocks.messages.mockResolvedValue([]); mocks.send.mockResolvedValue({id:10,groupId:4,senderId:7,content:'Hello',attachments:[]}); mocks.markRead.mockResolvedValue(undefined);
});

describe('group membership management', () => {
  it('loads participants only for a member, using server-side management permissions', async () => {
    await request(app).get('/api/chat-groups/4').expect(200);
    expect(mocks.detail).toHaveBeenCalledWith(4, 7, false);
    mocks.memberIds.mockResolvedValue(null);
    await request(app).get('/api/chat-groups/4').expect(404);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
  });
  it('renames and adds participants with the authenticated actor', async () => {
    await request(app).patch('/api/chat-groups/4').send({ name: ' New name ' }).expect(200);
    expect(mocks.rename).toHaveBeenCalledWith(4, 7, false, 'New name');
    await request(app).post('/api/chat-groups/4/participants').send({ participantIds: [9] }).expect(200);
    expect(mocks.addParticipants).toHaveBeenCalledWith(4, 7, false, [9]);
    expect(mocks.publish).toHaveBeenLastCalledWith({ type: 'GROUP_CHAT_UPDATED', data: { groupId: 4 }, audienceUserIds: [7, 8, 9] });
  });
  it('derives CRM administration rights from the authenticated account', async () => {
    mocks.actor.module = 'administration';
    await request(app).patch('/api/chat-groups/4').send({ name: 'Managed' }).expect(200);
    expect(mocks.rename).toHaveBeenCalledWith(4, 7, true, 'Managed');
    mocks.memberIds.mockResolvedValue(null);
    await request(app).patch('/api/chat-groups/5').send({ name: 'Outside' }).expect(404);
    expect(mocks.rename).toHaveBeenCalledTimes(1);
  });
  it('announces removals and exits to previous members so their UI can revoke access', async () => {
    await request(app).delete('/api/chat-groups/4/participants/8').expect(200);
    expect(mocks.removeParticipant).toHaveBeenCalledWith(4, 7, false, 8);
    expect(mocks.publish).toHaveBeenLastCalledWith({ type: 'GROUP_CHAT_UPDATED', data: { groupId: 4 }, audienceUserIds: [7, 8] });
    await request(app).post('/api/chat-groups/4/leave').send({ nextOwnerId: 8 }).expect(200);
    expect(mocks.leave).toHaveBeenCalledWith(4, 7, 8);
  });
  it.each(['rename', 'addParticipants', 'removeParticipant'] as const)('returns a management rejection for %s', async (method) => {
    mocks[method].mockRejectedValue(Object.assign(new Error('chatGroupManagementDenied'), { statusCode: 403 }));
    const response = method === 'rename' ? await request(app).patch('/api/chat-groups/4').send({ name: 'Forged' })
      : method === 'addParticipants' ? await request(app).post('/api/chat-groups/4/participants').send({ participantIds: [9] })
        : await request(app).delete('/api/chat-groups/4/participants/8');
    expect(response.status).toBe(403); expect(response.body).toEqual({ error: 'chatGroupManagementDenied' });
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('does not expose unexpected server errors', async () => {
    mocks.rename.mockRejectedValue(Object.assign(new Error('SQL internal table detail'), { statusCode: 400 }));
    const response = await request(app).patch('/api/chat-groups/4').send({ name: 'New' });
    expect(response.status).toBe(500); expect(response.body).toEqual({ error: 'chatGroupUpdateFailed' });
  });
  it('rejects empty names, forged permissions, invalid member IDs and successor manipulation', async () => {
    await request(app).patch('/api/chat-groups/4').send({ name: '' }).expect(400);
    await request(app).patch('/api/chat-groups/4').send({ name: 'New', administrator: true }).expect(400);
    await request(app).post('/api/chat-groups/4/participants').send({ participantIds: [] }).expect(400);
    await request(app).delete('/api/chat-groups/4/participants/-1').expect(400);
    await request(app).post('/api/chat-groups/4/leave').send({ userId: 8 }).expect(400);
    expect(mocks.rename).not.toHaveBeenCalled(); expect(mocks.leave).not.toHaveBeenCalled();
  });
  it.each(['details', 'rename', 'add', 'remove', 'leave'])('blocks a guessed group for %s', async (operation) => {
    mocks.memberIds.mockResolvedValue(null);
    const response = operation === 'details' ? await request(app).get('/api/chat-groups/4')
      : operation === 'rename' ? await request(app).patch('/api/chat-groups/4').send({ name: 'Other' })
        : operation === 'add' ? await request(app).post('/api/chat-groups/4/participants').send({ participantIds: [9] })
          : operation === 'remove' ? await request(app).delete('/api/chat-groups/4/participants/8')
            : await request(app).post('/api/chat-groups/4/leave').send({});
    expect(response.status).toBe(404); expect(mocks.publish).not.toHaveBeenCalled();
  });
});
describe('staff group chat boundaries', () => {
  it('lists only the authenticated user groups', async () => {
    await request(app).get('/api/chat-groups').expect(200); expect(mocks.list).toHaveBeenCalledWith(7);
  });
  it('creates a group and announces it only to its members', async () => {
    const response=await request(app).post('/api/chat-groups').send({name:'Teachers',participantIds:[8]});
    expect(response.status).toBe(201); expect(mocks.create).toHaveBeenCalledWith(7,{name:'Teachers',participantIds:[8]});
    expect(mocks.publish).toHaveBeenCalledWith({type:'GROUP_CHAT_UPDATED',data:{groupId:4},audienceUserIds:[7,8]});
  });
  it.each(['messages','read'])('blocks a non-member from %s', async (path) => {
    mocks.memberIds.mockResolvedValue(null);
    const response=path==='read' ? await request(app).put(`/api/chat-groups/4/${path}`).send({messageId:10}) : await request(app).get(`/api/chat-groups/4/${path}`);
    expect(response.status).toBe(404); expect(mocks.messages).not.toHaveBeenCalled(); expect(mocks.markRead).not.toHaveBeenCalled();
  });
  it('blocks non-members from sending to a guessed group', async () => {
    mocks.memberIds.mockResolvedValue(null);
    await request(app).post('/api/chat-groups/4/messages').send({content:'Hello'}).expect(404);
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('uses the authenticated sender and rejects forged attachment metadata', async () => {
    await request(app).post('/api/chat-groups/4/messages').send({content:'Hello',senderId:99,attachments:[]}).expect(400);
    expect(mocks.send).not.toHaveBeenCalled();
    await request(app).post('/api/chat-groups/4/messages').send({content:'Hello'}).expect(201);
    expect(mocks.send).toHaveBeenCalledWith(4,7,'Hello',[]);
    expect(mocks.publish).toHaveBeenCalledWith({type:'GROUP_CHAT_UPDATED',data:{groupId:4},audienceUserIds:[7,8]});
  });
  it('marks only the requesting member read through their displayed message', async () => {
    await request(app).put('/api/chat-groups/4/read').send({messageId:10,userId:99}).expect(200);
    expect(mocks.markRead).toHaveBeenCalledWith(4,7,10);
    expect(mocks.publish).toHaveBeenCalledWith({type:'GROUP_CHAT_UPDATED',data:{groupId:4},audienceUserIds:[7]});
  });
  it('denies a private attachment to a non-member', async () => {
    mocks.attachment.mockResolvedValue(null);
    await request(app).get('/api/chat-groups/attachments/aaaaaaaaaaaaaaaaaaaaa').expect(404);
    expect(mocks.attachment).toHaveBeenCalledWith('aaaaaaaaaaaaaaaaaaaaa',7);
  });
  it.each([{name:'',participantIds:[8]}, {name:'Teachers',participantIds:[]}, {name:'Teachers',participantIds:[-1]}])('rejects an invalid group %j', async (input) => {
    await request(app).post('/api/chat-groups').send(input).expect(400); expect(mocks.create).not.toHaveBeenCalled();
  });
});
