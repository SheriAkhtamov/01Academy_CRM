import { composeGroupName, parseGroupName, previewGroupCode, type GroupCodeCatalogue, type GroupDeliveryMode, type GroupTrainingType } from '@shared/academy-group-code';
import { ACADEMY_SCHEDULING_ADVISORY_LOCK, ACADEMY_TIME_ZONE, query, queryOne, transactionContext, type Row } from './academy-core';

const sequenceKey = 'academy.group-code.high-water';
const catalogueKey = 'academy.group-code.approved-catalogue';
const fail = (message: string) => { throw Object.assign(new Error(message), { statusCode: 400 }); };

/** Old names remain intact; existing codes are the source of approved abbreviations. */
export async function getGroupCodeCatalogue(reference = new Date()): Promise<GroupCodeCatalogue> {
  const groups = await query<{ name: string; schoolId: number; courseId: number }>('SELECT name, school_id, course_id FROM academy_groups');
  const schools = await query<{ id: number; code: string }>('SELECT id, code FROM academy_schools');
  const courses = await query<{ id: number; slug: string }>('SELECT id, slug FROM academy_courses');
  const maximum = await queryOne<{ maximumNumber: string | number | null }>(`SELECT MAX((regexp_match(name,
    '^[A-Z0-9]+-[A-Z0-9]+-(?:GRP|IND)-[0-9]{2}-([0-9]+)(?:$|[[:space:]])'))[1]::numeric) AS maximum_number
    FROM (
      SELECT name FROM academy_groups
      UNION ALL
      SELECT record->>'name' FROM audit_logs audit
      CROSS JOIN LATERAL jsonb_array_elements(
        (CASE jsonb_typeof(audit.new_values) WHEN 'array' THEN audit.new_values
          WHEN 'object' THEN jsonb_build_array(audit.new_values) ELSE '[]'::jsonb END)
        || (CASE jsonb_typeof(audit.old_values) WHEN 'array' THEN audit.old_values
          WHEN 'object' THEN jsonb_build_array(audit.old_values) ELSE '[]'::jsonb END)
      ) AS saved_records(record)
      WHERE audit.entity_type IN ('academy_group', 'academy_groups')
    ) AS historical_group_names`);
  const saved = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = $1', [sequenceKey]);
  const approved = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = $1', [catalogueKey]);
  const schoolCodes: Record<string, string> = {};
  const courseCodes: Record<string, string> = {};
  // Prefer the latest numbered code when an older abbreviation was replaced.
  for (const group of groups.sort((left, right) => (parseGroupName(left.name)?.number ?? 0) - (parseGroupName(right.name)?.number ?? 0))) {
    const parsed = parseGroupName(group.name);
    if (!parsed) continue;
    if (parsed.branch !== 'ONL') schoolCodes[group.schoolId] = parsed.branch;
    courseCodes[group.courseId] = parsed.course;
  }
  // These canonical codes are explicitly defined by the project rules and user.
  for (const school of schools) {
    if (!schoolCodes[school.id] && ['cyberpark', 'cyp'].includes(school.code.toLowerCase())) schoolCodes[school.id] = 'CYP';
  }
  for (const course of courses) {
    if (!courseCodes[course.id] && course.slug === 'vibe-coding') courseCodes[course.id] = 'VC';
    if (!courseCodes[course.id] && course.slug === 'ai-kids') courseCodes[course.id] = 'AI';
  }
  if (approved?.value) {
    const stored = JSON.parse(approved.value) as Pick<GroupCodeCatalogue, 'schoolCodes' | 'courseCodes'>;
    Object.assign(schoolCodes, stored.schoolCodes);
    Object.assign(courseCodes, stored.courseCodes);
  }
  const highWater = Math.max(Number(maximum?.maximumNumber ?? 0), Number(saved?.value ?? 0),
    ...groups.map((group) => parseGroupName(group.name)?.number ?? 0));
  if (!Number.isSafeInteger(highWater) || highWater < 0 || !Number.isSafeInteger(highWater + 1)) fail('invalidData');
  return { schoolCodes, courseCodes, nextNumber: highWater + 1,
    year: new Intl.DateTimeFormat('en', { timeZone: ACADEMY_TIME_ZONE, year: 'numeric' }).format(reference).slice(-2) };
}

