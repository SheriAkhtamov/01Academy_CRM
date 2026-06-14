import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const { Pool } = pg;
const configPath = path.resolve(process.cwd(), 'config', 'app.config.json');
const appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const databaseUrl = appConfig?.database?.url;

async function main() {
  if (!databaseUrl) {
    throw new Error(`Database URL is missing in ${configPath}`);
  }

  console.log('Applying migrations to database...');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: appConfig?.database?.ssl,
  });

  const db = drizzle(pool);

  try {
    await migrate(db, { migrationsFolder: './migrations' });
    console.log('Migrations applied successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
