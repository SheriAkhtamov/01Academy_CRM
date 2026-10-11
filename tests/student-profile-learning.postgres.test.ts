import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { rows } from "../server/modules/lms/infrastructure/postgres-base";
const fixture = vi.hoisted(() => ({
  pool: null as unknown as import("pg").Pool,
}));
vi.mock("../server/modules/academy/academy-core", () => ({
  query: (sql: string, params: unknown[] = []) =>
    rows(fixture.pool, sql, params),
  queryOne: vi.fn(),
  SALES_MODULES: new Set(["sales", "administration"]),
  ensureModuleAccess: vi.fn(),
  ensureLeadRowAccess: vi.fn(),
  ensureLeadMutationAccess: vi.fn(),
  parseId: vi.fn(),
}));
vi.mock("../server/modules/academy/academy-leads", () => ({
  getLead: vi.fn(),
}));
vi.mock("../server/lib/logger", () => ({ logger: { error: vi.fn() } }));
import {
  configureStudentProfileLearningPortfolioAvailability,
  loadLearningStudentPortfolio,
} from "../server/modules/academy/student-profile-data";
const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `legacy_portfolio_${randomBytes(6).toString("hex")}`;
let admin: Pool;
describe.skipIf(!databaseUrl)(
  "legacy profile learning portfolio isolation",
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
        .query(`CREATE TABLE academy_teachers(id integer PRIMARY KEY,user_id integer,status text);
      CREATE TABLE academy_groups(id integer PRIMARY KEY,teacher_id integer);
      CREATE TABLE academy_student_group_enrollments(student_id integer,group_id integer);
      CREATE TABLE lms_group_runs(id bigint PRIMARY KEY,group_id integer);
      CREATE TABLE lms_staff_permissions(user_id integer,permission text);
      CREATE TABLE lms_files(id bigint PRIMARY KEY,student_id integer,name text,mime text,size_bytes bigint,state text,deleted_at timestamptz);
      CREATE TABLE academy_portfolio_projects(id integer PRIMARY KEY,student_id integer,group_id integer,lms_run_id bigint,title text,url text,file_url text,description text,file_ids jsonb,cover_file_id bigint,teacher_review text,portal_created boolean DEFAULT false,archived_at timestamptz,created_at timestamptz DEFAULT now());
      INSERT INTO academy_teachers VALUES(1,10,'active'),(2,11,'active'); INSERT INTO academy_groups VALUES(1,1),(2,2); INSERT INTO academy_student_group_enrollments VALUES(42,1),(42,2); INSERT INTO lms_group_runs VALUES(1,1),(2,2);
      INSERT INTO lms_files VALUES(1,42,'accepted.pdf','application/pdf',500,'ready',NULL),(2,42,'waiting.pdf','application/pdf',500,'checking',NULL),(3,42,'unsafe.pdf','application/pdf',500,'rejected',NULL),(4,42,'gone.pdf','application/pdf',500,'ready',now()),(5,99,'foreign.pdf','application/pdf',500,'ready',NULL);
      INSERT INTO academy_portfolio_projects(id,student_id,group_id,lms_run_id,title,url,description,file_ids,teacher_review,portal_created,archived_at) VALUES
      (1,42,2,1,'First group private','https://example.com/first','Private body','[1,2,3,4,5]','Private review',true,NULL),
      (2,42,1,2,'Second group private','https://example.com/second','Other course body','[1]','Other feedback',true,NULL),
      (3,42,1,1,'Archived private',NULL,'Archived body','[]',NULL,true,now()),
      (4,42,NULL,NULL,'Personal private',NULL,'Personal body','[]',NULL,true,NULL),
      (5,42,1,NULL,'Old school project','https://example.com/legacy','Old body','[]',NULL,false,NULL);`);
    });
    beforeEach(() => {
      configureStudentProfileLearningPortfolioAvailability(() => true);
    });
    afterAll(async () => {
      configureStudentProfileLearningPortfolioAvailability(null);
      if (fixture.pool) await fixture.pool.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });
    it("keeps sales and finance roles out of private portfolio contents", async () => {
      for (const modules of [["sales"], ["finance"]])
        expect(
          await loadLearningStudentPortfolio(42, {
            userId: 20,
            modules,
            isLeadership: false,
          }),
        ).toEqual([]);
    });
    it("uses the actual project run for teacher scope and exposes only ready own attachments", async () => {
      const first = await loadLearningStudentPortfolio(42, {
        userId: 10,
        modules: ["teacher"],
        isLeadership: false,
      });
      expect(first.map((project) => project.id)).toEqual([1]);
      expect(first[0].attachments).toEqual([
        {
          id: 1,
          name: "accepted.pdf",
          mime: "application/pdf",
          size: 500,
          downloadUrl: "/api/lms-management/files/1/download",
        },
      ]);
      expect(first[0]).not.toHaveProperty("description");
      expect(first[0]).not.toHaveProperty("teacherReview");
      expect(first[0]).not.toHaveProperty("fileIds");
      expect(
        (
          await loadLearningStudentPortfolio(42, {
            userId: 11,
            modules: ["teacher"],
            isLeadership: false,
          })
        ).map((project) => project.id),
      ).toEqual([2]);
      expect(
        await loadLearningStudentPortfolio(42, {
          userId: 10,
          modules: ["finance"],
          isLeadership: false,
        }),
      ).toEqual([]);
    });
    it("allows explicit results rights and administration while still filtering pilot groups", async () => {
      await fixture.pool.query(
        "INSERT INTO lms_staff_permissions VALUES(20,'results.manage')",
      );
      expect(
        (
          await loadLearningStudentPortfolio(42, {
            userId: 20,
            modules: ["sales"],
            isLeadership: false,
          })
        )
          .map((project) => project.id)
          .sort(),
      ).toEqual([1, 2, 4]);
      configureStudentProfileLearningPortfolioAvailability(
        (groupId) => groupId === 1,
      );
      expect(
        (
          await loadLearningStudentPortfolio(42, {
            userId: 30,
            modules: ["administration"],
            isLeadership: true,
          })
        )
          .map((project) => project.id)
          .sort(),
      ).toEqual([1, 4]);
      await fixture.pool.query(
        "DELETE FROM lms_staff_permissions WHERE user_id=20",
      );
    });
    it("leaves the legacy profile usable with learning disabled or its tables unavailable", async () => {
      configureStudentProfileLearningPortfolioAvailability(() => false);
      await fixture.pool.query(
        "ALTER TABLE lms_files RENAME TO unavailable_files",
      );
      try {
        expect(
          await loadLearningStudentPortfolio(42, {
            userId: 30,
            modules: ["administration"],
            isLeadership: true,
          }),
        ).toEqual([]);
        configureStudentProfileLearningPortfolioAvailability(() => true);
        expect(
          await loadLearningStudentPortfolio(42, {
            userId: 30,
            modules: ["administration"],
            isLeadership: true,
          }),
        ).toEqual([]);
        expect(
          (
            await fixture.pool.query(
              "SELECT title FROM academy_portfolio_projects project WHERE NOT COALESCE((to_jsonb(project)->>'portal_created')::boolean,false)",
            )
          ).rows,
        ).toEqual([{ title: "Old school project" }]);
      } finally {
        await fixture.pool.query(
          "ALTER TABLE unavailable_files RENAME TO lms_files",
        );
      }
    });
  },
);
