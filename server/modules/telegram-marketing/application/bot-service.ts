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
    const now = ports.now();
    const reply = (text: string, keyboard?: object): TelegramMethod => ({
      method: event.callbackId && event.messageId ? 'editMessageText' : 'sendMessage',
      chat_id: event.chatId,
      ...(event.callbackId && event.messageId ? { message_id: event.messageId } : {}),
      text, ...(keyboard ? { reply_markup: keyboard } : {}),
    });
    if (event.callbackId) {
      // Clear Telegram's loading indicator even when the session has expired.
      await ports.telegram(config.botToken, 'answerCallbackQuery', { callback_query_id: event.callbackId });
    }
    let session = await ports.access.get(botId, event.userId, config.passwordHash);
    if (!session) {
      if (event.callbackId || event.text.startsWith('/')) return reply('🔐 Введите пароль доступа к отчётам.');
      const result = await ports.access.authenticate(botId, event.userId, event.text, config.passwordHash);
      // Never retain the password as a visible message when Telegram permits deletion.
      if (event.messageId) await ports.telegram(config.botToken, 'deleteMessage', {
        chat_id: event.chatId, message_id: event.messageId,
      }).catch(() => undefined);
      if (result === 'locked') return reply('Слишком много попыток. Повторите вход через 15 минут.');
      if (result !== 'ok') return reply('Неверный пароль. Попробуйте ещё раз.');
      session = { state: {} };
    }

    const parsed = marketingBotStateSchema.safeParse(session.state);
    let state: MarketingBotState = parsed.success && validMarketingPeriod(parsed.data.from, parsed.data.to, now)
      ? parsed.data : { ...marketingPeriod('week', now), course: 'all', awaitingDates: false };
    const save = () => ports.access.saveState(botId, event.userId, config.passwordHash, state);
    const action = event.callbackId ? event.text : '';
    if (action === 'mr:logout' || event.text === '/logout') {
      await ports.access.logout(botId, event.userId);
      return reply('Вы вышли. Для входа отправьте пароль.', { inline_keyboard: [] });
    }
    if (action === 'mr:period') return reply('📅 Период поступления заявок', marketingPeriodKeyboard);
    if (action === 'mr:courses') return reply('🎓 Выберите курс', marketingCourseKeyboard);
    if (action === 'mr:custom') {
      state.awaitingDates = true;
      await save();
      return reply(marketingDatePrompt, { inline_keyboard: [[{ text: '← К отчёту', callback_data: 'mr:refresh' }]] });
    }
    if (!event.callbackId && state.awaitingDates && !event.text.startsWith('/')) {
      const range = parseMarketingDates(event.text, now);
      if (!range) return reply(`Проверьте даты: не позднее сегодня, период до 366 дней.\n${marketingDatePrompt}`);
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
    if (!await ports.access.get(botId, event.userId, config.passwordHash)) return reply('🔐 Введите пароль доступа к отчётам.');
    return reply(formatMarketingReport(summarizeMarketingLeads(facts, state.course), state, now), marketingMainKeyboard);
  };
}
