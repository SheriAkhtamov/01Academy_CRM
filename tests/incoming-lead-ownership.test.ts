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
    integrations: {},
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

  it('keeps ChatPlace, Google Forms, and website leads and tasks unassigned', async () => {
    const app = createApp();
    const responses = await Promise.all([
      request(app).post('/api/incoming/chatplace').send({
        contactName: 'Instagram lead',
        instagramUsername: 'instagram_client',
      }),
      request(app).post('/api/incoming/google-forms').send({
        contactName: 'Google Client',
        phone: '+998 90 111 22 33',
      }),
      request(app).post('/api/incoming/website-lead').send({
        contactName: 'Website Client',
        phone: '+998 90 444 55 66',
        telegramUsername: '@telegram_client',
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(responses.every((response) => response.body.managerId === null)).toBe(true);

    const leadInsertCalls = mocks.clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO academy_leads'));
    expect(leadInsertCalls).toHaveLength(3);
    for (const [sql] of leadInsertCalls) {
      expect(String(sql)).toMatch(/status_code, manager_id[\s\S]+VALUES[\s\S]+NULL/);
    }

    const taskInsertCalls = mocks.clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO academy_tasks'));
    expect(taskInsertCalls).toHaveLength(2);
    for (const [sql] of taskInsertCalls) {
      expect(String(sql)).toMatch(/responsible_id[\s\S]+VALUES[\s\S]+NULL/);
    }
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
