import { afterEach, expect, it, vi } from "vitest";
import {
  PortalFinanceApiError,
  portalFinanceApi,
} from "../client/src/features/portal-finance/api";

afterEach(() => vi.unstubAllGlobals());
it.each([
  ["questionsPage", "/api/lms-management/finance-questions?limit=30&cursor=88"],
  [
    "unallocated",
    "/api/lms-management/payments/needs-review?limit=30&cursor=88",
  ],
] as const)(
  "reads %s from canonical JSON pagination and keeps the requested cursor",
  async (method, path) => {
    const page = { items: [{ id: 87 }], nextCursor: 87, hasMore: true };
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page), {
        headers: { "X-Next-Cursor": "99" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await portalFinanceApi[method](88)).toEqual(page);
    expect(fetch.mock.calls[0][0]).toBe(path);
  },
);
it.each(
  [
    [{ id: 88 }],
    { items: [], nextCursor: null },
    { items: [], nextCursor: 88, hasMore: false },
    { items: [], nextCursor: null, hasMore: true },
  ].map((body) => [body]),
)(
  "rejects incomplete finance pagination instead of hiding older questions",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(portalFinanceApi.questionsPage(null)).rejects.toBeInstanceOf(
      PortalFinanceApiError,
    );
  },
);
