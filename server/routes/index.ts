import type { Express } from 'express';
import academyRoutes from '../modules/academy';
import authRoutes from './auth.routes';
import clientErrorsRoutes from './client-errors.routes';
import boardRoutes from './board.routes';
import financeRoutes from './finance.routes';
import incomingRoutes from './incoming.routes';
import instagramRoutes from './instagram.routes';
import messageRoutes from './message.routes';
import chatGroupRoutes from '../services/chat-groups';
import { updatesRouter } from '../infrastructure/platform-updates';
import notificationsRoutes from './notifications.routes';
import telephonyRoutes, { createTelephonyRouter } from './telephony.routes';
import { createTelephonyLinesRouter } from '../modules/voice-reminders/http/telephony-lines.router';
import type { createVoiceRemindersRuntime } from '../infrastructure/voice-reminders-runtime';
import { requireAuth } from '../middleware/auth.middleware';
import userRoutes from './user.routes';
import publicAttendanceRoutes from './public-attendance.routes';

/**
 * API composition belongs here; transport concerns such as sessions,
 * WebSockets, static assets and process lifecycle stay in the app bootstrap.
 */
export const registerApiRoutes = (app: Express, voiceReminders?: ReturnType<typeof createVoiceRemindersRuntime>): void => {
  app.use('/api/public/attendance', publicAttendanceRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/client-errors', clientErrorsRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/chat-groups', chatGroupRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/updates', updatesRouter);
  if (voiceReminders) {
    app.use('/api/academy/voice-reminders', requireAuth);
    app.use('/api/academy', voiceReminders.router);
  }
  app.use('/api/academy', academyRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/board', boardRoutes);
  if (voiceReminders) {
    app.use('/api/telephony/lines', requireAuth);
    app.use('/api/telephony', createTelephonyLinesRouter(voiceReminders.channels));
  }
  app.use('/api/telephony', voiceReminders ? createTelephonyRouter(voiceReminders.observeRobotCall) : telephonyRoutes);
  app.use('/api/instagram', instagramRoutes);

  // Public inbound webhooks authenticate with provider-specific secrets.
  app.use('/api/incoming', incomingRoutes);
};
