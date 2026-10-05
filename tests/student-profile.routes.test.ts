import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_STUDENT_PROJECT_BYTES } from '../shared/contracts/student-profile';

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), insertRow: vi.fn(), createAudit: vi.fn(), getLead: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', () => ({
  ...mocks, SALES_MODULES: new Set(['sales', 'administration']), LEAD_MODULES: new Set(['sales', 'administration']),
  ensureModuleAccess: () => true, ensureLeadRowAccess: () => true, ensureLeadMutationAccess: () => true,
  parseId: (value: string) => /^[1-9]\d*$/.test(String(value)) ? Number(value) : null,
  withTransaction: (run: () => Promise<unknown>) => run(), normalizePhoneForStorage: vi.fn(), nullableText: vi.fn(), updateRow: vi.fn(),
}));
vi.mock('../server/modules/academy/academy-leads', () => ({ getLead: mocks.getLead }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn() } }));
import { registerAcademyStudentProfileRoutes } from '../server/modules/academy/student-profile.router';
import { STUDENT_PROJECT_UPLOAD_DIR, studentProjectFileInfo, studentProjectFilePath } from '../server/middleware/student-project-upload.middleware';

const student = { id: 321, managerId: 7, leadId: 12, contactName: 'Parent', studentName: 'Child', status: 'studying', groupId: 5, courseId: 1 };
const files: string[] = [];
let savedFileUrl: string | null;
const app = (userId = 7) => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: userId, module: 'sales', modules: ['sales'] } as typeof req.user; next(); });
  const router = express.Router(); registerAcademyStudentProfileRoutes(router); app.use('/api/academy', router);
  return app;
};
beforeEach(() => {
  vi.clearAllMocks(); savedFileUrl = null;
  mocks.getLead.mockResolvedValue({ id: 12, contactName: 'Current parent', phone: '+998901234567', managerId: 7 });
  mocks.queryOne.mockImplementation(async (sql: string) => sql.includes('SELECT file_url') ? savedFileUrl ? { fileUrl: savedFileUrl } : null : student);
  mocks.query.mockResolvedValue([]);
  mocks.insertRow.mockImplementation(async (_table, values) => {
    savedFileUrl = values.fileUrl;
    const info = studentProjectFileInfo(values.fileUrl);
    if (info) files.push(studentProjectFilePath(info.fileId)!);
    return { id: 45, createdAt: '2026-10-05', ...values };
  });
  mocks.createAudit.mockResolvedValue(undefined);
});
afterEach(async () => { await Promise.all(files.splice(0).map((file) => fs.unlink(file).catch(() => undefined))); });
// Superagent accepts any readable stream; its typings name only fs.ReadStream.
const upload = (size: number) => Readable.from((function* () {
  const chunk = Buffer.alloc(1024 * 1024);
  for (let remaining = size; remaining > 0; remaining -= chunk.length) yield chunk.subarray(0, Math.min(chunk.length, remaining));
})()) as unknown as import('node:fs').ReadStream;

describe('student profile routes', () => {
  it('returns the current linked lead and applies payment and enrollment totals', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT membership.group_id')) return [{ groupId: 5, groupName: 'Group', isPrimary: true,
        plannedLessons: 16, groupConductedLessons: 10, conductedLessons: 3, attendedLessons: 2, missedLessons: 1 }];
      if (sql.includes('FROM academy_payments')) return [{ id: 1, amountUzs: '100000', status: 'pending', dueAt: '2000-01-01' }];
      return [];
    });
    const response = await request(app()).get('/api/academy/students/321/profile');
    expect(response.status).toBe(200);
    expect(response.body.lead).toEqual({ id: 12, contactName: 'Current parent', phone: '+998901234567' });
    expect(response.body.groups[0]).toMatchObject({ totalLessons: 9, completedLessons: 2, remainingLessons: 6 });
    expect(response.body.payments[0].status).toBe('overdue');
    expect(response.body.summary).toMatchObject({ remaining: 100_000, paid: 0 });
    const attendanceQuery = mocks.query.mock.calls.find(([sql]) => sql.includes('SELECT lesson.id AS lesson_id'))?.[0];
    expect(attendanceQuery).toContain('membership.ended_at');
    expect(attendanceQuery).toContain("lesson.status = 'conducted'");
  });
  it('denies another employee before reading records or accepting an upload', async () => {
    expect((await request(app(8)).get('/api/academy/students/321/profile')).status).toBe(403);
    expect((await request(app(8)).post('/api/academy/students/321/projects').field('title', 'Project').attach('file', Buffer.from('test'), 'project.zip')).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.insertRow).not.toHaveBeenCalled();
  });
  it('saves a link and rejects unsafe or missing sources', async () => {
    const response = await request(app()).post('/api/academy/students/321/projects').send({ title: ' Website ', url: 'https://example.com/work' });
    expect(response.status).toBe(201);
    expect(mocks.insertRow).toHaveBeenCalledWith('academy_portfolio_projects', expect.objectContaining({ studentId: 321, title: 'Website', url: 'https://example.com/work', fileUrl: null }));
    expect((await request(app()).post('/api/academy/students/321/projects').send({ title: 'Unsafe', url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await request(app()).post('/api/academy/students/321/projects').send({ title: 'Missing' })).body.error).toBe('studentProjectSourceRequired');
  });
  it('serves project code only as an authorized attachment', async () => {
    const created = await request(app()).post('/api/academy/students/321/projects').field('title', 'Website').attach('file', Buffer.from('<script>alert(1)</script>'), 'website.html');
    expect(created.status).toBe(201);
    expect(created.body.fileName).toBe('website.html');
    const file = await request(app()).get(created.body.fileUrl);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toContain('attachment');
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect((await request(app(8)).get(created.body.fileUrl)).status).toBe(403);
    expect(studentProjectFilePath('../secret')).toBeNull();
    expect(studentProjectFileInfo('https://example.com/file.zip')).toBeNull();
  });
  it('removes the uploaded file when title validation fails', async () => {
    await fs.mkdir(STUDENT_PROJECT_UPLOAD_DIR, { recursive: true });
    const before = await fs.readdir(STUDENT_PROJECT_UPLOAD_DIR);
    const response = await request(app()).post('/api/academy/students/321/projects').field('title', ' ').attach('file', Buffer.from('test'), 'project.zip');
    expect(response.status).toBe(400);
    expect(await fs.readdir(STUDENT_PROJECT_UPLOAD_DIR)).toEqual(before);
  });
  it('accepts exactly 100 MB and rejects one byte more', async () => {
    const accepted = await request(app()).post('/api/academy/students/321/projects').field('title', 'Boundary').attach('file', upload(MAX_STUDENT_PROJECT_BYTES), 'boundary.zip');
    expect(accepted.status).toBe(201);
    expect((await fs.stat(files[files.length - 1])).size).toBe(MAX_STUDENT_PROJECT_BYTES);
    const before = await fs.readdir(STUDENT_PROJECT_UPLOAD_DIR);
    const rejected = await request(app()).post('/api/academy/students/321/projects').field('title', 'Oversize').attach('file', upload(MAX_STUDENT_PROJECT_BYTES + 1), 'oversize.zip');
    expect(rejected.status).toBe(413);
    expect(rejected.body.error).toBe('studentProjectFileTooLarge');
    expect(await fs.readdir(STUDENT_PROJECT_UPLOAD_DIR)).toEqual(before);
  }, 30_000);
});
