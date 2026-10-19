import { telegramTaskKeyboard, type TelegramTaskButton } from './telegram-task-keyboard';

export type TelegramDelivery = { status: 'sent' | 'deferred' | 'failed' | 'uncertain'; code: number | null; retrySeconds: number | null };

export async function sendTelegramTaskReminder(botToken: string, chatId: string, text: string, appUrl: string, buttons?: TelegramTaskButton[]): Promise<TelegramDelivery> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true },
        reply_markup: telegramTaskKeyboard(appUrl, buttons) }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { ok?: boolean; error_code?: number; parameters?: { retry_after?: number } };
    if (response.ok && result.ok === true) return { status: 'sent', code: null, retrySeconds: null };
    const code = Number(result.error_code ?? response.status);
    if (code === 429) {
      const retry = Number(result.parameters?.retry_after);
      return { status: 'deferred', code, retrySeconds: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 60 };
    }
    return { status: code >= 500 ? 'uncertain' : 'failed', code, retrySeconds: null };
  } catch {
    // Telegram may have accepted a timed-out request; never blindly resend it.
    return { status: 'uncertain', code: null, retrySeconds: null };
  }
}
