import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(() => ({query:vi.fn(),clientQuery:vi.fn(),release:vi.fn()}));
vi.mock('../server/db', () => ({pool:{query:mocks.query,connect:async()=>({query:mocks.clientQuery,release:mocks.release})}}));
import { chatGroupStorage } from '../server/storage/chat-group.storage';
beforeEach(()=>{vi.clearAllMocks();mocks.clientQuery.mockResolvedValue({rows:[]});});
describe('group chat creation and read cursors',()=>{
  it('includes the creator once, deduplicates participants and saves membership atomically',async()=>{
    mocks.clientQuery.mockImplementation(async(sql:string)=>sql.includes('SELECT id FROM users')?{rows:[{id:7},{id:8}]}:sql.includes('INSERT INTO chat_groups')?{rows:[{id:4,name:'Teachers',createdBy:7}]}:{rows:[]});
    const group=await chatGroupStorage.create(7,{name:'Teachers',participantIds:[8,7,8]});
    expect(group.participantCount).toBe(2);
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO chat_group_members'),[4,[7,8]]);
    expect(mocks.clientQuery).toHaveBeenCalledWith('COMMIT'); expect(mocks.release).toHaveBeenCalled();
  });
  it('rolls back creation when a participant is archived or inactive',async()=>{
    mocks.clientQuery.mockImplementation(async(sql:string)=>sql.includes('SELECT id FROM users')?{rows:[{id:7}]}:{rows:[]});
    await expect(chatGroupStorage.create(7,{name:'Teachers',participantIds:[8]})).rejects.toThrow('chatGroupParticipantsUnavailable');
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql])=>sql.includes('INSERT INTO'))).toBe(false);
  });
  it('requires a colleague as well as the creator',async()=>{
    await expect(chatGroupStorage.create(7,{name:'Teachers',participantIds:[7]})).rejects.toThrow('chatGroupParticipantsRequired');
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });
});

it('retains messages and unread counts after their sender is deleted', async () => {
  const message = { id: 12, groupId: 4, senderId: null, senderName: 'Former teacher', content: 'Lesson notes', attachments: [] };
  mocks.query.mockResolvedValue({ rows: [message] });
  expect(await chatGroupStorage.messages(4)).toEqual([message]);
  const messageSql = mocks.query.mock.calls.at(-1)![0];
  expect(messageSql).toContain('LEFT JOIN users');
  expect(messageSql).toContain('COALESCE(u.full_name, m.sender_name)');
  await chatGroupStorage.list(7);
  expect(mocks.query.mock.calls.at(-1)![0]).toContain('m.sender_id IS DISTINCT FROM $1');
});
it('captures the sender name when saving a message', async () => {
  mocks.query.mockResolvedValue({ rows: [{ id: 12, senderId: 7, senderName: 'Teacher' }] });
  await chatGroupStorage.send(4, 7, 'Hello', []);
  expect(mocks.query.mock.calls.at(-1)![0]).toContain('sender_name');
  expect(mocks.query.mock.calls.at(-1)![0]).toContain('SELECT $1, id, full_name');
});
