import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
}));

vi.mock("../server/db", () => ({
  pool: { query: mocks.poolQuery, connect: mocks.connect },
}));

import { runEscalations } from "../server/services/escalations";

const sqlText = (value: unknown) => String(value).replace(/\s+/g, " ").trim();

describe("escalation monitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
    mocks.poolQuery.mockImplementation(async (sql: unknown) => ({
      rows: sqlText(sql).includes("INTERVAL '24 hours'") ? [{ id: 7 }] : [],
    }));
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.includes("FOR UPDATE OF t")) {
        return { rows: [{ id: 7, title: "Call parent", responsible_id: 3, responsible_name: "Manager" }] };
      }
      if (text.startsWith("INSERT INTO academy_escalation_events")) return { rows: [{ id: 20 }] };
      return { rows: [], rowCount: 1 };
    });
  });

  it("notifies only the task owner in CRM while keeping the leadership outbox", async () => {
    await expect(runEscalations()).resolves.toEqual(["task-sla:7"]);

    const sql = mocks.clientQuery.mock.calls.map(([query]) => sqlText(query));
    expect(sql[0]).toBe("BEGIN");
    expect(sql.some((query) => query.includes("FOR UPDATE OF t"))).toBe(true);
    expect(sql.some((query) => query.startsWith("INSERT INTO academy_escalation_events"))).toBe(true);
    expect(sql.some((query) => query.startsWith("INSERT INTO notifications"))).toBe(true);
    expect(sql.some((query) => query.startsWith("INSERT INTO academy_notification_outbox"))).toBe(true);
    expect(sql.some((query) => query.startsWith("UPDATE academy_tasks SET escalated_at = NOW()"))).toBe(true);
    const notificationCall = mocks.clientQuery.mock.calls.find(([query]) =>
      sqlText(query).startsWith("INSERT INTO notifications")
    );
    expect(sqlText(notificationCall?.[0])).toContain("WHERE task_owner.id = $1");
    expect(sqlText(notificationCall?.[0])).not.toContain("user_workspaces");
    expect(notificationCall?.[1]?.[0]).toBe(3);
    expect(sql.at(-1)).toBe("COMMIT");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("rolls back the ledger if queuing a notification fails", async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.includes("FOR UPDATE OF t")) {
        return { rows: [{ id: 7, title: "Call parent", responsible_id: 3, responsible_name: "Manager" }] };
      }
      if (text.startsWith("INSERT INTO academy_escalation_events")) return { rows: [{ id: 20 }] };
      if (text.startsWith("INSERT INTO notifications")) throw new Error("write failed");
      return { rows: [], rowCount: 1 };
    });

    await expect(runEscalations()).resolves.toEqual([]);

    const sql = mocks.clientQuery.mock.calls.map(([query]) => sqlText(query));
    expect(sql).toContain("ROLLBACK");
    expect(sql).not.toContain("COMMIT");
  });
});
