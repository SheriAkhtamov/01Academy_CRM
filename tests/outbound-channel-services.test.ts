import { describe, expect, it, vi } from "vitest";
import { sendPlainTelegramText, sendTelegramMessage } from "../server/services/telegram";
import { sendWhatsAppMessage } from "../server/services/whatsapp";

describe("outbound channel validation", () => {
  it("rejects an unconfigured Telegram target as a permanent error", async () => {
    await expect(sendTelegramMessage("998901234567", "hello")).resolves.toMatchObject({
      ok: false,
      retryable: false,
    });
  });

  it("passes Telegram outbox content as plain text without parse mode", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 9 });

    await sendPlainTelegramText(
      { sendMessage },
      "-1001234567890",
      "<b>customer & manager</b>",
    );

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(
      "-1001234567890",
      "<b>customer & manager</b>",
    );
  });

  it("rejects an invalid WhatsApp address before simulated delivery", async () => {
    await expect(sendWhatsAppMessage("@customer", "hello")).resolves.toMatchObject({
      ok: false,
      retryable: false,
    });
  });

  it("normalizes a valid WhatsApp address for the configured-or-simulated path", async () => {
    await expect(sendWhatsAppMessage("+998 (90) 123-45-67", "hello")).resolves.toMatchObject({
      ok: true,
      simulated: true,
    });
  });
});
