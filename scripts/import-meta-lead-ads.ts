import { pool } from '../server/db';
import { importHistoricalMetaLeadAds } from '../server/services/meta-lead-ads';

if (!process.argv.includes('--apply')) {
  throw new Error('Pass --apply to import historical Meta Instant Form leads into CRM');
}

try {
  const result = await importHistoricalMetaLeadAds();
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
