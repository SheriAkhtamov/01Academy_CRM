import { describe, expect, it } from "vitest";
import {
  isAuthorizedCommandChat,
  splitTelegramText,
  TELEGRAM_TEXT_LIMIT,
} from "../telegram-bot/src/telegramText";

describe("Telegram summary delivery", () => {
  it("splits long summaries at line boundaries under Telegram's limit", () => {
    const line = `<b>${"x".repeat(1_000)}</b>`;
    const source = Array.from({ length: 10 }, () => line).join("\n");
    const chunks = splitTelegramText(source);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= TELEGRAM_TEXT_LIMIT)).toBe(true);
    expect(chunks.join("\n")).toBe(source);
    expect(chunks.every((chunk) => !chunk.startsWith("</b>"))).toBe(true);
  });

  it("allows only the configured group, except bootstrap /chatid", () => {
    expect(isAuthorizedCommandChat("-100123", -100123, "summary")).toBe(true);
    expect(isAuthorizedCommandChat("-100123", 55, "summary")).toBe(false);
    expect(isAuthorizedCommandChat("", 55, "chatid")).toBe(true);
    expect(isAuthorizedCommandChat("", 55, "summary")).toBe(false);
  });
});
