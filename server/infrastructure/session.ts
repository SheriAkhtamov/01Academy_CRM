import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { pool } from '../db';
import { appConfig, secureSessionCookies } from '../config';

const PgStore = pgSession(session);

export type SessionMiddleware = ReturnType<typeof session>;

export const createSessionMiddleware = (): SessionMiddleware => {
  const sessionSecret = appConfig.session.secret;
  if (!sessionSecret) {
    throw new Error('session.secret is required in config/app.config.json');
  }

  return session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'academy.sid',
    store: new PgStore({
      pool,
      tableName: 'session',
      createTableIfMissing: false,
    }),
    cookie: {
      secure: secureSessionCookies,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      priority: 'high',
      path: '/',
    },
  });
};
