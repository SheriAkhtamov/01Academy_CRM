import { Router } from 'express';
import { releaseTelephonyLineSchema, reserveTelephonyLineSchema, telephonyLineLeaseSchema, TELEPHONY_REMINDER_LINE_BUSY } from '@shared/contracts/telephony-lines';
import { canAccessAcademyModule } from '@shared/academy';
import { onlinePbxRoutingDestination } from '@shared/telephony';
import type { TelephonyChannelReservations } from '../../../infrastructure/voice-telephony/channel-reservations';
import { TelephonyReminderLineBusyError } from '../domain/telephony-line-policy';

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
    } catch (error) {
      response.status(error instanceof TelephonyReminderLineBusyError ? 409 : 503)
        .json({ error: error instanceof TelephonyReminderLineBusyError ? TELEPHONY_REMINDER_LINE_BUSY : 'onlinePbxUnavailable' });
    }
  });
  router.post('/lines/renew', async (request, response) => {
    const parsed = telephonyLineLeaseSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'onlinePbxInvalidCallEvent' }); return; }
    try { response.json({ alive: await channels.renew(parsed.data.id, 'manager', request.user!.id) }); }
    catch { response.status(503).json({ error: 'onlinePbxUnavailable' }); }
  });
  router.post('/lines/authorize', async (request, response) => {
    const parsed = telephonyLineLeaseSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'onlinePbxInvalidCallEvent' }); return; }
    try {
      response.json({ authorized: await channels.authorizeManagerDial(
        parsed.data.id, request.user!.id, request.user!.onlinePbxExtension!,
      ) });
    } catch (error) {
      response.status(error instanceof TelephonyReminderLineBusyError ? 409 : 503)
        .json({ error: error instanceof TelephonyReminderLineBusyError ? TELEPHONY_REMINDER_LINE_BUSY : 'onlinePbxUnavailable' });
    }
  });
  router.post('/lines/release', async (request, response) => {
    const parsed = releaseTelephonyLineSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'onlinePbxInvalidCallEvent' }); return; }
    try {
      response.json({ released: await channels.release(parsed.data.id, 'manager', request.user!.id, parsed.data.beforeInvite) });
    }
    catch { response.status(503).json({ error: 'onlinePbxUnavailable' }); }
  });
  return router;
};
