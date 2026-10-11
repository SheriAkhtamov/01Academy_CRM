import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { LmsAcceptanceFailure } from "./lms-api-acceptance-guard";

const positive = z.number().int().positive();
const fakeStaff = z
  .object({
    id: positive,
    email: z
      .string()
      .email()
      .refine((value) => value.endsWith("@acceptance.invalid")),
  })
  .strict();
const fakeStudent = z
  .object({
    id: positive,
    enrollmentId: positive,
    groupId: positive,
    paymentId: positive.nullable(),
    login: z.string().regex(/^[a-z0-9._-]{4,32}$/),
    label: z.string().max(80),
    classification: z.enum(["minor", "adult"]),
    accountId: positive.nullable(),
    linkId: positive.nullable(),
  })
  .strict();
export const acceptanceFixtureSchema = z
  .object({
    kind: z.literal("lms-http-acceptance-v1"),
    tag: z.string().regex(/^[a-f0-9]{12}$/),
    databaseName: z
      .string()
      .regex(/^(academy_lms_[a-zA-Z0-9_]+|lms_staging(?:_[a-zA-Z0-9_]+)?)$/),
    password: z.string().min(12).max(72),
    createdAt: z.string().datetime(),
    load: z.boolean(),
    staff: z
      .object({ admin: fakeStaff, teacher: fakeStaff, finance: fakeStaff })
      .strict(),
    teacherId: positive,
    courseId: positive,
    schoolId: positive,
    roomId: positive,
    groups: z.array(positive).min(3).max(100),
    students: z.array(fakeStudent).min(4).max(1000),
  })
  .strict();
export type AcceptanceFixture = z.infer<typeof acceptanceFixtureSchema>;
const id = async (
  sql: PoolClient,
  statement: string,
  parameters: unknown[],
) => {
  const result = await sql.query<{ id: number }>(statement, parameters);
  const value = Number(result.rows[0]?.id);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new LmsAcceptanceFailure("ACCEPTANCE_FIXTURE_ID_INVALID");
  return value;
};
export const fakeLabel = (tag: string, suffix: string) =>
  `[LMS Acceptance ${tag}] ${suffix}`;

