import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  poolQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../server/config', () => ({
  appConfig: {
    integrations: {
      website: {
        webhookSecret: 'test-webhook-secret',
        allowedFormOrigins: ['https://01academy.pro', 'https://www.01academy.pro'],
      },
    },
    server: { appUrl: 'http://localhost:5001' },
  },
  isDevelopmentEnvironment: false,
  isProductionEnvironment: false,
}));

vi.mock('../server/db', () => ({
  pool: {
    connect: vi.fn(async () => ({
      query: mocks.clientQuery,
      release: mocks.release,
    })),
    query: mocks.poolQuery,
  },
}));

vi.mock('../server/services/instagram', () => ({
  processInstagramWebhook: vi.fn(),
  verifyInstagramWebhookChallenge: vi.fn(),
  verifyInstagramWebhookSignature: vi.fn(),
}));

import incomingRoutes from '../server/routes/incoming.routes';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('external lead ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    mocks.clientQuery.mockImplementation(async (sqlValue: unknown, params: unknown[] = []) => {
      const sql = String(sqlValue);
      if (sql.includes('SELECT u.id FROM users')) return { rows: [{ id: 1 }] };
      if (sql.includes("SELECT 'lead' AS entity_type")) return { rows: [] };
      if (sql.includes('INSERT INTO academy_lead_sources')) return { rows: [{ id: 5 }] };
      if (sql.includes('INSERT INTO academy_leads')) {
        return {
          rows: [{
            id: 77,
            contact_name: params[0],
            phone: params[1] ?? null,
            messenger: params[2] ?? null,
            manager_id: null,
          }],
        };
      }
      return { rows: [] };
    });
  });

  const createApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/incoming', incomingRoutes);
    return app;
  };

  it('keeps direct website leads unassigned', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/incoming/website-lead')
      .set('x-webhook-secret', 'test-webhook-secret')
      .send({
        contactName: 'Website Client',
        phone: '+998 90 444 55 66',
      });

    expect(response.status).toBe(201);
    expect(response.body.managerId).toBeNull();

    const leadInsertCalls = mocks.clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO academy_leads'));
    expect(leadInsertCalls).toHaveLength(1);
    for (const [sql] of leadInsertCalls) {
      expect(String(sql)).toMatch(/status_code, manager_id[\s\S]+VALUES[\s\S]+NULL/);
    }

    expect(mocks.clientQuery.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO academy_tasks'))).toBe(false);
  });

  it('rejects unsigned lead webhooks', async () => {
    const response = await request(createApp())
      .post('/api/incoming/website-lead')
      .send({ contactName: 'Unsigned lead' });

    expect(response.status).toBe(401);
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it('accepts the configured public form origin and stores a Telegram contact', async () => {
    const response = await request(createApp())
      .post('/api/incoming/website-lead')
      .set('origin', 'https://01academy.pro')
      .send({
        name: 'Telegram Client',
        company: 'Acme',
        contact: 'https://t.me/acme_client',
        team: '10–20 человек',
        sourceLabel: '01academy.pro',
        page: 'https://01academy.pro/#cta',
      });

    expect(response.status).toBe(201);
    expect(response.body.phone).toBeNull();
    expect(response.body.messenger).toBe('@acme_client');

    const leadInsertCall = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO academy_leads'));
    expect(leadInsertCall).toBeDefined();
    expect(leadInsertCall?.[1]).toEqual([
      'Telegram Client',
      null,
      '@acme_client',
      5,
      '01academy.pro',
      'ru',
      [
        'Компания: Acme',
        'Отдел / размер группы: 10–20 человек',
        'Страница заявки: https://01academy.pro/#cta',
      ].join('\n'),
      1,
    ]);
  });

  it('does not let an unconfigured browser origin bypass the webhook secret', async () => {
    const response = await request(createApp())
      .post('/api/incoming/website-lead')
      .set('origin', 'https://attacker.example')
      .send({ name: 'Attacker', contact: '+998901112233' });

    expect(response.status).toBe(401);
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it('silently accepts a filled honeypot without creating a lead', async () => {
    const response = await request(createApp())
      .post('/api/incoming/website-lead')
      .set('origin', 'https://01academy.pro')
      .send({
        name: 'Bot',
        contact: '+998901112233',
        website: 'spam.example',
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ ok: true });
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it('keeps native Meta Instagram leads and tasks unassigned', () => {
    const incomingSource = fs.readFileSync(
      path.join(repositoryRoot, 'server/routes/incoming.routes.ts'),
      'utf8',
    );
    const instagramSource = fs.readFileSync(
      path.join(repositoryRoot, 'server/services/instagram.ts'),
      'utf8',
    );

    expect(incomingSource).not.toContain('getLeadAssigneeId');
    expect(instagramSource).not.toContain('getLeadAssigneeId');
    expect(instagramSource).toContain("VALUES ($1,NULL,$2,$3,'new_request',NULL,'ru',$4,$5)");
    expect(instagramSource).toMatch(
      /INSERT INTO academy_tasks[\s\S]+?'Ответить на новый диалог Instagram[^`]+?NULL/,
    );
  });
});
