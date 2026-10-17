import { insertCrmCourseUnits } from './crm-course-units';
import type { Pool, PoolClient } from "pg";
import { courseLessonPosition, flattenCourseCurriculum } from '@shared/contracts/course-curriculum';
import { one, rows, transaction } from "./postgres-base";
import {
  crmGroupFormat,
  crmPreparationHash,
  crmProgramUnits,
  type CrmLearningFormat,
  type CrmPreparationActor,
  type CrmPreparationStatus,
} from "../domain/crm-preparation";

type PreparationOptions = {
  enabled: () => boolean;
  groupIds?: readonly number[];
  defaultFormat: () => CrmLearningFormat | null;
};
type GroupSource = {
  id: number;
  name: string;
  courseId: number | null;
  program: unknown;
  selectedCourseLessonIds?: string[] | null;
};
type SourceMapping = { sourceHash: string; targetId: number };
type LessonSource = { id: number; lessonNumber: number; topic: string; materials: string | null; courseLessonId?: string | null };
const CURSOR = "crm-preparation:groups:v1";

function ensureLease(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("LMS_JOB_LEASE_LOST");
}

/** Reconciles authoritative CRM rows; it never copies students, enrollments or timetable data. */
export class PgCrmLearningPreparationRepository {
  constructor(private readonly pool: Pool, private readonly options: PreparationOptions) {}

  async runOnce(actor: CrmPreparationActor = { kind: "system" }, signal?: AbortSignal) {
    const result = { prepared: 0, reviewed: 0, scanned: 0 };
    if (!this.options.enabled()) return result;
    ensureLease(signal);
    const rollout = await one(this.pool, "SELECT key FROM lms_feature_flags WHERE key='learning' AND enabled=true");
    if (!rollout) return result;
    const cursor = await one<{ lastId: number }>(this.pool, "SELECT last_id FROM lms_legacy_import_checkpoints WHERE scope=$1", [CURSOR]);
    const groups = await rows<{ id: number }>(this.pool,
      `SELECT g.id FROM academy_groups g JOIN lms_feature_flags flag ON flag.key='learning' AND flag.enabled
       WHERE g.id>$1 AND (flag.all_groups OR g.id=ANY(flag.group_ids))
       AND ($2::integer[]='{}' OR g.id=ANY($2::integer[])) ORDER BY g.id LIMIT 50`,
      [cursor?.lastId ?? 0, this.options.groupIds ?? []]);
    for (const group of groups) {
      ensureLease(signal);
      if (!this.options.enabled()) break;
      let status: CrmPreparationStatus | null;
      try { status = await this.prepareGroup(group.id, actor, signal); }
      catch (error) {
        if (error instanceof Error && error.message === "CRM_PREPARATION_DISABLED") break;
        throw error;
      }
      result.scanned++;
      if (status === "ready") result.prepared++;
      else if (status) result.reviewed++;
    }
    ensureLease(signal);
    if (this.options.enabled()) await this.pool.query(
      `INSERT INTO lms_legacy_import_checkpoints(scope,last_id) SELECT $1,$2
       WHERE EXISTS(SELECT 1 FROM lms_feature_flags WHERE key='learning' AND enabled)
       ON CONFLICT(scope) DO UPDATE SET last_id=EXCLUDED.last_id,updated_at=now()`,
      [CURSOR, groups.length === 50 ? groups[groups.length - 1].id : 0]);
    return result;
  }