/** Never empties tables or updates existing CRM records. Every new person and course is visibly tagged. */
export async function seedAcceptanceFixture(
  pool: Pool,
  databaseName: string,
  load: boolean,
): Promise<AcceptanceFixture> {
  const tag = randomBytes(6).toString("hex");
  const password = `Acceptance-${randomBytes(20).toString("base64url")}!7`;
  const passwordHash = await bcrypt.hash(password, 12);
  const sql = await pool.connect();
  try {
    await sql.query("BEGIN");
    const database = await sql.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    if (database.rows[0]?.name !== databaseName)
      throw new LmsAcceptanceFailure("ACCEPTANCE_DATABASE_MISMATCH");
    const foreign = await sql.query<{ count: string }>(`SELECT (
      (SELECT count(*) FROM users WHERE full_name NOT LIKE '[LMS Acceptance %' OR email NOT LIKE '%@acceptance.invalid') +
      (SELECT count(*) FROM academy_students WHERE contact_name NOT LIKE '[LMS Acceptance %') +
      (SELECT count(*) FROM academy_courses WHERE name NOT LIKE '[LMS Acceptance %') +
      (SELECT count(*) FROM academy_groups g JOIN academy_courses c ON c.id=g.course_id WHERE c.name NOT LIKE '[LMS Acceptance %') +
      (SELECT count(*) FROM academy_schools WHERE name NOT LIKE '[LMS Acceptance %' AND NOT(code='cyberpark' AND name='Cyberpark')) +
      (SELECT count(*) FROM academy_teachers WHERE full_name NOT LIKE '[LMS Acceptance %')
    )::text AS count`);
    if (Number(foreign.rows[0].count))
      throw new LmsAcceptanceFailure("ACCEPTANCE_EXISTING_DATA_REFUSED");
    const staff = {} as AcceptanceFixture["staff"];
    for (const [role, module] of [
      ["admin", "administration"],
      ["teacher", "teacher"],
      ["finance", "finance"],
    ] as const) {
      const email = `${tag}.${role}@acceptance.invalid`;
      const userId = await id(
        sql,
        "INSERT INTO users(email,password,full_name,module,is_active) VALUES($1,$2,$3,$4,true) RETURNING id",
        [email, passwordHash, fakeLabel(tag, role), module],
      );
      await sql.query(
        "INSERT INTO user_modules(user_id,module) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [userId, module],
      );
      staff[role] = { id: userId, email };
    }
    const school = (
      await sql.query<{ id: number }>(
      "SELECT id FROM academy_schools WHERE (code='cyberpark' AND name='Cyberpark') OR (code='CYP' AND name LIKE '[LMS Acceptance %') ORDER BY id LIMIT 1",
      )
    ).rows[0];
    const schoolId =
      school?.id ??
      (await id(
        sql,
        "INSERT INTO academy_schools(name,code,address) VALUES($1,$2,$3) RETURNING id",
        [
          fakeLabel(tag, "Cyberpark fixture"),
          "CYP",
          "Acceptance fixture address",
        ],
      ));
    const roomId = await id(
      sql,
      "INSERT INTO academy_rooms(school_id,name,capacity) VALUES($1,$2,20) RETURNING id",
      [schoolId, fakeLabel(tag, "room")],
    );
    const courseId = await id(
      sql,
      "INSERT INTO academy_courses(name,slug,age_category,lesson_count,program) VALUES($1,$2,$3,2,$4::jsonb) RETURNING id",
      [
        fakeLabel(tag, "VC course"),
        `acceptance-${tag}-vc`,
        "Acceptance fixture",
        JSON.stringify([
          { topic: fakeLabel(tag, "Lesson one") },
          { topic: fakeLabel(tag, "Lesson two") },
        ]),
      ],
    );
    const teacherId = await id(
      sql,
      "INSERT INTO academy_teachers(user_id,full_name,course_ids,school_ids) VALUES($1,$2,$3::jsonb,$4::jsonb) RETURNING id",
      [
        staff.teacher.id,
        fakeLabel(tag, "teacher"),
        JSON.stringify([courseId]),
        JSON.stringify([schoolId]),
      ],
    );
    // All historical names, including archived groups, participate in the global suffix sequence.
    await sql.query("SELECT pg_advisory_xact_lock(56470201)");
    await sql.query("LOCK TABLE academy_groups IN SHARE ROW EXCLUSIVE MODE");
    const previous = (
      await sql.query<{ name: string }>(
        "SELECT name FROM academy_groups ORDER BY id",
      )
    ).rows;
    let sequence = previous.reduce(
      (max, group) =>
        Math.max(max, Number(group.name.match(/-(\d+)$/)?.[1] ?? 0)),
      0,
    );
    const groups: number[] = [];
    for (let index = 0; index < (load ? 100 : 3); index++) {
      const number = ++sequence;
      const name = `ONL-VC-GRP-${String(new Date().getUTCFullYear()).slice(-2)}-${String(number).padStart(4, "0")}`;
      const conflict = await sql.query(
        "SELECT id FROM academy_groups WHERE name=$1 OR substring(name FROM '-([0-9]+)$')::bigint=$2",
        [name, number],
      );
      if (conflict.rowCount)
        throw new LmsAcceptanceFailure("ACCEPTANCE_GROUP_CODE_CONFLICT");
      groups.push(
        await id(
          sql,
          "INSERT INTO academy_groups(name,course_id,school_id,room_id,teacher_id,status,max_students) VALUES($1,$2,$3,$4,$5,$6,20) RETURNING id",
          [name, courseId, schoolId, roomId, teacherId, "open"],
        ),
      );
    }
    const students: AcceptanceFixture["students"] = [];
    for (let index = 0; index < (load ? 1000 : 4); index++) {
      const label =
        ["child_a", "child_b", "foreign", "parent_self"][index] ??
        `load_${index}`;
      const classification = index < 2 ? "minor" : "adult";
      const groupId = groups[index === 3 ? 0 : index % groups.length];
      const studentId = await id(
        sql,
        "INSERT INTO academy_students(group_id,course_id,school_id,manager_id,contact_name,student_name,student_age,referral_code,enrolled_at) VALUES($1,$2,$3,$4,$5,$5,$6,$7,now()-interval '30 days') RETURNING id",
        [
          groupId,
          courseId,
          schoolId,
          staff.admin.id,
          fakeLabel(tag, label),
          classification === "minor" ? 12 : 30,
          `acceptance-${tag}-${index}`,
        ],
      );
      const enrollmentId = await id(
        sql,
        "INSERT INTO academy_student_group_enrollments(student_id,group_id,is_primary,enrolled_at,created_by) VALUES($1,$2,true,now()-interval '30 days',$3) RETURNING id",
        [studentId, groupId, staff.admin.id],
      );
      const login = `acc_${tag}_${label}`;
      const paymentId =
        index < 4
          ? await id(
              sql,
              "INSERT INTO academy_payments(student_id,group_id,amount_uzs,status,paid_at,paid_until,period,comment) VALUES($1,$2,$3,'paid',now(),now()+interval '30 days',$4,$5) RETURNING id",
              [
                studentId,
                groupId,
                500_000 * (index + 1),
                fakeLabel(tag, "paid period"),
                fakeLabel(tag, "PRIVATE payment note"),
              ],
            )
          : null;
      let accountId: number | null = null;
      let linkId: number | null = null;
      if (index >= 4) {
        await sql.query(
          "INSERT INTO portal_student_identity(student_id,classification,verified_at,verified_by,verification_method) VALUES($1,'adult',now(),$2,'acceptance_fixture')",
          [studentId, staff.admin.id],
        );
        accountId = await id(
          sql,
          "INSERT INTO portal_accounts(login,full_name,email,locale,status,password_hash) VALUES($1,$2,$3,'en','active',$4) RETURNING id",
          [
            login,
            fakeLabel(tag, label),
            `${tag}.${label}@acceptance.invalid`,
            passwordHash,
          ],
        );
        linkId = await id(
          sql,
          "INSERT INTO portal_student_links(account_id,student_id,kind,permissions,status,verified_at,verified_by) VALUES($1,$2,'self',$3::jsonb,'active',now(),$4) RETURNING id",
          [
            accountId,
            studentId,
            JSON.stringify([
              "learning.read",
              "attendance.read",
              "feedback.read",
              "communication.create",
              "assignments.submit",
              "quizzes.attempt",
              "portfolio.edit",
            ]),
            staff.admin.id,
          ],
        );
      }
      students.push({
        id: studentId,
        enrollmentId,
        groupId,
        paymentId,
        login,
        label,
        classification,
        accountId,
        linkId,
      });
    }
    for (let index = 0; index < 3; index++)
      await sql.query(
        "INSERT INTO academy_lessons(group_id,course_id,school_id,room_id,teacher_id,lesson_number,topic,scheduled_at) VALUES($1,$2,$3,$4,$5,1,$6,now()+interval '1 day')",
        [
          groups[index],
          courseId,
          schoolId,
          roomId,
          teacherId,
          fakeLabel(tag, `lesson_${index}`),
        ],
      );
    await sql.query(
      "UPDATE lms_feature_flags SET enabled=(key<>'email'),all_groups=false,group_ids=CASE WHEN key='email' THEN '{}'::integer[] ELSE $1::integer[] END,updated_by=$2,version=version+1,updated_at=now()",
      [groups, staff.admin.id],
    );
    await sql.query("COMMIT");
    return acceptanceFixtureSchema.parse({
      kind: "lms-http-acceptance-v1",
      tag,
      databaseName,
      password,
      createdAt: new Date().toISOString(),
      load,
      staff,
      teacherId,
      courseId,
      schoolId,
      roomId,
      groups,
      students,
    });
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  } finally {
    sql.release();
  }
}
export async function verifyAcceptanceFixture(
  pool: Pool,
  fixture: AcceptanceFixture,
  databaseName: string,
) {
  if (fixture.databaseName !== databaseName)
    throw new LmsAcceptanceFailure("ACCEPTANCE_DATABASE_MISMATCH");
  const result = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM academy_students WHERE id=ANY($1::integer[]) AND contact_name LIKE $2",
    [
      fixture.students.map((student) => student.id),
      `[LMS Acceptance ${fixture.tag}] %`,
    ],
  );
  if (result.rows[0]?.count !== fixture.students.length)
    throw new LmsAcceptanceFailure("ACCEPTANCE_FIXTURE_SCOPE_REFUSED");
  const users = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE id=ANY($1::integer[]) AND email=ANY($2::text[])",
    [
      Object.values(fixture.staff).map((staff) => staff.id),
      Object.values(fixture.staff).map((staff) => staff.email),
    ],
  );
  if (users.rows[0]?.count !== 3)
    throw new LmsAcceptanceFailure("ACCEPTANCE_FIXTURE_SCOPE_REFUSED");
}
