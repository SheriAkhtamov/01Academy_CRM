import { expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { isLearningNavigationHref, learningSubjectHref, toLearningModuleHref } from "../shared/platform-routes";
import { PostgresPortalResourceRepository } from "../server/modules/portal-resources/infrastructure/postgres-repository";

it.each([
  ["/learn/assignments/7?linkId=9#draft", "parent", "/parent-module/assignments/7?linkId=9#draft"],
  ["/learn/activate#token=a%2Fb", "student", "/activate#token=a%2Fb"],
  ["/learn/invite?token=legacy#token=fragment", "parent", "/activate?token=legacy#token=fragment"],
  ["/learn/reset", "parent", "/recover"],
  ["/learn/invite/#token=legacy", "student", "/activate#token=legacy"],
  ["/learn/?linkId=9", "parent", "/parent-module?linkId=9"],
  ["/student-module/profile?linkId=8", "parent", "/parent-module/profile?linkId=8"],
  ["/sales/pipeline?stage=2", "student", "/sales/pipeline?stage=2"],
  ["//example.test/learn", "parent", "//example.test/learn"],
] as const)("maps %s to the canonical module without losing its destination", (href, module, expected) => {
  expect(toLearningModuleHref(href, module)).toBe(expected);
});

it.each(["/learning", "/learn-other", "/student-module-other", "https://example.test/learn", "//example.test/parent-module", "javascript:alert(1)"])("rejects %s as an in-platform learning navigation link", (href) => {
  expect(isLearningNavigationHref(href)).toBe(false);
});

it("generates a parent notification link with a concrete child while preserving other parameters", () => {
  expect(learningSubjectHref("/learn/payments?question=4&linkId=999#reply", { kind: "representative", linkId: 8 })).toBe("/parent-module/payments?question=4&linkId=8#reply");
});

it("presents both old persisted and new notification links in the correct module without a data migration", async () => {
  const query = vi.fn().mockResolvedValueOnce({ rows: [
    { id: 3, link_id: 8, link_kind: "representative", href: "/learn/payments?question=4", code: "portalNoticeThreadAnswered" },
    { id: 2, link_id: 9, link_kind: "self", href: "/student-module/assignments/7", code: "portalNoticeAssignmentPublished" },
  ] }).mockResolvedValueOnce({ rows: [{ count: 2 }] });
  const repository = new PostgresPortalResourceRepository({ query } as unknown as Pool);
  const page = await repository.notifications(50, null, 10);
  expect(page.items.map((item) => item.href)).toEqual([
    "/parent-module/payments?question=4&linkId=8",
    "/student-module/assignments/7?linkId=9",
  ]);
  expect(page.items.every((item) => !("linkKind" in item))).toBe(true);
  expect(page.unreadCount).toBe(2);
});
