import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  sendTelegramMessage: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
}));

vi.mock("../server/db", () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock("../server/services/telegram", () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

vi.mock("../server/services/whatsapp", () => ({
  sendWhatsAppMessage: mocks.sendWhatsAppMessage,
}));

import { processOutbox } from "../server/services/outbox-worker";

const claimedAt = new Date("2026-07-10T10:00:00.000Z");

const claimedRow = (retryCount = 0) => ({
  id: 15,
  channel: "telegram",
  recipient: "123",
  message: "hello",
  retry_count: retryCount,
  claimed_at: claimedAt,
});

describe("outbox worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [claimedRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
  });

  it("atomically claims due rows and retries a normal provider failure", async () => {
    mocks.sendTelegramMessage.mockResolvedValue({ ok: false, error: "temporary outage" });

    const dispatched = await processOutbox(20);

    expect(dispatched).toBe(0);
    const [claimSql, claimParams] = mocks.poolQuery.mock.calls[0];
    expect(String(claimSql)).toContain("FOR UPDATE SKIP LOCKED");
    expect(String(claimSql)).toContain("SET status = 'processing'");
    expect(claimParams).toEqual([20, 15]);

    const [failureSql, failureParams] = mocks.poolQuery.mock.calls[1];
    expect(String(failureSql)).toContain("status = $1");
    expect(failureParams[0]).toBe("pending");
    expect(failureParams[1]).toBe("temporary outage");
    expect(failureParams[3]).toBe(1);
    expect(failureParams[4]).toBe(15);
    expect(failureParams[5]).toBe(claimedAt);
    expect(failureParams[2]).toBeInstanceOf(Date);
  });

  it("moves a message to failed only after the fifth failed attempt", async () => {
    mocks.poolQuery.mockReset();
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [claimedRow(4)], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mocks.sendTelegramMessage.mockResolvedValue({ ok: false, error: "still down" });

    await processOutbox();

    const failureParams = mocks.poolQuery.mock.calls[1][1];
    expect(failureParams[0]).toBe("failed");
    expect(failureParams[2]).toBeNull();
    expect(failureParams[3]).toBe(5);
  });

  it("marks a successfully dispatched claimed row as sent", async () => {
    mocks.sendTelegramMessage.mockResolvedValue({ ok: true, messageId: 99 });

    const dispatched = await processOutbox();

    expect(dispatched).toBe(1);
    const [successSql, successParams] = mocks.poolQuery.mock.calls[1];
    expect(String(successSql)).toContain("status = $1");
    expect(successParams).toEqual(["sent", null, 15, claimedAt]);
  });
});
