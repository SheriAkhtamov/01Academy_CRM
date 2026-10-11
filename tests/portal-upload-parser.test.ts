import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express, { type Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageRelease } from '../server/modules/portal-resources/infrastructure/storage-reservation';
import { PortalResourceError } from '../server/modules/portal-resources/domain/policy';
const mocks = vi.hoisted(() => ({ reserve: vi.fn() }));
vi.mock('../server/modules/portal-resources/infrastructure/storage-reservation', () => ({ reserveUploadSpace: mocks.reserve }));
import { createResourceUploadParser } from '../server/modules/portal-resources/infrastructure/upload-parser';

let directory: string, release: ReturnType<typeof vi.fn<StorageRelease>>;
let incoming: Request | undefined;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-upload-http-'));
  release = vi.fn<StorageRelease>(); incoming = undefined; mocks.reserve.mockReset();
  mocks.reserve.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 30)); return release; });
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
const app = () => {
  const api = express();
  api.use((req, _res, next) => { incoming = req; next(); });
  api.post('/upload', createResourceUploadParser(path.join(directory, 'uploads/lms/quarantine'), path.join(directory, 'uploads')), (req, res) => {
    if (!req.file) return res.status(400).json({ code: 'portalUploadFailed' });
    res.status(201).json({ name: req.file.originalname, size: req.file.size });
  });
  return api;
};
describe('Portal multipart upload parser HTTP regression', () => {
  it('accepts a completed small request after asynchronous disk admission and records actual bytes', async () => {
    const content = Buffer.from('Small completed multipart fixture');
    const response = await request(app()).post('/upload').attach('file', content, 'fixture.txt').expect(201);
    expect(response.body).toEqual({ name: 'fixture.txt', size: content.length });
    expect(incoming).toMatchObject({ complete: true, destroyed: true, aborted: false });
    expect(release.mock.calls).toContainEqual([{ writtenBytes: content.length }]);
    expect(release.mock.calls.some(([completion]) => completion === 'cancelled')).toBe(false);
    const files = await fs.readdir(path.join(directory, 'uploads/lms/quarantine'));
    expect(files).toHaveLength(1);
    expect(await fs.readFile(path.join(directory, 'uploads/lms/quarantine', files[0]))).toEqual(content);
  });
  it('refuses insufficient headroom before creating upload directories or writing bytes', async () => {
    mocks.reserve.mockRejectedValue(new PortalResourceError('portalFileStorageFull', 503));
    const response = await request(app()).post('/upload').attach('file', Buffer.from('fixture'), 'fixture.txt').expect(503);
    expect(response.body).toEqual({ code: 'portalFileStorageFull' });
    expect(await fs.readdir(directory)).toEqual([]);
    expect(release).not.toHaveBeenCalled();
  });
  it('accounts for a completed file when multipart validation fails after a write starts', async () => {
    const response = await request(app()).post('/upload').attach('file', Buffer.from('one'), 'first.txt').attach('file', Buffer.from('two'), 'second.txt').expect(400);
    expect(response.body).toEqual({ code: 'portalUploadFailed' });
    expect(release).toHaveBeenCalledWith({ writtenBytes: 3 });
    expect(release.mock.calls.some(([completion]) => completion === 'cancelled')).toBe(false);
  });
});
