import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { rows } from "../server/modules/lms/infrastructure/postgres-base";
import type { AcademyAccessModule } from "@shared/academy";

const fixture = vi.hoisted(() => ({
  pool: null as unknown as import("pg").Pool,
  queries: [] as string[],
}));
vi.mock("../server/modules/academy/academy-core", () => ({
  ACADEMY_TIME_ZONE: "Asia/Tashkent",
  query: async (sql: string, values: unknown[] = []) => {
    fixture.queries.push(sql);
    return rows(fixture.pool, sql, values);
  },
  queryOne: async (sql: string, values: unknown[] = []) => {
    fixture.queries.push(sql);
    return (await rows(fixture.pool, sql, values))[0] ?? null;
  },
  applyLeadVisibilityForActor: async (_actor: unknown, leads: unknown[]) =>
    leads,
  leadPhoneNumbersSelect: vi.fn(),
  leadTagsSelect: vi.fn(),
  studentGroupMembershipsSelect: vi.fn(),
}));
import { getAcademyDataset } from "../server/modules/academy/academy-analytics";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `legacy_teacher_${randomBytes(6).toString("hex")}`;
let admin: Pool;
const include = [
  "schools",
  "rooms",
  "courses",
  "teachers",
  "groups",
  "students",
  "lessons",
  "attendance",
  "projects",
] as const;
const dataset = (userId: number, modules: AcademyAccessModule[] = ["teacher"]) =>
  getAcademyDataset(
    { userId, module: modules[0], modules, scopeModule: "teacher" },
    { include },
  );

