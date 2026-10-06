import { pool } from '../db';
import type { CreateChatGroupRequest, ChatGroupDto, GroupMessageDto } from '@shared/contracts/chat-groups';
import type { MessageAttachment } from '@shared/contracts/messages';

const messageColumns = `m.id, m.group_id AS "groupId", m.sender_id AS "senderId", u.full_name AS "senderName", m.content, m.attachments, m.created_at AS "createdAt"`;
export const chatGroupStorage = {
  async list(userId: number): Promise<ChatGroupDto[]> {
    const result = await pool.query(`SELECT g.id, g.name, g.created_by AS "createdBy",
      (SELECT COUNT(*)::int FROM chat_group_members members WHERE members.group_id=g.id) AS "participantCount",
      (SELECT COUNT(*)::int FROM chat_group_messages m WHERE m.group_id=g.id AND m.sender_id<>$1 AND m.id>own.last_read_message_id) AS "unreadCount"
      FROM chat_groups g JOIN chat_group_members own ON own.group_id=g.id AND own.user_id=$1
      ORDER BY COALESCE((SELECT MAX(created_at) FROM chat_group_messages m WHERE m.group_id=g.id), g.created_at) DESC, g.id DESC`, [userId]);
    return result.rows;
  },
  async memberIds(groupId: number, userId: number): Promise<number[] | null> {
    const result = await pool.query(`SELECT user_id FROM chat_group_members WHERE group_id=$1
      AND EXISTS (SELECT 1 FROM chat_group_members own WHERE own.group_id=$1 AND own.user_id=$2)`, [groupId, userId]);
    return result.rows.length ? result.rows.map((row) => Number(row.user_id)) : null;
  },
  async create(userId: number, input: CreateChatGroupRequest): Promise<ChatGroupDto> {
    const ids = [...new Set([userId, ...input.participantIds])].sort((a, b) => a-b);
    if (ids.length < 2) throw Object.assign(new Error('chatGroupParticipantsRequired'), { statusCode: 400 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const users = await client.query(`SELECT id FROM users WHERE id=ANY($1::int[]) AND is_active=true AND is_archived=false FOR SHARE`, [ids]);
      if (users.rows.length !== ids.length) throw Object.assign(new Error('chatGroupParticipantsUnavailable'), { statusCode: 400 });
      const group = await client.query(`INSERT INTO chat_groups (name, created_by) VALUES ($1,$2) RETURNING id, name, created_by AS "createdBy"`, [input.name, userId]);
      await client.query(`INSERT INTO chat_group_members (group_id,user_id) SELECT $1, unnest($2::int[])`, [group.rows[0].id, ids]);
      await client.query('COMMIT');
      return { ...group.rows[0], participantCount: ids.length, unreadCount: 0 };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  },
  async messages(groupId: number): Promise<GroupMessageDto[]> {
    const result = await pool.query(`SELECT ${messageColumns} FROM chat_group_messages m
      JOIN users u ON u.id=m.sender_id WHERE m.group_id=$1 ORDER BY m.id`, [groupId]);
    return result.rows;
  },
  async send(groupId: number, senderId: number, content: string, attachments: MessageAttachment[]): Promise<GroupMessageDto> {
    const result = await pool.query(`WITH m AS (
      INSERT INTO chat_group_messages (group_id,sender_id,content,attachments) VALUES ($1,$2,$3,$4::jsonb) RETURNING *
      ) SELECT ${messageColumns} FROM m JOIN users u ON u.id=m.sender_id`, [groupId,senderId,content,JSON.stringify(attachments)]);
    return result.rows[0];
  },
  async markRead(groupId: number, userId: number, messageId: number): Promise<void> {
    await pool.query(`UPDATE chat_group_members SET last_read_message_id=GREATEST(last_read_message_id,
      COALESCE((SELECT MAX(id) FROM chat_group_messages WHERE group_id=$1 AND id<=$3),0))
      WHERE group_id=$1 AND user_id=$2`, [groupId,userId,messageId]);
  },
  async attachment(fileId: string, userId: number): Promise<MessageAttachment | null> {
    const result = await pool.query(`SELECT file FROM chat_group_messages m
      JOIN chat_group_members own ON own.group_id=m.group_id AND own.user_id=$2
      CROSS JOIN LATERAL jsonb_array_elements(m.attachments) file WHERE file->>'id'=$1 LIMIT 1`, [fileId,userId]);
    return result.rows[0]?.file ?? null;
  },
};
