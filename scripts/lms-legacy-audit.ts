import { createHash } from "node:crypto";
import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";

export type LegacyIssue = {
  code: string;
  sourceType: string;
  sourceIds: number[];
  referenceHash?: string;
};
export type LegacyAudit = {
  issues: LegacyIssue[];
  truncated: boolean;
  checkedFileReferences: number;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Only local upload references are inspected; remote links are never fetched. */
export function uploadReferences(value: unknown): string[] {
  const result = new Set<string>();
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      for (const match of item.matchAll(/(?<![A-Za-z0-9.:/\-])\/uploads\/[^\s<>"'\]\[)]+/g))
        result.add(match[0].replace(/[.,;]+$/, ""));
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object")
      Object.values(item).forEach(visit);
  };
  visit(value);
  return [...result];
}

export async function inspectUploadReference(
  uploadsDirectory: string,
  reference: string,
): Promise<"present" | "missing" | "unsafe"> {
  try {
    const decoded = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
    if (!decoded.startsWith("/uploads/")) return "unsafe";
    const segments = decoded.slice("/uploads/".length).split("/");
    if (
      segments.some((segment) =>
        !segment || segment === "." || segment === ".." || /[\\\u0000-\u001f]/.test(segment),
      )
    ) return "unsafe";
    const root = await realpath(uploadsDirectory);
    let candidate = root;
    for (const segment of segments) {
      candidate = path.join(candidate, segment);
      if ((await lstat(candidate)).isSymbolicLink()) return "unsafe";
    }
    const resolved = await realpath(candidate);
    if (!resolved.startsWith(`${root}${path.sep}`)) return "unsafe";
    return (await stat(resolved)).isFile() ? "present" : "unsafe";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "missing"
      : "unsafe";
  }
}

export async function auditLegacyData(
  sql: PoolClient,
  limit = 5_000,
): Promise<LegacyAudit> {
  const audit: LegacyAudit = {
    issues: [],
    truncated: false,
    checkedFileReferences: 0,
  };
  const checks: { code: string; source: string; sql: string }[] = [
    {
      code: "duplicate_student_lead",
      source: "student",
      sql: "SELECT array_agg(id ORDER BY id) AS ids FROM academy_students WHERE lead_id IS NOT NULL GROUP BY lead_id HAVING count(*)>1 ORDER BY min(id)",
    },
    {
      code: "possible_duplicate_student",
      source: "student",
      sql: "SELECT array_agg(id ORDER BY id) AS ids FROM academy_students WHERE nullif(trim(student_name),'') IS NOT NULL AND length(regexp_replace(phone,'[^0-9]','','g'))>=7 GROUP BY lower(trim(student_name)),regexp_replace(phone,'[^0-9]','','g') HAVING count(*)>1 ORDER BY min(id)",
    },
    {
      code: "shared_contact_requires_verification",
      source: "student",
      sql: "SELECT array_agg(id ORDER BY id) AS ids FROM academy_students WHERE length(regexp_replace(phone,'[^0-9]','','g'))>=7 GROUP BY regexp_replace(phone,'[^0-9]','','g') HAVING count(*)>1 ORDER BY min(id)",
    },
    {
      code: "payment_without_student_allocation",
      source: "payment",
      sql: "SELECT ARRAY[payment.id] AS ids FROM academy_payments payment LEFT JOIN academy_students student ON student.id=payment.student_id LEFT JOIN LATERAL(SELECT COALESCE(sum(amount_uzs),0) AS amount FROM academy_payment_student_allocations allocation WHERE allocation.payment_id=payment.id) allocation ON true WHERE student.id IS NULL AND allocation.amount<payment.amount_uzs ORDER BY payment.id",
    },
    {
      code: "group_course_or_teacher_missing",
      source: "group",
      sql: "SELECT ARRAY[g.id] AS ids FROM academy_groups g LEFT JOIN academy_courses course ON course.id=g.course_id LEFT JOIN academy_teachers teacher ON teacher.id=g.teacher_id LEFT JOIN users staff ON staff.id=teacher.user_id WHERE course.id IS NULL OR teacher.id IS NULL OR staff.id IS NULL OR NOT staff.is_active OR staff.is_archived OR teacher.status<>'active' ORDER BY g.id",
    },
    {
      code: "lesson_relation_incomplete",
      source: "lesson",
      sql: "SELECT ARRAY[lesson.id] AS ids FROM academy_lessons lesson LEFT JOIN academy_groups g ON g.id=lesson.group_id WHERE g.id IS NULL OR (lesson.course_id IS NOT NULL AND lesson.course_id<>g.course_id) OR lesson.lesson_number<1 ORDER BY lesson.id",
    },
    {
      code: "enrollment_relation_incomplete",
      source: "enrollment",
      sql: "SELECT ARRAY[enrollment.id] AS ids FROM academy_student_group_enrollments enrollment LEFT JOIN academy_students student ON student.id=enrollment.student_id LEFT JOIN academy_groups g ON g.id=enrollment.group_id WHERE student.id IS NULL OR g.id IS NULL OR enrollment.enrolled_at IS NULL OR enrollment.ended_at<enrollment.enrolled_at ORDER BY enrollment.id",
    },
    {
      code: "legacy_group_without_enrollment",
      source: "student",
      sql: "SELECT ARRAY[student.id] AS ids FROM academy_students student WHERE student.group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.student_id=student.id AND enrollment.group_id=student.group_id) ORDER BY student.id",
    },
    {
      code: "portfolio_relation_incomplete",
      source: "portfolio",
      sql: "SELECT ARRAY[project.id] AS ids FROM academy_portfolio_projects project LEFT JOIN academy_students student ON student.id=project.student_id LEFT JOIN academy_lessons lesson ON lesson.id=project.lesson_id LEFT JOIN academy_groups g ON g.id=project.group_id LEFT JOIN academy_courses course ON course.id=project.course_id WHERE student.id IS NULL OR (project.lesson_id IS NOT NULL AND (lesson.id IS NULL OR (project.group_id IS NOT NULL AND lesson.group_id<>project.group_id))) OR (project.group_id IS NOT NULL AND g.id IS NULL) OR (project.course_id IS NOT NULL AND course.id IS NULL) ORDER BY project.id",
    },
  ];
  for (const check of checks) {
    const rows = (await sql.query<{ ids: number[] }>(`${check.sql} LIMIT $1`, [limit + 1])).rows;
    if (rows.length > limit) audit.truncated = true;
    for (const row of rows.slice(0, limit))
      audit.issues.push({ code: check.code, sourceType: check.source, sourceIds: row.ids.map(Number) });
  }
  return audit;
}

export async function auditSourceFiles(
  audit: LegacyAudit,
  uploadsDirectory: string,
  sourceType: string,
  sourceId: number,
  content: unknown,
): Promise<void> {
  for (const reference of uploadReferences(content)) {
    audit.checkedFileReferences++;
    const state = await inspectUploadReference(uploadsDirectory, reference);
    if (state !== "present")
      audit.issues.push({
        code: state === "missing" ? "missing_upload" : "unsafe_upload_reference",
        sourceType,
        sourceIds: [sourceId],
        referenceHash: hash(reference),
      });
  }
}
