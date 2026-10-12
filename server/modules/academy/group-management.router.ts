import { getGroupCodeCatalogue } from './group-code';
import type { Router } from 'express';
import { ensureSalesAccess } from './academy-core';
import { getAcademyDataset } from './academy-analytics';
import { logger } from '../../lib/logger';

export function registerGroupManagementRoutes(router: ReturnType<typeof Router>) {
  router.get('/group-code-catalogue', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    try {
      res.json(await getGroupCodeCatalogue());
    } catch (error) {
      logger.error('Failed to fetch group codes', { error });
      res.status(500).json({ error: 'failedToLoadData' });
    }
  });
  router.get('/group-configuration', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    try {
      const dataset = await getAcademyDataset(undefined, {
        include: ['schools', 'rooms', 'courses', 'teachers', 'groups'],
      });
      res.json({
        schools: dataset.schools,
        rooms: dataset.rooms,
        courses: dataset.courses,
        teachers: dataset.teachers,
        groups: dataset.groups,
      });
    } catch (error) {
      logger.error('Failed to fetch group configuration', { error });
      res.status(500).json({ error: 'failedToLoadData' });
    }
  });
}
