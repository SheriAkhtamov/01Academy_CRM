import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  students: [] as Record<string, unknown>[],
  groups: [] as Record<string, unknown>[],
  courses: [] as Record<string, unknown>[],
  payments: [] as Record<string, unknown>[],
}));
vi.mock("../server/modules/academy/academy-core", () => ({
  ACADEMY_TIME_ZONE: "Asia/Tashkent",
  query: async (sql: string) => {
    if (sql.trim().startsWith("SELECT g.*")) return fixture.groups;
    if (sql.includes("FROM academy_students st")) return fixture.students;
    if (sql.includes("FROM academy_payments p")) return fixture.payments;
    if (sql.includes("SELECT * FROM academy_courses")) return fixture.courses;
    return [];
  },
  queryOne: vi.fn(),
  applyLeadVisibilityForActor: async (_actor: unknown, leads: unknown[]) => leads,
  leadPhoneNumbersSelect: vi.fn(),
  leadTagsSelect: vi.fn(),
  studentGroupMembershipsSelect: vi.fn(),
}));
import { buildAnalytics } from "../server/modules/academy/academy-analytics";

describe("student analytics use the canonical financial and group read models", () => {
  beforeEach(() => {
    fixture.students = [];
    fixture.groups = [];
    fixture.courses = [];
    fixture.payments = [];
  });
  it.each([null, 1])("includes allocations in lifetime revenue when the payment's direct student is %s", async (studentId) => {
    fixture.students = [
      { id: 1, leadId: 42, courseId: 1, paidAmountUzs: 40000, status: "studying" },
      { id: 2, leadId: 42, courseId: 2, paidAmountUzs: 60000, status: "studying" },
    ];
    fixture.courses = [{ id: 1, name: "First course" }, { id: 2, name: "Second course" }];
    fixture.payments = [{ id: 1, leadId: 42, studentId, amountUzs: 100000, status: "paid", paidAt: new Date() }];
    const analytics = await buildAnalytics();
    expect(analytics.summary.revenueTotal).toBe(100000);
    expect(analytics.summary.averageLtv).toBe(50000);
    expect(analytics.byCourse.map(course => course.averageLtv)).toEqual([40000, 60000]);
    fixture.students[0].paidAmountUzs = 60000;
    fixture.students[1].paidAmountUzs = 40000;
    expect((await buildAnalytics()).byCourse.map(course => course.averageLtv)).toEqual([60000, 40000]);
  });
  it("keeps secondary group averages independent of the primary group's attendance and progress", async () => {
    fixture.students = [{
      id: 1, groupId: 20, groupIds: [20, 30], status: "studying", attendancePercent: 43, progressPercent: 15,
      riskFlags: ["attendance_below_70"],
      groups: [
        { groupId: 20, courseId: 1, courseName: "First course", attendancePercent: 100, progressPercent: 30 },
        { groupId: 30, courseId: 2, courseName: "Second course", attendancePercent: 0, progressPercent: 0 },
      ],
    }];
    fixture.groups = [
      { id: 20, name: "Primary group", maxStudents: 12, currentStudents: 1 },
      { id: 30, name: "Secondary group", maxStudents: 12, currentStudents: 1 },
    ];
    const analytics = await buildAnalytics();
    expect(analytics.byGroupProgress).toEqual([
      { groupId: 20, groupName: "Primary group", capacity: 1, maxCapacity: 12, attendanceAvg: 100, progressAvg: 30 },
      { groupId: 30, groupName: "Secondary group", capacity: 1, maxCapacity: 12, attendanceAvg: 0, progressAvg: 0 },
    ]);
    expect(analytics.risks.lowAttendanceStudents.map(student => student.id)).toEqual([1]);
    expect(analytics.risks.lowAttendanceStudents[0]).toMatchObject({ courseName: "Second course", attendancePercent: 0 });
  });
});
