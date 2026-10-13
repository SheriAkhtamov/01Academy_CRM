import { Router } from 'express';
import { reserveTelephonyLineSchema, telephonyLineLeaseSchema } from '@shared/contracts/telephony-lines';
import { canAccessAcademyModule } from '@shared/academy';
import { onlinePbxRoutingDestination } from '@shared/telephony';
import type { TelephonyChannelReservations } from '../../../infrastructure/voice-telephony/channel-reservations';

export const createTelephonyLinesRouter = (channels: TelephonyChannelReservations) => {
  const router = Router();
  router.use('/lines', (request, response, next) => {
    if (!request.user?.id) { response.status(401).json({ error: 'authenticationRequired' }); return; }
    if (!canAccessAcademyModule(request.user, 'sales') || !request.user.onlinePbxIncomingEnabled
      || !onlinePbxRoutingDestination(request.user.onlinePbxExtension)) {
      response.status(403).json({ error: 'onlinePbxManagerNotAssigned' }); return;
    }
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.post('/lines/reserve', async (request, response) => {
    const parsed = reserveTelephonyLineSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'onlinePbxInvalidCallEvent' }); return; }
    try {
      if (!await channels.enabled()) { response.json({ id: null }); return; }
      const lease = await channels.acquire({
        owner: 'manager', userId: request.user!.id, extensions: [request.user!.onlinePbxExtension!], ...parsed.data,
      });
      if (!lease) { response.status(409).json({ error: 'onlinePbxTooManyCalls' }); return; }
      response.json({ id: lease.id });
    } catch { response.status(503).json({ error: 'onlinePbxUnavailable' }); }
  });
  router.post('/lines/renew', async (request, response) => {
    const parsed = telephonyLineLeaseSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'onlinePbxInvalidCallEvent' }); return; }
    try { response.json({ alive: await channels.renew(parsed.data.id, 'manager', request.user!.id) }); }
    catch { response.status(503).json({ error: 'onlinePbxUnavailable' }); }
  });
  router.post('/lines/release', async (request, response) => {
    const parsed = telephonyLineLeaseSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'onlinePbxInvalidCallEvent' }); return; }
    try { await channels.release(parsed.data.id, 'manager', request.user!.id); response.json({ ok: true }); }
    catch { response.status(503).json({ error: 'onlinePbxUnavailable' }); }
  });
  return router;
};
