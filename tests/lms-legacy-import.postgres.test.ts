import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectUploadReference, uploadReferences } from "../scripts/lms-legacy-audit";
import { legacySourceHash, runLegacyImport } from "../scripts/lms-legacy-import";
import { parseLegacyImportArguments } from "../scripts/lms-import-legacy";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `lms_import_it_${randomBytes(8).toString("hex")}`;
let admin: Pool, pool: Pool, directory: string;
const run = (options: Partial<Parameters<typeof runLegacyImport>[1]> = {}) => runLegacyImport(pool, { apply: true, actorUserId: 1, defaultFormat: "offline", uploadsDirectory: directory, ...options });
async function counts() {
  const names = ["lms_course_versions", "lms_units", "lms_group_runs", "lms_lesson_bindings", "lms_materials", "lms_material_versions", "lms_material_publications", "lms_legacy_imports", "lms_legacy_import_checkpoints", "lms_legacy_portfolio_drafts", "portal_accounts", "portal_student_links", "lms_portfolio_shares", "lms_learning_events"];
  return Object.fromEntries(await Promise.all(names.map(async (table) => [table, Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count)])));
}
async function originalRows() {
  const tables = ["academy_students", "academy_courses", "academy_groups", "academy_lessons", "academy_portfolio_projects", "academy_payments", "academy_student_group_enrollments"];
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows])));
}

describe("LMS legacy import option and local-file protection", () => {
  it("defaults to dry-run and requires an explicit format when applying groups", () => {
    expect(parseLegacyImportArguments([]).options.apply).toBe(false);
    expect(() => parseLegacyImportArguments(["--apply", "--actor-user-id", "1"])).toThrow("IMPORT_GROUP_FORMAT_REQUIRED");
    expect(() => parseLegacyImportArguments(["--unknown", "value"])).toThrow("IMPORT_ARGUMENT_INVALID");
    expect(legacySourceHash({ b: 2, a: 1 })).toBe(legacySourceHash({ a: 1, b: 2 }));
  });
  it("checks local references without fetching remote URLs or following symlinks", async () => {
    const local = await mkdtemp(path.join(os.tmpdir(), "lms-file-audit-"));
    try {
      await writeFile(path.join(local, "present.txt"), "safe");
      await symlink(path.join(local, "present.txt"), path.join(local, "alias.txt"));
      expect(uploadReferences("https://example.invalid/uploads/remote.pdf [file](/uploads/present.txt)")).toEqual(["/uploads/present.txt"]);
      expect(await inspectUploadReference(local, "/uploads/present.txt")).toBe("present");
      expect(await inspectUploadReference(local, "/uploads/missing.txt")).toBe("missing");
      expect(await inspectUploadReference(local, "/uploads/alias.txt")).toBe("unsafe");
      expect(await inspectUploadReference(local, "/uploads/%2e%2e/outside.txt")).toBe("unsafe");
      expect(await inspectUploadReference(local, "/uploads/folder%5coutside.txt")).toBe("unsafe");
    } finally { await rm(local, { recursive: true, force: true }); }
  });
});

