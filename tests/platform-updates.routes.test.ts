import express, { type RequestHandler } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
import { createUpdateRouter } from '../server/modules/platform-updates/http/router';
import { PlatformUpdateService, type UpdateRepository } from '../server/modules/platform-updates/application/update-service';
import { PostgresUpdateRepository } from '../server/modules/platform-updates/infrastructure/postgres-repository';
import { publishUpdateSchema } from '../shared/contracts/platform-updates';
import { updateImagePath } from '../server/modules/platform-updates/infrastructure/images';
import { releasePosts } from '../server/modules/platform-updates/release-posts';
const repository = { list: vi.fn(), find: vi.fn(), publish: vi.fn() };
const notify = vi.fn();
const image = vi.fn();
const auth: RequestHandler = (req, res, next) => {
  const role = req.header('x-role');
  if (!role) return void res.status(401).json({ error: 'Unauthorized' });
  req.user = { id: 7, module: role } as any; next();
};
const administration: RequestHandler = (req, res, next) => auth(req, res, () => {
  if (req.user?.module !== 'administration') return void res.status(403).json({ error: 'Admin access required' });
  next();
});
const app = (updates: UpdateRepository = repository) => { const value = express(); value.use(express.json()); value.use('/api/updates', createUpdateRouter(new PlatformUpdateService(updates, notify), auth, administration, image)); return value; };
beforeEach(() => { vi.clearAllMocks(); repository.publish.mockReset(); repository.list.mockResolvedValue([]); repository.find.mockResolvedValue(null); image.mockResolvedValue(null); });
it('requires an employee login to read posts and screenshots', async () => {
  expect((await request(app()).get('/api/updates')).status).toBe(401);
  expect((await request(app()).get('/api/updates/images/release/screenshot.jpg')).status).toBe(401);
  expect(repository.list).not.toHaveBeenCalled(); expect(image).not.toHaveBeenCalled();
});
it.each(['sales', 'teacher', 'marketing', 'finance'])('lets %s read posts but never publish them', async (module) => {
  expect((await request(app()).get('/api/updates').set('x-role', module)).status).toBe(200);
  expect((await request(app()).post('/api/updates').set('x-role', module).send(releasePosts[0])).status).toBe(403);
  expect(repository.publish).not.toHaveBeenCalled();
});
it('serves historical posts through both read endpoints without retired metadata', async () => {
  const content = releasePosts[0].content;
  const storedContent = { ...content, category: 'sales', action: { href: '/sales/groups' } };
  const row = { id: 5, content: storedContent, published_at: new Date('2026-10-13T07:00:00.000Z') };
  const query = vi.fn().mockResolvedValue({ rows: [row] });
  const application = app(new PostgresUpdateRepository({ query } as unknown as Pool));
  const expected = { id: row.id, content, publishedAt: row.published_at.toISOString() };

  const feed = await request(application).get('/api/updates').set('x-role', 'sales');
  const article = await request(application).get('/api/updates/5').set('x-role', 'sales');
  expect(feed.status).toBe(200);
  expect(article.status).toBe(200);
  expect(feed.body).toEqual([expected]);
  expect(article.body).toEqual(expected);
  expect(storedContent).toHaveProperty('category', 'sales');
  expect(storedContent).toHaveProperty('action.href', '/sales/groups');
});
it('publishes through the shared notification service with the authenticated author', async () => {
  const command = releasePosts[0]; const post = { id: 5, content: command.content, publishedAt: new Date().toISOString() };
  repository.publish.mockResolvedValue({ post, created: true, recipientIds: [1, 2, 7] });
  const result = await request(app()).post('/api/updates').set('x-role', 'administration').send(command);
  expect(result.status).toBe(201); expect(result.body.id).toBe(5);
  expect(repository.publish).toHaveBeenCalledWith(command, 7); expect(notify).toHaveBeenCalledWith([1, 2, 7], 5);
});
it('rejects remote images, missing translations and recipient manipulation', async () => {
  const command = releasePosts[0];
  for (const data of [{ ...command, recipientIds: [7] },
    { ...command, content: { ...command.content, title: { ru: 'Only Russian' } } },
    { ...command, content: { ...command.content, sections: [{ paragraphs: [], items: [], image: { src: 'https://other.example/image.jpg', caption: { ru: 'Снимок', en: 'Screenshot' } } }] } }]) {
    expect((await request(app()).post('/api/updates').set('x-role', 'administration').send(data)).status).toBe(400);
  }
  expect(repository.publish).not.toHaveBeenCalled();
});
it.each([
  { category: 'sales' },
  { action: { href: '/sales/groups' } },
  { category: 'sales', action: { href: '/sales/groups' } },
])('rejects retired publication metadata %j', async (metadata) => {
  const command = releasePosts[0];
  const response = await request(app()).post('/api/updates').set('x-role', 'administration')
    .send({ ...command, content: { ...command.content, ...metadata } });
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: 'updatesInvalidContent' });
  expect(repository.publish).not.toHaveBeenCalled();
});
it('does not send notifications again for an idempotent publication retry', async () => {
  const command = releasePosts[0];
  const post = { id: 5, content: command.content, publishedAt: new Date().toISOString() };
  repository.publish.mockResolvedValue({ post, created: false, recipientIds: [] });
  const result = await request(app()).post('/api/updates').set('x-role', 'administration').send(command);
  expect(result.status).toBe(201);
  expect(result.body).toEqual(post);
  expect(notify).not.toHaveBeenCalled();
});
it('keeps real content conflicts visible to the publisher', async () => {
  repository.publish.mockRejectedValue(Object.assign(new Error('updatesPublicationConflict'), { statusCode: 409 }));
  const result = await request(app()).post('/api/updates').set('x-role', 'administration').send(releasePosts[0]);
  expect(result.status).toBe(409);
  expect(result.body).toEqual({ error: 'updatesPublicationConflict' });
  expect(notify).not.toHaveBeenCalled();
});
it('rejects malformed post IDs and protects image paths from traversal', async () => {
  expect((await request(app()).get('/api/updates/5bad').set('x-role', 'sales')).status).toBe(400);
  expect((await request(app()).get('/api/updates/5').set('x-role', 'sales')).status).toBe(404);
  expect(await updateImagePath('..', 'groups-list.jpg')).toBeNull();
  expect(await updateImagePath('2026-10-12-sales-groups', '../config.json')).toBeNull();
  for (const section of releasePosts[0].content.sections) {
    if (section.image) {
      const [, release, file] = section.image.src.match(/\/images\/([^/]+)\/([^/]+)$/)!;
      expect(await updateImagePath(release, file)).toBeTruthy();
    }
  }
  expect(publishUpdateSchema.safeParse(releasePosts[0]).success).toBe(true);
});
