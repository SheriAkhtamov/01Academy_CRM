import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock('../server/middleware/auth.middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 7 } as express.Request['user'];
    next();
  },
}));
vi.mock('../server/lib/logger', () => ({ logger: { error: logError } }));

import clientErrorsRoutes from '../server/routes/client-errors.routes';

const app = express();
app.use(express.json());
app.use('/api/client-errors', clientErrorsRoutes);

beforeEach(() => logError.mockClear());

describe('client error reports', () => {
  it('records a bounded report with the authenticated user', async () => {
    const response = await request(app).post('/api/client-errors').send({
      source: 'react-boundary',
      name: 'TypeError',
      message: 'Cannot read properties of undefined',
      path: '/sales/pipeline',
    });

    expect(response.status).toBe(204);
    expect(logError).toHaveBeenCalledWith('Client application error', expect.objectContaining({
      userId: 7,
      source: 'react-boundary',
      path: '/sales/pipeline',
    }));
  });

  it('rejects reports containing a query string in the route', async () => {
    const response = await request(app).post('/api/client-errors').send({
      source: 'react-boundary',
      name: 'Error',
      message: 'Crash',
      path: '/sales/pipeline?lead=123',
    });

    expect(response.status).toBe(400);
    expect(logError).not.toHaveBeenCalled();
  });
});
