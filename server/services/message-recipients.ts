const TELEGRAM_CHAT_ID_LIMIT = 4_503_599_627_370_495n; // Telegram chat ids use at most 52 significant bits.
const LEADERSHIP_ALIASES = new Set([
  "leadership",
  "head",
  "admin",
  "руководство",
]);

/**
 * Telegram bots address private users and groups by their numeric chat id.
 * A phone number, CRM user id chosen by coincidence, or a person's @username
 * is not a Bot API address and must never be treated as one.
 */
export const normalizeTelegramChatId = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  if (!/^-?[1-9]\d*$/.test(normalized)) return null;

  try {
    const numeric = BigInt(normalized);
    const absolute = numeric < 0n ? -numeric : numeric;
    return absolute <= TELEGRAM_CHAT_ID_LIMIT ? normalized : null;
  } catch {
    return null;
  }
};

export const isLeadershipRecipient = (value: unknown): boolean =>
  LEADERSHIP_ALIASES.has(String(value ?? "").trim().toLowerCase());

export const resolveTelegramChatId = (
  recipient: unknown,
  leadershipChatId?: unknown,
): string | null => {
  const configuredChatId = normalizeTelegramChatId(leadershipChatId);
  if (!configuredChatId) return null;

  if (isLeadershipRecipient(recipient)) return configuredChatId;
  const requestedChatId = normalizeTelegramChatId(recipient);
  return requestedChatId === configuredChatId ? requestedChatId : null;
};

/**
 * Normalises a WhatsApp destination to the digits-only E.164 representation
 * expected by the Cloud API. Nine-digit local Uzbek numbers are expanded with
 * country code 998 because the CRM is deployed for Uzbekistan.
 */
export const normalizeWhatsAppRecipient = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return null;

  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = `998${digits}`;

  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
};

export const normalizeOutboxRecipient = (
  channel: unknown,
  recipient: unknown,
  configuredTelegramChatId?: unknown,
): string | null => {
  switch (String(channel ?? "").trim().toLowerCase()) {
    case "telegram":
      return resolveTelegramChatId(recipient, configuredTelegramChatId);
    case "whatsapp":
      return normalizeWhatsAppRecipient(recipient);
    default:
      return null;
  }
};
