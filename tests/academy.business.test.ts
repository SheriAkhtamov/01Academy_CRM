import { describe, expect, it } from "vitest";
import {
  ACADEMY_WORKSPACES,
  buildReferralCode,
  calculateAttendancePercent,
  calculateCac,
  calculateLtv,
  calculateNps,
  calculateProgressPercent,
  calculateRoas,
  canAccessAcademyWorkspace,
  getComputedPaymentStatus,
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
      "analytics",
      "marketing",
      "management",
    ]);
  });

  it("gives administration global workspace access", () => {
    expect(canAccessAcademyWorkspace("administration", "administration")).toBe(true);
    expect(canAccessAcademyWorkspace("administration", "sales")).toBe(true);
    expect(canAccessAcademyWorkspace("administration", "analytics")).toBe(true);
    expect(canAccessAcademyWorkspace("administration", "marketing")).toBe(true);
    expect(canAccessAcademyWorkspace("administration", "teacher")).toBe(true);
    expect(canAccessAcademyWorkspace("administration", "management")).toBe(true);
  });

  it("keeps other employees inside the assigned workspace", () => {
    expect(canAccessAcademyWorkspace("sales", "sales")).toBe(true);
    expect(canAccessAcademyWorkspace("sales", "management")).toBe(false);
  });

  it("uses workspace assignment as the system access model", () => {
    expect(canAccessAcademyWorkspace("teacher", "teacher")).toBe(true);
    expect(canAccessAcademyWorkspace("analytics", "analytics")).toBe(true);
    expect(canAccessAcademyWorkspace("marketing", "marketing")).toBe(true);
    expect(canAccessAcademyWorkspace("management", "management")).toBe(true);
  });

  it("suggests course and age group from student age", () => {
    expect(suggestCourseSlugByAge(8)).toBe("ai-kids");
    expect(suggestCourseSlugByAge(13)).toBe("ai-creator");
    expect(suggestCourseSlugByAge(16)).toBe("vibe-coding");
    expect(suggestAgeGroup(8)).toBe("7-10");
    expect(suggestAgeGroup(13)).toBe("10-15");
    expect(suggestAgeGroup(16)).toBe("15+");
  });

  it("requires qualification fields before moving lead to qualified", () => {
    expect(validateLeadForStatusChange({ nextStatus: "qualified" })).toBe("completeQualificationFields");
    expect(validateLeadForStatusChange({
      nextStatus: "qualified",
      studentName: "Timur",
      studentAge: 10,
      courseId: 1,
    })).toBeNull();
  });

  it("requires a group before enrolling a lead", () => {
    expect(validateLeadForStatusChange({
      nextStatus: "enrolled",
      studentName: "Student",
      studentAge: 12,
      courseId: 1,
    })).toBe("groupRequiredForEnrollment");
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
    })).toBe("groupRequiredForEnrollment");
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

  it("marks unpaid payments as overdue after due date", () => {
    expect(getComputedPaymentStatus("paid", "2020-01-01")).toBe("paid");
    expect(getComputedPaymentStatus("pending", "2020-01-01")).toBe("overdue");
  });

  it("generates a stable referral code shape", () => {
    expect(buildReferralCode("Timur Aliyev", 7, 2026)).toBe("TIMURALI72026");
  });
});
