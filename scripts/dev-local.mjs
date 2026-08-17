/*
  Starts the dev server against a Postgres running on this machine.

  The committed config addresses the database by its compose service name, so
  `npm run start` only works inside the container. This reads the credentials
  already in config/app.config.json, redirects just the host, and hands the
  result to the server through DATABASE_URL — the secrets file is never read
  aloud, never written to, and never has to be edited to work locally.
*/
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCAL_HOST = process.env.LOCAL_DB_HOST ?? '127.0.0.1';
const configPath = resolve(process.cwd(), 'config', 'app.config.json');

let databaseUrl;
try {
  const config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^﻿/, ''));
  const url = new URL(config.database.url);
  url.hostname = LOCAL_HOST;
  databaseUrl = url.toString();
  console.log(`dev-local: database ${url.protocol}//<credentials>@${url.host}${url.pathname}`);
} catch (error) {
  console.error(`dev-local: could not derive a local database URL from ${configPath}`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// 5000 is taken by AirPlay on macOS, so local dev gets its own port — and the
// allowed origin has to move with it or the browser is refused by CORS.
const port = process.env.PORT ?? '5050';

const child = spawn('npx', ['tsx', 'server/index.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: port,
    APP_URL: process.env.APP_URL ?? `http://localhost:${port}`,
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
