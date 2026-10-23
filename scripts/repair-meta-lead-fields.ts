import { pool } from '../server/db';
import { repairMetaLeadFields } from '../server/services/meta-lead-field-repair';

try {
  const ids = process.argv.find(arg => arg.startsWith('--lead-ids='))?.slice('--lead-ids='.length);
  if (!ids || !/^\d+(?:,\d+)*$/.test(ids)) throw new Error('Usage: repair-meta-lead-fields --lead-ids=3536[,other-id] [--apply]');
  console.log(JSON.stringify(await repairMetaLeadFields(pool, ids.split(',').map(Number), process.argv.includes('--apply'))));
} finally {
  await pool.end();
}
