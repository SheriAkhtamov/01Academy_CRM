import { describe, expect, it } from "vitest";
import {
  isLeadershipRecipient,
  normalizeOutboxRecipient,
  normalizeTelegramChatId,
  normalizeWhatsAppRecipient,
  resolveTelegramChatId,
} from "../server/services/message-recipients";

describe("outbound message recipients", () => {
  it("accepts only numeric Telegram chat ids within Telegram's range", () => {
    expect(normalizeTelegramChatId("-1001234567890")).toBe("-1001234567890");
    expect(normalizeTelegramChatId("123456789")).toBe("123456789");
    expect(normalizeTelegramChatId("@customer")).toBeNull();
    expect(normalizeTelegramChatId("+998901234567")).toBeNull();
    expect(normalizeTelegramChatId("0")).toBeNull();
    expect(normalizeTelegramChatId("4503599627370496")).toBeNull();
  });

  it("resolves aliases and direct values only to the configured Telegram chat", () => {
    expect(isLeadershipRecipient("leadership")).toBe(true);
    expect(isLeadershipRecipient("not-admin")).toBe(false);
    expect(resolveTelegramChatId("leadership", "-1001234567890")).toBe("-1001234567890");
    expect(resolveTelegramChatId("-1001234567890", "-1001234567890")).toBe("-1001234567890");
    expect(resolveTelegramChatId("42", "-1001234567890")).toBeNull();
    expect(resolveTelegramChatId("leadership", "")).toBeNull();
  });

  it("normalizes valid WhatsApp phones and rejects messenger handles", () => {
    expect(normalizeWhatsAppRecipient("+998 (90) 123-45-67")).toBe("998901234567");
    expect(normalizeWhatsAppRecipient("90 123 45 67")).toBe("998901234567");
    expect(normalizeWhatsAppRecipient("00998901234567")).toBe("998901234567");
    expect(normalizeWhatsAppRecipient("@customer")).toBeNull();
    expect(normalizeWhatsAppRecipient("12345")).toBeNull();
  });

  it("refuses unsupported channels and normalizes queue recipients", () => {
    expect(normalizeOutboxRecipient("whatsapp", "+998901234567")).toBe("998901234567");
    expect(normalizeOutboxRecipient("telegram", "@customer", "-1001234567890")).toBeNull();
    expect(normalizeOutboxRecipient("telegram", "42", "-1001234567890")).toBeNull();
    expect(normalizeOutboxRecipient("telegram", "leadership", "-1001234567890"))
      .toBe("-1001234567890");
    expect(normalizeOutboxRecipient("email", "person@example.com")).toBeNull();
  });
});
