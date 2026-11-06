import type { Router } from 'express';
import { ensureSalesAccess, parseId } from './academy-core';
import { getDemoParticipantCard } from './demo-participant-card';
import { sendHttpError } from '../../lib/http-errors';

export function registerDemoParticipantCardRoutes(router: Router) {
  router.get('/demo-lessons/:id/participants/:participantId/card', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const demoId = parseId(req.params.id);
    const participantId = parseId(req.params.participantId);
    if (!demoId || !participantId) return res.status(400).json({ error: 'invalidData' });
    try {
      const card = await getDemoParticipantCard(demoId, participantId);
      if (!card) return res.status(404).json({ error: 'demoParticipantNotFound' });
      res.json(card);
    } catch (error) {
      sendHttpError(res, error, 'failedToLoadData');
    }
  });
}
