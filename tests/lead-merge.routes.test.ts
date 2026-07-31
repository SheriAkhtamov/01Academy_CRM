import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadMergeService } from '../server/modules/leads/application/merge-service';
import { createLeadMergeRouter } from '../server/modules/leads/http/merge.router';

const service = {
  search: vi.fn(),
  preview: vi.fn(),
  merge: vi.fn(),
  mergeDraft: vi.fn(),
};

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: 7,
      module: 'administration',
      modules: ['administration'],
      hasReportAccess: true,
    } as typeof req.user;
    next();
  });
  app.use('/api/academy', createLeadMergeRouter(service as unknown as LeadMergeService));
  return app;
};

describe('lead merge HTTP contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates candidate search with an ActorContext and preserves the response shape', async () => {
    const candidates = [{ id: 11, contactName: 'Parent' }];
    service.search.mockResolvedValue(candidates);

    const response = await request(createApp())
      .get('/api/academy/leads/merge-candidates')
      .query({ q: ' par ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(candidates);
    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      primaryModule: 'administration',
      isLeadership: true,
    }), ' par ');
  });

  it('rejects malformed or identical preview ids before the application service', async () => {
    const malformed = await request(createApp())
      .get('/api/academy/leads/merge-preview')
      .query({ firstLeadId: 'oops', secondLeadId: 2 });
    const identical = await request(createApp())
      .get('/api/academy/leads/merge-preview')
      .query({ firstLeadId: 2, secondLeadId: 2 });

    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: 'leadMergeRequiresDifferentLeads' });
    expect(identical.status).toBe(400);
    expect(service.preview).not.toHaveBeenCalled();
  });

  it('preserves the merge endpoint result and validates ids', async () => {
    const result = {
      retainedLead: { id: 1, contactName: 'Parent' },
      duplicateLeadId: 2,
      moved: { comments: 3 },
    };
    service.merge.mockResolvedValue(result);

    const response = await request(createApp())
      .post('/api/academy/leads/merge')
      .send({ retainedLeadId: '1', duplicateLeadId: 2 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(result);
    expect(service.merge).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
      1,
      2,
    );
  });

  it('keeps duplicate conflict metadata on draft merge errors', async () => {
    service.mergeDraft.mockRejectedValue(Object.assign(new Error('clientAlreadyExists'), {
      statusCode: 409,
      duplicate: {
        id: 9,
        entityType: 'lead',
        isArchived: false,
        managerId: 12,
      },
    }));

    const response = await request(createApp())
      .post('/api/academy/leads/merge-draft')
      .send({ retainedLeadId: 1, draft: { contactName: 'Parent' } });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'clientAlreadyExists',
      duplicate: expect.objectContaining({ id: 9, canMerge: true }),
    });
  });
});
