import { describe, expect, it, vi } from "vitest";
import {
  notificationEscalationAt,
  PortalNotificationWorker,
  PORTAL_NOTIFICATION_EVENT_CODES,
} from "../server/modules/portal-resources/infrastructure/notification-worker";
import type { Pool } from "pg";
import { translations, type TranslationKey } from "../client/src/lib/i18n";
import { learningNotificationCopy } from "../server/lib/learning-notification-copy";
const date = (value: string) => new Date(value).getTime();

describe("LMS notification time and default-off policies", () => {
  it("escalates unanswered requests after 24 hours regardless of branches or weekends", () => {
    expect(notificationEscalationAt(date("2026-10-09T05:00:00Z"))).toBe(date("2026-10-10T05:00:00Z"));
    expect(notificationEscalationAt(date("2026-10-12T18:00:00Z"))).toBe(date("2026-10-13T18:00:00Z"));
  });
  it("does not even query or connect while disabled", async () => {
    const connect = vi.fn();
    const worker = new PortalNotificationWorker({
      pool: { connect } as unknown as Pool,
      enabled: false,
      authorizeLink: vi.fn(),
    });
    expect(await worker.runOnce()).toEqual({
      queued: 0,
      delivered: 0,
      cancelled: 0,
      failed: 0,
    });
    expect(connect).not.toHaveBeenCalled();
  });
  it("has distinct notification codes for every required event family", () => {
    expect(new Set(Object.values(PORTAL_NOTIFICATION_EVENT_CODES)).size).toBe(
      Object.keys(PORTAL_NOTIFICATION_EVENT_CODES).length,
    );
    expect(PORTAL_NOTIFICATION_EVENT_CODES).toEqual(
      expect.objectContaining({
        material_published: expect.any(String),
        assignment_assigned: expect.any(String),
        assignment_due: expect.any(String),
        assignment_overdue: expect.any(String),
        assignment_submitted: expect.any(String),
        assignment_accepted: expect.any(String),
        assignment_revision_required: expect.any(String),
        lesson_rescheduled: expect.any(String),
        lesson_cancelled: expect.any(String),
        attendance_absent: expect.any(String),
        thread_answered: expect.any(String),
        payment_due: expect.any(String),
        payment_overdue: expect.any(String),
        report_published: expect.any(String),
        achievement_awarded: expect.any(String),
        password_changed: expect.any(String),
        access_changed: expect.any(String),
        family_weekly: expect.any(String),
      }),
    );
  });
  it("uses the same complete RU/EN wording for portal and staff notification codes", () => {
    const staffCodes = ["lmsNoticeReviewQueue", "lmsNoticeHelpRequested", "lmsNoticeHelpEscalated", "lmsNoticeLessonChanged", "lmsNoticeAssignmentOverdue", "lmsNoticePublished", "lmsNoticeDeliveryFailed"] as const;
    const params = { title: "Example", children: 2, updates: 4 };
    for (const code of [...Object.values(PORTAL_NOTIFICATION_EVENT_CODES), ...staffCodes]) {
      for (const locale of ["ru", "en"] as const) {
        const expected = Object.entries(params).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), String(translations[code as TranslationKey][locale]));
        expect(learningNotificationCopy(code, params, locale), `${code} ${locale}`).toBe(expected);
      }
    }
  });
});
