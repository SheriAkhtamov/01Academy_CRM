import { expect, it } from "vitest";
import type { PortalSubjectDto } from "../shared/contracts/portal-identity";
import {
  canAccessPortalSection,
  resolvePortalHref,
  resolvePortalNotificationHref,
} from "../client/src/features/portal-app/module-navigation";

const student: PortalSubjectDto = {
  linkId: 1,
  studentId: 10,
  studentName: "Student",
  kind: "self",
  relationship: null,
  permissions: ["learning.read", "assignments.submit", "feedback.read"],
  status: "active",
  studentClassification: "adult",
};
const parent: PortalSubjectDto = {
  ...student,
  linkId: 2,
  studentId: 20,
  kind: "representative",
  relationship: "parent",
  permissions: ["learning.read", "attendance.read", "finance.read", "feedback.read"],
};
const payer: PortalSubjectDto = {
  ...parent,
  linkId: 3,
  studentId: 30,
  permissions: ["finance.read", "communication.create"],
};
const subjects = [student, parent, payer];

it.each([
  ["/learn/assignments/9#draft", 1, "/student-module/assignments/9?linkId=1#draft"],
  ["/learn/assignments/9", 2, "/parent-module/progress?linkId=2"],
  ["/student-module/assignments/9", 2, null],
  ["/parent-module/progress?linkId=1&tab=history#grade", 2, "/parent-module/progress?linkId=2&tab=history#grade"],
  ["/parent-module/progress?linkId=2", 999, null],
  [null, 2, null],
  ["/learn/notifications", null, "/parent-module/notifications"],
  ["/learn/feedback?review=5&linkId=2#grade", null, "/parent-module/feedback?review=5&linkId=2#grade"],
] as const)("resolves notice %s using its trusted target %s", (href, linkId, expected) => {
  expect(resolvePortalNotificationHref({ href, linkId }, subjects, "parent")).toBe(expected);
});

it.each(["/courses", "/courses/8/materials/9", "/assignments", "/assignments/9"])(
  "keeps standalone %s student-only without changing its read API permissions",
  (path) => {
    expect(canAccessPortalSection(`/student-module${path}`, "student", subjects)).toBe(true);
    expect(canAccessPortalSection(`/parent-module${path}`, "parent", subjects)).toBe(false);
  },
);

it.each([
  ["/parent-module/progress?linkId=2", true],
  ["/parent-module/progress?linkId=3", false],
  ["/parent-module/payments?linkId=3", true],
  ["/parent-module/payments?linkId=1", false],
  ["/parent-module/quizzes?linkId=2", true],
  ["/parent-module?linkId=3", true],
  ["/parent-module/notifications", true],
  ["/student-module/progress?linkId=1", false],
] as const)(
  "evaluates role and concrete permissions for %s",
  (path, expected) => {
    expect(canAccessPortalSection(path, "parent", subjects)).toBe(expected);
  },
);

it.each([
  ["/learn/assignments/9?linkId=2#draft", "student", "/parent-module/progress?linkId=2"],
  ["/parent-module/courses/8/materials/9?linkId=2", "student", "/parent-module/progress?linkId=2"],
  ["/learn/assignments/9?linkId=1#draft", "parent", "/student-module/assignments/9?linkId=1#draft"],
  ["/learn/feedback?review=5&linkId=2#grade", "student", "/parent-module/feedback?review=5&linkId=2#grade"],
  ["/learn/payments?linkId=3&question=4", "student", "/parent-module/payments?linkId=3&question=4"],
  ["/learn/assignments/9?linkId=3", "parent", null],
  ["/student-module/assignments/9?linkId=2", "parent", null],
  ["/parent-module/progress?linkId=1", "parent", null],
  ["/learn/progress?linkId=999", "parent", null],
  ["/learn/progress?linkId=NaN", "parent", null],
  ["/learn/progress", "parent", "/parent-module/progress"],
  ["/learn/courses", "parent", null],
  ["/learn/courses", "student", "/student-module/courses"],
  ["/sales", "student", null],
  ["//external.example/learn", "parent", null],
] as const)(
  "resolves %s from the %s module to an authorized destination",
  (href, module, expected) => {
    expect(resolvePortalHref(href, subjects, module)).toBe(expected);
  },
);
