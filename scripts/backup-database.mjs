import fs from 'fs/promises';
import path from 'path';
import pg from 'pg';

const configPath = path.resolve(process.cwd(), 'config', 'app.config.json');
const configRaw = await fs.readFile(configPath, 'utf8');
const appConfig = JSON.parse(configRaw.replace(/^\uFEFF/, ''));

if (!appConfig?.database?.url) {
  throw new Error(`database.url is missing in ${configPath}`);
}

const pool = new pg.Pool({
  connectionString: appConfig.database.url,
  ssl: appConfig.database.ssl,
});

const client = await pool.connect();

try {
  const { rows: tableRows } = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('session', '__drizzle_migrations')
    ORDER BY tablename
  `);

  const backup = {
    createdAt: new Date().toISOString(),
    source: '01 Academy CRM JSON backup',
    tables: {},
  };

  for (const { tablename } of tableRows) {
    const quoted = `"${tablename.replace(/"/g, '""')}"`;
    const { rows } = await client.query(`SELECT * FROM ${quoted}`);
    backup.tables[tablename] = rows;
  }

  await fs.mkdir('backups', { recursive: true });
  const file = path.join('backups', `academy-crm-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(file, JSON.stringify(backup, null, 2));
  console.log(file);
} finally {
  client.release();
  await pool.end();
}
