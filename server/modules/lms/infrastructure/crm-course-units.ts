import { courseCurriculumSchema } from '@shared/contracts/course-curriculum';
import { crmProgramUnits } from '../domain/crm-preparation';
import { one, type LmsSql } from './postgres-base';

/** Sections and units share the immutable program version, including stable source identities. */
export async function insertCrmCourseUnits(sql: LmsSql, versionId: number, program: unknown) {
  const structured = courseCurriculumSchema.safeParse(program);
  if (structured.success) {
    let position = 0;
    for (const [index, block] of structured.data.blocks.entries()) {
      const section = await one<{ id: number }>(sql,
        'INSERT INTO lms_sections(course_version_id,title,position) VALUES($1,$2,$3) RETURNING id',
        [versionId, block.title, index]);
      for (const lesson of block.lessons) await sql.query(
        'INSERT INTO lms_units(course_version_id,section_id,title,position) VALUES($1,$2,$3,$4)',
        [versionId, section!.id, lesson.title, position++]);
    }
    return;
  }
  for (const unit of crmProgramUnits(program) ?? []) await sql.query(
    'INSERT INTO lms_units(course_version_id,title,position) VALUES($1,$2,$3)', [versionId, unit.title, unit.position]);
}
