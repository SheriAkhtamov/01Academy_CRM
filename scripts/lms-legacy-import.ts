import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { auditLegacyData, auditSourceFiles, type LegacyAudit } from "./lms-legacy-audit";

export const LEGACY_SCOPES = ["courses", "groups", "lessons", "portfolio"] as const;
export type LegacyScope = (typeof LEGACY_SCOPES)[number];
export type LegacyImportOptions = {
  apply: boolean;
  actorUserId?: number;
  batchSize?: number;
  maxBatches?: number;
  resume?: boolean;
  scopes?: LegacyScope[];
  groupIds?: number[];
  defaultFormat?: "offline" | "online";
  uploadsDirectory: string;
  audit?: boolean;
};
export type LegacyImportRecord = {
  scope: LegacyScope;
  sourceId: number;
  sourceHash: string;
  outcome: "planned" | "created" | "adopted" | "unchanged" | "conflict" | "skipped";
  code?: string;
  targetId?: number;
};
export type LegacyImportReport = {
  mode: "dry_run" | "apply";
  startedAt: string;
  completedAt?: string;
  batches: number;
  defaultFormat: "offline" | "online";
  counts: Record<LegacyImportRecord["outcome"], number>;
  records: LegacyImportRecord[];
  checkpoints: Partial<Record<LegacyScope, number>>;
  audit: LegacyAudit;
};
export class LegacyImportError extends Error {
  constructor(public readonly code: string) { super(code); }
}
type Source = { id: number; [key: string]: unknown };
type ProgramUnit = { title: string; position: number };
type ImportTarget = { id?: number; outcome: "created" | "adopted" | "skipped" | "conflict"; code?: string };
const SOURCE_TABLE: Record<LegacyScope, string> = {
  courses: "academy_courses", groups: "academy_groups", lessons: "academy_lessons", portfolio: "academy_portfolio_projects",
};
const TARGET_TABLE: Record<LegacyScope, string> = {
  courses: "lms_course_versions", groups: "lms_group_runs", lessons: "lms_lesson_bindings", portfolio: "lms_legacy_portfolio_drafts",
};
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value instanceof Date ? value.toISOString() : value;
};
export const legacySourceHash = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const positiveInteger = (value: unknown, fallback: number, maximum: number) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new LegacyImportError("IMPORT_OPTION_INVALID");
  return number;
};
const one = async <T extends Record<string, unknown>>(sql: PoolClient, query: string, values: unknown[] = []) => (await sql.query<T>(query, values)).rows[0];
function sourceSnapshot(scope: LegacyScope, row: Source, format: "offline" | "online") {
  if (scope === "courses") return { id: row.id, program: row.program };
  if (scope === "groups") return { id: row.id, course_id: row.course_id, format };
  if (scope === "lessons") return { id: row.id, group_id: row.group_id, course_id: row.course_id, lesson_number: row.lesson_number, topic: row.topic, materials: row.materials };
  return Object.fromEntries(["id", "student_id", "lesson_id", "group_id", "course_id", "title", "url", "file_url", "final_status", "marketing_consent"].map((key) => [key, row[key] ?? null]));
}
function programUnits(program: unknown): ProgramUnit[] | null {
  if (!Array.isArray(program) || program.length > 2_000) return null;
  const result: ProgramUnit[] = [];
  const positions = new Set<number>();
  for (let index = 0; index < program.length; index++) {
    const entry = program[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const position = entry.lessonNumber === undefined ? index : Number(entry.lessonNumber) - 1;
    const title = typeof entry.topic === "string" ? entry.topic.trim() : typeof entry.title === "string" ? entry.title.trim() : "";
    if (!Number.isSafeInteger(position) || position < 0 || positions.has(position) || !title) return null;
    positions.add(position);
    result.push({ position, title });
  }
  return result;
}
const checkpointScope = (scope: LegacyScope, groupIds: number[]) => `legacy-v1:${scope}:${groupIds.length ? legacySourceHash(groupIds.sort((a, b) => a - b)) : "all"}`;

async function importCourse(sql: PoolClient, row: Source, actorUserId: number): Promise<ImportTarget> {
  const units = programUnits(row.program);
  if (!units) return { outcome: "skipped", code: "program_invalid" };
  if (!units.length) return { outcome: "skipped", code: "program_empty" };
  const existing = await one<{ id: string }>(sql, "SELECT id FROM lms_course_versions WHERE course_id=$1 AND program=$2::jsonb ORDER BY version DESC LIMIT 1", [row.id, JSON.stringify(row.program)]);
  if (existing) return { id: Number(existing.id), outcome: "adopted" };
  const version = await one<{ id: string }>(sql, "INSERT INTO lms_course_versions(course_id,version,state,program,created_by) SELECT $1,COALESCE(MAX(version),0)+1,'draft',$2::jsonb,$3 FROM lms_course_versions WHERE course_id=$1 RETURNING id", [row.id, JSON.stringify(row.program), actorUserId]);
  for (const unit of units)
    await sql.query("INSERT INTO lms_units(course_version_id,title,position) VALUES($1,$2,$3)", [version!.id, unit.title, unit.position]);
  return { id: Number(version!.id), outcome: "created" };
}
async function importGroup(sql: PoolClient, row: Source, format: string): Promise<ImportTarget> {
  const existing = await one<{ id: string; format: string; course_id: number }>(sql, "SELECT run.id,run.format,version.course_id FROM lms_group_runs run JOIN lms_course_versions version ON version.id=run.course_version_id WHERE run.group_id=$1", [row.id]);
  if (existing) return existing.course_id === row.course_id
    ? { id: Number(existing.id), outcome: "adopted" }
    : { outcome: "conflict", code: "existing_run_course_mismatch" };
  const version = await one<{ target_id: string }>(sql, "SELECT imported.target_id FROM lms_legacy_imports imported JOIN lms_course_versions version ON version.id=imported.target_id AND version.course_id=$1 WHERE imported.source_type='courses' AND imported.source_id=$1 AND imported.target_type='lms_course_versions'", [row.course_id]);
  if (!version) return { outcome: "skipped", code: "course_not_imported" };
  const created = await one<{ id: string }>(sql, "INSERT INTO lms_group_runs(group_id,course_version_id,format) VALUES($1,$2,$3) RETURNING id", [row.id, version.target_id, format]);
  return { id: Number(created!.id), outcome: "created" };
}
async function importLesson(sql: PoolClient, row: Source, actorUserId: number): Promise<ImportTarget> {
  const run = await one<{ id: string; course_version_id: string; course_id: number }>(sql, "SELECT run.id,run.course_version_id,version.course_id FROM lms_group_runs run JOIN lms_course_versions version ON version.id=run.course_version_id WHERE run.group_id=$1", [row.group_id]);
  if (!run) return { outcome: "skipped", code: "group_run_missing" };
  if (row.course_id !== null && row.course_id !== undefined && run.course_id !== row.course_id) return { outcome: "skipped", code: "lesson_course_mismatch" };
  const unit = await one<{ id: string }>(sql, "SELECT id FROM lms_units WHERE course_version_id=$1 AND position=$2", [run.course_version_id, Number(row.lesson_number) - 1]);
  if (!unit) return { outcome: "skipped", code: "lesson_unit_unmatched" };
  const existing = await one<{ id: string; unit_id: string | null }>(sql, "SELECT id,unit_id FROM lms_lesson_bindings WHERE run_id=$1 AND lesson_id=$2", [run.id, row.id]);
  if (existing && existing.unit_id !== unit.id) return { outcome: "conflict", code: "existing_binding_review_required" };
  const body = typeof row.materials === "string" ? row.materials : "";
  const title = typeof row.topic === "string" ? row.topic : "";
  let needsMaterial = Boolean(body.trim());
  if (needsMaterial) {
    const equivalent = await one(sql, "SELECT material.id FROM lms_materials material JOIN lms_material_versions version ON version.material_id=material.id WHERE material.run_id=$1 AND material.unit_id=$2 AND version.title=$3 AND version.body=$4 AND version.category='lesson' LIMIT 1", [run.id, unit.id, title, body]);
    needsMaterial = !equivalent;
    if (needsMaterial && existing && await one(sql, "SELECT id FROM lms_materials WHERE run_id=$1 AND unit_id=$2 LIMIT 1", [run.id, unit.id])) return { outcome: "conflict", code: "existing_material_review_required" };
  }
  const binding = existing ?? await one<{ id: string }>(sql, "INSERT INTO lms_lesson_bindings(run_id,unit_id,lesson_id) VALUES($1,$2,$3) RETURNING id", [run.id, unit.id, row.id]);
  if (needsMaterial) {
    const material = await one<{ id: string }>(sql, "INSERT INTO lms_materials(run_id,unit_id,state,created_by) VALUES($1,$2,'draft',$3) RETURNING id", [run.id, unit.id, actorUserId]);
    await sql.query("INSERT INTO lms_material_versions(material_id,version,title,body,category,created_by) VALUES($1,1,$2,$3,'lesson',$4)", [material!.id, title, body, actorUserId]);
  }
  return { id: Number(binding!.id), outcome: existing && !needsMaterial ? "adopted" : "created" };
}
async function importPortfolio(sql: PoolClient, row: Source, hash: string): Promise<ImportTarget> {
  if (row.lms_run_id || row.source_submission_id) return { outcome: "skipped", code: "already_lms_project" };
  const existing = await one<{ source_hash: string }>(sql, "SELECT source_hash FROM lms_legacy_portfolio_drafts WHERE project_id=$1", [row.id]);
  if (existing) return existing.source_hash === hash ? { id: row.id, outcome: "adopted" } : { outcome: "conflict", code: "portfolio_draft_changed" };
  if (!await one(sql, "SELECT id FROM academy_students WHERE id=$1", [row.student_id])) return { outcome: "skipped", code: "portfolio_student_missing" };
  await sql.query("INSERT INTO lms_legacy_portfolio_drafts(project_id,source_hash,snapshot,state) VALUES($1,$2,$3::jsonb,'draft')", [row.id, hash, JSON.stringify(sourceSnapshot("portfolio", row, "offline"))]);
  return { id: row.id, outcome: "created" };
}
async function planSource(sql: PoolClient, scope: LegacyScope, row: Source, options: LegacyImportOptions): Promise<ImportTarget | { outcome: "planned" }> {
  if (scope === "courses") {
    const units = programUnits(row.program);
    if (!units || !units.length) return { outcome: "skipped", code: units ? "program_empty" : "program_invalid" };
    const existing = await one<{ id: string }>(sql, "SELECT id FROM lms_course_versions WHERE course_id=$1 AND program=$2::jsonb ORDER BY version DESC LIMIT 1", [row.id, JSON.stringify(row.program)]);
    return existing ? { id: Number(existing.id), outcome: "adopted" } : { outcome: "planned" };
  }
  if (scope === "groups") {
    const existing = await one<{ id: string; course_id: number }>(sql, "SELECT run.id,version.course_id FROM lms_group_runs run JOIN lms_course_versions version ON version.id=run.course_version_id WHERE run.group_id=$1", [row.id]);
    if (existing) return existing.course_id === row.course_id ? { id: Number(existing.id), outcome: "adopted" } : { outcome: "conflict", code: "existing_run_course_mismatch" };
    const imported = await one(sql, "SELECT imported.target_id FROM lms_legacy_imports imported JOIN lms_course_versions version ON version.id=imported.target_id WHERE imported.source_type='courses' AND imported.source_id=$1 AND imported.target_type='lms_course_versions' AND version.course_id=$1", [row.course_id]);
    if (imported) return { outcome: "planned" };
    const course = await one<{ program: unknown }>(sql, "SELECT program FROM academy_courses WHERE id=$1", [row.course_id]);
    const units = programUnits(course?.program);
    return (options.scopes ?? LEGACY_SCOPES).includes("courses") && units?.length ? { outcome: "planned" } : { outcome: "skipped", code: "course_not_imported" };
  }
  if (scope === "portfolio") {
    if (row.lms_run_id || row.source_submission_id) return { outcome: "skipped", code: "already_lms_project" };
    const existing = await one(sql, "SELECT project_id FROM lms_legacy_portfolio_drafts WHERE project_id=$1", [row.id]);
    if (existing) return { outcome: "conflict", code: "untracked_portfolio_draft" };
    return await one(sql, "SELECT id FROM academy_students WHERE id=$1", [row.student_id]) ? { outcome: "planned" } : { outcome: "skipped", code: "portfolio_student_missing" };
  }
  const run = await one<{ id: string; course_version_id: string; course_id: number }>(sql, "SELECT run.id,run.course_version_id,version.course_id FROM lms_group_runs run JOIN lms_course_versions version ON version.id=run.course_version_id WHERE run.group_id=$1", [row.group_id]);
  if (!run) {
    const course = await one<{ id: number; program: unknown }>(sql, "SELECT course.id,course.program FROM academy_groups g JOIN academy_courses course ON course.id=g.course_id WHERE g.id=$1", [row.group_id]);
    const units = programUnits(course?.program);
    if (!(options.scopes ?? LEGACY_SCOPES).includes("groups") || !units?.length) return { outcome: "skipped", code: "group_run_missing" };
    if (row.course_id !== null && row.course_id !== undefined && row.course_id !== course?.id) return { outcome: "skipped", code: "lesson_course_mismatch" };
    return units.some((unit) => unit.position === Number(row.lesson_number) - 1) ? { outcome: "planned" } : { outcome: "skipped", code: "lesson_unit_unmatched" };
  }
  if (row.course_id !== null && row.course_id !== undefined && row.course_id !== run.course_id) return { outcome: "skipped", code: "lesson_course_mismatch" };
  const unit = await one<{ id: string }>(sql, "SELECT id FROM lms_units WHERE course_version_id=$1 AND position=$2", [run.course_version_id, Number(row.lesson_number) - 1]);
  if (!unit) return { outcome: "skipped", code: "lesson_unit_unmatched" };
  const existing = await one<{ id: string; unit_id: string | null }>(sql, "SELECT id,unit_id FROM lms_lesson_bindings WHERE run_id=$1 AND lesson_id=$2", [run.id, row.id]);
  if (existing && existing.unit_id !== unit.id) return { outcome: "conflict", code: "existing_binding_review_required" };
  const body = typeof row.materials === "string" ? row.materials : "";
  if (!body.trim()) return existing ? { id: Number(existing.id), outcome: "adopted" } : { outcome: "planned" };
  const equivalent = await one(sql, "SELECT material.id FROM lms_materials material JOIN lms_material_versions version ON version.material_id=material.id WHERE material.run_id=$1 AND material.unit_id=$2 AND version.title=$3 AND version.body=$4 AND version.category='lesson' LIMIT 1", [run.id, unit.id, row.topic, body]);
  if (equivalent && existing) return { id: Number(existing.id), outcome: "adopted" };
  if (!equivalent && existing && await one(sql, "SELECT id FROM lms_materials WHERE run_id=$1 AND unit_id=$2 LIMIT 1", [run.id, unit.id])) return { outcome: "conflict", code: "existing_material_review_required" };
  return { outcome: "planned" };
}
async function processSource(sql: PoolClient, scope: LegacyScope, row: Source, options: LegacyImportOptions): Promise<LegacyImportRecord> {
  const sourceHash = legacySourceHash(sourceSnapshot(scope, row, options.defaultFormat ?? "offline"));
  const base = { scope, sourceId: row.id, sourceHash };
  const previous = await one<{ source_hash: string; target_id: string; target_type: string }>(sql, "SELECT source_hash,target_id,target_type FROM lms_legacy_imports WHERE source_type=$1 AND source_id=$2", [scope, row.id]);
  if (previous) {
    if (previous.source_hash !== sourceHash) return { ...base, outcome: "conflict", code: "source_changed" };
    const table = TARGET_TABLE[scope];
    const target = previous.target_type === table && await one(sql, `SELECT 1 FROM ${table} WHERE ${scope === "portfolio" ? "project_id" : "id"}=$1`, [previous.target_id]);
    return target ? { ...base, outcome: "unchanged", targetId: Number(previous.target_id) } : { ...base, outcome: "conflict", code: "import_target_missing" };
  }
  if (!options.apply) {
    const plan = await planSource(sql, scope, row, options);
    return { ...base, outcome: plan.outcome, ...("code" in plan && plan.code ? { code: plan.code } : {}), ...("id" in plan && plan.id ? { targetId: plan.id } : {}) };
  }
  const target = scope === "courses" ? await importCourse(sql, row, options.actorUserId!) : scope === "groups" ? await importGroup(sql, row, options.defaultFormat ?? "offline") : scope === "lessons" ? await importLesson(sql, row, options.actorUserId!) : await importPortfolio(sql, row, sourceHash);
  if (target.id !== undefined)
    await sql.query("INSERT INTO lms_legacy_imports(source_type,source_id,source_hash,target_type,target_id) VALUES($1,$2,$3,$4,$5)", [scope, row.id, sourceHash, TARGET_TABLE[scope], target.id]);
  return { ...base, outcome: target.outcome, code: target.code, targetId: target.id };
}

export async function runLegacyImport(pool: Pool, options: LegacyImportOptions): Promise<LegacyImportReport> {
  const batchSize = positiveInteger(options.batchSize, 100, 500);
  const maxBatches = positiveInteger(options.maxBatches, 1_000, 100_000);
  const groupIds = [...new Set(options.groupIds ?? [])];
  for (const id of groupIds) positiveInteger(id, 0, 2_147_483_647);
  const scopes = [...new Set(options.scopes ?? LEGACY_SCOPES)];
  if (!scopes.length || scopes.some((scope) => !LEGACY_SCOPES.includes(scope))) throw new LegacyImportError("IMPORT_SCOPE_INVALID");
  // Dependency order is fixed even when the CLI receives a different list order.
  scopes.sort((a, b) => LEGACY_SCOPES.indexOf(a) - LEGACY_SCOPES.indexOf(b));
  if (options.apply && !options.actorUserId) throw new LegacyImportError("IMPORT_ACTOR_REQUIRED");
  if (options.actorUserId !== undefined) positiveInteger(options.actorUserId, 0, 2_147_483_647);
  if (options.defaultFormat !== undefined && !["offline", "online"].includes(options.defaultFormat)) throw new LegacyImportError("IMPORT_OPTION_INVALID");
  const report: LegacyImportReport = {
    mode: options.apply ? "apply" : "dry_run", startedAt: new Date().toISOString(), batches: 0,
    defaultFormat: options.defaultFormat ?? "offline", counts: { planned: 0, created: 0, adopted: 0, unchanged: 0, conflict: 0, skipped: 0 }, records: [], checkpoints: {}, audit: { issues: [], truncated: false, checkedFileReferences: 0 },
  };
  const sql = await pool.connect();
  let locked = false;
  let inTransaction = false;
  try {
    if (options.apply) {
      locked = Boolean((await one<{ acquired: boolean }>(sql, "SELECT pg_try_advisory_lock(hashtext('01academy-crm:legacy-lms-import')) AS acquired"))?.acquired);
      if (!locked) throw new LegacyImportError("IMPORT_ALREADY_RUNNING");
      if (!await one(sql, "SELECT id FROM users WHERE id=$1 AND is_active AND NOT is_archived", [options.actorUserId])) throw new LegacyImportError("IMPORT_ACTOR_INVALID");
    }
    await sql.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    inTransaction = true;
    if (options.audit !== false) report.audit = await auditLegacyData(sql);
    await sql.query("COMMIT");
    inTransaction = false;
    for (const scope of scopes) {
      const checkpointKey = checkpointScope(scope, groupIds);
      let lastId = options.resume ? Number((await one<{ last_id: string }>(sql, "SELECT last_id FROM lms_legacy_import_checkpoints WHERE scope=$1", [checkpointKey]))?.last_id ?? 0) : 0;
      report.checkpoints[scope] = lastId;
      for (let batch = 0; batch < maxBatches; batch++) {
        await sql.query(options.apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        inTransaction = true;
        const filter = !groupIds.length ? "" : scope === "courses" ? "AND source.id IN(SELECT course_id FROM academy_groups WHERE id=ANY($3::int[]))" : scope === "groups" ? "AND source.id=ANY($3::int[])" : "AND source.group_id=ANY($3::int[])";
        const values: unknown[] = [lastId, batchSize];
        if (filter) values.push(groupIds);
        const batchRows = (await sql.query<Source>(`SELECT source.* FROM ${SOURCE_TABLE[scope]} source WHERE source.id>$1 ${filter} ORDER BY source.id LIMIT $2 ${options.apply ? "FOR UPDATE OF source" : ""}`, values)).rows;
        if (!batchRows.length) {
          await sql.query("COMMIT"); inTransaction = false; break;
        }
        const records: LegacyImportRecord[] = [];
        for (const row of batchRows) {
          await auditSourceFiles(report.audit, options.uploadsDirectory, scope, row.id, sourceSnapshot(scope, row, report.defaultFormat));
          records.push(await processSource(sql, scope, row, options));
        }
        lastId = Number(batchRows[batchRows.length - 1].id);
        if (options.apply)
          await sql.query("INSERT INTO lms_legacy_import_checkpoints(scope,last_id) VALUES($1,$2) ON CONFLICT(scope) DO UPDATE SET last_id=EXCLUDED.last_id,updated_at=now()", [checkpointKey, lastId]);
        await sql.query("COMMIT"); inTransaction = false;
        // Records appear only after their transaction committed successfully.
        for (const record of records) { report.records.push(record); report.counts[record.outcome]++; }
        report.checkpoints[scope] = lastId;
        report.batches++;
      }
    }
    report.completedAt = new Date().toISOString();
    return report;
  } catch (error) {
    if (inTransaction) await sql.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (locked) await sql.query("SELECT pg_advisory_unlock(hashtext('01academy-crm:legacy-lms-import'))").catch(() => undefined);
    sql.release();
  }
}
