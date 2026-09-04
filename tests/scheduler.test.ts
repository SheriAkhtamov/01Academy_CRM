import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  poolQuery: vi.fn(),
  runAutomations: vi.fn(),
  refreshTokens: vi.fn(),
  runEscalations: vi.fn(),
  syncRecentMetaLeads: vi.fn(),
  telegramReminders: vi.fn().mockResolvedValue(0),
}));

vi.mock("node-cron", () => ({ default: { schedule: mocks.schedule } }));
vi.mock("../server/db", () => ({ pool: { query: mocks.poolQuery } }));
vi.mock("../server/services/automations", () => ({ runAutomations: mocks.runAutomations }));
vi.mock("../server/services/instagram", () => ({ refreshExpiringInstagramTokens: mocks.refreshTokens }));
vi.mock("../server/services/escalations", () => ({ runEscalations: mocks.runEscalations }));
vi.mock("../server/services/meta-lead-ads", () => ({ syncRecentMetaLeadAds: mocks.syncRecentMetaLeads }));
vi.mock("../server/services/telegram-task-reminders", () => ({ processTelegramTaskReminders: mocks.telegramReminders }));

describe("scheduler timezone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.poolQuery.mockResolvedValue({ rows: [{ count: 0 }] });
    mocks.syncRecentMetaLeads.mockResolvedValue({
      skipped: false,
      summary: { created: 0, merged: 0, mergedArchived: 0 },
    });
  });

  it("schedules every job explicitly in the academy timezone without overlap", async () => {
    vi.stubEnv("ACADEMY_TIME_ZONE", "Asia/Tashkent");
    vi.resetModules();
    const { startScheduler, SCHEDULER_TIME_ZONE } = await import("../server/services/scheduler");

    startScheduler();

    expect(SCHEDULER_TIME_ZONE).toBe("Asia/Tashkent");
    expect(mocks.schedule).toHaveBeenCalledTimes(8);
    for (const call of mocks.schedule.mock.calls) {
      expect(call[2]).toEqual({ timezone: "Asia/Tashkent", noOverlap: true });
    }
    expect(mocks.schedule.mock.calls.map((call) => call[0])).toEqual([
      "* * * * *",
      "* * * * *",
      "*/5 * * * *",
      "*/15 * * * *",
      "7 * * * *",
      "5 * * * *",
      "0 * * * *",
      "0 9 * * *",
    ]);
    await mocks.schedule.mock.calls[0][1]();
    expect(mocks.telegramReminders).toHaveBeenCalledWith('Asia/Tashkent');
  });
});
