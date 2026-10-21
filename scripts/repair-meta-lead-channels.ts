import { pool } from '../server/db';
import { repairMetaLeadChannels } from '../server/services/meta-lead-channel-repair';

try {
  console.log(JSON.stringify(await repairMetaLeadChannels(pool, process.argv.includes('--apply'))));
} finally {
  await pool.end();
}
