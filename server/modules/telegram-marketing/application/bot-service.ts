import { marketingBotCourses, marketingBotStateSchema, type MarketingBotCourse, type MarketingBotState } from '@shared/contracts/telegram-marketing';
import type { MarketingBotConfig, MarketingBotEvent, MarketingBotPorts, TelegramMethod } from './ports';
import { marketingPeriod, parseMarketingDates, validMarketingPeriod } from '../domain/period';
import { summarizeMarketingLeads } from '../domain/report';
import {
  formatMarketingReport, marketingCourseKeyboard, marketingDatePrompt,
  marketingMainKeyboard, marketingPeriodKeyboard,
} from '../domain/presentation';

export function createMarketingBotService(ports: MarketingBotPorts) {
  return async (config: MarketingBotConfig, event: MarketingBotEvent): Promise<TelegramMethod> => {
    const botId = config.botToken.split(':')[0];
    const chatId = String(event.chatId);
    const group = event.chatId < 0;
    const now = ports.now();
    const reply = (text: string, keyboard?: object, sendNew = false): TelegramMethod => ({
      method: !sendNew && event.callbackId && event.messageId ? 'editMessageText' : 'sendMessage',
      chat_id: event.chatId,
      ...(!sendNew && event.callbackId && event.messageId ? { message_id: event.messageId } : {}),
      text, ...(keyboard ? { reply_markup: keyboard } : {}),
    });
    const passwordPrompt = (text = group
      ? '🔐 Ответьте на это сообщение паролем. Доступ откроется всем участникам этой группы.'
      : '🔐 Введите пароль доступа к отчётам.') => reply(text, group
      ? { force_reply: true, input_field_placeholder: 'Пароль доступа' } : undefined, group);
    if (event.callbackId) {
      // Clear Telegram's loading indicator even when the session has expired.
      await ports.telegram(config.botToken, 'answerCallbackQuery', { callback_query_id: event.callbackId });
    }
    let session = await ports.access.get(botId, chatId, config.passwordHash);
    let connectedGroup = false;
    if (!session) {
      if (event.callbackId || event.text.startsWith('/')) return passwordPrompt();
      const result = await ports.access.authenticate(botId, chatId, event.text, config.passwordHash);
      // Never retain the password as a visible message when Telegram permits deletion.
      if (event.messageId) await ports.telegram(config.botToken, 'deleteMessage', {
        chat_id: event.chatId, message_id: event.messageId,
      }).catch(() => undefined);
      if (result === 'locked') return reply('Слишком много попыток. Повторите вход через 15 минут.');
      if (result !== 'ok') return passwordPrompt('Неверный пароль. Попробуйте ещё раз.');
      session = { state: {} };
      connectedGroup = group;
    }

    const parsed = marketingBotStateSchema.safeParse(session.state);
    let state: MarketingBotState = parsed.success && validMarketingPeriod(parsed.data.from, parsed.data.to, now)
      ? parsed.data : { ...marketingPeriod('week', now), course: 'all', awaitingDates: false };
    const save = () => ports.access.saveState(botId, chatId, config.passwordHash, state);
    const action = event.callbackId ? event.text : '';
    if (action === 'mr:logout' || event.text === '/logout') {
      await ports.access.logout(botId, chatId);
      return group ? passwordPrompt('Доступ группы отключён. Ответьте паролем на это сообщение, чтобы подключить её снова.')
        : reply('Вы вышли. Для входа отправьте пароль.', { inline_keyboard: [] });
    }
    if (action === 'mr:period') return reply('📅 Период поступления заявок', marketingPeriodKeyboard);
    if (action === 'mr:courses') return reply('🎓 Выберите курс', marketingCourseKeyboard);
    if (action === 'mr:custom') {
      state.awaitingDates = true;
      await save();
      return group ? reply(marketingDatePrompt, { force_reply: true, input_field_placeholder: '01.10.2026 — 23.10.2026' }, true)
        : reply(marketingDatePrompt, { inline_keyboard: [[{ text: '← К отчёту', callback_data: 'mr:refresh' }]] });
    }
    if (!event.callbackId && state.awaitingDates && !event.text.startsWith('/')) {
      const range = parseMarketingDates(event.text, now);
      if (!range) return reply(`Проверьте даты: не позднее сегодня, период до 366 дней.\n${marketingDatePrompt}`,
        group ? { force_reply: true } : undefined, group);
      state = { ...state, ...range, awaitingDates: false };
    }
    if (action.startsWith('mr:p:')) {
      const preset = action.slice(5);
      if (['today', 'yesterday', 'week', 'month', 'previous'].includes(preset)) {
        state = { ...state, ...marketingPeriod(preset, now), awaitingDates: false };
      }
    }
    if (action.startsWith('mr:c:') && marketingBotCourses.includes(action.slice(5) as MarketingBotCourse)) {
      state.course = action.slice(5) as MarketingBotCourse;
    }
    if (action === 'mr:refresh' || event.text.startsWith('/')) state.awaitingDates = false;
    await save();
    const facts = await ports.facts(state, now);
    // Recheck access after the potentially expensive report read.
    if (!await ports.access.get(botId, chatId, config.passwordHash)) return passwordPrompt();
    const report = formatMarketingReport(summarizeMarketingLeads(facts, state.course), state, now);
    return reply(`${connectedGroup ? '✅ Группа подключена. Отчёты доступны всем участникам.\n\n' : ''}${report}`, marketingMainKeyboard);
  };
}
