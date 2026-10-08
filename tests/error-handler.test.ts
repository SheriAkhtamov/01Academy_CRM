import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../server/lib/logger', () => ({ logger: { error: mocks.error } }));

import { errorHandler, requestContextMiddleware } from '../server/middleware/errorHandler';

describe('HTTP error handling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards the original asynchronous error after streaming has sent headers', async () => {
    const failure = new Error('The source stream failed');
    const forwarded: unknown[] = [];
    const app = express();
    app.use(requestContextMiddleware);
    app.get('/api/stream', (_req, res, next) => {
      res.type('text/plain').write('started\n');
      setImmediate(() => next(failure));
    });
    app.use(errorHandler);
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      forwarded.push(error);
      res.end('stream stopped');
    });

    const response = await request(app).get('/api/stream');

    expect(forwarded).toEqual([failure]);
    expect(response.status).toBe(200);
    expect(response.text).toBe('started\nstream stopped');
    expect(mocks.error).toHaveBeenCalledWith('Server Error', expect.objectContaining({
      message: failure.message,
      route: '/api/stream',
    }));
  });

  it('does not try to send a second response when a completed request reports an error', () => {
    const failure = new Error('Session save failed after the response');
    const req = {
      headers: {},
      originalUrl: '/api/auth/session',
      method: 'GET',
    } as Request;
    const res = {
      headersSent: true,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    errorHandler(failure, req, res, next);

    expect(next).toHaveBeenCalledWith(failure);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('still returns the configured API error before headers are sent', async () => {
    const app = express();
    app.use(requestContextMiddleware);
    app.get('/api/invalid', (_req, _res, next) => {
      next(Object.assign(new Error('invalidData'), { statusCode: 422 }));
    });
    app.use(errorHandler);

    const response = await request(app).get('/api/invalid');

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ message: 'invalidData' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});
