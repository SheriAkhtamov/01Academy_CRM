import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createHttpApp } from '../server/app/http-app';

describe('private learning module document routes', () => {
  it.each([
    '/student-module', '/student-module/courses/8?linkId=3', '/parent-module',
    '/parent-module/payments', '/activate?token=secret', '/recover?token=secret',
    '/learn/activate?token=legacy', '/portfolio/p/shared-token',
  ])('preserves private headers at %s', async (path) => {
    const app = createHttpApp();
    app.get('*', (_request, response) => response.send('platform'));
    const response = await request(app).get(path).expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it.each(['/sales', '/student-modules', '/parent-module-extra', '/activate-extra'])('does not change employee or unrelated document headers at %s', async (path) => {
    const app = createHttpApp();
    app.get('*', (_request, response) => response.send('platform'));
    const response = await request(app).get(path).expect(200);
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['x-robots-tag']).toBeUndefined();
  });
});
