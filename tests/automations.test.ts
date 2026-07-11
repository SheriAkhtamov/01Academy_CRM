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

  it("uses pending-only overdue criteria and the academy timezone", async () => {
    await expect(runAutomations(1)).resolves.toEqual([]);

    const sql = mocks.clientQuery.mock.calls.map(([query]) => sqlText(query));
    const overdueSelection = sql.find((query) =>
      query.includes("FROM academy_payments") && query.includes("INTERVAL '3 days'") && !query.includes("FOR UPDATE"),
    );
    expect(overdueSelection).toContain("status = 'pending'");
    expect(overdueSelection).not.toContain("status <>");
    expect(sql.some((query) => query.includes("NOW() AT TIME ZONE $1"))).toBe(true);
    expect(sql.at(-1)).toContain("pg_advisory_unlock");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("commits the overdue task and status transition in one transaction", async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
      if (text.includes("SELECT id FROM academy_payments") && text.includes("status = 'pending'")) {
        return { rows: [{ id: 9 }] };
      }
      if (text.includes("SELECT p.id, COALESCE(s.manager_id, l.manager_id)") && text.includes("FOR UPDATE OF p")) {
        return { rows: [{ id: 9, manager_id: 4 }] };
      }
      if (text.startsWith("INSERT INTO academy_tasks")) return { rows: [{ id: 55 }] };
      if (text.includes("to_char(NOW() AT TIME ZONE")) return { rows: [{ period: "2026-07" }] };
      return { rows: [], rowCount: 1 };
    });

    const actions = await runAutomations(1);

    expect(actions).toContain("payment:9:overdue");
    const sql = mocks.clientQuery.mock.calls.map(([query]) => sqlText(query));
    const begin = sql.indexOf("BEGIN");
    const task = sql.findIndex((query) => query.startsWith("INSERT INTO academy_tasks"));
    const status = sql.findIndex((query) => query.startsWith("UPDATE academy_payments SET status = 'overdue'"));
    const commit = sql.indexOf("COMMIT", begin);
    expect(begin).toBeGreaterThan(-1);
    expect(task).toBeGreaterThan(begin);
    expect(status).toBeGreaterThan(task);
    expect(commit).toBeGreaterThan(status);
    expect(sql[task]).toContain("WHERE NOT EXISTS");
  });

  it("skips immediately when another automation runner holds the lock", async () => {
    mocks.clientQuery.mockResolvedValueOnce({ rows: [{ acquired: false }] });

    await expect(runAutomations(1)).resolves.toEqual([]);

    expect(mocks.clientQuery).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("queues warm customer messages through WhatsApp with a normalized phone", async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
      if (
        text.includes("SELECT id FROM academy_leads")
        && text.includes("status_code = 'not_now'")
      ) {
        return { rows: [{ id: 17 }] };
      }
      if (text.includes("SELECT id, phone, warm_moved_at") && text.includes("FOR UPDATE")) {
        return {
          rows: [{
            id: 17,
            phone: "+998 (90) 123-45-67",
            warm_moved_at: new Date("2026-07-01T00:00:00.000Z"),
          }],
        };
      }
      if (text.startsWith("INSERT INTO academy_notification_outbox")) {
        return { rows: [{ id: 80 }], rowCount: 1 };
      }
      if (text.includes("to_char(NOW() AT TIME ZONE")) return { rows: [{ period: "2026-07" }] };
      return { rows: [], rowCount: 0 };
    });

    const actions = await runAutomations(1);

    expect(actions).toContain("lead:17:warm_mailings");
    const outboxCalls = mocks.clientQuery.mock.calls.filter(([query]) =>
      sqlText(query).startsWith("INSERT INTO academy_notification_outbox")
    );
    expect(outboxCalls).toHaveLength(3);
    expect(outboxCalls.every(([, params]) => params[0] === "whatsapp")).toBe(true);
    expect(outboxCalls.every(([, params]) => params[1] === "998901234567")).toBe(true);
  });

  it("excludes lessons from paused periods and old groups when recalculating student metrics", async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
      if (text === "SELECT id FROM academy_students WHERE status = 'studying'") {
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
    expect(metricQueries.length).toBeGreaterThanOrEqual(5);
    const surveyQuery = sql.find((query) => query.includes("SELECT survey.score"));
    expect(surveyQuery).toContain("lesson.group_id = $2");
    expect(surveyQuery).toContain("lesson.scheduled_at >= $3");
  });
});
