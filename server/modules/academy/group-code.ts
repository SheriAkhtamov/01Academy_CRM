import { composeGroupName, parseGroupName, previewGroupCode, type GroupCodeCatalogue, type GroupDeliveryMode, type GroupTrainingType } from '@shared/academy-group-code';
import { ACADEMY_SCHEDULING_ADVISORY_LOCK, ACADEMY_TIME_ZONE, query, queryOne, transactionContext, type Row } from './academy-core';

export const GROUP_CODE_STATE_ENTITY = 'academy_group_code_state';
const stateAction = 'SAVE_GROUP_CODE_STATE';
const fail = (message: string) => { throw Object.assign(new Error(message), { statusCode: 400 }); };

type NamingState = Pick<GroupCodeCatalogue, 'schoolCodes' | 'courseCodes'> & { highWaterNumber: number };
type GroupCodeRecord = { name: string | null; schoolId: string | null; courseId: string | null; maximumNumber: string | number | null };
const validRecordId = (id: unknown): id is string => typeof id === 'string'
  && /^[1-9][0-9]*$/.test(id) && Number.isSafeInteger(Number(id));

function savedCodeMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalidData');
  const entries = Object.entries(value);
  if (entries.some(([id, code]) => !validRecordId(id) || typeof code !== 'string' || !/^[A-Z0-9]+$/.test(code))) return fail('invalidData');
  return Object.fromEntries(entries) as Record<string, string>;
}

async function readNamingState(): Promise<NamingState> {
  const saved = await queryOne<{ newValues: unknown }>(`SELECT new_values::jsonb AS new_values FROM audit_logs
    WHERE entity_type = $1 AND action = $2 ORDER BY id DESC LIMIT 1`, [GROUP_CODE_STATE_ENTITY, stateAction]);
  if (!saved) return { highWaterNumber: 0, schoolCodes: {}, courseCodes: {} };
  if (!saved.newValues || typeof saved.newValues !== 'object' || Array.isArray(saved.newValues)) return fail('invalidData');
  const { highWaterNumber, schoolCodes, courseCodes } = saved.newValues as Partial<NamingState>;
  if (typeof highWaterNumber !== 'number' || !Number.isSafeInteger(highWaterNumber) || highWaterNumber < 0) return fail('invalidData');
  return { highWaterNumber, schoolCodes: savedCodeMap(schoolCodes), courseCodes: savedCodeMap(courseCodes) };
}

/** Old names remain intact; existing codes are the source of approved abbreviations. */
export async function getGroupCodeCatalogue(reference = new Date()): Promise<GroupCodeCatalogue> {
  const groups = await query<GroupCodeRecord>(`SELECT name, school_id, course_id, MAX((regexp_match(name,
    '^[A-Z0-9]+-[A-Z0-9]+-(?:GRP|IND)-[0-9]{2}-([0-9]+)(?:$|[[:space:]])'))[1]::numeric) OVER () AS maximum_number
    FROM (
      SELECT name, school_id::text, course_id::text FROM academy_groups
      UNION ALL
      SELECT record->>'name', COALESCE(record->>'schoolId', record->>'school_id'),
        COALESCE(record->>'courseId', record->>'course_id') FROM audit_logs audit
      CROSS JOIN LATERAL jsonb_array_elements(
        (CASE jsonb_typeof(audit.new_values::jsonb) WHEN 'array' THEN audit.new_values::jsonb
          WHEN 'object' THEN jsonb_build_array(audit.new_values::jsonb) ELSE '[]'::jsonb END)
        || (CASE jsonb_typeof(audit.old_values::jsonb) WHEN 'array' THEN audit.old_values::jsonb
          WHEN 'object' THEN jsonb_build_array(audit.old_values::jsonb) ELSE '[]'::jsonb END)
      ) AS saved_records(record)
      WHERE audit.entity_type IN ('academy_group', 'academy_groups')
    ) AS historical_group_records`);
  const schools = await query<{ id: number; code: string }>('SELECT id, code FROM academy_schools');
  const courses = await query<{ id: number; slug: string }>('SELECT id, slug FROM academy_courses');
  const saved = await readNamingState();
  const schoolCodes: Record<string, string> = {};
  const courseCodes: Record<string, string> = {};
  const applyCodes = (group: GroupCodeRecord) => {
    const parsed = parseGroupName(group.name);
    if (!parsed) return;
    if (parsed.branch !== 'ONL' && validRecordId(group.schoolId)) schoolCodes[group.schoolId] = parsed.branch;
    if (validRecordId(group.courseId)) courseCodes[group.courseId] = parsed.course;
  };
  groups.sort((left, right) => (parseGroupName(left.name)?.number ?? 0) - (parseGroupName(right.name)?.number ?? 0));
  for (const group of groups) applyCodes(group);
  // Retain deleted newer abbreviations, while admitting numbered evidence added after the snapshot.
  Object.assign(schoolCodes, saved.schoolCodes);
  Object.assign(courseCodes, saved.courseCodes);
  for (const group of groups) if ((parseGroupName(group.name)?.number ?? 0) > saved.highWaterNumber) applyCodes(group);
  // These canonical codes are explicitly defined by the project rules and user.
  for (const school of schools) {
    if (!schoolCodes[school.id] && ['cyberpark', 'cyp'].includes(school.code.toLowerCase())) schoolCodes[school.id] = 'CYP';
  }
  for (const course of courses) {
    if (!courseCodes[course.id] && course.slug === 'vibe-coding') courseCodes[course.id] = 'VC';
    if (!courseCodes[course.id] && course.slug === 'ai-kids') courseCodes[course.id] = 'AI';
  }
  const highWater = groups.reduce((maximum, group) => Math.max(maximum, parseGroupName(group.name)?.number ?? 0),
    Math.max(Number(groups[0]?.maximumNumber ?? 0), saved.highWaterNumber));
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
  await query(`INSERT INTO audit_logs (action, entity_type, new_values) VALUES ($1, $2, $3)`,
    [stateAction, GROUP_CODE_STATE_ENTITY, JSON.stringify({ highWaterNumber: number, schoolCodes: catalogue.schoolCodes, courseCodes: catalogue.courseCodes })]);
}

/** Remember old numbered groups before deletion, even before the first automatic creation. */
export async function rememberDeletedGroupCode(row: Row) {
  if (!parseGroupName(row.name)) return;
  if (!transactionContext.getStore()) throw new Error('Group naming requires a transaction');
  await query('SELECT pg_advisory_xact_lock($1)', [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
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
