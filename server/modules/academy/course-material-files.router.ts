import fs from 'node:fs/promises';
import type { Router, RequestHandler } from 'express';
import { PortalResourceError } from '../portal-resources/domain/policy';
import { createResourceUploadParser } from '../portal-resources/infrastructure/upload-parser';
import { ensureAdministrationModuleAccess, parseId } from './academy-core';
import { assertCourseFileAdministrator, CourseMaterialFileService } from './course-material-files';

const uploadedName = (value: string) => {
  if (![...value].every(character => character.charCodeAt(0) <= 255) || !/[\u0080-\u00ff]/.test(value)) return value;
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? value : decoded;
};

const handled = (operation: RequestHandler): RequestHandler => async (request, response, next) => {
  try { await operation(request, response, next); }
  catch (error) { if (error instanceof PortalResourceError) response.status(error.statusCode).json({ error: error.code }); else next(error); }
};

export function registerCourseMaterialFileRoutes(router: Router, service = new CourseMaterialFileService(), parser = createResourceUploadParser()) {
  const authorize: RequestHandler = handled(async (request, response, next) => {
    if (!ensureAdministrationModuleAccess(request, response)) return;
    await assertCourseFileAdministrator(request.user!.id);
    next();
  });
  router.post('/course-material-files', authorize, parser, handled(async (request, response) => {
    try {
      if (!request.file) throw new PortalResourceError('portalFileRequired');
      response.status(201).json(await service.upload(request.user!.id, request.file.path, uploadedName(request.file.originalname)));
    } finally {
      if (request.file) await fs.unlink(request.file.path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
  }));
  for (const download of [false, true]) router.get(`/course-material-files/:id/${download ? 'download' : 'status'}`, authorize, handled(async (request, response) => {
    const id = parseId(request.params.id);
    if (!id) throw new PortalResourceError('portalNotFound', 404);
    const result = await service.file(request.user!.id, id, download);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!download) { response.json(result.file); return; }
    response.type(result.file.mime).download(result.path, result.file.name);
  }));
}
