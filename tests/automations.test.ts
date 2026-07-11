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
      if (text.includes("SELECT p.id, s.manager_id") && text.includes("FOR UPDATE OF p")) {
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
});
