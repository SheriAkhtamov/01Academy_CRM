import { appConfig } from "../config";
import { logger } from "../lib/logger";

let botClient: any = null;
let initError: string | null = null;

const getBot = () => {
  const token = appConfig.integrations?.telegram?.botToken;
  if (!token) {
    return null;
  }

  if (botClient) {
    return botClient;
  }

  try {
    // Lazy require so the dependency is only loaded when configured.
    const TelegramBot = require("node-telegram-bot-api");
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
}

/**
 * Sends a text message to a chat. Recipient can be a numeric chat id, a @username,
 * or a phone number (prefixed with "+" — Telegram requires the contact to be shared first).
 * When the bot is not configured, the message is logged as a simulated send.
 */
export const sendTelegramMessage = async (
  recipient: string,
  text: string,
): Promise<TelegramSendResult> => {
  const bot = getBot();
  const chatId = appConfig.integrations?.telegram?.leadershipChatId && isLeadershipRecipient(recipient)
    ? appConfig.integrations.telegram.leadershipChatId
    : recipient;

  if (!bot) {
    logger.info("[telegram:simulated] message not sent (no bot token)", { recipient, text });
    return {
      ok: true,
      simulated: true,
      error: initError ?? "Telegram bot token not configured",
    };
  }

  try {
    const result = await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
    return { ok: true, messageId: result?.message_id };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? String(error) };
  }
};

const isLeadershipRecipient = (recipient: string) =>
  ["leadership", "руководств", "head", "admin"].some((token) => recipient.toLowerCase().includes(token));
