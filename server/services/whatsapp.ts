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

  const apiUrl = `${cfg!.apiUrl}/${cfg!.phoneNumberId}/messages`;

  try {
    // Native fetch is available in Node 18+.
    const response = await fetch(apiUrl, {
      method: "POST",
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
      const body = await response.text();
      return { ok: false, error: `WhatsApp API ${response.status}: ${body}` };
    }

    const data = await response.json() as any;
    return { ok: true, messageId: data?.messages?.[0]?.id };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? String(error) };
  }
};
