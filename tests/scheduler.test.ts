import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  poolQuery: vi.fn(),
  processOutbox: vi.fn(),
  runAutomations: vi.fn(),
  buildWeeklyReport: vi.fn(),
  refreshTokens: vi.fn(),
  runEscalations: vi.fn(),
}));

vi.mock("node-cron", () => ({ default: { schedule: mocks.schedule } }));
vi.mock("../server/db", () => ({ pool: { query: mocks.poolQuery } }));
vi.mock("../server/services/outbox-worker", () => ({ processOutbox: mocks.processOutbox }));
vi.mock("../server/services/automations", () => ({ runAutomations: mocks.runAutomations }));
vi.mock("../server/services/weekly-report", () => ({ buildWeeklyReport: mocks.buildWeeklyReport }));
vi.mock("../server/services/instagram", () => ({ refreshExpiringInstagramTokens: mocks.refreshTokens }));
vi.mock("../server/services/escalations", () => ({ runEscalations: mocks.runEscalations }));

describe("scheduler timezone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schedules every job explicitly in the academy timezone without overlap", async () => {
    vi.stubEnv("ACADEMY_TIME_ZONE", "Asia/Tashkent");
    vi.resetModules();
    const { startScheduler, SCHEDULER_TIME_ZONE } = await import("../server/services/scheduler");

    startScheduler();

    expect(SCHEDULER_TIME_ZONE).toBe("Asia/Tashkent");
    expect(mocks.schedule).toHaveBeenCalledTimes(4);
    for (const call of mocks.schedule.mock.calls) {
      expect(call[2]).toEqual({ timezone: "Asia/Tashkent", noOverlap: true });
    }
    expect(mocks.schedule.mock.calls.map((call) => call[0])).toEqual([
      "* * * * *",
      "0 * * * *",
      "0 9 * * *",
      "0 9 * * 1",
    ]);
  });
});
