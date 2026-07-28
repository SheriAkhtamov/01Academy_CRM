import type { Express } from 'express';
import academyRoutes from '../modules/academy';
import authRoutes from './auth.routes';
import boardRoutes from './board.routes';
import financeRoutes from './finance.routes';
import incomingRoutes from './incoming.routes';
import instagramRoutes from './instagram.routes';
import messageRoutes from './message.routes';
import notificationsRoutes from './notifications.routes';
import telephonyRoutes from './telephony.routes';
import userRoutes from './user.routes';

/**
 * API composition belongs here; transport concerns such as sessions,
 * WebSockets, static assets and process lifecycle stay in the app bootstrap.
 */
export const registerApiRoutes = (app: Express): void => {
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/academy', academyRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/board', boardRoutes);
  app.use('/api/telephony', telephonyRoutes);
  app.use('/api/instagram', instagramRoutes);

  // Public inbound webhooks authenticate with provider-specific secrets.
  app.use('/api/incoming', incomingRoutes);
};