function namingInput(input: Row) {
  const legacy = parseGroupName(input.name);
  const deliveryMode = input.deliveryMode ?? legacy?.deliveryMode ?? 'offline';
  const trainingType = input.trainingType ?? legacy?.trainingType ?? 'GRP';
  if (!['offline', 'online'].includes(deliveryMode) || !['GRP', 'IND'].includes(trainingType)) fail('invalidData');
  return { deliveryMode: deliveryMode as GroupDeliveryMode, trainingType: trainingType as GroupTrainingType };
}

function additionFor(input: Row) {
  const addition = input.nameSuffix ?? parseGroupName(input.name)?.addition ?? input.name ?? '';
  if (typeof addition !== 'string' || parseGroupName(addition)) fail('groupNameAdditionInvalid');
  return addition.trim();
}

/** Called after schedule validation while the shared scheduling transaction lock is held. */
export async function allocateGroupName(values: Row, input: Row) {
  if (!transactionContext.getStore()) throw new Error('Group naming requires a transaction');
  await query('SELECT pg_advisory_xact_lock($1)', [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
  const naming = namingInput(input);
  if (naming.trainingType === 'IND' && Number(values.maxStudents) !== 1) fail('groupIndividualCapacity');
  const catalogue = await getGroupCodeCatalogue();
  if (!catalogue.courseCodes[values.courseId]) fail('groupCodeCourseMissing');
  if (naming.deliveryMode === 'offline' && !catalogue.schoolCodes[values.schoolId]) fail('groupCodeBranchMissing');
  const code = previewGroupCode(catalogue, { ...naming, schoolId: values.schoolId, courseId: values.courseId });
  const name = composeGroupName(code, additionFor(input));
  if (name.length > 255) fail('groupNameTooLong');
  values.name = name;
  await saveNamingState(catalogue, catalogue.nextNumber);
}

async function saveNamingState(catalogue: GroupCodeCatalogue, number: number) {
  await query(`INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = GREATEST(system_settings.value::numeric, EXCLUDED.value::numeric)::text, updated_at = NOW()`,
    [sequenceKey, String(number)]);
  await query(`INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [catalogueKey, JSON.stringify({ schoolCodes: catalogue.schoolCodes, courseCodes: catalogue.courseCodes })]);
}

/** Remember old numbered groups before deletion, even before the first automatic creation. */
export async function rememberDeletedGroupCode(row: Row) {
  if (!parseGroupName(row.name)) return;
  if (!transactionContext.getStore()) throw new Error('Group naming requires a transaction');
  const catalogue = await getGroupCodeCatalogue();
  await saveNamingState(catalogue, catalogue.nextNumber - 1);
}

export function preserveGroupCode(row: Row, values: Row, input: Row) {
  const original = parseGroupName(row.name);
  if (!original) {
    if (parseGroupName(values.name)) fail('groupNameAdditionInvalid');
    return;
  }
  if (input.deliveryMode !== undefined && input.deliveryMode !== original.deliveryMode) {
    fail(input.deliveryMode === 'online' ? 'groupOnlineRequiresNewGroup' : 'groupCodeImmutable');
  }
  if (input.trainingType !== undefined && input.trainingType !== original.trainingType) fail('groupCodeImmutable');
  if (original.trainingType === 'IND' && values.maxStudents !== undefined && Number(values.maxStudents) !== 1) fail('groupIndividualCapacity');
  if (input.nameSuffix !== undefined) values.name = composeGroupName(original.code, additionFor(input));
  else if (values.name !== undefined && parseGroupName(values.name)?.code !== original.code) fail('groupCodeImmutable');
  if (values.name && values.name.length > 255) fail('groupNameTooLong');
}
