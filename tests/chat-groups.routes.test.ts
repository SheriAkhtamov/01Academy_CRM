import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), memberIds: vi.fn(), messages: vi.fn(), send: vi.fn(), markRead: vi.fn(), attachment: vi.fn(), publish: vi.fn() }));
vi.mock('../server/middleware/auth.middleware', () => ({ requireAuth: (req: any, _res: any, next: () => void) => { req.user={id:7}; next(); } }));
vi.mock('../server/realtime/realtime-hub', () => ({ publishRealtimeEvent: mocks.publish }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn() } }));
import { createChatGroupRouter } from '../server/routes/chat-groups.routes';
const app = express(); app.use(express.json()); app.use('/api/chat-groups', createChatGroupRouter(mocks));
beforeEach(() => {
  vi.clearAllMocks(); mocks.list.mockResolvedValue([]); mocks.memberIds.mockResolvedValue([7,8]);
  mocks.create.mockResolvedValue({id:4,name:'Teachers',participantCount:2,unreadCount:0});
  mocks.messages.mockResolvedValue([]); mocks.send.mockResolvedValue({id:10,groupId:4,senderId:7,content:'Hello',attachments:[]}); mocks.markRead.mockResolvedValue(undefined);
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
