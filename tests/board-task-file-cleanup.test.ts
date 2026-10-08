import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const root = `/tmp/academy-task-cleanup-${Math.random().toString(16).slice(2)}`;
  return { root, directory: `${root}/uploads/board`, getTask: vi.fn(), deleteTask: vi.fn(), getAttachment: vi.fn(), deleteAttachment: vi.fn() };
});
vi.mock('../server/storage', () => ({ storage: { board: mocks } }));
vi.mock('../server/middleware/upload.middleware', () => ({ BOARD_UPLOAD_DIR: mocks.directory, boardAttachmentUpload: { single: vi.fn() } }));
vi.mock('../server/services/telegram-task-reminders', () => ({ notifyTelegramTaskProgress: vi.fn() }));
import { createBoardRouter } from '../server/routes/board.routes';
const app = express();
app.use('/api/board', createBoardRouter((req: any, _res, next) => { req.user = { id: 7 }; next(); }));
const fileName = 'aaaaaaaaaaaaaaaaaaaaa.pdf';
beforeEach(async () => {
  vi.clearAllMocks();
  await fs.mkdir(mocks.directory, { recursive: true });
  await fs.writeFile(path.join(mocks.directory, fileName), 'attachment');
  mocks.getTask.mockResolvedValue({ id: 100, creatorId: 7, assigneeId: 8, boardId: 1 });
});
afterEach(async () => fs.rm(mocks.root, { force: true, recursive: true }));
it('removes task files only after metadata deletion has committed', async () => {
  mocks.deleteTask.mockImplementation(async () => {
    expect(await fs.readFile(path.join(mocks.directory, fileName), 'utf8')).toBe('attachment');
    return [fileName, '../escape.pdf'];
  });
  expect((await request(app).delete('/api/board/tasks/100')).status).toBe(200);
  expect(await fs.readdir(mocks.directory)).toEqual([]);
  expect(await fs.readFile(path.join(mocks.root, 'uploads', '.retained', 'board', fileName), 'utf8')).toBe('attachment');
});
it('keeps physical files when the task deletion rolls back', async () => {
  mocks.deleteTask.mockRejectedValue(new Error('Transaction rolled back'));
  expect((await request(app).delete('/api/board/tasks/100')).status).toBe(500);
  expect(await fs.readFile(path.join(mocks.directory, fileName), 'utf8')).toBe('attachment');
});
it('retains an individually deleted attachment only after its database deletion succeeds', async () => {
  mocks.getTask.mockResolvedValue({ id: 100, creatorId: 7, assigneeId: 7, boardId: 1 });
  mocks.getAttachment.mockResolvedValue({ id: 23, taskId: 100, fileName });
  mocks.deleteAttachment.mockImplementation(async () => {
    expect(await fs.readFile(path.join(mocks.directory, fileName), 'utf8')).toBe('attachment');
  });
  expect((await request(app).delete('/api/board/attachments/23')).status).toBe(200);
  expect(await fs.readdir(mocks.directory)).toEqual([]);
  expect(await fs.readFile(path.join(mocks.root, 'uploads', '.retained', 'board', fileName), 'utf8')).toBe('attachment');
});
it('keeps a live attachment if its metadata deletion fails', async () => {
  mocks.getTask.mockResolvedValue({ id: 100, creatorId: 7, assigneeId: 7, boardId: 1 });
  mocks.getAttachment.mockResolvedValue({ id: 23, taskId: 100, fileName });
  mocks.deleteAttachment.mockRejectedValue(new Error('Deletion failed'));
  expect((await request(app).delete('/api/board/attachments/23')).status).toBe(500);
  expect(await fs.readFile(path.join(mocks.directory, fileName), 'utf8')).toBe('attachment');
});
