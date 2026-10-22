import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PgCrmLearningPreparationRepository } from "../server/modules/lms/infrastructure/crm-preparation-repository";
import { PgLearningRepository } from "../server/modules/lms/infrastructure/learning-repository";
import { crmGroupFormat, crmProgramUnits } from "../server/modules/lms/domain/crm-preparation";
import { LearningFeatureController } from "../server/infrastructure/learning-flags";
import { DEFAULT_LEARNING_SCHOOL_SETTINGS, learningSchoolSettingsUpdateSchema } from "@shared/contracts/learning-settings";
import type { AppConfig } from "../server/config";
import type { CourseCurriculum } from '@shared/contracts/course-curriculum';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `crm_preparation_${randomBytes(8).toString("hex")}`;
let admin: Pool, pool: Pool;
let enabled = true;
let defaultFormat: "offline" | "online" | null = null;
let compatibility: { before: unknown; after: unknown };
const administration = { userId: 1, modules: ["administration"], isLeadership: true };
const sourceTables = ["users", "academy_courses", "academy_groups", "academy_students", "academy_student_group_enrollments", "academy_lessons", "academy_payments"];
const fingerprints = async () => Object.fromEntries(await Promise.all(sourceTables.map(async table => [table, (await pool.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(source)-'selected_course_lesson_ids'-'course_lesson_id' ORDER BY id)::text,'[]')) AS hash FROM ${table} source`)).rows[0].hash])));
const repository = (sourcePool = pool, groupIds: number[] = []) => new PgCrmLearningPreparationRepository(sourcePool, { enabled: () => enabled, defaultFormat: () => defaultFormat, groupIds });
const learning = () => new PgLearningRepository(pool, undefined, async () => true, { crmPreparationDefaultFormat: () => defaultFormat });
const count = async (table: string) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

describe("CRM preparation off and explicit format boundaries", () => {
  it("does no queries while off and distinguishes approved codes from ambiguous names", async () => {
    const query = vi.fn(), connect = vi.fn();
    const disabled = new PgCrmLearningPreparationRepository({query,connect} as unknown as Pool, {enabled:() => false,defaultFormat:() => null});
    expect(await disabled.runOnce()).toEqual({prepared:0,reviewed:0,scanned:0});
    expect(query).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
    expect(crmGroupFormat("CYP-AI-GRP-26-0035")).toBe("offline");
    expect(crmGroupFormat("ONL-VC-IND-26-0036 Cyberpark teacher")).toBe("online");
    expect(crmGroupFormat("CYP-AI-GRP-26-0035 / ONL-AI-GRP-26-0036", "offline")).toBeNull();
    expect(crmGroupFormat("CYP-AI-GRP-26-0000", "offline")).toBeNull();
    expect(crmGroupFormat("CYP-AI-GRP-26-wrong", "offline")).toBeNull();
    expect(crmGroupFormat("Online group")).toBeNull();
    expect(crmGroupFormat("Legacy group", "online")).toBe("online");
    expect(crmProgramUnits([])).toEqual([]);
    expect(crmProgramUnits([{lessonNumber:1}])).toBeNull();
    expect(crmProgramUnits(Array.from({length:2001},(_,index) => ({lessonNumber:index+1,topic:"Topic"})))).toBeNull();
  });
});

describe.skipIf(!databaseUrl)("Automatic CRM preparation against isolated PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["127.0.0.1","localhost","::1","[::1]"].includes(target.hostname) || !/test/.test(target.pathname)) throw new Error("ISOLATED_TEST_DATABASE_REQUIRED");
    admin = new Pool({connectionString:databaseUrl});
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({connectionString:databaseUrl,options:`-c search_path=${schema} -c timezone=UTC`,max:6});
    await pool.query(`
      CREATE TABLE users(id serial PRIMARY KEY,full_name text NOT NULL,module text NOT NULL DEFAULT 'administration',is_active boolean NOT NULL DEFAULT true,is_archived boolean NOT NULL DEFAULT false);
      CREATE TABLE user_modules(id serial PRIMARY KEY,user_id integer,module text);
      CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text NOT NULL,status text NOT NULL DEFAULT 'studying');
      CREATE TABLE academy_courses(id serial PRIMARY KEY,name text NOT NULL,program jsonb NOT NULL DEFAULT '[]');
      CREATE TABLE academy_teachers(id serial PRIMARY KEY,user_id integer,full_name text,status text NOT NULL DEFAULT 'active');
      CREATE TABLE academy_groups(id serial PRIMARY KEY,name text NOT NULL,course_id integer,teacher_id integer,status text NOT NULL DEFAULT 'open',is_archived boolean NOT NULL DEFAULT false,end_date timestamptz,updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer,course_id integer,lesson_number integer,topic text NOT NULL,materials text,scheduled_at timestamptz NOT NULL DEFAULT '2026-10-13',status text NOT NULL DEFAULT 'scheduled',teacher_id integer);
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer,group_id integer,status text NOT NULL DEFAULT 'active',enrolled_at timestamptz NOT NULL DEFAULT '2026-10-01',ended_at timestamptz);
      CREATE TABLE academy_payments(id serial PRIMARY KEY,amount_uzs integer);
      CREATE TABLE academy_portfolio_projects(id serial PRIMARY KEY);
    `);
    for (const migration of ["0134_portal_identity","0135_lms_learning","0136_portal_resources"]) await pool.query(readFileSync(new URL(`../migrations/${migration}.sql`,import.meta.url),"utf8"));
    await pool.query(`INSERT INTO users(id,full_name) VALUES(1,'Actual operator'); INSERT INTO academy_courses(id,name) VALUES(1,'Existing course'); INSERT INTO academy_groups(id,name,course_id) VALUES(1,'Existing group',1);
      INSERT INTO lms_course_versions(id,course_id,version,created_by) VALUES(1,1,1,1); INSERT INTO lms_group_runs(id,group_id,course_version_id) VALUES(1,1,1);
      INSERT INTO lms_materials(id,run_id,created_by) VALUES(1,1,1); INSERT INTO lms_material_versions(material_id,version,title,body,category,created_by) VALUES(1,1,'Existing title','Existing authored content','lesson',1);
      INSERT INTO lms_learning_audit(user_id,run_id,entity_type,entity_id,action) VALUES(1,1,'material',1,'create');`);
    const before = {sources:await fingerprints(),authors:(await pool.query("SELECT material.created_by,version.created_by AS version_author FROM lms_materials material JOIN lms_material_versions version ON version.material_id=material.id")).rows};
    await pool.query(readFileSync(new URL("../migrations/0137_lms_crm_preparation.sql",import.meta.url),"utf8"));
    await pool.query(readFileSync(new URL("../migrations/0155_course_curriculum.sql",import.meta.url),"utf8"));
    const after = {sources:await fingerprints(),authors:(await pool.query("SELECT material.created_by,version.created_by AS version_author FROM lms_materials material JOIN lms_material_versions version ON version.material_id=material.id")).rows};
    compatibility = {before,after};
  });
  afterAll(async () => { if(pool) await pool.end(); if(admin) {await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();} });
  beforeEach(async () => {
    enabled = true; defaultFormat = null;
    await pool.query(`TRUNCATE users,academy_students,academy_courses,academy_teachers,academy_groups,academy_lessons,academy_student_group_enrollments,academy_payments,lms_feature_flags,lms_school_settings,lms_legacy_imports,lms_legacy_import_checkpoints,lms_learning_audit RESTART IDENTITY CASCADE;
      INSERT INTO users(id,full_name,module) VALUES(1,'Operator','administration'),(2,'Teacher','teacher');
      INSERT INTO academy_teachers(id,user_id,full_name) VALUES(1,2,'Teacher');
      INSERT INTO academy_courses(id,name,program) VALUES(1,'AI','[{"lessonNumber":1,"topic":"First"},{"lessonNumber":2,"topic":"Second"}]'),(2,'Empty','[]');
      INSERT INTO academy_groups(id,name,course_id,teacher_id) VALUES(1,'CYP-AI-GRP-26-0001',1,1),(2,'ONL-AI-IND-26-0002',1,1),(3,'Legacy group',2,1),(4,'CYP-AI-GRP-26-0004',2,1),(5,'CYP-AI-GRP-26-0005',999,1);
      INSERT INTO academy_students(id,student_name,contact_name) VALUES(1,'Pupil','Contact');
      INSERT INTO academy_student_group_enrollments(id,student_id,group_id) VALUES(1,1,1);
      INSERT INTO academy_lessons(id,group_id,lesson_number,topic,materials) VALUES(1,1,1,'First','Existing lesson text'),(2,1,2,'Second',NULL),(3,2,1,'First','Other group text');
      INSERT INTO academy_payments(amount_uzs) VALUES(100000);
      INSERT INTO lms_feature_flags(key,enabled,all_groups) VALUES('learning',true,true);
      INSERT INTO lms_school_settings(singleton) VALUES(true);`);
  });

  it("applies actual additive migration without changing original authors, keeps staff writes and foreign keys", async () => {
    expect(compatibility.after).toEqual(compatibility.before);
    const run = await learning().createRun(administration,{groupId:3,format:"offline",meetingUrl:null}) as {id:number};
    expect((await pool.query("SELECT created_by FROM lms_course_versions WHERE id=(SELECT course_version_id FROM lms_group_runs WHERE id=$1)",[run.id])).rows[0].created_by).toBe(1);
    await expect(pool.query("INSERT INTO lms_learning_audit(user_id,entity_type,entity_id,action) VALUES(999,'test',1,'test')")).rejects.toMatchObject({code:"23503"});
    await repository().runOnce();
    expect((await pool.query("SELECT DISTINCT created_by FROM lms_materials")).rows).toEqual([{created_by:null}]);
    expect((await pool.query("SELECT new_value FROM lms_learning_audit WHERE action='crm.source.linked' LIMIT 1")).rows[0].new_value).toMatchObject({actor:{kind:"system"},sourceHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
  });

  it("prepares valid groups concurrently exactly once, exposes exceptions and creates only private drafts", async () => {
    await pool.query("INSERT INTO academy_courses(id,name,program) VALUES(3,'Incomplete','[{\"lessonNumber\":1}]'); INSERT INTO academy_groups(id,name,course_id) VALUES(6,'CYP-AI-GRP-26-0006',3)");
    const before = await fingerprints();
    await Promise.all([repository().runOnce(),repository().runOnce()]);
    const counts = {runs:await count("lms_group_runs"),versions:await count("lms_course_versions"),materials:await count("lms_materials"),audit:await count("lms_learning_audit")};
    expect(counts).toMatchObject({runs:4,versions:3,materials:2});
    await repository().runOnce();
    expect(await count("lms_learning_audit")).toBe(counts.audit);
    expect(await fingerprints()).toEqual(before);
    expect((await pool.query("SELECT DISTINCT state FROM lms_materials UNION SELECT DISTINCT state FROM lms_course_versions")).rows).toEqual([{state:"draft"}]);
    for(const table of ["portal_accounts","portal_invitations","portal_student_links","lms_material_publications","lms_assignments","lms_resource_outbox","lms_learning_events"]) expect(await count(table),table).toBe(0);
    const groups = await learning().managementGroups(administration);
    expect(groups.find(group => group.groupId===3)).toMatchObject({runId:null,setupStatus:"needs_format"});
    expect(groups.find(group => group.groupId===5)).toMatchObject({runId:null,courseId:null,courseName:null,setupStatus:"needs_course"});
    expect(groups.find(group => group.groupId===4)).toMatchObject({setupStatus:"ready"});
    expect(groups.find(group => group.groupId===6)).toMatchObject({setupStatus:"needs_program_review",runId:expect.any(Number)});
    expect(await count("lms_units")).toBe(2);
  });

  it("honors rollout and config cohorts and catches new CRM groups, teacher and roster without copies", async () => {
    await pool.query("UPDATE lms_feature_flags SET all_groups=false,group_ids=ARRAY[1,2]");
    await repository(pool,[2]).runOnce();
    expect((await pool.query("SELECT group_id,format FROM lms_group_runs")).rows).toEqual([{group_id:2,format:"online"}]);
    await pool.query("UPDATE lms_feature_flags SET all_groups=true; INSERT INTO academy_groups(id,name,course_id,teacher_id) VALUES(6,'ONL-AI-GRP-26-0006',1,1); INSERT INTO academy_lessons(id,group_id,lesson_number,topic) VALUES(6,6,1,'First');");
    await repository().runOnce();
    const runId = Number((await pool.query("SELECT id FROM lms_group_runs WHERE group_id=6")).rows[0].id);
    expect((await pool.query("SELECT count(*) FROM lms_lesson_bindings WHERE run_id=$1",[runId])).rows[0].count).toBe("1");
    await pool.query("UPDATE academy_teachers SET full_name='Renamed teacher'; INSERT INTO academy_student_group_enrollments(id,student_id,group_id) VALUES(2,1,6)");
    const group = (await learning().managementGroups(administration)).find(value => value.groupId===6);
    expect(group).toMatchObject({teacherName:"Renamed teacher",studentCount:1,setupStatus:"ready"});
    await pool.query("UPDATE lms_feature_flags SET enabled=false; INSERT INTO academy_groups(id,name,course_id) VALUES(7,'CYP-AI-GRP-26-0007',1)");
    expect(await repository().runOnce()).toEqual({prepared:0,reviewed:0,scanned:0});
    expect((await pool.query("SELECT id FROM lms_group_runs WHERE group_id=7")).rows).toEqual([]);
  });

  it("uses the latest published program for new groups while preserving old pins, changed courses and staff drafts", async () => {
    await pool.query("INSERT INTO lms_course_versions(id,course_id,version,state,program,created_by) VALUES(10,1,1,'published','[{\"topic\":\"Teacher program\"}]',2),(11,1,2,'published','[{\"topic\":\"Latest teacher program\"}]',2); INSERT INTO lms_units(course_version_id,title,position) VALUES(10,'Old teacher unit',0),(11,'Latest teacher unit',0); INSERT INTO lms_group_runs(group_id,course_version_id,format) VALUES(1,10,'online')");
    await repository().runOnce();
    expect((await pool.query("SELECT group_id,course_version_id,format FROM lms_group_runs WHERE group_id IN(1,2) ORDER BY group_id")).rows).toEqual([{group_id:1,course_version_id:"10",format:"online"},{group_id:2,course_version_id:"11",format:"online"}]);
    expect((await learning().managementGroups(administration)).find(group => group.groupId===1)?.setupStatus).toBe("ready");
    await pool.query("UPDATE academy_groups SET course_id=2 WHERE id=1; UPDATE lms_course_versions SET program='[{\"topic\":\"Intentional staff edit\"}]' WHERE id=10");
    await repository().runOnce();
    expect((await learning().managementGroups(administration)).find(group => group.groupId===1)).toMatchObject({courseId:1,courseName:"AI",courseVersionId:10,setupStatus:"needs_program_review"});
    expect((await pool.query("SELECT program FROM lms_course_versions WHERE id=10")).rows[0].program).toEqual([{topic:"Intentional staff edit"}]);
    expect((await pool.query("SELECT count(*) FROM lms_course_versions WHERE state='published'")).rows[0].count).toBe("2");
  });

  it("updates only untouched generated material drafts and preserves staff edits and published history", async () => {
    await repository().runOnce();
    await pool.query("UPDATE academy_lessons SET materials='Updated source text' WHERE id=1");
    await repository().runOnce();
    expect((await pool.query("SELECT body,created_by FROM lms_material_versions WHERE material_id=(SELECT material_id FROM lms_material_versions WHERE body='Existing lesson text') ORDER BY version")).rows).toEqual([{body:"Existing lesson text",created_by:null},{body:"Updated source text",created_by:null}]);
    await pool.query("INSERT INTO lms_material_versions(material_id,version,title,body,category,created_by) SELECT material_id,3,title,'Teacher authored draft',category,2 FROM lms_material_versions WHERE body='Updated source text'; UPDATE academy_lessons SET materials='Third source text' WHERE id=1; UPDATE lms_materials SET state='published' WHERE id=(SELECT material_id FROM lms_material_versions WHERE body='Other group text'); UPDATE academy_lessons SET materials='Changed published source' WHERE id=3");
    await repository().runOnce();
    expect((await pool.query("SELECT body,created_by FROM lms_material_versions WHERE version=3")).rows).toEqual([{body:"Teacher authored draft",created_by:2}]);
    expect((await pool.query("SELECT body FROM lms_material_versions WHERE body IN('Third source text','Changed published source')")).rows).toEqual([]);
    expect((await learning().managementGroups(administration)).filter(group => [1,2].includes(group.groupId)).map(group => group.setupStatus)).toEqual(["needs_program_review","needs_program_review"]);
  });

  it("preserves source program snapshots and uses one explicit legacy policy without resetting it from old clients", async () => {
    const config = {portal:{enabled:true,learningEnabled:true}} as AppConfig;
    const flags = new LearningFeatureController(pool,config);
    await flags.refresh();
    await flags.updateSettings(1,{...DEFAULT_LEARNING_SCHOOL_SETTINGS,crmPreparation:{defaultFormat:"online"}},0,"policy-request");
    const {crmPreparation: _unused,...oldSettings} = DEFAULT_LEARNING_SCHOOL_SETTINGS;
    const parsed = learningSchoolSettingsUpdateSchema.parse({version:1,settings:{...oldSettings,maxFileMiB:50}});
    await flags.updateSettings(1,parsed.settings,parsed.version,"old-client-request");
    expect(flags.settings().crmPreparation.defaultFormat).toBe("online");
    defaultFormat = flags.settings().crmPreparation.defaultFormat;
    await repository().runOnce({kind:"staff",userId:1,requestId:"actual-staff-trigger"});
    expect((await pool.query("SELECT format FROM lms_group_runs WHERE group_id=3")).rows[0].format).toBe("online");
    expect((await pool.query("SELECT DISTINCT user_id FROM lms_learning_audit WHERE action='crm.source.linked'")).rows).toEqual([{user_id:1}]);
    const pinned = (await pool.query("SELECT course_version_id FROM lms_group_runs WHERE group_id=1")).rows[0].course_version_id;
    await pool.query("UPDATE academy_courses SET program='[{\"lessonNumber\":1,\"topic\":\"Changed CRM program\"}]' WHERE id=1; INSERT INTO academy_groups(id,name,course_id) VALUES(6,'CYP-AI-GRP-26-0006',1)");
    await repository().runOnce();
    expect((await pool.query("SELECT course_version_id FROM lms_group_runs WHERE group_id=1")).rows[0].course_version_id).toBe(pinned);
    expect((await learning().managementGroups(administration)).find(group => group.groupId===1)?.setupStatus).toBe("needs_program_review");
    expect((await pool.query("SELECT course_version_id FROM lms_group_runs WHERE group_id=6")).rows[0].course_version_id).not.toBe(pinned);
    await flags.updateSettings(1,{...flags.settings(),crmPreparation:{defaultFormat:null}},2,"clear-policy");
    expect(flags.settings().crmPreparation.defaultFormat).toBeNull();
  });

  it("rolls back a lost lease or disabled runtime mid-preparation and retries without partial drafts", async () => {
    const controller = new AbortController();
    const intercepted = (interrupt: () => void) => new Proxy(pool,{get(target,property){
      if(property==="connect") return async () => {
        const client = await target.connect();
        return new Proxy(client,{get(source,key){
          if(key==="query") return async (sql:string,values?:unknown[]) => {const result=await source.query(sql,values);if(sql.includes("INSERT INTO lms_course_versions")) interrupt();return result;};
          const value=Reflect.get(source,key,source);return typeof value==="function" ? value.bind(source) : value;
        }});
      };
      const value=Reflect.get(target,property,target);return typeof value==="function" ? value.bind(target) : value;
    }});
    await expect(repository(intercepted(() => controller.abort())).runOnce({kind:"system"},controller.signal)).rejects.toThrow("LMS_JOB_LEASE_LOST");
    expect(await count("lms_course_versions")).toBe(0);expect(await count("lms_group_runs")).toBe(0);expect(await count("lms_learning_audit")).toBe(0);
    await repository(intercepted(() => {enabled=false;})).runOnce();
    expect(await count("lms_course_versions")).toBe(0);expect(await count("lms_group_runs")).toBe(0);
    enabled=true;
    await repository().runOnce();
    expect(await count("lms_group_runs")).toBe(3);
  });

  it('keeps selected lesson IDs and blocks through automatic and manual LMS preparation', async () => {
    const program: CourseCurriculum = { version: 1, blocks: [
      { id: 'block-one', title: 'First block', lessons: [{ id: 'lesson-one', title: 'First', materials: [] }] },
      { id: 'block-two', title: 'Second block', lessons: [{ id: 'lesson-two', title: 'Second', materials: [] }, { id: 'lesson-three', title: 'Third', materials: [] }] },
    ] };
    await pool.query('UPDATE academy_courses SET program=$1 WHERE id=1', [JSON.stringify(program)]);
    await pool.query(`UPDATE academy_groups SET selected_course_lesson_ids='["lesson-one","lesson-three"]' WHERE id IN(1,2);
      UPDATE academy_lessons SET course_lesson_id=CASE WHEN id=2 THEN 'lesson-three' ELSE 'lesson-one' END;
      INSERT INTO lms_course_versions(course_id,version,state,program,created_by) VALUES(1,1,'published','[{"title":"Old staff block","units":[{"title":"Old lesson"}]}]',1)`);
    await repository().runOnce();
    const run = (await pool.query('SELECT id,course_version_id FROM lms_group_runs WHERE group_id=1')).rows[0];
    expect((await pool.query('SELECT state FROM lms_course_versions WHERE id=$1', [run.course_version_id])).rows[0].state).toBe('draft');
    expect((await pool.query('SELECT section.title,unit.position FROM lms_units unit JOIN lms_sections section ON section.id=unit.section_id WHERE unit.course_version_id=$1 ORDER BY unit.position', [run.course_version_id])).rows).toEqual([
      { title: 'First block', position: 0 }, { title: 'Second block', position: 1 }, { title: 'Second block', position: 2 },
    ]);
    expect((await pool.query('SELECT binding.lesson_id,unit.position FROM lms_lesson_bindings binding JOIN lms_units unit ON unit.id=binding.unit_id WHERE binding.run_id=$1 ORDER BY binding.lesson_id', [run.id])).rows).toEqual([{ lesson_id: 1, position: 0 }, { lesson_id: 2, position: 2 }]);
    expect((await learning().managementUnits(administration, run.id)).map(unit => unit.position)).toEqual([0, 2]);
    const unselected = (await pool.query('SELECT id FROM lms_units WHERE course_version_id=$1 AND position=1', [run.course_version_id])).rows[0].id;
    await expect(learning().assertUnit(pool, run.id, unselected)).rejects.toMatchObject({ message: 'lmsNotFound' });
    const selected = (await pool.query('SELECT id FROM lms_units WHERE course_version_id=$1 AND position=2', [run.course_version_id])).rows[0].id;
    const author = await pool.connect(), editor = await pool.connect();
    try {
      await author.query('BEGIN');
      await learning().assertUnit(author, run.id, selected);
      await editor.query('BEGIN');
      await editor.query("SET LOCAL lock_timeout='50ms'");
      await expect(editor.query(`UPDATE academy_groups SET selected_course_lesson_ids='["lesson-one"]' WHERE id=1`)).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await editor.query('ROLLBACK'); await author.query('ROLLBACK'); editor.release(); author.release();
    }
    await pool.query('DELETE FROM lms_lesson_bindings WHERE run_id=$1 AND lesson_id=2', [run.id]);
    expect((await learning().managementUnits(administration, run.id)).map(unit => unit.position)).toEqual([0, 2]);
    await pool.query(`INSERT INTO academy_groups(id,name,course_id,teacher_id,selected_course_lesson_ids) VALUES(6,'ONL-AI-GRP-26-0006',1,1,'["lesson-three"]')`);
    await expect(learning().createRun(administration, { groupId: 6, courseVersionId: 1, format: 'online', meetingUrl: null })).rejects.toMatchObject({ message: 'lmsCourseVersionInvalid' });
    const manual = await learning().createRun(administration, { groupId: 6, format: 'online', meetingUrl: null }) as { id: number };
    expect((await learning().managementUnits(administration, manual.id)).map(unit => unit.position)).toEqual([2]);
  });
});
