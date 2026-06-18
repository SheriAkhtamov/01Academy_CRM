import { describe, expect, it } from "vitest";
import {
  ACADEMY_ROLES,
  buildReferralCode,
  calculateAttendancePercent,
  calculateCac,
  calculateLtv,
  calculateNps,
  calculateProgressPercent,
  calculateRoas,
  getComputedPaymentStatus,
  suggestAgeGroup,
  suggestCourseSlugByAge,
  validateLeadForStatusChange,
  validateLeadStatusTransition,
} from "../shared/academy";

describe("01 Academy business rules", () => {
  it("only exposes roles that have an assigned workspace", () => {
    expect(ACADEMY_ROLES).toEqual([
      "admin",
      "head",
      "account_manager",
      "teacher",
      "operations_director",
      "smm_manager",
    ]);
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
    expect(validateLeadForStatusChange({ nextStatus: "qualified" })).toContain("Квалифицирован");
    expect(validateLeadForStatusChange({
      nextStatus: "qualified",
      studentName: "Timur",
      studentAge: 10,
      courseId: 1,
    })).toBeNull();
  });

  it("keeps paid clients terminal and requires a payment to enter paid", () => {
    expect(validateLeadStatusTransition("qualified", "paid")).toContain("оплату");
    expect(validateLeadStatusTransition("paid", "thinking")).toContain("нельзя вернуть");
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
