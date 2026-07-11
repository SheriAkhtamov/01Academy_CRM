import { appConfig } from "../config";
import { logger } from "../lib/logger";
import { resolveTelegramChatId } from "./message-recipients";

let botClient: any = null;
let initError: string | null = null;

const getBot = async () => {
  const token = appConfig.integrations?.telegram?.botToken;
  if (!token) {
    return null;
  }

  if (botClient) {
    return botClient;
  }

  try {
    // The server is emitted as ESM. Dynamic import keeps initialization lazy
    // without relying on CommonJS `require`, which is unavailable in the
    // production bundle and previously downgraded configured sends to a
    // misleading simulation.
    const telegramModule = await import("node-telegram-bot-api");
    const TelegramBot = (telegramModule as any).default ?? telegramModule;
    botClient = new TelegramBot(token, { polling: false });
    initError = null;
    logger.info("Telegram bot client initialized");
    return botClient;
  } catch (error: any) {
    initError = error?.message ?? String(error);
    logger.error("Failed to initialize Telegram bot client", { error });
    return null;
  }
};

interface TelegramSendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
  simulated?: boolean;
  retryable?: boolean;
}

interface TelegramClient {
  sendMessage: (chatId: string, text: string) => Promise<{ message_id?: number }>;
}

export const sendPlainTelegramText = (
  client: TelegramClient,
  chatId: string,
  text: string,
) => client.sendMessage(chatId, text);

/**
 * Sends plain text only to the numeric chat id explicitly configured for the
 * leadership channel. The special leadership alias resolves to that same id.
 * Bot API cannot address a private user by phone number or @username.
 * When the bot is not configured, the message is logged as a simulated send.
 */
export const sendTelegramMessage = async (
  recipient: string,
  text: string,
): Promise<TelegramSendResult> => {
  const chatId = resolveTelegramChatId(
    recipient,
    appConfig.integrations?.telegram?.leadershipChatId,
  );
  if (!chatId) {
    return {
      ok: false,
      retryable: false,
      error: "Telegram recipient must match the configured numeric chat id",
    };
  }

  const bot = await getBot();

  if (!bot) {
    logger.info("[telegram:simulated] message not sent (no bot token)", { chatId });
    return {
      ok: true,
      simulated: true,
      error: initError ?? "Telegram bot token not configured",
    };
  }

  try {
    // Outbox content contains customer and employee supplied values. Sending it
    // as plain text avoids malformed HTML and markup injection.
    const result = await sendPlainTelegramText(bot, chatId, text);
    return { ok: true, messageId: result?.message_id };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? String(error) };
  }
};
