import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/config', () => ({
  appConfig: {
    server: {
      appUrl: 'https://crm.01academy.uz',
      environment: 'production',
    },
    integrations: {
      website: {
        allowedFormOrigins: ['https://01academy.pro', 'https://www.01academy.pro'],
      },
      onlinePbx: {
        apiUrl: 'https://api2.onlinepbx.ru/api/path-is-not-a-csp-source',
      },
    },
  },
  isDevelopmentEnvironment: false,
  isProductionEnvironment: true,
}));

import {
  browserMutationProtectionMiddleware,
  corsMiddleware,
  securityHeadersMiddleware,
} from '../server/middleware/security.middleware';

const createApp = () => {
  const app = express();
  app.use(securityHeadersMiddleware);
  app.use(corsMiddleware);
  app.use(browserMutationProtectionMiddleware);
  app.all('/api/test', (_req, res) => res.json({ ok: true }));
  app.post('/api/incoming/test', (_req, res) => res.json({ ok: true }));
  app.post('/api/incoming/website-lead', (_req, res) => res.json({ ok: true }));
  return app;
};

describe('HTTP security middleware', () => {
  it('sets browser hardening headers and allows the configured origin', async () => {
    const response = await request(createApp())
      .get('/api/test')
      .set('origin', 'https://crm.01academy.uz');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://crm.01academy.uz');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(response.headers['content-security-policy']).not.toContain("'unsafe-eval'");
    expect(response.headers['content-security-policy']).toContain(
      "media-src 'self' data: blob:",
    );
    expect(response.headers['content-security-policy']).not.toContain(
      'https://api2.onlinepbx.ru',
    );
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects cross-origin preflight and mutation requests', async () => {
    const app = createApp();
    const preflight = await request(app)
      .options('/api/test')
      .set('origin', 'https://attacker.example');
    const mutation = await request(app)
      .post('/api/test')
      .set('origin', 'https://attacker.example');

    expect(preflight.status).toBe(403);
    expect(mutation.status).toBe(403);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('requires an explicit same-origin signal when Origin is absent', async () => {
    const app = createApp();
    const blocked = await request(app).post('/api/test');
    const allowed = await request(app)
      .post('/api/test')
      .set('x-requested-with', 'XMLHttpRequest');

    expect(blocked.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it('leaves authenticated-provider webhook paths to their signature checks', async () => {
    const response = await request(createApp()).post('/api/incoming/test');
    expect(response.status).toBe(200);
  });

  it('allows the landing origin only for the website lead form endpoint', async () => {
    const app = createApp();
    const preflight = await request(app)
      .options('/api/incoming/website-lead')
      .set('origin', 'https://01academy.pro');
    const formPost = await request(app)
      .post('/api/incoming/website-lead')
      .set('origin', 'https://01academy.pro');
    const unrelatedApiRequest = await request(app)
      .get('/api/test')
      .set('origin', 'https://01academy.pro');

    expect(preflight.status).toBe(204);
    expect(formPost.status).toBe(200);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://01academy.pro');
    expect(formPost.headers['access-control-allow-origin']).toBe('https://01academy.pro');
    expect(unrelatedApiRequest.status).toBe(403);
    expect(unrelatedApiRequest.headers['access-control-allow-origin']).toBeUndefined();
  });
});
