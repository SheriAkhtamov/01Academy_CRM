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
  it("returns confirmed payment totals alongside each student's own forecast", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => sql.includes('SELECT st.*')
      ? { rows: [{ id: 12, manager_id: 7, expected_payment_uzs: 1_000_000, paid_amount_uzs: 300_000 }] }
      : { rows: [] });
    const dataset = await (await loadDataset())({ userId: 7, module: 'sales', modules: ['sales'], scopeModule: 'sales' }, { include: ['students'] });
    expect(dataset.students).toEqual([expect.objectContaining({ id: 12, expectedPaymentUzs: 1_000_000, paidAmountUzs: 300_000 })]);
    const studentQuery = mocks.poolQuery.mock.calls.find(([sql]) => String(sql).includes('SELECT st.*'))!;
    expect(studentQuery[0]).toContain("confirmed_payment.status = 'paid'");
    expect(studentQuery[0]).toContain('confirmed_payment.student_id = st.id');
    expect(studentQuery[1]).toEqual([7]);
  });

  it("does not add payment amounts to teacher-scoped data", async () => {
    await (await loadDataset())({ userId: 7, module: 'teacher', modules: ['teacher'], scopeModule: 'teacher' }, { include: ['students'] });
    const studentQuery = mocks.poolQuery.mock.calls.find(([sql]) => String(sql).includes('FROM academy_students st'))!;
    expect(studentQuery[0]).not.toContain('SELECT st.*');
    expect(studentQuery[0]).not.toContain('academy_payments');
    expect(studentQuery[0]).toContain('AND membership_group.teacher_id = $1');
    expect(studentQuery[0]).toContain('NULL AS paid_amount_uzs');
    expect(studentQuery[0]).not.toContain('confirmed_payment');
  });

  it("returns an academic allowlist and only teacher-scoped membership context", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM academy_teachers')) return { rows: [{ id: 4 }] };
      if (sql.includes('FROM academy_students st')) return { rows: [{
        id: 12, student_name: 'Student', contact_name: 'Parent', attendance_percent: 85,
        group_id: 99, group_name: 'Other teacher group', course_name: 'Other course',
        lead_id: 42, manager_id: 7, manager_name: 'Manager', phone: '+998901234567',
        expected_payment_uzs: 1_000_000, paid_amount_uzs: 300_000,
        next_payment_at: '2026-10-15', payment_status: 'overdue',
        groups: [{ groupId: 54, groupName: 'My group', courseId: 1, courseName: 'My course', schoolId: 2, isPrimary: false }],
      }] };
      return { rows: [] };
    });
    const dataset = await (await loadDataset())({ userId: 9, module: 'teacher', modules: ['teacher'], scopeModule: 'teacher' }, { include: ['students'] });
    expect(dataset.students[0]).toMatchObject({ id: 12, studentName: 'Student', attendancePercent: 85,
      groupId: 54, groupName: 'My group', courseName: 'My course', groupIds: [54], groupNames: ['My group'] });
    for (const key of ['expectedPaymentUzs', 'paidAmountUzs', 'nextPaymentAt', 'paymentStatus', 'leadId', 'managerId', 'managerName', 'phone']) {
      expect(dataset.students[0]).not.toHaveProperty(key);
    }
  });

  it("excludes missing NPS responses while retaining a real zero rating", async () => {
    const surveys: Array<number | null | undefined | string> = [10, null, undefined, ''];
    mocks.poolQuery.mockImplementation(async (sql: string) => sql.includes('SELECT * FROM academy_parent_surveys')
      ? { rows: surveys.map((npsScore, id) => ({ id, nps_score: npsScore, created_at: new Date().toISOString() })) }
      : { rows: [] });
    const { buildAnalytics } = await import('../server/modules/academy/academy-analytics');
    expect((await buildAnalytics()).summary.nps).toBe(100);
    surveys.push(0);
    expect((await buildAnalytics()).summary.nps).toBe(0);
  });

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
