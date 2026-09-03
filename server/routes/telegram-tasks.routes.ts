import { Router, type Express, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { appConfig } from '../config';
import { authService } from '../services/auth';
import { createBoardRouter } from './board.routes';
import { bindTelegramTaskEmployee, getTelegramTaskIdentity, TelegramBindingDenied, telegramTaskAccess } from '../services/telegram-tasks';
import { secureEqual, signTaskToken, validateTelegramInitData, verifyTaskToken, type TaskToken } from '../services/telegram-tasks-crypto';

const messages = {
  ru: {
    share: 'Поделиться своим номером',
    welcome: 'Здравствуйте, {name}! Здесь ваши рабочие задачи.',
    register: 'Для доступа к задачам поделитесь своим номером кнопкой ниже. Номер должен быть указан в вашей карточке сотрудника CRM.',
    denied: 'Не удалось подтвердить сотрудника. Отправьте свой контакт кнопкой ниже. Если номер уже указан в CRM, попросите администратора проверить номер и привязку Telegram.',
    open: 'Открыть задачи',
  },
  en: {
    share: 'Share my phone number',
    welcome: 'Hello, {name}! Your work tasks are here.',
    register: 'To access tasks, share your phone number using the button below. It must match your employee profile in the CRM.',
    denied: 'Unable to verify your employee account. Share your own contact using the button below. If your number is already in the CRM, ask an administrator to check the number and Telegram binding.',
    open: 'Open tasks',
  },
};

export function registerTelegramTaskRoutes(app: Express) {
  const config = appConfig.integrations?.telegramTasks;
  const botToken = config?.botToken?.trim();
  const webhookSecret = config?.webhookSecret?.trim();
  const enabled = Boolean(botToken && webhookSecret);
  const botId = botToken?.split(':')[0] ?? '';
  const signingSecret = `${appConfig.session.secret}:telegram-tasks:${botToken ?? ''}`;
  const appUrl = new URL('/miniapp/tasks', appConfig.server.appUrl).href;
  const mini = Router();
  const board = createBoardRouter((_req, _res, next) => next());
  const issueToken = (identity: NonNullable<Awaited<ReturnType<typeof getTelegramTaskIdentity>>>) => {
    const iat = Math.floor(Date.now() / 1000);
    const payload: TaskToken = { scope: 'telegram-tasks', botId, telegramUserId: identity.binding.telegram_user_id,
      userId: identity.user.id, verificationId: identity.binding.verification_id, iat, exp: iat + 43200 };
    return signTaskToken(payload, signingSecret);
  };
  const authorize: RequestHandler = async (req, res, next) => {
    let payload: TaskToken;
    try {
      payload = verifyTaskToken(req.header('Authorization')?.replace(/^Bearer /, ''), signingSecret, 'telegram-tasks');
      if (payload.botId !== botId) throw new Error('Wrong bot');
    } catch {
      return void res.status(401).json({ error: 'miniTasksSessionExpired' });
    }
    try {
      const identity = await getTelegramTaskIdentity(botId, payload.telegramUserId, payload);
      if (!identity) return void res.status(401).json({ error: 'miniTasksSessionExpired' });
      req.user = identity.user;
      res.locals.telegramTaskToken = payload;
      next();
    } catch {
      res.status(503).json({ error: 'miniTasksUnavailable' });
    }
  };

  app.post('/api/incoming/telegram-tasks', async (req, res) => {
    if (!enabled) return void res.sendStatus(503);
    if (!secureEqual(req.header('X-Telegram-Bot-Api-Secret-Token') ?? '', webhookSecret!)) return void res.sendStatus(403);
    const message = req.body?.message;
    const sender = message?.from;
    if (!message || message.chat?.type !== 'private' || !Number.isSafeInteger(sender?.id) || sender.id <= 0
      || sender.is_bot || message.chat.id !== sender.id) return void res.json({ ok: true });
    const text = sender.language_code === 'en' ? messages.en : messages.ru;
    const keyboard = { keyboard: [[{ text: text.share, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
    const reply = (body: string, replyMarkup: object) => res.json({ method: 'sendMessage', chat_id: sender.id, text: body, reply_markup: replyMarkup });
    try {
      let identity;
      if (message.contact) {
        if (message.contact.user_id !== sender.id || message.forward_origin || message.forward_date) {
          return void reply(text.denied, keyboard);
        }
        identity = await bindTelegramTaskEmployee(botId, String(sender.id), message.contact.phone_number);
        if (!identity) return void reply(text.denied, keyboard);
      } else {
        identity = await getTelegramTaskIdentity(botId, String(sender.id));
      }
      if (!identity) return void reply(text.register, keyboard);
      reply(text.welcome.replace('{name}', identity.user.fullName), {
        inline_keyboard: [[{ text: text.open, web_app: { url: appUrl } }]],
      });
    } catch (error) {
      if (error instanceof TelegramBindingDenied) return void reply(text.denied, keyboard);
      // No update bodies, contact numbers, tokens or Telegram URLs in logs.
      res.sendStatus(503);
    }
  });

  mini.use((_req, res, next) => enabled ? next() : res.status(503).json({ error: 'miniTasksUnavailable' }));
  mini.post('/auth', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    let telegramUserId: string;
    try {
      telegramUserId = validateTelegramInitData(req.body?.initData, botToken!);
    } catch {
      return void res.status(401).json({ error: 'miniTasksSessionExpired' });
    }
    try {
      const identity = await getTelegramTaskIdentity(botId, telegramUserId);
      if (!identity) return void res.status(401).json({ error: 'miniTasksSessionExpired' });
      res.json({ token: issueToken(identity), session: { kind: 'user', user: authService.sanitizeUser(identity.user) } });
    } catch {
      res.status(503).json({ error: 'miniTasksUnavailable' });
    }
  });
  mini.get('/auth/session', authorize, (req, res) => res.json({ kind: 'user', user: authService.sanitizeUser(req.user!) }));
  mini.get('/users', authorize, async (_req, res) => {
    try {
      res.json(await telegramTaskAccess.getAssignableUsers());
    } catch { res.status(503).json({ error: 'miniTasksUnavailable' }); }
  });
  mini.post('/attachments/:id/link', authorize, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return void res.sendStatus(400);
      if (!await telegramTaskAccess.canDownload(req.user!, id)) {
        return void res.sendStatus(403);
      }
      const iat = Math.floor(Date.now() / 1000);
      const ticket = signTaskToken({ ...res.locals.telegramTaskToken, scope: 'telegram-task-file', attachmentId: id, iat, exp: iat + 120 }, signingSecret);
      const url = new URL(`/api/miniapp/files/${id}`, appConfig.server.appUrl);
      url.searchParams.set('ticket', ticket);
      res.json({ url: url.href });
    } catch { res.status(503).json({ error: 'miniTasksUnavailable' }); }
  });
  mini.get('/files/:id', async (req, res, next) => {
    let payload: TaskToken;
    try {
      payload = verifyTaskToken(req.query.ticket, signingSecret, 'telegram-task-file');
      if (payload.botId !== botId || payload.attachmentId !== Number(req.params.id)) throw new Error('Invalid file');
    } catch { return void res.sendStatus(401); }
    try {
      const identity = await getTelegramTaskIdentity(botId, payload.telegramUserId, payload);
      if (!identity) return void res.sendStatus(401);
      req.user = identity.user;
      req.url = `/attachments/${payload.attachmentId}/download`;
      res.setHeader('Referrer-Policy', 'no-referrer');
      board(req, res, next);
    } catch { res.sendStatus(503); }
  });
  mini.use('/board', authorize, (req, res, next) => {
    // Mini App cannot create/reassign CRM lead links, even for administrators.
    if (req.body?.leadId != null) return void res.status(403).json({ error: 'accessDenied' });
    next();
  }, board);
  mini.use((_req, res) => res.sendStatus(404));
  // Deliberately mounted before CRM session middleware: bearer access never becomes a CRM session.
  app.use('/api/miniapp', mini);
}
