import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
import { createUpdateRouter } from '../server/modules/platform-updates/http/router';
import { PlatformUpdateService } from '../server/modules/platform-updates/application/update-service';
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
const app = () => { const value = express(); value.use(express.json()); value.use('/api/updates', createUpdateRouter(new PlatformUpdateService(repository, notify), auth, administration, image)); return value; };
beforeEach(() => { vi.clearAllMocks(); repository.list.mockResolvedValue([]); repository.find.mockResolvedValue(null); image.mockResolvedValue(null); });
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
