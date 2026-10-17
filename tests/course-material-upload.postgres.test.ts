import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalActorContext } from '../server/modules/portal-identity';
import type { CourseCurriculum, CourseMaterialFile } from '../shared/contracts/course-curriculum';

const fixture = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }));
vi.mock('../server/db', () => ({ pool: { query: (...args: Parameters<Pool['query']>) => fixture.pool.query(...args), connect: () => fixture.pool.connect() } }));
vi.mock('../server/storage', () => ({ storage: { createAuditLog: vi.fn(async () => {}) } }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { CourseMaterialFileService } from '../server/modules/academy/course-material-files';
import { registerCourseMaterialFileRoutes } from '../server/modules/academy/course-material-files.router';
import { registerAcademyOperationsRoutes } from '../server/modules/academy/operations.router';
import { registerAcademyResourceRoutes } from '../server/modules/academy/resources.router';
import { createResourceUploadParser } from '../server/modules/portal-resources/infrastructure/upload-parser';
import { LocalResourceFileStore } from '../server/modules/portal-resources/infrastructure/file-store';
import { createResourceTokenCodec } from '../server/modules/portal-resources/infrastructure/file-store';
import { PortalResourceService } from '../server/modules/portal-resources/application/resource-service';
import { PgLearningRepository } from '../server/modules/lms/infrastructure/learning-repository';
import { lmsMaterialSchema } from '../shared/contracts/lms';
import { PostgresPortalResourceRepository, authorizeLmsFiles } from '../server/modules/portal-resources/infrastructure/postgres-repository';
import { PgCrmLearningPreparationRepository } from '../server/modules/lms/infrastructure/crm-preparation-repository';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `course_upload_${randomBytes(6).toString('hex')}`;
let admin: Pool, directory: string, service: CourseMaterialFileService, app: express.Express;
const parserCalls = vi.fn();
const pdf = Buffer.from('%PDF-1.4\nPrivate course workbook\n%%EOF');
const curriculum = (file?: CourseMaterialFile): CourseCurriculum => ({ version: 1, blocks: [{ id: 'block', title: 'Block', lessons: [
  { id: 'lesson-one', title: 'First', materials: file ? [{ id: 'material-file', type: 'file', title: 'Workbook', content: '', file }] : [] },
  { id: 'lesson-two', title: 'Second', materials: [] },
] }] });
const courseBody = (program: CourseCurriculum, slug = 'uploaded-course') => ({ name: 'Uploaded course', slug, ageCategory: 'kids', basePriceUzs: 1000, isActive: true, program });
const learner: PortalActorContext = { portalAccountId: 1, linkId: 1, studentId: 1, sessionId: 'learner', kind: 'self', studentClassification: 'adult', permissions: ['learning.read'] };
const sourceRef = (file: Record<string, any>): CourseMaterialFile => ({ id: file.id, name: file.name, mime: file.mime, size: file.size });

describe.skipIf(!databaseUrl)('private course material upload, attachment ownership and published learner access', () => {
  beforeAll(async () => {
    if (!databaseUrl || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Isolated local PostgreSQL required');
    admin = new Pool({ connectionString: databaseUrl }); await admin.query(`CREATE SCHEMA ${schema}`);
    fixture.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC`, max: 8 });
    await fixture.pool.query(`
      CREATE TABLE users(id serial PRIMARY KEY,full_name text,module text,is_active boolean DEFAULT true,is_archived boolean DEFAULT false);
      CREATE TABLE user_modules(user_id integer,module text);
      CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text);
      CREATE TABLE academy_courses(id serial PRIMARY KEY,name text,slug text UNIQUE,age_category text,description text,base_price_uzs integer DEFAULT 0,is_active boolean DEFAULT true,is_archived boolean DEFAULT false,program jsonb DEFAULT '[]',lesson_count integer DEFAULT 0,updated_at timestamp DEFAULT now());
      CREATE TABLE academy_teachers(id serial PRIMARY KEY,user_id integer,full_name text,status text DEFAULT 'active');
      CREATE TABLE academy_groups(id serial PRIMARY KEY,name text,course_id integer,teacher_id integer,status text DEFAULT 'open',is_archived boolean DEFAULT false,end_date timestamptz,updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer,group_id integer,status text DEFAULT 'active',enrolled_at timestamptz,ended_at timestamptz);
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer,course_id integer,lesson_number integer,topic text,materials text,scheduled_at timestamptz DEFAULT now(),duration_minutes integer DEFAULT 60,status text DEFAULT 'scheduled',teacher_id integer);
      CREATE TABLE academy_portfolio_projects(id serial PRIMARY KEY,student_id integer,title text,group_id integer,course_id integer,url text,file_url text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_payments(id serial PRIMARY KEY,student_id integer,lead_id integer,amount_uzs bigint,status text,method text,type text,period text,paid_at timestamptz,due_at timestamptz,paid_until timestamptz,created_at timestamptz DEFAULT now());
    `);
    for (const migration of ['0134_portal_identity', '0135_lms_learning', '0136_portal_resources', '0137_lms_crm_preparation', '0155_course_curriculum', '0156_course_material_files']) await fixture.pool.query(readFileSync(`migrations/${migration}.sql`, 'utf8'));
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'academy-course-files-'));
    service = new CourseMaterialFileService(new LocalResourceFileStore(path.join(directory, 'lms/files'), directory));
    const parser = createResourceUploadParser(path.join(directory, 'lms/quarantine'), directory);
    app = express(); app.use(express.json());
    app.use((req, res, next) => {
      const actor = req.get('x-test-user') ?? '1';
      if (actor === 'none') { res.status(401).json({ error: 'unauthorized' }); return; }
      req.user = { id: Number(actor), module: actor === '3' ? 'teacher' : 'administration', modules: actor === '3' ? ['teacher'] : ['administration'] } as typeof req.user;
      next();
    });
    const router = express.Router();
    registerCourseMaterialFileRoutes(router, service, (req, res, next) => { parserCalls(); parser(req, res, next); });
    registerAcademyOperationsRoutes(router); registerAcademyResourceRoutes(router);
    app.use('/api/academy', router);
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
  });
  beforeEach(async () => {
    parserCalls.mockClear();
    const tables = (await fixture.pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema])).rows.map(row => `"${schema}"."${row.tablename}"`).join(',');
    await fixture.pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    await fixture.pool.query(`INSERT INTO users(id,full_name,module) VALUES(1,'Administrator','administration'),(2,'Other admin','administration'),(3,'Teacher','teacher');
      INSERT INTO academy_students(id,student_name,contact_name) VALUES(1,'Learner','Learner'),(2,'Stranger','Stranger');
      INSERT INTO academy_courses(id,name,slug) VALUES(1,'Course one','first'),(2,'Course two','second');
      SELECT setval('academy_courses_id_seq',2);
      INSERT INTO academy_teachers(id,user_id) VALUES(1,3);
      INSERT INTO academy_groups(id,name,course_id,teacher_id) VALUES(1,'CYP-AI-GRP-26-0001',1,1),(2,'CYP-AI-GRP-26-0002',1,1),(3,'CYP-AI-GRP-26-0003',2,1);
      INSERT INTO academy_student_group_enrollments(id,student_id,group_id,enrolled_at) VALUES(1,1,1,now()-interval '1 month'),(2,2,3,now()-interval '1 month');
      INSERT INTO lms_school_settings(singleton) VALUES(true);
      INSERT INTO lms_feature_flags(key,enabled,all_groups) VALUES('learning',true,true)`);
  });
  afterAll(async () => { await fixture.pool?.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } if (directory) await fs.rm(directory, { recursive: true, force: true }); });

  it('uploads actual Unicode PDF bytes privately and authorizes requests before multipart writes', async () => {
    for (const actor of ['none', '3']) {
      const denied = await request(app).post('/api/academy/course-material-files').set('x-test-user', actor).attach('file', pdf, 'Урок1.pdf');
      expect(denied.status).toBe(actor === 'none' ? 401 : 403);
    }
    expect(parserCalls).not.toHaveBeenCalled();
    const uploaded = await request(app).post('/api/academy/course-material-files').attach('file', pdf, 'Урок1.pdf');
    expect(uploaded.status, uploaded.text).toBe(201);
    expect(uploaded.body).toMatchObject({ name: 'Урок1.pdf', mime: 'application/pdf', size: pdf.length, state: 'ready', downloadUrl: expect.stringContaining('/api/academy/course-material-files/') });
    expect(uploaded.body).not.toHaveProperty('storageKey');
    expect(uploaded.body).not.toHaveProperty('ownerUserId');
    const download = await request(app).get(uploaded.body.downloadUrl);
    expect(download.status).toBe(200); expect(download.body).toEqual(pdf);
    expect(download.headers['content-disposition']).toContain('attachment;');
    expect(download.headers['cache-control']).toBe('private, no-store'); expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect((await request(app).get(uploaded.body.downloadUrl).set('x-test-user', '2')).status).toBe(404);
    expect((await fs.readdir(path.join(directory, 'lms/quarantine')))).toEqual([]);
  });

  it('rejects empty, forged types and oversized files without leaving temporary bytes', async () => {
    for (const [body, name, code] of [[Buffer.alloc(0), 'empty.txt', 'portalFileRequired'], [Buffer.from('MZ executable'), 'fake.pdf', 'portalFileTypeUnsupported']] as const) {
      const result = await request(app).post('/api/academy/course-material-files').attach('file', body, name);
      expect(result.status).toBe(400); expect(result.body.error).toBe(code);
    }
    const large = await request(app).post('/api/academy/course-material-files').attach('file', Buffer.alloc(10 * 1024 ** 2 + 1, 65), 'big.txt');
    expect(large.status).toBe(413); expect(large.body.code).toBe('portalFileTooLarge');
    expect((await fixture.pool.query('SELECT COUNT(*)::int AS count FROM lms_files')).rows[0].count).toBe(0);
    expect(await fs.readdir(path.join(directory, 'lms/quarantine'))).toEqual([]);
  });

  it('claims drafts transactionally, canonicalizes saved metadata, and refuses foreign/unready source IDs', async () => {
    const uploaded = (await request(app).post('/api/academy/course-material-files').attach('file', pdf, 'Workbook.pdf')).body;
    const forged = { ...sourceRef(uploaded), name: 'forged.html', mime: 'text/html', size: 0 };
    const saved = await request(app).post('/api/academy/courses/with-teachers').send(courseBody(curriculum(forged)));
    expect(saved.status, saved.text).toBe(201);
    expect(saved.body.program.blocks[0].lessons[0].materials[0].file).toEqual(sourceRef(uploaded));
    const reopened = await request(app).get(`/api/academy/courses/${saved.body.id}`);
    expect(reopened.body.program).toEqual(saved.body.program);
    expect((await request(app).get(uploaded.downloadUrl).set('x-test-user', '2')).status).toBe(200);
    const foreign = (await request(app).post('/api/academy/course-material-files').set('x-test-user', '2').attach('file', pdf, 'Foreign.pdf')).body;
    const denied = await request(app).post('/api/academy/courses/with-teachers').send(courseBody(curriculum(sourceRef(foreign)), 'forbidden-course'));
    expect(denied.status).toBe(409); expect(denied.body.error).toBe('courseMaterialFileInvalid');
    expect((await fixture.pool.query("SELECT COUNT(*)::int AS count FROM academy_courses WHERE slug='forbidden-course'")).rows[0].count).toBe(0);
    const crossCourse = await request(app).post('/api/academy/courses/with-teachers').send(courseBody(curriculum(sourceRef(uploaded)), 'another-course'));
    expect(crossCourse.status).toBe(409);
    await fixture.pool.query("UPDATE lms_files SET state='checking' WHERE id=$1", [foreign.id]);
    expect((await request(app).post('/api/academy/courses/with-teachers').set('x-test-user', '2').send(courseBody(curriculum(sourceRef(foreign)), 'checking-file'))).status).toBe(409);
  });

  it('shares course sources across selected groups while learner downloads require publication, enrollment and current selection', async () => {
    const uploaded = (await request(app).post('/api/academy/course-material-files').attach('file', pdf, 'Workbook.pdf')).body;
    const saved = await request(app).patch('/api/academy/courses/1/with-teachers').send(courseBody(curriculum(sourceRef(uploaded)), 'first'));
    expect(saved.status, saved.text).toBe(200);
    await fixture.pool.query(`UPDATE academy_groups SET selected_course_lesson_ids='["lesson-one"]' WHERE id IN(1,2)`);
    await fixture.pool.query(`INSERT INTO academy_lessons(group_id,course_id,lesson_number,course_lesson_id,topic,material_file_ids) VALUES(1,1,1,'lesson-one','First',$1::jsonb),(2,1,1,'lesson-one','First',$1::jsonb)`, [JSON.stringify([uploaded.id])]);
    await new PgCrmLearningPreparationRepository(fixture.pool, { enabled: () => true, defaultFormat: () => null, groupIds: [1, 2] }).runOnce();
    const materials = (await fixture.pool.query(`SELECT material.id,material.run_id,version.id AS version_id,version.file_ids FROM lms_materials material JOIN lms_material_versions version ON version.material_id=material.id ORDER BY material.run_id`)).rows;
    expect(materials).toHaveLength(2); expect(materials.map(row => row.file_ids)).toEqual([[uploaded.id], [uploaded.id]]);
    expect((await fixture.pool.query('SELECT course_id,run_id,purpose FROM lms_files WHERE id=$1', [uploaded.id])).rows[0]).toEqual({ course_id: 1, run_id: null, purpose: 'course_material' });
    const repository = new PostgresPortalResourceRepository(fixture.pool, async () => true);
    expect(await repository.readFile(learner, uploaded.id)).toBeNull();
    await fixture.pool.query("UPDATE lms_materials SET state='published' WHERE id=$1", [materials[0].id]);
    await fixture.pool.query("INSERT INTO lms_material_publications(material_id,material_version_id,enrollment_id,publish_at) VALUES($1,$2,1,now()-interval '1 day')", [materials[0].id, materials[0].version_id]);
    expect(await repository.readFile(learner, uploaded.id)).toMatchObject({ id: uploaded.id });
    expect(await repository.readFile({ ...learner, studentId: 2 }, uploaded.id)).toBeNull();
    expect(await repository.readFile({ ...learner, permissions: [] }, uploaded.id)).toBeNull();
    expect(await new PostgresPortalResourceRepository(fixture.pool, async () => false).readFile(learner, uploaded.id)).toBeNull();
    await fixture.pool.query(`UPDATE academy_groups SET selected_course_lesson_ids='["lesson-two"]' WHERE id=1`);
    expect(await repository.readFile(learner, uploaded.id)).toBeNull();
    await fixture.pool.query(`UPDATE academy_groups SET selected_course_lesson_ids='["lesson-one"]' WHERE id=1`);
    await expect(authorizeLmsFiles(fixture.pool, { userId: 1 }, [uploaded.id], { runId: materials[1].run_id })).rejects.toMatchObject({ code: 'portalFileNotReady' });
    await authorizeLmsFiles(fixture.pool, { userId: 1 }, [uploaded.id], { runId: materials[0].run_id, allowCourseMaterial: true });
    await authorizeLmsFiles(fixture.pool, { userId: 1 }, [uploaded.id], { runId: materials[1].run_id, allowCourseMaterial: true });
    expect((await fixture.pool.query('SELECT run_id FROM lms_files WHERE id=$1', [uploaded.id])).rows[0].run_id).toBeNull();
    const resources = new PortalResourceService(repository, new LocalResourceFileStore(path.join(directory, 'lms/files'), directory), createResourceTokenCodec('course-file-test-secret'), { appUrl: 'https://academy.test', publicPortfolioEnabled: () => false });
    const clone = await resources.cloneStaffFiles({ userId: 1, modules: ['administration'], isLeadership: true }, [uploaded.id], materials[0].run_id, materials[1].run_id);
    expect(clone.fileIds).toHaveLength(1); expect(clone.fileIds[0]).not.toBe(uploaded.id);
    expect((await fixture.pool.query('SELECT purpose,run_id FROM lms_files WHERE id=$1', [clone.fileIds[0]])).rows[0]).toEqual({ purpose: 'learning', run_id: String(materials[1].run_id) });
    await authorizeLmsFiles(fixture.pool, { userId: 1 }, clone.fileIds, { runId: Number(materials[1].run_id) });
    const learning = new PgLearningRepository(fixture.pool, authorizeLmsFiles, async () => true);
    const author = { userId: 1, modules: ['administration'], isLeadership: true };
    const authored = await learning.createMaterial(author, lmsMaterialSchema.parse({ runId: materials[1].run_id, title: 'Authored source', body: '', fileIds: [uploaded.id] }));
    await learning.reviseMaterial(author, authored.id, lmsMaterialSchema.parse({ runId: materials[1].run_id, title: 'Revised source', body: '', fileIds: [uploaded.id] }));
    const wrongVersion = (await fixture.pool.query("INSERT INTO lms_course_versions(course_id,version,created_by) VALUES(2,1,1) RETURNING id")).rows[0];
    const wrongRun = (await fixture.pool.query('INSERT INTO lms_group_runs(group_id,course_version_id) VALUES(3,$1) RETURNING id', [wrongVersion.id])).rows[0];
    await expect(authorizeLmsFiles(fixture.pool, { userId: 1 }, [uploaded.id], { runId: Number(wrongRun.id), allowCourseMaterial: true })).rejects.toMatchObject({ code: 'portalFileNotReady' });
    await expect(resources.cloneStaffFiles({ userId: 1, modules: ['administration'], isLeadership: true }, [uploaded.id], Number(wrongRun.id), materials[1].run_id)).rejects.toMatchObject({ code: 'portalNotFound' });
    await fixture.pool.query('UPDATE lms_material_publications SET revoked_at=now()');
    expect(await repository.readFile(learner, uploaded.id)).toBeNull();
    // A later publication without this attachment supersedes historical access to these bytes.
    const replacement = (await fixture.pool.query("INSERT INTO lms_material_versions(material_id,version,title,body,category,created_by) VALUES($1,2,'Replacement','','lesson',1) RETURNING id", [materials[0].id])).rows[0];
    await fixture.pool.query("INSERT INTO lms_material_publications(material_id,material_version_id,enrollment_id,publish_at) VALUES($1,$2,1,now())", [materials[0].id, replacement.id]);
    await fixture.pool.query('UPDATE lms_material_publications SET revoked_at=NULL');
    expect(await repository.readFile(learner, uploaded.id)).toBeNull();
    await fixture.pool.query("UPDATE lms_files SET attached_at=NULL,created_at=now()-interval '25 hours' WHERE id=$1", [uploaded.id]);
    await fixture.pool.query("UPDATE academy_courses SET program='[]' WHERE id=1");
    expect(await repository.cleanupFiles()).toEqual([]);
    expect((await fixture.pool.query('SELECT deleted_at FROM lms_files WHERE id=$1', [uploaded.id])).rows[0].deleted_at).toBeNull();
    await fixture.pool.query('UPDATE users SET is_active=false WHERE id=1');
    await expect(repository.readStaffFile(author, uploaded.id)).rejects.toMatchObject({ code: 'portalAccessDenied' });
  });
});
