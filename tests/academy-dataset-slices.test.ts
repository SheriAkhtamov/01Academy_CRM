import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock("../server/db", () => ({
  pool: { query: mocks.poolQuery, connect: vi.fn() },
}));

const loadDataset = async () => {
  const module = await import("../server/modules/academy/academy-analytics");
  return module.getAcademyDataset;
};

/** Which physical tables the run touched, in the order they were queried. */
const queriedTables = () => mocks.poolQuery.mock.calls
  .map(([sql]) => String(sql))
  .flatMap((sql) => sql.match(/FROM\s+(academy_[a-z_]+|users)/gi) ?? [])
  .map((match) => match.replace(/FROM\s+/i, "").toLowerCase());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.poolQuery.mockResolvedValue({ rows: [] });
});

describe("getAcademyDataset slice gating", () => {
  it("queries every slice when no include list is given", async () => {
    const getAcademyDataset = await loadDataset();
    await getAcademyDataset();

    const tables = queriedTables();
    expect(tables).toContain("academy_leads");
    expect(tables).toContain("academy_payments");
    expect(tables).toContain("academy_attendance");
    expect(tables).toContain("academy_parent_surveys");
    expect(tables).toContain("academy_marketing_expenses");
  });

  it("skips the queries a caller did not ask for", async () => {
    const getAcademyDataset = await loadDataset();
    const dataset = await getAcademyDataset(undefined, {
      include: ["schools", "rooms", "courses", "statuses", "teachers", "groups", "lessons"],
    });

    const tables = queriedTables();
    expect(tables).toContain("academy_schools");
    expect(tables).toContain("academy_lessons");

    // The configuration endpoint renders rooms and groups; it has no business
    // scanning every lead, payment and survey in the database to do it.
    expect(tables).not.toContain("academy_leads");
    expect(tables).not.toContain("academy_payments");
    expect(tables).not.toContain("academy_attendance");
    expect(tables).not.toContain("academy_parent_surveys");
    expect(tables).not.toContain("academy_marketing_expenses");
    expect(tables).not.toContain("academy_referral_rewards");

    // Skipped slices still come back as empty arrays, so callers that read a
    // field they did not request get [] rather than undefined.
    expect(dataset.leads).toEqual([]);
    expect(dataset.payments).toEqual([]);
  });

  it("cuts the number of round trips for a narrow caller", async () => {
    const getAcademyDataset = await loadDataset();

    await getAcademyDataset();
    const fullRunQueries = mocks.poolQuery.mock.calls.length;

    mocks.poolQuery.mockClear();
    await getAcademyDataset(undefined, {
      include: ["schools", "rooms", "courses", "statuses", "teachers", "groups", "lessons"],
    });
    const narrowRunQueries = mocks.poolQuery.mock.calls.length;

    expect(narrowRunQueries).toBeLessThan(fullRunQueries);
  });
});
