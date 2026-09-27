import { pool } from '../db';
import {
  instagramConversationOwnershipFilter,
  type InstagramUser,
} from './instagram';

export const countUnreadInstagramMessages = async (user: InstagramUser): Promise<number> => {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(
       CASE WHEN conversation_read.user_id IS NULL THEN c.unread_count
       ELSE (
         SELECT COUNT(*)
         FROM instagram_messages unread_message
         WHERE unread_message.conversation_id = c.id
           AND unread_message.direction = 'inbound'
           AND unread_message.id > COALESCE(conversation_read.last_read_message_id, 0)
       ) END
     ), 0)::int AS count
     FROM instagram_conversations c
     JOIN instagram_accounts a ON a.id = c.account_id
     LEFT JOIN academy_leads l ON l.id = c.lead_id
     LEFT JOIN instagram_conversation_reads conversation_read
       ON conversation_read.conversation_id = c.id
      AND conversation_read.user_id = $1
     WHERE a.status = 'connected' ${instagramConversationOwnershipFilter(user)}`,
    [user.id],
  );
  return Number(rows[0]?.count) || 0;
};
