import express from 'express';
import session from 'express-session';
import request from 'supertest';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageAttachment } from '../shared/contracts/messages';
import { MAX_MESSAGE_FILE_BYTES } from '../shared/contracts/messages';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), createMessage: vi.fn(), getMessageAttachment: vi.fn(), broadcast: vi.fn() }));
vi.mock('../server/storage', () => ({ storage: mocks }));
vi.mock('../server/realtime/realtime-hub', () => ({ publishRealtimeEvent: mocks.broadcast }));
import routes from '../server/routes/message.routes';
import { MESSAGE_UPLOAD_DIR, messageFilePath, messageInlineMimeType } from '../server/middleware/message-upload.middleware';

const saved = new Map<string, MessageAttachment>();
const uploaded: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2nUAAAAASUVORK5CYII=', 'base64');
const app = express();
app.use(express.json());
app.use(session({ secret: 'test-message-file-session', resave: false, saveUninitialized: false }));
app.post('/test/session', (req, res) => { Object.assign(req.session, req.body); req.session.save(() => res.json({ ok: true })); });
app.use('/api/messages', routes);
beforeEach(async () => {
  vi.clearAllMocks(); saved.clear();
  mocks.getUser.mockImplementation(async (id: number) => ({ id, isActive: true, fullName: `User ${id}`, module: 'sales', modules: ['sales'] }));
  mocks.createMessage.mockImplementation(async (input) => {
    input.attachments.forEach((file: MessageAttachment) => { saved.set(file.id, file); uploaded.push(messageFilePath(file.id)!); });
    return { id: 123, createdAt: '2026-10-06T00:00:00Z', ...input };
  });
  mocks.getMessageAttachment.mockImplementation(async (id: string, userId: number) => [1, 2].includes(userId) ? saved.get(id) ?? null : null);
  await fs.mkdir(MESSAGE_UPLOAD_DIR, { recursive: true });
});
afterEach(async () => { await Promise.all(uploaded.splice(0).map((file) => fs.unlink(file).catch(() => undefined))); });
const login = async (id = 1) => { const agent = request.agent(app); await agent.post('/test/session').send({ userId: id }); return agent; };

describe('employee chat attachment routes', () => {
  it('sends a photo without text, records its size and broadcasts only to its participants', async () => {
    const agent = await login();
    const response = await agent.post('/api/messages').field('receiverId', '2').attach('files', png, { filename: 'photo.png', contentType: 'image/png' });
    expect(response.status).toBe(200);
    const attachment = response.body.attachments[0];
    expect(attachment).toMatchObject({ name: 'photo.png', mimeType: 'image/png', size: png.length });
    expect(response.body.content).toBe('');
    expect(mocks.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'NEW_MESSAGE', audienceUserIds: [1, 2], data: expect.objectContaining({ attachments: [attachment] }) }));
    expect((await fs.stat(messageFilePath(attachment.id)!)).size).toBe(png.length);
    const image = await (await login(2)).get(attachment.url);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect(image.headers['content-disposition']).toContain('inline');
    expect(image.headers['cache-control']).toContain('private');
    expect((await (await login(3)).get(attachment.url)).status).toBe(404);
    expect((await request(app).get(attachment.url)).status).toBe(401);
  });

  it('allows exactly 10 MB, rejects a larger file and removes partial uploads', async () => {
    const agent = await login();
    const exact = await agent.post('/api/messages').field('receiverId', '2').attach('files', Buffer.alloc(MAX_MESSAGE_FILE_BYTES), 'exact.bin');
    expect(exact.status).toBe(200);
    const before = await fs.readdir(MESSAGE_UPLOAD_DIR);
    const oversized = await agent.post('/api/messages').field('receiverId', '2').attach('files', Buffer.alloc(MAX_MESSAGE_FILE_BYTES + 1), 'large.bin');
    expect(oversized.status).toBe(413);
    expect(oversized.body.error).toBe('messageFileTooLarge');
    await vi.waitFor(async () => expect(await fs.readdir(MESSAGE_UPLOAD_DIR)).toEqual(before));
    expect(mocks.createMessage).toHaveBeenCalledTimes(1);
  });

  it('sends five files together and rejects six without a partial message', async () => {
    const agent = await login();
    let send = agent.post('/api/messages').field('receiverId', '2').field('content', 'Files');
    for (let i = 0; i < 5; i++) send = send.attach('files', png, `${i}.png`);
    expect((await send).body.attachments).toHaveLength(5);
    const before = await fs.readdir(MESSAGE_UPLOAD_DIR);
    send = agent.post('/api/messages').field('receiverId', '2');
    for (let i = 0; i < 6; i++) send = send.attach('files', png, `${i}.png`);
    expect((await send).status).toBe(400);
    await vi.waitFor(async () => expect(await fs.readdir(MESSAGE_UPLOAD_DIR)).toEqual(before));
    expect(mocks.createMessage).toHaveBeenCalledTimes(1);
  });

  it('serves video ranges and forces documents or spoofed photos to download', async () => {
    const agent = await login();
    const videoBytes = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex');
    const response = await agent.post('/api/messages').field('receiverId', '2').attach('files', videoBytes, 'video.mp4').attach('files', Buffer.from('<script>alert(1)</script>'), { filename: 'fake.png', contentType: 'image/png' });
    expect(response.body.attachments.map((file: MessageAttachment) => file.mimeType)).toEqual(['video/mp4', 'application/octet-stream']);
    const range = await agent.get(response.body.attachments[0].url).set('Range', 'bytes=0-7');
    expect(range.status).toBe(206);
    expect(range.headers['content-range']).toBe(`bytes 0-7/${videoBytes.length}`);
    expect(range.headers['content-type']).toContain('video/mp4');
    const spoof = await agent.get(response.body.attachments[1].url);
    expect(spoof.headers['content-type']).toContain('application/octet-stream');
    expect(spoof.headers['content-disposition']).toContain('attachment');
    expect(spoof.headers['x-content-type-options']).toBe('nosniff');
  });

  it.each(['invalid receiver', 'failed save', 'forged metadata'])('cleans up files after %s', async (reason) => {
    const before = await fs.readdir(MESSAGE_UPLOAD_DIR);
    const agent = await login();
    if (reason === 'failed save') mocks.createMessage.mockRejectedValue(new Error('Save failed'));
    let send = agent.post('/api/messages').field('receiverId', reason === 'invalid receiver' ? '0' : '2');
    if (reason === 'forged metadata') send = send.field('attachments', '[]');
    const response = await send.attach('files', png, 'photo.png');
    expect(response.status).toBe(reason === 'failed save' ? 500 : 400);
    await vi.waitFor(async () => expect(await fs.readdir(MESSAGE_UPLOAD_DIR)).toEqual(before));
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it('does not accept path traversal or treat HTML and SVG as inline media', () => {
    expect(messageFilePath('../secret')).toBeNull();
    expect(messageInlineMimeType(Buffer.from('<svg onload="alert(1)">'))).toBe('application/octet-stream');
    expect(messageInlineMimeType(Buffer.from('<html>'))).toBe('application/octet-stream');
  });
});