describe.skipIf(!databaseUrl)(
  "legacy teacher module against the actual student schema",
  () => {
    beforeAll(async () => {
      if (
        !databaseUrl ||
        !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
          new URL(databaseUrl).hostname,
        )
      )
        throw new Error("Local isolated PostgreSQL required");
      admin = new Pool({ connectionString: databaseUrl });
      await admin.query(`CREATE SCHEMA ${schema}`);
      fixture.pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema} -c timezone=UTC`,
      });
      await fixture.pool
        .query(`CREATE TABLE users(id integer PRIMARY KEY,full_name text);
      CREATE TABLE academy_schools(id integer PRIMARY KEY,name text,is_active boolean DEFAULT true);
      CREATE TABLE academy_rooms(id integer PRIMARY KEY,name text,school_id integer,is_active boolean DEFAULT true);
      CREATE TABLE academy_courses(id integer PRIMARY KEY,name text);
      CREATE TABLE academy_teachers(id integer PRIMARY KEY,user_id integer,full_name text,status text);
      CREATE TABLE academy_groups(id integer PRIMARY KEY,name text,course_id integer,teacher_id integer,school_id integer,room_id integer,archived_by integer,status text DEFAULT 'open',is_archived boolean DEFAULT false,created_at timestamptz DEFAULT now());
      CREATE TABLE academy_leads(id integer PRIMARY KEY,is_archived boolean DEFAULT false);
      CREATE TABLE academy_lead_group_reservations(group_id integer,lead_id integer);
      CREATE TABLE academy_students(id integer PRIMARY KEY,student_name text,contact_name text,student_age integer,status text DEFAULT 'studying',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),enrolled_at timestamptz DEFAULT now(),enrollment_date date DEFAULT current_date,attendance_percent numeric,progress_percent numeric,course_id integer,group_id integer,manager_id integer,school_id integer,lead_id integer,phone text,paid_amount_uzs bigint);
      CREATE TABLE academy_student_group_enrollments(student_id integer,group_id integer,status text,is_primary boolean,enrolled_at timestamptz DEFAULT now());
      CREATE TABLE academy_lessons(id integer PRIMARY KEY,group_id integer,teacher_id integer,course_id integer,school_id integer,room_id integer,topic text,scheduled_at timestamptz DEFAULT now(),status text);
      CREATE TABLE academy_attendance(id integer PRIMARY KEY,lesson_id integer,student_id integer,status text);
      CREATE TABLE academy_portfolio_projects(id integer PRIMARY KEY,student_id integer,group_id integer,title text,created_at timestamptz DEFAULT now());
      INSERT INTO users VALUES(10,'Teacher one'),(11,'Teacher two');
      INSERT INTO academy_schools(id,name) VALUES(1,'School'); INSERT INTO academy_rooms(id,name,school_id) VALUES(1,'Room',1);
      INSERT INTO academy_courses VALUES(1,'First course'),(2,'Second course'); INSERT INTO academy_teachers VALUES(1,10,'Teacher one','active'),(2,11,'Teacher two','active');
      INSERT INTO academy_groups(id,name,course_id,teacher_id,school_id,room_id) VALUES(1,'First group',1,1,1,1),(2,'Second group',2,2,1,1);
      INSERT INTO academy_students(id,student_name,contact_name,student_age,course_id,group_id,manager_id,school_id,phone,paid_amount_uzs) VALUES(41,'Shared learner','Contact',18,2,2,11,1,'private-contact',100000),(42,'Foreign learner','Other contact',20,2,2,11,1,'foreign-contact',200000);
      INSERT INTO academy_student_group_enrollments(student_id,group_id,status,is_primary) VALUES(41,1,'active',false),(41,2,'active',true),(42,2,'active',true);
      INSERT INTO academy_lessons(id,group_id,teacher_id,course_id,school_id,room_id,topic,status) VALUES(1,1,1,1,1,1,'Own lesson','conducted'),(2,2,2,2,1,1,'Foreign lesson','conducted');
      INSERT INTO academy_attendance VALUES(1,1,41,'present'),(2,2,42,'absent');
      INSERT INTO academy_portfolio_projects(id,student_id,group_id,title) VALUES(1,41,1,'Own project'),(2,42,2,'Foreign project');`);
    });
    beforeEach(() => {
      fixture.queries = [];
    });
    afterAll(async () => {
      if (fixture.pool) await fixture.pool.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });
    it("loads the existing teacher module without a final_project_status column or LMS tables", async () => {
      expect(
        (
          await fixture.pool.query(
            "SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='academy_students' AND column_name='final_project_status'",
            [schema],
          )
        ).rows,
      ).toEqual([]);
      const result = await dataset(10);
      expect(result.teachers.map((teacher) => teacher.id)).toEqual([1]);
      expect(result.groups.map((group) => group.id)).toEqual([1]);
      expect(result.students.map((student) => student.id)).toEqual([41]);
      expect(result.students[0]).toMatchObject({
        groupId: 1,
        courseId: 1,
        groupIds: [1],
        groups: [{ groupId: 1, courseId: 1 }],
      });
      for (const field of [
        "finalProjectStatus",
        "phone",
        "paidAmountUzs",
        "managerName",
        "paymentStatus",
      ])
        expect(result.students[0]).not.toHaveProperty(field);
      expect(result.lessons.map((lesson) => lesson.id)).toEqual([1]);
      expect(result.attendance.map((mark) => mark.id)).toEqual([1]);
      expect(result.projects.map((project) => project.id)).toEqual([1]);
      expect(
        fixture.queries.some((sql) => /\b(?:lms_|portal_)/.test(sql)),
      ).toBe(false);
    });
    it("keeps leadership accounts in their teacher scope and fails closed without a teacher mapping", async () => {
      const leadership = await dataset(10, ["administration", "teacher"]);
      expect(leadership.students.map((student) => student.id)).toEqual([41]);
      expect(leadership.groups.map((group) => group.id)).toEqual([1]);
      const other = await dataset(11);
      expect(other.students.map((student) => student.id).sort()).toEqual([
        41, 42,
      ]);
      expect(other.groups.map((group) => group.id)).toEqual([2]);
      const unmapped = await dataset(99, ["administration", "teacher"]);
      for (const items of [
        unmapped.teachers,
        unmapped.groups,
        unmapped.students,
        unmapped.lessons,
        unmapped.attendance,
        unmapped.projects,
      ])
        expect(items).toEqual([]);
    });
  },
);
