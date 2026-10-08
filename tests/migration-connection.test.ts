import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it.each([
  [' postgres://fixture:placeholder-password@override.test/test ', 'postgres://fixture:placeholder-password@override.test/test'],
  ['   ', 'postgres://fixture:placeholder-password@config.test/test'],
])('migration runner uses the same DATABASE_URL precedence as runtime: %s', (override, expected) => {
  const root = mkdtempSync(join(tmpdir(), 'academy-migration-connection-'));
  try {
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, 'node_modules', 'pg'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'drizzle-orm'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(root, 'config', 'app.config.json'), JSON.stringify({ database: {
      url: 'postgres://fixture:placeholder-password@config.test/test', ssl: { rejectUnauthorized: true },
    } }));
    writeFileSync(join(root, 'node_modules', 'pg', 'package.json'), '{"type":"module","exports":"./index.js"}');
    writeFileSync(join(root, 'node_modules', 'pg', 'index.js'), `export default {Pool: class {
      constructor(options) { this.options = options; }
      async end() { console.log('TEST_OPTIONS:' + JSON.stringify(this.options)); }
    }};`);
    writeFileSync(join(root, 'node_modules', 'drizzle-orm', 'package.json'), '{"type":"module","exports":{"./node-postgres":"./db.js","./node-postgres/migrator":"./migrator.js"}}');
    writeFileSync(join(root, 'node_modules', 'drizzle-orm', 'db.js'), 'export const drizzle = pool => pool;');
    writeFileSync(join(root, 'node_modules', 'drizzle-orm', 'migrator.js'), 'export const migrate = async () => {};');
    writeFileSync(join(root, 'apply-migrations.js'), readFileSync(resolve('apply-migrations.js'), 'utf8'));
    const output = execFileSync(process.execPath, ['apply-migrations.js'], {
      cwd: root, env: { ...process.env, DATABASE_URL: override }, encoding: 'utf8',
    });
    const options = JSON.parse(output.split('\n').find((line) => line.startsWith('TEST_OPTIONS:'))!.slice('TEST_OPTIONS:'.length));
    expect(options).toEqual({ connectionString: expected, ssl: { rejectUnauthorized: true } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
