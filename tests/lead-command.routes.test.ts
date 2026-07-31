import express, { type Router } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadAssignmentService } from '../server/modules/leads/application/assignment-service';
import type { LeadLifecycleService } from '../server/modules/leads/application/lifecycle-service';
import type { LeadRelationsService } from '../server/modules/leads/application/relations-service';
import { createLeadAssignmentRouter } from '../server/modules/leads/http/assignment.router';
import { createLeadLifecycleRouter } from '../server/modules/leads/http/lifecycle.router';
import { createLeadRelationsRouter } from '../server/modules/leads/http/relations.router';

const actor = {
  id: 7,
  fullName: 'Sales Manager',
  module: 'sales',
  modules: ['sales'],
  hasReportAccess: false,
};

const createApp = (router: Router) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = actor as typeof req.user;
    next();
  });
  app.use('/api/academy', router);
  return app;
};

describe('lead command HTTP contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates and delegates lead assignment', async () => {
    const service = { assign: vi.fn().mockResolvedValue({ id: 12, managerId: 7 }) };
    const app = createApp(createLeadAssignmentRouter(
      service as unknown as LeadAssignmentService,
    ));

    const response = await request(app)
      .post('/api/academy/leads/12/assign')
      .send({ managerId: '7', comment: '  mine  ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 12, managerId: 7 });
    expect(service.assign).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, displayName: 'Sales Manager' }),
      12,
      7,
      'mine',
    );
  });

  it('keeps legacy assignment validation errors', async () => {
    const service = { assign: vi.fn() };
    const response = await request(createApp(createLeadAssignmentRouter(
      service as unknown as LeadAssignmentService,
    )))
      .post('/api/academy/leads/not-an-id/assign')
      .send({ managerId: 7 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid lead id' });
    expect(service.assign).not.toHaveBeenCalled();
  });

  it('returns 201 only for a newly-created manual tag', async () => {
    const service = {
      addTag: vi.fn().mockResolvedValue({
        automatic: false,
        created: true,
        tag: { id: 3, tagId: 4, name: 'Camp' },
      }),
      removeTag: vi.fn(),
      addComment: vi.fn(),
    };
    const response = await request(createApp(createLeadRelationsRouter(
      service as unknown as LeadRelationsService,
    )))
      .post('/api/academy/leads/12/tags')
      .send({ name: '  Camp  ' });

    expect(response.status).toBe(201);
    expect(service.addTag).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
      12,
      { name: 'Camp' },
    );
  });

  it('trims comment input and preserves the created response', async () => {
    const comment = { id: 8, leadId: 12, body: 'Called parent' };
    const service = {
      addTag: vi.fn(),
      removeTag: vi.fn(),
      addComment: vi.fn().mockResolvedValue(comment),
    };
    const response = await request(createApp(createLeadRelationsRouter(
      service as unknown as LeadRelationsService,
    )))
      .post('/api/academy/leads/12/comments')
      .send({ body: '  Called parent  ' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(comment);
    expect(service.addComment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
      12,
      'Called parent',
    );
  });

  it('maps persistence foreign-key conflicts during confirmed deletion', async () => {
    const service = {
      delete: vi.fn().mockRejectedValue(Object.assign(new Error('constraint'), { code: '23503' })),
    };
    const response = await request(createApp(createLeadLifecycleRouter(
      service as unknown as LeadLifecycleService,
    )))
      .delete('/api/academy/leads/12');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'resourceInUse' });
  });
});