describe.skipIf(!databaseUrl)("LMS legacy import isolated PostgreSQL rehearsal", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("Legacy import integration tests require local PostgreSQL");
    directory = await mkdtemp(path.join(os.tmpdir(), "lms-import-uploads-"));
    await writeFile(path.join(directory, "present.pdf"), "fixture");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC`, max: 8 });
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY,full_name text,module text,is_active boolean DEFAULT true,is_archived boolean DEFAULT false);
      CREATE TABLE user_modules(user_id integer REFERENCES users(id),module text);
      CREATE TABLE notifications(id serial PRIMARY KEY,user_id integer REFERENCES users(id),type text,title text,message text,related_entity_type text,related_entity_id integer,is_read boolean DEFAULT false,created_at timestamptz DEFAULT now());
      CREATE TABLE academy_students(id serial PRIMARY KEY,lead_id integer,student_name text,contact_name text,phone text,group_id integer,manager_id integer REFERENCES users(id));
      CREATE TABLE academy_courses(id serial PRIMARY KEY,name text,program jsonb DEFAULT '[]');
      CREATE TABLE academy_teachers(id serial PRIMARY KEY,user_id integer REFERENCES users(id),full_name text,status text DEFAULT 'active');
      CREATE TABLE academy_groups(id serial PRIMARY KEY,name text,course_id integer REFERENCES academy_courses(id),teacher_id integer REFERENCES academy_teachers(id));
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer REFERENCES academy_students(id),group_id integer REFERENCES academy_groups(id),status text DEFAULT 'active',enrolled_at timestamptz,ended_at timestamptz);
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer REFERENCES academy_groups(id),course_id integer REFERENCES academy_courses(id),lesson_number integer,topic text,materials text,scheduled_at timestamptz,status text,duration_minutes integer DEFAULT 120,course_lesson_id text,material_file_ids jsonb NOT NULL DEFAULT '[]');
      CREATE TABLE academy_lesson_reschedules(id serial PRIMARY KEY,lesson_id integer REFERENCES academy_lessons(id),previous_scheduled_at timestamptz,next_scheduled_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE academy_lesson_status_history(id serial PRIMARY KEY,lesson_id integer REFERENCES academy_lessons(id),from_status text,to_status text,created_at timestamptz DEFAULT now());
      CREATE TABLE academy_attendance(id serial PRIMARY KEY,lesson_id integer REFERENCES academy_lessons(id),student_id integer REFERENCES academy_students(id),status text,updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_payments(id serial PRIMARY KEY,student_id integer REFERENCES academy_students(id),lead_id integer,group_id integer REFERENCES academy_groups(id),amount_uzs integer NOT NULL,status text,due_at timestamptz);
      CREATE TABLE academy_portfolio_projects(id serial PRIMARY KEY,student_id integer REFERENCES academy_students(id),lesson_id integer REFERENCES academy_lessons(id),group_id integer REFERENCES academy_groups(id),course_id integer REFERENCES academy_courses(id),title text,url text,file_url text,final_status text DEFAULT 'not_started',marketing_consent boolean DEFAULT false);`);
    for (const name of ["0134_portal_identity", "0135_lms_learning", "0136_portal_resources"])
      await pool.query(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
  });
  beforeEach(async () => {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [schema])).rows.map((row) => `"${schema}"."${row.tablename}"`).join(",");
    await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    await pool.query(`INSERT INTO users(full_name,module) VALUES('Operator','administration');
      INSERT INTO academy_teachers(user_id,full_name) VALUES(1,'Teacher');
      INSERT INTO academy_courses(name,program) VALUES('Course','[{"lessonNumber":1,"topic":"First","materials":"staff note"},{"lessonNumber":2,"topic":"Second"}]');
      INSERT INTO academy_groups(name,course_id,teacher_id) VALUES('Group',1,1),('Other group',1,1);
      INSERT INTO academy_students(lead_id,student_name,contact_name,phone,group_id) VALUES(10,'Child','Parent','+998 90 123 45 67',1),(10,'Child','Parent','998901234567',1);
      INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(1,1,'2026-09-01');
      INSERT INTO academy_lessons(group_id,course_id,lesson_number,topic,materials,scheduled_at,status) VALUES(1,1,1,'First','Internal note /uploads/present.pdf /uploads/missing.pdf','2026-09-01','completed'),(1,1,2,'Second','Private staff text','2026-09-02','completed'),(2,1,1,'First','Other group staff text','2026-09-03','completed');
      INSERT INTO academy_portfolio_projects(student_id,lesson_id,group_id,course_id,title,file_url,marketing_consent) VALUES(1,1,1,1,'Existing project','/uploads/missing-project.pdf',true);
      INSERT INTO academy_payments(lead_id,amount_uzs,status) VALUES(10,100000,'pending');`);
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("dry-run performs no data writes and reports contacts, files, payments and incomplete links without private values", async () => {
    const before = await counts();
    const original = await originalRows();
    const client = await pool.connect();
    const query = vi.spyOn(client, "query");
    const connect = vi.spyOn(pool, "connect").mockResolvedValue(client as never);
    let report;
    let statements: string[] = [];
    try {
      report = await run({ apply: false });
      statements = query.mock.calls.map(([statement]) => String(statement));
    }
    finally { connect.mockRestore(); query.mockRestore(); }
    expect(statements.some((statement) => /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i.test(statement))).toBe(false);
    expect(report!.mode).toBe("dry_run");
    expect(report!.counts.planned).toBe(7);
    expect(report!.audit.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["duplicate_student_lead", "possible_duplicate_student", "shared_contact_requires_verification", "payment_without_student_allocation", "legacy_group_without_enrollment", "missing_upload"]));
    expect(JSON.stringify(report)).not.toContain("998901234567");
    expect(JSON.stringify(report)).not.toContain("Internal note");
    expect(await counts()).toEqual(before);
    expect(await originalRows()).toEqual(original);
  });
  it("creates only drafts, retains CRM IDs and data, and fully reconciles repeat runs without duplicates", async () => {
    const original = await originalRows();
    const first = await run({ batchSize: 1 });
    const after = await counts();
    expect(first.counts.created).toBe(7);
    expect(after.lms_materials).toBe(3);
    expect(after.lms_material_publications).toBe(0);
    expect(after.portal_accounts).toBe(0);
    expect(after.portal_student_links).toBe(0);
    expect(after.lms_portfolio_shares).toBe(0);
    expect(after.lms_learning_events).toBe(0);
    expect((await pool.query("SELECT DISTINCT state FROM lms_materials")).rows).toEqual([{ state: "draft" }]);
    expect((await pool.query("SELECT DISTINCT state FROM lms_course_versions")).rows).toEqual([{ state: "draft" }]);
    const repeated = await run();
    expect(repeated.counts.unchanged).toBe(7);
    expect(await counts()).toEqual(after);
    expect(await originalRows()).toEqual(original);
    expect((await pool.query("SELECT project_id,state FROM lms_legacy_portfolio_drafts")).rows).toEqual([{ project_id: 1, state: "draft" }]);
  });
  it("resumes committed batches and detects changed sources in a full reconciliation", async () => {
    await run({ batchSize: 1, maxBatches: 1 });
    const resumed = await run({ resume: true, batchSize: 1 });
    expect(resumed.counts.created).toBe(3);
    expect((await counts()).lms_materials).toBe(3);
    await pool.query("UPDATE academy_lessons SET materials='Changed after preparation' WHERE id=1");
    const reconciled = await run();
    expect(reconciled.records.find((item) => item.scope === "lessons" && item.sourceId === 1)).toMatchObject({ outcome: "conflict", code: "source_changed" });
    expect((await counts()).lms_material_versions).toBe(3);
    expect((await pool.query("SELECT body FROM lms_material_versions WHERE material_id=1")).rows[0].body).toContain("Internal note");
  });
  it("imports selected structured lessons by stable identity and skips cancelled lessons", async () => {
    const program = { version: 1, blocks: [
      { id: "block-1", title: "Basics", lessons: [1, 2, 3].map((n) => ({ id: `topic-${n}`, title: `Topic ${n}`, materials: [] })) },
      { id: "block-2", title: "Projects", lessons: [4, 5].map((n) => ({ id: `topic-${n}`, title: `Topic ${n}`, materials: [] })) },
    ] };
    await pool.query("UPDATE academy_courses SET program=$1::jsonb WHERE id=1", [JSON.stringify(program)]);
    await pool.query("UPDATE academy_lessons SET course_lesson_id='topic-2',topic='Topic 2' WHERE id=1");
    await pool.query("UPDATE academy_lessons SET course_lesson_id='topic-5',topic='Topic 5' WHERE id=2");
    await pool.query("UPDATE academy_lessons SET status='cancelled' WHERE id=3");
    const planned = await run({ apply: false, audit: false });
    expect(planned.records.filter((record) => record.scope === "lessons").map((record) => record.outcome)).toEqual(["planned", "planned"]);
    const original = await originalRows();
    await run({ audit: false });
    const bindings = await pool.query(`SELECT lesson.id,unit.title,unit.position,section.title AS section_title FROM lms_lesson_bindings binding
      JOIN academy_lessons lesson ON lesson.id=binding.lesson_id JOIN lms_units unit ON unit.id=binding.unit_id
      LEFT JOIN lms_sections section ON section.id=unit.section_id ORDER BY lesson.id`);
    expect(bindings.rows).toEqual([
      { id: 1, title: "Topic 2", position: 1, section_title: "Basics" },
      { id: 2, title: "Topic 5", position: 4, section_title: "Projects" },
    ]);
    expect((await counts()).lms_materials).toBe(2);
    expect(await originalRows()).toEqual(original);
    expect((await run({ audit: false })).counts.unchanged).toBe(6);
  });
  it("adopts existing staff-created runs, bindings and original material versions without changing content", async () => {
    await pool.query(`INSERT INTO lms_course_versions(course_id,version,state,program,created_by) SELECT id,1,'draft',program,1 FROM academy_courses WHERE id=1;
      INSERT INTO lms_units(course_version_id,title,position) VALUES(1,'First',0),(1,'Second',1);
      INSERT INTO lms_group_runs(group_id,course_version_id,format) VALUES(1,1,'online');
      INSERT INTO lms_lesson_bindings(run_id,unit_id,lesson_id) VALUES(1,1,1);
      INSERT INTO lms_materials(run_id,unit_id,state,created_by) VALUES(1,1,'draft',1);
      INSERT INTO lms_material_versions(material_id,version,title,body,category,created_by) SELECT 1,1,topic,materials,'lesson',1 FROM academy_lessons WHERE id=1;`);
    const report = await run({ groupIds: [1] });
    expect(report.counts.adopted).toBe(3);
    expect((await counts()).lms_materials).toBe(2);
    expect((await pool.query("SELECT format FROM lms_group_runs WHERE group_id=1")).rows[0].format).toBe("online");
    expect((await pool.query("SELECT count(*) FROM lms_group_runs")).rows[0].count).toBe("1");
    expect(report.records.some((item) => item.scope === "lessons" && item.sourceId === 3)).toBe(false);
  });
  it("preserves file-only lesson snapshots and detects a changed attachment without duplicating drafts", async () => {
    const file = await pool.query(`INSERT INTO lms_files(owner_user_id,name,mime,size_bytes,storage_key,state)
      VALUES(1,'Workbook.pdf','application/pdf',24,'course_workbook_storage_key','ready') RETURNING id`);
    const id = Number(file.rows[0].id);
    await pool.query("UPDATE academy_lessons SET materials=NULL,material_file_ids=$1::jsonb WHERE id=1", [JSON.stringify([id])]);
    expect((await run({ apply: false, audit: false })).records.find((record) => record.scope === 'lessons' && record.sourceId === 1)?.outcome).toBe('planned');
    const first = await run({ audit: false });
    expect(first.records.find((record) => record.scope === 'lessons' && record.sourceId === 1)?.outcome).toBe('created');
    const material = await pool.query(`SELECT version.body,version.file_ids FROM lms_material_versions version
      JOIN lms_materials material ON material.id=version.material_id JOIN lms_lesson_bindings binding
      ON binding.run_id=material.run_id AND binding.unit_id=material.unit_id WHERE binding.lesson_id=1`);
    expect(material.rows).toEqual([{ body: '', file_ids: [id] }]);
    expect((await run({ audit: false })).records.find((record) => record.scope === 'lessons' && record.sourceId === 1)?.outcome).toBe('unchanged');
    await pool.query("DELETE FROM lms_legacy_imports WHERE source_type='lessons' AND source_id=1");
    expect((await run({ audit: false })).records.find((record) => record.scope === 'lessons' && record.sourceId === 1)?.outcome).toBe('adopted');
    await pool.query("UPDATE academy_lessons SET material_file_ids='[]' WHERE id=1");
    expect((await run({ audit: false })).records.find((record) => record.scope === 'lessons' && record.sourceId === 1)).toMatchObject({ outcome: 'conflict', code: 'source_changed' });
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM lms_material_versions")).rows[0].count).toBe(3);
  });
  it("reports invalid programs and pre-existing edited content instead of replacing them", async () => {
    await run();
    await pool.query("DELETE FROM lms_legacy_imports WHERE source_type='lessons' AND source_id=1");
    await pool.query("UPDATE academy_lessons SET materials='Different source content' WHERE id=1");
    const report = await run({ scopes: ["lessons"] });
    expect(report.records[0]).toMatchObject({ outcome: "conflict", code: "existing_material_review_required" });
    expect((await counts()).lms_materials).toBe(3);
    await pool.query("INSERT INTO academy_courses(name,program) VALUES('Bad','[{\"lessonNumber\":1,\"topic\":\"A\"},{\"lessonNumber\":1,\"topic\":\"B\"}]')");
    const invalid = await run({ scopes: ["courses"] });
    expect(invalid.records.find((item) => item.sourceId === 2)).toMatchObject({ outcome: "skipped", code: "program_invalid" });
  });
  it("rolls back a failed batch including its checkpoint, allowing a clean retry", async () => {
    await pool.query("CREATE FUNCTION import_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.title='Second' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END$$; CREATE TRIGGER import_test_fail BEFORE INSERT ON lms_material_versions FOR EACH ROW EXECUTE FUNCTION import_test_fail()");
    try {
      await expect(run({ batchSize: 100 })).rejects.toThrow("test failure");
      expect((await counts()).lms_materials).toBe(0);
      expect((await pool.query("SELECT count(*) FROM lms_legacy_import_checkpoints WHERE scope LIKE 'legacy-v1:lessons:%'")).rows[0].count).toBe("0");
    } finally { await pool.query("DROP TRIGGER import_test_fail ON lms_material_versions; DROP FUNCTION import_test_fail()"); }
    const retried = await run({ resume: true });
    expect(retried.counts.created).toBe(4);
    expect((await counts()).lms_materials).toBe(3);
  });
});
