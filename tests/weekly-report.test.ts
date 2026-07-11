import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
}));

vi.mock("../server/db", () => ({
  pool: { connect: mocks.connect },
}));

import { buildWeeklyReport } from "../server/services/weekly-report";

const sqlText = (value: unknown) => String(value).replace(/\s+/g, " ").trim();
const metrics = {
  period_key: 20260706,
  lead_count: 4,
  demo_count: 3,
  paid_count: 2,
  revenue_sum: "1500000",
  attendance_avg: 88,
  survey_avg: "4.5",
  risk_count: 1,
};

describe("weekly report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.startsWith("WITH bounds AS")) return { rows: [metrics] };
      if (text.startsWith("SELECT id, message FROM academy_notification_outbox")) return { rows: [] };
      if (text.startsWith("INSERT INTO academy_notification_outbox")) return { rows: [{ id: 77 }] };
      return { rows: [], rowCount: 1 };
    });
  });

  it("uses one timezone-bounded period and includes lead-only payers and pending debt", async () => {
    const result = await buildWeeklyReport(1);

    expect(result.outboxId).toBe(77);
    expect(result.preview).toContain("Были на демо: 3");
    const metricsCall = mocks.clientQuery.mock.calls.find(([sql]) => sqlText(sql).startsWith("WITH bounds AS"));
    expect(metricsCall?.[1]?.[0]).toBe("Asia/Tashkent");
    const sql = sqlText(metricsCall?.[0]);
    expect(sql).toContain("academy_lead_stage_history");
    expect(sql).toContain("history.entered_at >= bounds.week_start");
    expect(sql).toContain("AT TIME ZONE 'UTC' AS week_start");
    expect(sql).toContain("to_char(bounds.local_week_end, 'YYYYMMDD')");
    expect(sql).toContain("CASE WHEN payment.lead_id IS NOT NULL THEN 'lead:'");
    expect(sql).toContain("payment.status = 'pending' AND payment.due_at < NOW()");

    const insertCall = mocks.clientQuery.mock.calls.find(([query]) =>
      sqlText(query).startsWith("INSERT INTO academy_notification_outbox"),
    );
    expect(insertCall?.[1]?.[2]).toBe(metrics.period_key);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("returns the existing outbox row instead of duplicating the same period", async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.startsWith("WITH bounds AS")) return { rows: [metrics] };
      if (text.startsWith("SELECT id, message FROM academy_notification_outbox")) {
        return { rows: [{ id: 12, message: "existing report" }] };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(buildWeeklyReport(1)).resolves.toEqual({ outboxId: 12, preview: "existing report" });

    const sql = mocks.clientQuery.mock.calls.map(([query]) => sqlText(query));
    expect(sql.filter((query) => query.startsWith("INSERT INTO academy_notification_outbox"))).toHaveLength(0);
    expect(sql.at(-1)).toBe("COMMIT");
  });
});
