import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { importLeadRecords, type LeadImportRecord } from '../server/services/lead-import';

const { Pool } = pg;
const inputPath = process.argv[2];
const provider = process.argv[3] ?? 'meta_lead_ads';
if (!inputPath) {
  throw new Error('Usage: tsx scripts/import-leads-json.ts <payload.json> [provider]');
}

const configPath = path.resolve(process.cwd(), 'config', 'app.config.json');
const appConfig = JSON.parse((await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
if (!appConfig?.database?.url) throw new Error('Database URL is not configured');

const parsed = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
const records = (Array.isArray(parsed) ? parsed : parsed.records) as LeadImportRecord[];
const pool = new Pool({
  connectionString: appConfig.database.url,
  ssl: appConfig.database.ssl,
});

try {
  const summary = await importLeadRecords(pool, records, {
    provider,
    providerLabel: 'Meta Lead Ads · июль 2026',
    sourceCode: 'meta_lead_ads',
    sourceName: 'Meta Lead Ads',
  });
  console.log(JSON.stringify(summary));
} finally {
  await pool.end();
}
