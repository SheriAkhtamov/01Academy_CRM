import type { PoolClient } from 'pg';
import { pool } from '../db';
import type { ChatGroupDetailsDto } from '@shared/contracts/chat-groups';

const fail = (message: string, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
type LockedGroup = { id: number; createdBy: number | null };

async function mutateMembership(groupId: number, userId: number, administrator: boolean, management: boolean,
  change: (client: PoolClient, group: LockedGroup, memberIds: number[]) => Promise<void>): Promise<number[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const group = (await client.query<LockedGroup>(
      'SELECT id, created_by AS "createdBy" FROM chat_groups WHERE id=$1 FOR UPDATE', [groupId])).rows[0];
    const before = (await client.query<{ user_id: number }>(
      'SELECT user_id FROM chat_group_members WHERE group_id=$1 ORDER BY user_id', [groupId])).rows.map((row) => row.user_id);
    if (!group || !before.includes(userId)) fail('resourceNotFound', 404);
    if (management && group.createdBy !== userId && !administrator) fail('chatGroupManagementDenied', 403);
    await change(client, group, before);
    const after = (await client.query<{ user_id: number }>(
      'SELECT user_id FROM chat_group_members WHERE group_id=$1 ORDER BY user_id', [groupId])).rows.map((row) => row.user_id);
    await client.query('COMMIT');
    return [...new Set([...before, ...after])];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export const chatGroupManagementStorage = {
  async detail(groupId: number, userId: number, administrator: boolean): Promise<ChatGroupDetailsDto | null> {
    const result = await pool.query(`SELECT g.id, g.name, g.created_by AS "createdBy",
      (SELECT COUNT(*)::int FROM chat_group_members WHERE group_id=g.id) AS "participantCount",
      (SELECT COUNT(*)::int FROM chat_group_messages m WHERE m.group_id=g.id
        AND m.sender_id IS DISTINCT FROM $2 AND m.id>own.last_read_message_id) AS "unreadCount",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', u.id, 'fullName', u.full_name,
        'avatarUrl', u.avatar_url, 'position', u.position, 'isActive', u.is_active, 'isArchived', u.is_archived)
        ORDER BY u.full_name, u.id), '[]'::jsonb) FROM chat_group_members members JOIN users u ON u.id=members.user_id
        WHERE members.group_id=g.id) AS participants
      FROM chat_groups g JOIN chat_group_members own ON own.group_id=g.id AND own.user_id=$2
      WHERE g.id=$1`, [groupId, userId]);
    const group = result.rows[0];
    return group ? { ...group, canManage: group.createdBy === userId || administrator } : null;
  },

  rename(groupId: number, userId: number, administrator: boolean, name: string) {
    return mutateMembership(groupId, userId, administrator, true, async (client) => {
      await client.query('UPDATE chat_groups SET name=$2 WHERE id=$1', [groupId, name]);
    });
  },

  addParticipants(groupId: number, userId: number, administrator: boolean, participantIds: number[]) {
    return mutateMembership(groupId, userId, administrator, true, async (client, _group, members) => {
      const ids = [...new Set(participantIds)].filter((id) => !members.includes(id)).sort((a, b) => a - b);
      if (members.length + ids.length > 100) fail('chatGroupParticipantsLimit');
      if (!ids.length) return;
      const available = await client.query('SELECT id FROM users WHERE id=ANY($1::int[]) AND is_active=true AND is_archived=false FOR SHARE', [ids]);
      if (available.rows.length !== ids.length) fail('chatGroupParticipantsUnavailable');
      await client.query(`INSERT INTO chat_group_members(group_id,user_id,last_read_message_id)
        SELECT $1, unnest($2::int[]), COALESCE((SELECT MAX(id) FROM chat_group_messages WHERE group_id=$1),0)`, [groupId, ids]);
    });
  },

  removeParticipant(groupId: number, userId: number, administrator: boolean, participantId: number) {
    return mutateMembership(groupId, userId, administrator, true, async (client, group, members) => {
      if (participantId === group.createdBy) fail('chatGroupOwnerProtected');
      if (participantId === userId) fail('invalidData');
      if (!members.includes(participantId)) fail('chatGroupMemberMissing', 404);
      await client.query('DELETE FROM chat_group_members WHERE group_id=$1 AND user_id=$2', [groupId, participantId]);
    });
  },

  leave(groupId: number, userId: number, nextOwnerId?: number) {
    return mutateMembership(groupId, userId, false, false, async (client, group, members) => {
      if (group.createdBy === userId) {
        const remaining = members.filter((id) => id !== userId);
        if (remaining.length) {
          if (!nextOwnerId) fail('chatGroupNextOwnerRequired');
          if (!remaining.includes(nextOwnerId!)) fail('chatGroupNextOwnerUnavailable');
          const nextOwner = (await client.query<{ full_name: string }>(
            'SELECT full_name FROM users WHERE id=$1 AND is_active=true AND is_archived=false FOR SHARE', [nextOwnerId])).rows[0];
          if (!nextOwner) fail('chatGroupNextOwnerUnavailable');
          await client.query('UPDATE chat_groups SET created_by=$2, creator_name=$3 WHERE id=$1', [groupId, nextOwnerId, nextOwner.full_name]);
        } else {
          if (nextOwnerId) fail('chatGroupNextOwnerUnavailable');
          await client.query('UPDATE chat_groups SET created_by=NULL WHERE id=$1', [groupId]);
        }
      } else if (nextOwnerId) fail('invalidData');
      await client.query('DELETE FROM chat_group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
    });
  },
};
