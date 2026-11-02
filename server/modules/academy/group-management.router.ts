import { getGroupCodeCatalogue } from './group-code';
import type { Router } from 'express';
import { ensureSalesAccess } from './academy-core';
import { getAcademyDataset } from './academy-analytics';
import { logger } from '../../lib/logger';
import { listEligibleGroupTeachers } from './group-teacher-eligibility';

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
  router.get('/enrollment-groups', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    try {
      const dataset = await getAcademyDataset(undefined, { include: ['groups'], includePlannedGroups: true });
      res.json(dataset.groups.filter(group => !group.isArchived && ['planned', 'open', 'in_progress'].includes(group.status))
        .sort((a, b) => Number(b.status === 'planned') - Number(a.status === 'planned')));
    } catch (error) {
      logger.error('Failed to fetch enrollment groups', { error });
      res.status(500).json({ error: 'failedToLoadData' });
    }
  });
  router.get('/group-configuration', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    try {
      const [dataset, teachers] = await Promise.all([
        getAcademyDataset(undefined, { include: ['schools', 'rooms', 'courses', 'groups'] }),
        listEligibleGroupTeachers(),
      ]);
      res.json({
        schools: dataset.schools,
        rooms: dataset.rooms,
        courses: dataset.courses,
        teachers,
        groups: dataset.groups,
      });
    } catch (error) {
      logger.error('Failed to fetch group configuration', { error });
      res.status(500).json({ error: 'failedToLoadData' });
    }
  });
}
