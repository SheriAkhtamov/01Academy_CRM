import { telegramTaskUrl, type TelegramTaskDestination } from '@shared/telegram-task-links';
import { t } from '../lib/i18n';

export type TelegramTaskButton = { text: string; destination: TelegramTaskDestination };

export function telegramTaskKeyboard(appUrl: string, buttons?: TelegramTaskButton[]) {
  return { inline_keyboard: (buttons?.length ? buttons : [{ text: t('telegramReminderOpen'), destination: {} }])
    .map((button) => [{ text: Array.from(button.text).slice(0, 60).join(''), web_app: { url: telegramTaskUrl(appUrl, button.destination) } }]) };
}
