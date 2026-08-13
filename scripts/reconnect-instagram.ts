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
  const history = Number.isInteger(connectedBy) && connectedBy > 0
    ? await importInstagramConversationHistory(connectedBy)
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
