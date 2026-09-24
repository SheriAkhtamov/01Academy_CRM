import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { serveStatic } from '../server/vite';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('production static files', () => {
  it('does not return the SPA document for an unavailable JavaScript bundle', async () => {
    const distPath = mkdtempSync(path.join(tmpdir(), 'crm-static-'));
    tempDirs.push(distPath);
    mkdirSync(path.join(distPath, 'assets'));
    writeFileSync(path.join(distPath, 'index.html'), '<html>CRM</html>');
    writeFileSync(path.join(distPath, 'assets', 'current.js'), 'export default 1;');

    const app = express();
    serveStatic(app, distPath);

    const currentAsset = await request(app).get('/assets/current.js');
    expect(currentAsset.status).toBe(200);

    const missingAsset = await request(app).get('/assets/previous.js');
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.text).not.toContain('CRM');

    const page = await request(app).get('/sales/pipeline');
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.text).toContain('CRM');

    const root = await request(app).get('/');
    expect(root.headers['cache-control']).toBe('no-cache');
  });
});
