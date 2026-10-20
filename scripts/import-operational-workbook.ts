import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { executeOperationalImport } from './lib/operational-import';

const [inputPath, mode = '--dry-run'] = process.argv.slice(2);
if (!inputPath || !['--dry-run', '--apply'].includes(mode)) {
  throw new Error('Usage: tsx scripts/import-operational-workbook.ts <reviewed-plan.json> [--dry-run|--apply]');
}
const config = JSON.parse((await fs.readFile(
  path.resolve('config/app.config.json'), 'utf8',
)).replace(/^\uFEFF/, ''));
const pool = new pg.Pool({
  connectionString: config.database.url,
  ssl: config.database.ssl,
});
try {
  const plan = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
  const result = await executeOperationalImport(pool, plan, { apply: mode === '--apply' });
  // A compact report contains database references and counts, never contact
  // details, payment comments, configuration, or raw source values.
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
