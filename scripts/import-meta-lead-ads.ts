import { pool } from '../server/db';
import {
  importHistoricalMetaLeadAds,
  importMetaLeadAdsByIds,
} from '../server/services/meta-lead-ads';

if (!process.argv.includes('--apply')) {
  throw new Error('Pass --apply to import historical Meta Instant Form leads into CRM');
}

try {
  const idsArgumentIndex = process.argv.indexOf('--ids');
  const leadgenIds = idsArgumentIndex >= 0
    ? String(process.argv[idsArgumentIndex + 1] ?? '').split(',').map((id) => id.trim()).filter(Boolean)
    : [];
  const result = idsArgumentIndex >= 0
    ? await importMetaLeadAdsByIds(leadgenIds)
    : await importHistoricalMetaLeadAds();
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
