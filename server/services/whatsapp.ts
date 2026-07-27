import { appConfig } from "../config";
import { logger } from "../lib/logger";
import { normalizeWhatsAppRecipient } from "./message-recipients";

const isWhatsAppConfigured = () =>
  Boolean(appConfig.integrations?.whatsapp?.apiToken && appConfig.integrations?.whatsapp?.phoneNumberId);

interface WhatsAppSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  simulated?: boolean;
  retryable?: boolean;
}

/**
 * Sends a WhatsApp Business Cloud API text message. Requires apiToken + phoneNumberId.
 * Recipient should be a phone number in international format without "+".
 * When not configured, the message is logged as a simulated send.
 */
export const sendWhatsAppMessage = async (
  recipient: string,
  text: string,
): Promise<WhatsAppSendResult> => {
  const phone = normalizeWhatsAppRecipient(recipient);
  if (!phone) {
    return {
      ok: false,
      retryable: false,
      error: "WhatsApp recipient must be a valid international phone number",
    };
  }

  const cfg = appConfig.integrations?.whatsapp;
  if (!isWhatsAppConfigured()) {
    logger.info("[whatsapp:simulated] message not sent (no api token)", { phone });
    return {
      ok: true,
      simulated: true,
      error: "WhatsApp api token / phone number id not configured",
    };
  }
  if (
    typeof text !== "string"
    || text.length === 0
    || text.length > 4096
    || !/^\d{5,30}$/.test(cfg!.phoneNumberId!.trim())
  ) {
    return {
      ok: false,
      retryable: false,
      error: "Invalid WhatsApp message configuration",
    };
  }

  let apiUrl: URL;
  try {
    apiUrl = new URL(cfg!.apiUrl || "https://graph.facebook.com/v19.0");
    if (apiUrl.protocol !== "https:") throw new Error("HTTPS is required");
    apiUrl.pathname = `${apiUrl.pathname.replace(/\/+$/, "")}/${cfg!.phoneNumberId!.trim()}/messages`;
    apiUrl.search = "";
    apiUrl.hash = "";
  } catch {
    return {
      ok: false,
      retryable: false,
      error: "Invalid WhatsApp API URL",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${cfg!.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: text },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        retryable: response.status === 429 || response.status >= 500,
        error: `WhatsApp API request failed (${response.status})`,
      };
    }

    const data = await response.json() as any;
    return { ok: true, messageId: data?.messages?.[0]?.id };
  } catch (error: any) {
    return {
      ok: false,
      retryable: true,
      error: error?.name === "AbortError"
        ? "WhatsApp API request timed out"
        : "WhatsApp API request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
};