  private async prepareGroup(groupId: number, actor: CrmPreparationActor, signal?: AbortSignal): Promise<CrmPreparationStatus | null> {
    return transaction(this.pool, async (sql) => {
      ensureLease(signal);
      const allowed = await one(sql,
        `SELECT key FROM lms_feature_flags WHERE key='learning' AND enabled
         AND (all_groups OR $1=ANY(group_ids)) AND ($2::integer[]='{}' OR $1=ANY($2::integer[])) FOR SHARE`,
        [groupId, this.options.groupIds ?? []]);
      if (!allowed || !this.options.enabled()) return null;
      if (actor.kind === "staff" && !await one(sql, "SELECT id FROM users WHERE id=$1 AND is_active=true AND is_archived=false", [actor.userId])) throw new Error("CRM_PREPARATION_ACTOR_INACTIVE");
      const group = await one<GroupSource>(sql,
        `SELECT g.id,g.name,course.id AS course_id,course.program,to_jsonb(g)->'selected_course_lesson_ids' AS selected_course_lesson_ids FROM academy_groups g
         LEFT JOIN academy_courses course ON course.id=g.course_id WHERE g.id=$1 FOR UPDATE OF g`, [groupId]);
      if (!group) return null;
      const existing = await one<{ id: number; courseVersionId: number }>(sql, "SELECT id,course_version_id FROM lms_group_runs WHERE group_id=$1 FOR UPDATE", [groupId]);
      const format = existing ? null : crmGroupFormat(group.name, this.options.defaultFormat());
      let status: CrmPreparationStatus = group.courseId === null ? "needs_course" : !existing && !format ? "needs_format" : "ready";
      let runId = existing?.id ?? null;
      if (status === "ready") {
        const lockedCourse = await one<{ program: unknown }>(sql,"SELECT program FROM academy_courses WHERE id=$1 FOR UPDATE",[group.courseId]);
        group.program = lockedCourse!.program;
        const units = crmProgramUnits(group.program);
        let versionId = existing?.courseVersionId;
        if (existing) {
          const pinned = await one<{ courseId: number }>(sql, "SELECT course_id FROM lms_course_versions WHERE id=$1", [existing.courseVersionId]);
          const origin = await one<{ sourceHash: string }>(sql,
            "SELECT new_value->>'sourceHash' AS source_hash FROM lms_learning_audit WHERE entity_type='lms_course_versions' AND entity_id=$1 AND action='crm.source.linked' AND new_value->>'source'='crm_course' ORDER BY id DESC LIMIT 1", [existing.courseVersionId]);
          if (pinned?.courseId !== group.courseId || (origin && (!units || origin.sourceHash !== crmPreparationHash({courseId:group.courseId,program:group.program})))) status = "needs_program_review";
        } else {
          const published = await one<{id:number;program:unknown}>(sql,"SELECT id,program FROM lms_course_versions WHERE course_id=$1 AND state='published' ORDER BY version DESC LIMIT 1",[group.courseId]);
          const publishedIds = new Set(flattenCourseCurriculum(published?.program).map(lesson => lesson.id));
          const compatiblePublished = published && (!group.selectedCourseLessonIds || group.selectedCourseLessonIds.every(id => publishedIds.has(id)));
          versionId = compatiblePublished ? published.id : await this.courseDraft(sql, group, units ?? [], actor);
          if (!compatiblePublished && !units) status = "needs_program_review";
          const run = await one<{ id: number }>(sql,
            "INSERT INTO lms_group_runs(group_id,course_version_id,format) VALUES($1,$2,$3) ON CONFLICT(group_id) DO NOTHING RETURNING id", [groupId, versionId, format]);
          runId = run?.id ?? (await one<{ id: number }>(sql, "SELECT id FROM lms_group_runs WHERE group_id=$1", [groupId]))!.id;
        }
        if (runId && versionId && await this.lessonDrafts(sql, groupId, runId, versionId, actor, signal)) status = "needs_program_review";
      }
      const sourceHash = crmPreparationHash({ groupId, name: group.name, courseId: group.courseId, program: group.program });
      await this.audit(sql, actor, groupId, runId, status, sourceHash);
      ensureLease(signal);
      if (!this.options.enabled()) throw new Error("CRM_PREPARATION_DISABLED");
      return status;
    });
  }

  private async mapping(sql: PoolClient, type: string, id: number) {
    return one<SourceMapping>(sql, "SELECT source_hash,target_id FROM lms_legacy_imports WHERE source_type=$1 AND source_id=$2", [type, id]);
  }
  private async remember(sql: PoolClient, type: string, id: number, hash: string, target: string, targetId: number, actor: CrmPreparationActor) {
    await sql.query(
      `INSERT INTO lms_legacy_imports(source_type,source_id,source_hash,target_type,target_id) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(source_type,source_id) DO UPDATE SET source_hash=EXCLUDED.source_hash,target_type=EXCLUDED.target_type,target_id=EXCLUDED.target_id,imported_at=now()`,
      [type, id, hash, target, targetId]);
    await sql.query(
      "INSERT INTO lms_learning_audit(user_id,entity_type,entity_id,action,new_value,request_id) VALUES($1,$2,$3,'crm.source.linked',$4::jsonb,$5)",
      [actor.kind === "staff" ? actor.userId : null,target,targetId,JSON.stringify({actor,source:type,sourceId:id,sourceHash:hash,targetId}),actor.kind === "staff" ? actor.requestId ?? null : null]);
  }

