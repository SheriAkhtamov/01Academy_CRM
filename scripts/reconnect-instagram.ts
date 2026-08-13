import { pool } from '../server/db';
import { importInstagramConversationHistory } from '../server/services/instagram';
import { reconnectInstagramAccountWithAccessToken } from '../server/services/instagram-reconnect';

if (!process.argv.includes('--apply')) {
  throw new Error('Pass --apply to reconnect the Instagram account');
}

const accessToken = process.env.INSTAGRAM_RECONNECT_TOKEN?.trim() ?? '';
if (!accessToken) {
  throw new Error('INSTAGRAM_RECONNECT_TOKEN is not configured');
}

try {
  const account = await reconnectInstagramAccountWithAccessToken(accessToken);
  const connectedBy = Number(account.connectedBy);
  const requestedBy = Number.isInteger(connectedBy) && connectedBy > 0
    ? connectedBy
    : Number((await pool.query(
      `SELECT u.id
       FROM users u
       WHERE u.is_active = true
         AND (
           u.module = 'administration'
           OR EXISTS (
             SELECT 1 FROM user_modules module_access
             WHERE module_access.user_id = u.id AND module_access.module = 'administration'
           )
         )
       ORDER BY u.id
       LIMIT 1`,
    )).rows[0]?.id);
  const history = Number.isInteger(requestedBy) && requestedBy > 0
    ? await importInstagramConversationHistory(requestedBy)
    : null;
  console.log(JSON.stringify({
    account: {
      id: account.id,
      igUserId: account.igUserId,
      username: account.username,
      status: account.status,
    },
    webhookSubscribed: true,
    history,
  }));
} finally {
  await pool.end();
}
