import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock("../server/db", () => ({
  pool: {
    query: mocks.poolQuery,
  },
}));

import { getInstagramConversationAudienceUserIds } from "../server/services/instagram";

describe("Instagram realtime audience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("limits an assigned conversation to its sales manager plus leadership", async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: "7" }, { id: 7 }] });

    const audience = await getInstagramConversationAudienceUserIds(7);

    expect(audience).toEqual([1, 7]);
    const [sql, params] = mocks.poolQuery.mock.calls[0];
    expect(String(sql)).toContain("u.id = $1");
    expect(String(sql)).toContain("u.module = 'sales'");
    expect(String(sql)).toContain("u.module = 'administration'");
    expect(params).toEqual([7]);
  });

  it("routes an unlinked conversation only to active sales and leadership users", async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: 7 }, { id: 8 }] });

    const audience = await getInstagramConversationAudienceUserIds(null);

    expect(audience).toEqual([1, 7, 8]);
    expect(mocks.poolQuery.mock.calls[0][1]).toEqual([]);
    expect(String(mocks.poolQuery.mock.calls[0][0])).not.toContain("u.id = $1");
  });

  it("routes an unassigned lead conversation only to employees assigned to its funnel", async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: 8 }] });

    const audience = await getInstagramConversationAudienceUserIds(null, 4);

    expect(audience).toEqual([1, 8]);
    const [sql, params] = mocks.poolQuery.mock.calls[0];
    expect(String(sql)).toContain('academy_sales_funnel_users assignment');
    expect(String(sql)).toContain('assignment.funnel_id = $1');
    expect(params).toEqual([4]);
  });

  it("fails closed when audience resolution cannot reach the database", async () => {
    mocks.poolQuery.mockRejectedValue(new Error("database unavailable"));

    await expect(getInstagramConversationAudienceUserIds(null)).resolves.toEqual([]);
  });
});