  private async courseDraft(sql: PoolClient, group: GroupSource, units: { title: string; position: number }[], actor: CrmPreparationActor) {
    const program = crmProgramUnits(group.program) ? group.program : [];
    const hash = crmPreparationHash({ courseId: group.courseId, program });
    const mapped = await this.mapping(sql, "crm_course", group.courseId!);
    if (mapped?.sourceHash === hash) {
      const draft = await one<{ id: number; program: unknown; createdBy: number | null; state: string }>(sql, "SELECT id,program,created_by,state FROM lms_course_versions WHERE id=$1 AND course_id=$2", [mapped.targetId, group.courseId]);
      const currentUnits = await rows<{ title: string; position: number }>(sql, "SELECT title,position FROM lms_units WHERE course_version_id=$1 ORDER BY position", [mapped.targetId]);
      if (draft?.state === "draft" && draft.createdBy === null && crmPreparationHash(draft.program) === crmPreparationHash(program) && crmPreparationHash(currentUnits) === crmPreparationHash([...units].sort((left, right) => left.position - right.position).map(unit => ({ title: unit.title, position: unit.position })))) return draft.id;
    }
    const draft = await one<{ id: number }>(sql,
      `INSERT INTO lms_course_versions(course_id,version,state,program,created_by)
       SELECT $1,COALESCE(MAX(version),0)+1,'draft',$2::jsonb,NULL FROM lms_course_versions WHERE course_id=$1 RETURNING id`,
      [group.courseId, JSON.stringify(program)]);
    await insertCrmCourseUnits(sql, draft!.id, program);
    await this.remember(sql, "crm_course", group.courseId!, hash, "lms_course_versions", draft!.id, actor);
    return draft!.id;
  }

