import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("../server/db", () => ({
  pool: { connect: mocks.connect },
}));

import { runAutomations } from "../server/services/automations";

const sqlText = (value: unknown) => String(value).replace(/\s+/g, " ").trim();

describe("academy automations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
      if (text.includes("to_char(NOW() AT TIME ZONE")) return { rows: [{ period: "2026-07" }] };
      return { rows: [], rowCount: 0 };
    });
  });

  it("never creates payment reminders, overdue statuses or legacy tasks", async () => {
    await expect(runAutomations(1)).resolves.toEqual([]);

    const sql = mocks.clientQuery.mock.calls.map(([query]) => sqlText(query));
    expect(sql.some((query) => query.includes("academy_tasks"))).toBe(false);
    expect(sql.some((query) => query.includes("next_payment_at") || query.includes("due_at"))).toBe(false);
    expect(sql.some((query) => query.includes("'overdue'"))).toBe(false);
    expect(sql.some((query) => query.includes("academy_notification_outbox"))).toBe(false);
    expect(sql.at(-1)).toContain("pg_advisory_unlock");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("never changes a lead stage from a background automation", async () => {
    await expect(runAutomations(1)).resolves.toEqual([]);

    const sql = mocks.clientQuery.mock.calls.map(([query]) => sqlText(query));
    expect(sql.some((query) => query.includes("updated_at < NOW() - INTERVAL '14 days'"))).toBe(false);
    expect(sql.some((query) => query.includes("Автоматический перенос: нет ответа 14+ дней"))).toBe(false);
    expect(sql.some((query) =>
      query.startsWith("UPDATE academy_leads")
      && query.includes("status_code = 'not_now'")
    )).toBe(false);
  });

  it("skips immediately when another automation runner holds the lock", async () => {
    mocks.clientQuery.mockResolvedValueOnce({ rows: [{ acquired: false }] });

    await expect(runAutomations(1)).resolves.toEqual([]);

    expect(mocks.clientQuery).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("excludes lessons outside studying periods and old groups when recalculating student metrics", async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
      if (text === "SELECT id FROM academy_students WHERE status = 'studying' AND is_archived = false") {
        return { rows: [{ id: 5 }] };
      }
      if (text.includes("SELECT student.group_id")) {
        return { rows: [{ group_id: 3, membership_started_at: new Date("2026-01-01T00:00:00.000Z") }] };
      }
      if (text.includes("SELECT lesson.id") && text.includes("academy_student_status_history")) {
        return { rows: [{ id: 11 }] };
      }
      if (text.includes("SELECT COUNT(*)::int AS c") && text.includes("academy_attendance")) {
        return { rows: [{ c: 1 }] };
      }
      if (text.includes("SELECT COUNT(*)::int AS c") && text.includes("FROM academy_lessons lesson")) {
        return { rows: [{ c: 1 }] };
      }
      if (text.includes("SELECT lesson_count FROM academy_groups")) {
        return { rows: [{ lesson_count: 10 }] };
      }
      if (text.includes("SELECT survey.score")) return { rows: [{ score: 5 }] };
      if (text.includes("to_char(NOW() AT TIME ZONE")) return { rows: [{ period: "2026-07" }] };
      return { rows: [], rowCount: 1 };
    });

    const actions = await runAutomations(1);

    expect(actions).toContain("student:5:recalc");
    const sql = mocks.clientQuery.mock.calls.map(([query]) => sqlText(query));
    const metricQueries = sql.filter((query) => query.includes("academy_student_status_history"));
    // Was 5 while a fifth query averaged lesson surveys; that feature is gone.
    expect(metricQueries.length).toBeGreaterThanOrEqual(4);
    expect(sql.some((query) => query.includes("academy_lesson_surveys"))).toBe(false);
  });
});
