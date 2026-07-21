import { describe, expect, it } from "vitest";
import {
  ACADEMY_ACCESS_MODULES,
  ACADEMY_WORKSPACES,
  buildReferralCode,
  calculateAttendancePercent,
  calculateCac,
  calculateLtv,
  calculateNps,
  calculateProgressPercent,
  calculateRoas,
  canAccessAcademyWorkspace,
  getAssignedWorkspaces,
  getComputedPaymentStatus,
  hasFinanceAccess,
  hasLeadershipAccess,
  normalizeMoney,
  resolveReferralMilestone,
  resolveStudentRiskFlags,
  suggestAgeGroup,
  suggestCourseSlugByAge,
  validateLeadForStatusChange,
  validateLeadStatusTransition,
} from "../shared/academy";

describe("01 Academy business rules", () => {
  it("exposes the supported employee workspaces", () => {
    expect(ACADEMY_WORKSPACES).toEqual([
      "administration",
      "sales",
      "teacher",
      "marketing",
    ]);
  });

  it("exposes finance as a separately assigned access module", () => {
    expect(ACADEMY_ACCESS_MODULES).toEqual([
      "administration",
      "sales",
      "teacher",
      "marketing",
      "finance",
    ]);
    expect(hasFinanceAccess("administration")).toBe(false);
    expect(hasFinanceAccess({
      workspace: "administration",
      workspaces: ["administration"],
    })).toBe(false);
    expect(hasFinanceAccess({
      workspace: "sales",
      workspaces: ["sales", "finance"],
    })).toBe(true);
  });

  it("gives administration global workspace access", () => {
    expect(canAccessAcademyWorkspace("administration", "administration")).toBe(true);
    expect(canAccessAcademyWorkspace("administration", "sales")).toBe(true);
    expect(canAccessAcademyWorkspace("administration", "marketing")).toBe(true);
    expect(canAccessAcademyWorkspace("administration", "teacher")).toBe(true);
  });

  it("keeps other employees inside the assigned workspace", () => {
    expect(canAccessAcademyWorkspace("sales", "sales")).toBe(true);
    expect(canAccessAcademyWorkspace("sales", "marketing")).toBe(false);
  });

  it("uses workspace assignment as the system access model", () => {
    expect(canAccessAcademyWorkspace("teacher", "teacher")).toBe(true);
    expect(canAccessAcademyWorkspace("marketing", "marketing")).toBe(true);
  });

  it("supports several workspace modules on the same employee", () => {
    const employee = {
      workspace: "teacher",
      workspaces: ["teacher", "sales"],
    };

    expect(getAssignedWorkspaces(employee)).toEqual(["teacher", "sales"]);
    expect(canAccessAcademyWorkspace(employee, "teacher")).toBe(true);
    expect(canAccessAcademyWorkspace(employee, "sales")).toBe(true);
    expect(canAccessAcademyWorkspace(employee, "marketing")).toBe(false);
  });

  it("treats leadership modules as global access even when primary workspace differs", () => {
    const employee = {
      workspace: "teacher",
      workspaces: ["teacher", "administration"],
    };

    expect(hasLeadershipAccess(employee)).toBe(true);
    expect(canAccessAcademyWorkspace(employee, "marketing")).toBe(true);
  });

  it("represents leadership as all access modules instead of a separate workspace", () => {
    const employee = {
      workspace: "administration",
      workspaces: ["administration", "sales", "teacher", "marketing"],
    };

    expect(getAssignedWorkspaces(employee)).toEqual(["administration", "sales", "teacher", "marketing"]);
    expect(hasLeadershipAccess(employee)).toBe(true);
    expect(canAccessAcademyWorkspace(employee, "sales")).toBe(true);
    expect(canAccessAcademyWorkspace(employee, "teacher")).toBe(true);
    expect(canAccessAcademyWorkspace(employee, "marketing")).toBe(true);
  });

  it("suggests course and age group from student age", () => {
    expect(suggestCourseSlugByAge(8)).toBe("ai-kids");
    expect(suggestCourseSlugByAge(13)).toBe("ai-creator");
    expect(suggestCourseSlugByAge(16)).toBe("vibe-coding");
    expect(suggestAgeGroup(8)).toBe("7-10");
    expect(suggestAgeGroup(13)).toBe("10-15");
    expect(suggestAgeGroup(16)).toBe("15+");
  });

  it("keeps lead qualification independent from student records", () => {
    expect(validateLeadForStatusChange({ nextStatus: "qualified" })).toBeNull();
    expect(validateLeadForStatusChange({
      nextStatus: "qualified",
      studentName: "Timur",
      studentAge: 10,
      courseId: 1,
    })).toBeNull();
    expect(validateLeadForStatusChange({
      nextStatus: "qualified",
      studentName: "Timur",
      studentAge: -10,
      courseId: 1,
    })).toBeNull();
  });

  it("leaves enrollment validation to the concrete student workflow", () => {
    expect(validateLeadForStatusChange({
      nextStatus: "enrolled",
      studentName: "Student",
      studentAge: 12,
      courseId: 1,
    })).toBeNull();
    expect(validateLeadForStatusChange({
      nextStatus: "enrolled",
      studentName: "Student",
      studentAge: 12,
      courseId: 1,
      enrolledGroupId: 10,
    })).toBeNull();
    expect(validateLeadForStatusChange({
      nextStatus: "paid",
      studentName: "Student",
      studentAge: 12,
      courseId: 1,
    })).toBeNull();
    expect(validateLeadForStatusChange({
      nextStatus: "paid",
      studentName: null,
      studentAge: 12,
      courseId: 1,
      enrolledGroupId: 10,
    })).toBeNull();
  });

  it("keeps paid clients terminal and requires a payment to enter paid", () => {
    expect(validateLeadStatusTransition("qualified", "paid")).toBe("paymentRequiredBeforePaid");
    expect(validateLeadStatusTransition("paid", "thinking")).toBe("paidLeadCannotReturn");
    expect(validateLeadStatusTransition("paid", "paid")).toBeNull();
  });

  it("calculates attendance, progress, NPS, CAC, ROAS, and LTV", () => {
    expect(calculateAttendancePercent(7, 10)).toBe(70);
    expect(calculateProgressPercent(12, 24)).toBe(50);
    expect(calculateNps([10, 9, 8, 6])).toBe(25);
    expect(calculateCac(900000, 3)).toBe(300000);
    expect(calculateRoas(6000000, 1000000)).toBe(6);
    expect(calculateLtv([1200000, 1200000, 960000])).toBe(3360000);
  });

  it("keeps percentage metrics bounded and ignores invalid NPS answers", () => {
    expect(calculateAttendancePercent(12, 10)).toBe(100);
    expect(calculateAttendancePercent(-1, 10)).toBe(0);
    expect(calculateProgressPercent(-2, 10)).toBe(0);
    expect(calculateNps([10, 0, 11, Number.NaN])).toBe(0);
  });

  it("marks unpaid payments as overdue after due date", () => {
    expect(getComputedPaymentStatus("paid", "2020-01-01")).toBe("paid");
    expect(getComputedPaymentStatus("pending", "2020-01-01")).toBe("overdue");
    expect(getComputedPaymentStatus("refunded", "2020-01-01")).toBe("refunded");
  });

  it("generates a stable referral code shape", () => {
    expect(buildReferralCode("Timur Aliyev", 7, 2026)).toBe("TIMURALI72026");
  });

  it("grants referral benefits only when a milestone is first reached", () => {
    expect(resolveReferralMilestone(1)).toBe("next_payment_discount_15");
    expect(resolveReferralMilestone(2)).toBeNull();
    expect(resolveReferralMilestone(3)).toBe("free_month");
    expect(resolveReferralMilestone(4)).toBeNull();
    expect(resolveReferralMilestone(5)).toBe("ai_ambassador_free_training");
    expect(resolveReferralMilestone(6)).toBeNull();
  });

  it("rejects fractional money instead of silently changing the paid amount", () => {
    expect(normalizeMoney(1_200_000)).toBe(1_200_000);
    expect(normalizeMoney(1_200_000.49)).toBe(0);
    expect(normalizeMoney("not-money")).toBe(0);
  });

  it("keeps attendance risk rules identical for manual and scheduled recalculation", () => {
    expect(resolveStudentRiskFlags({
      conductedCount: 4,
      attendancePercent: 0,
      monthConductedCount: 2,
      monthAttendancePercent: 0,
      satisfactionAvg: 2,
    })).toEqual(["attendance_below_70", "churn_risk", "low_satisfaction"]);
    expect(resolveStudentRiskFlags({
      conductedCount: 0,
      attendancePercent: 0,
      monthConductedCount: 0,
      monthAttendancePercent: 0,
      satisfactionAvg: 0,
    })).toEqual([]);
  });
});