  private async lessonDrafts(sql: PoolClient, groupId: number, runId: number, versionId: number, actor: CrmPreparationActor, signal?: AbortSignal) {
    const scope = `crm-preparation:lessons:${groupId}`;
    const cursor = await one<{ lastId: number }>(sql, "SELECT last_id FROM lms_legacy_import_checkpoints WHERE scope=$1", [scope]);
    const lessons = await rows<LessonSource>(sql,
      "SELECT id,lesson_number,topic,materials,to_jsonb(academy_lessons)->>'course_lesson_id' AS course_lesson_id FROM academy_lessons WHERE group_id=$1 AND id>$2 AND status<>'cancelled' ORDER BY id LIMIT 200", [groupId, cursor?.lastId ?? 0]);
    const version = await one<{ program: unknown }>(sql, 'SELECT program FROM lms_course_versions WHERE id=$1', [versionId]);
    for (const lesson of lessons) {
      ensureLease(signal);
      let needsReview = false;
      const position = courseLessonPosition(version?.program, lesson.courseLessonId, lesson.lessonNumber);
      const unit = position === null ? undefined : await one<{ id: number }>(sql, "SELECT id FROM lms_units WHERE course_version_id=$1 AND position=$2", [versionId, position]);
      const binding = await one<{ id: number; unitId: number | null }>(sql, "SELECT id,unit_id FROM lms_lesson_bindings WHERE run_id=$1 AND lesson_id=$2", [runId, lesson.id]);
      if (!binding) {
        const created = await one<{ id: number }>(sql,"INSERT INTO lms_lesson_bindings(run_id,unit_id,lesson_id) VALUES($1,$2,$3) ON CONFLICT(run_id,lesson_id) DO NOTHING RETURNING id", [runId, unit?.id ?? null, lesson.id]);
        if (created) await this.remember(sql,"crm_lesson_binding",lesson.id,crmPreparationHash({groupId,lessonNumber:lesson.lessonNumber,unitId:unit?.id ?? null}),"lms_lesson_bindings",created.id,actor);
      }
      else if (binding.unitId !== (unit?.id ?? null)) needsReview = true;
      needsReview = await this.materialDraft(sql, lesson, runId, binding?.unitId ?? unit?.id ?? null, actor) || needsReview;
      const sourceHash = crmPreparationHash(lesson);
      const previous = await one<{newValue:{sourceHash:string;needsReview:boolean}}>(sql,"SELECT new_value FROM lms_learning_audit WHERE entity_type='crm_lesson_preparation' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[lesson.id]);
      if (previous?.newValue.sourceHash !== sourceHash || previous.newValue.needsReview !== needsReview) await sql.query(
        "INSERT INTO lms_learning_audit(user_id,run_id,entity_type,entity_id,action,new_value,request_id) VALUES($1,$2,'crm_lesson_preparation',$3,'crm.lesson.prepared',$4::jsonb,$5)",
        [actor.kind === "staff" ? actor.userId : null,runId,lesson.id,JSON.stringify({actor,source:"academy_lessons",sourceHash,needsReview}),actor.kind === "staff" ? actor.requestId ?? null : null]);
    }
    await sql.query("INSERT INTO lms_legacy_import_checkpoints(scope,last_id) VALUES($1,$2) ON CONFLICT(scope) DO UPDATE SET last_id=EXCLUDED.last_id,updated_at=now()", [scope, lessons.length === 200 ? lessons[lessons.length - 1].id : 0]);
    return Boolean(await one(sql,
      `SELECT 1 FROM (SELECT DISTINCT ON(entity_id) new_value FROM lms_learning_audit
       WHERE entity_type='crm_lesson_preparation' AND run_id=$1 ORDER BY entity_id,id DESC) latest
       WHERE (new_value->>'needsReview')::boolean=true LIMIT 1`,[runId]));
  }

  private async materialDraft(sql: PoolClient, lesson: LessonSource, runId: number, unitId: number | null, actor: CrmPreparationActor) {
    const mapped = await this.mapping(sql, "crm_lesson_material", lesson.id);
    if (!lesson.materials?.trim()) return Boolean(mapped);
    if (!lesson.topic.trim()) return true;
    const snapshot = { title: lesson.topic, body: lesson.materials!, category: "lesson" };
    const hash = crmPreparationHash(snapshot);
    if (mapped?.sourceHash === hash) return false;
    let materialId: number | null = null;
    let version = 1;
    if (mapped) {
      const previous = await one<{ materialId: number; state: string; latestId: number; version: number; createdBy: number | null; title: string; body: string; category: string; links: unknown; fileIds: unknown; published: boolean }>(sql,
        `SELECT material.id AS material_id,material.state,latest.id AS latest_id,latest.version,latest.created_by,latest.title,latest.body,latest.category,latest.links,latest.file_ids,
         EXISTS(SELECT 1 FROM lms_material_publications WHERE material_id=material.id) AS published
         FROM lms_material_versions old JOIN lms_materials material ON material.id=old.material_id
         JOIN LATERAL(SELECT * FROM lms_material_versions WHERE material_id=material.id ORDER BY version DESC LIMIT 1) latest ON true
         WHERE old.id=$1 AND material.run_id=$2 FOR UPDATE OF material`, [mapped.targetId, runId]);
      if (!previous || previous.state !== "draft" || previous.published || previous.latestId !== mapped.targetId || previous.createdBy !== null || crmPreparationHash({ title: previous.title, body: previous.body, category: previous.category }) !== mapped.sourceHash || JSON.stringify(previous.links) !== "[]" || JSON.stringify(previous.fileIds) !== "[]") return true;
      materialId = previous.materialId;
      version = previous.version + 1;
    } else {
      const equivalent = await one<{ id: number }>(sql,
        `SELECT version.id FROM lms_materials material JOIN lms_material_versions version ON version.material_id=material.id
         WHERE material.run_id=$1 AND material.unit_id IS NOT DISTINCT FROM $2::bigint AND version.title=$3 AND version.body=$4 AND version.category='lesson' ORDER BY version.version DESC LIMIT 1`, [runId, unitId, snapshot.title, snapshot.body]);
      if (equivalent) {
        await this.remember(sql, "crm_lesson_material", lesson.id, hash, "lms_material_versions", equivalent.id, actor);
        return false;
      }
      if (unitId !== null && await one(sql, "SELECT id FROM lms_materials WHERE run_id=$1 AND unit_id=$2 LIMIT 1", [runId, unitId])) return true;
      materialId = (await one<{ id: number }>(sql, "INSERT INTO lms_materials(run_id,unit_id,state,created_by) VALUES($1,$2,'draft',NULL) RETURNING id", [runId, unitId]))!.id;
    }
    const created = await one<{ id: number }>(sql,
      "INSERT INTO lms_material_versions(material_id,version,title,body,category,created_by) VALUES($1,$2,$3,$4,'lesson',NULL) RETURNING id", [materialId, version, snapshot.title, snapshot.body]);
    await this.remember(sql, "crm_lesson_material", lesson.id, hash, "lms_material_versions", created!.id, actor);
    return false;
  }

  private async audit(sql: PoolClient, actor: CrmPreparationActor, groupId: number, runId: number | null, setupStatus: CrmPreparationStatus, sourceHash: string) {
    const latest = await one<{ newValue: { setupStatus: string; sourceHash: string } }>(sql,
      "SELECT new_value FROM lms_learning_audit WHERE entity_type='crm_group_preparation' AND entity_id=$1 AND action='crm.prepared' ORDER BY id DESC LIMIT 1", [groupId]);
    if (latest?.newValue?.setupStatus === setupStatus && latest.newValue.sourceHash === sourceHash) return;
    await sql.query(
      `INSERT INTO lms_learning_audit(user_id,run_id,entity_type,entity_id,action,new_value,request_id)
       VALUES($1,$2,'crm_group_preparation',$3,'crm.prepared',$4::jsonb,$5)`,
      [actor.kind === "staff" ? actor.userId : null, runId, groupId,
        JSON.stringify({ actor, source: "academy_groups", groupId, sourceHash, setupStatus }), actor.kind === "staff" ? actor.requestId ?? null : null]);
  }
}
