import { composeGroupName, parseGroupName, previewGroupCode, type GroupCodeCatalogue, type GroupDeliveryMode, type GroupTrainingType } from '@shared/academy-group-code';
import { ACADEMY_SCHEDULING_ADVISORY_LOCK, ACADEMY_TIME_ZONE, query, queryOne, transactionContext, type Row } from './academy-core';

/** Earlier releases kept the generator state as audit records; the audit log still hides those rows. */
export const GROUP_CODE_STATE_ENTITY = 'academy_group_code_state';
const fail = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };

// The highest number in any group name, so a hand-typed name never collides
// with a generated one. Capped at the sequence's integer range.
const highestNameNumber = `LEAST(COALESCE((SELECT max((regexp_match(name,
  '^[A-Z0-9]+-[A-Z0-9]+-(?:GRP|IND)-[0-9]{2}-([0-9]+)(?:$|[[:space:]])'))[1]::numeric) FROM academy_groups), 0),
  2147483646)::bigint`;

const codeYear = (reference: Date) => new Intl.DateTimeFormat('en', { timeZone: ACADEMY_TIME_ZONE, year: 'numeric' })
  .format(reference).slice(-2);

/** Branch and course codes come from their own records; the number previews the next sequence value. */
export async function getGroupCodeCatalogue(reference = new Date()): Promise<GroupCodeCatalogue> {
  const schools = await query<{ id: number; shortCode: string }>(
    'SELECT id, short_code FROM academy_schools WHERE short_code IS NOT NULL ORDER BY id');
  const courses = await query<{ id: number; shortCode: string }>(
    'SELECT id, short_code FROM academy_courses WHERE short_code IS NOT NULL ORDER BY id');
  const next = await queryOne<{ nextNumber: string | number }>(`SELECT GREATEST(
      (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM academy_group_code_seq),
      ${highestNameNumber} + 1) AS next_number`);
  const nextNumber = Number(next?.nextNumber);
  if (!Number.isSafeInteger(nextNumber) || nextNumber < 1) fail('invalidData');
  return {
    schoolCodes: Object.fromEntries(schools.map((school) => [String(school.id), school.shortCode])),
    courseCodes: Object.fromEntries(courses.map((course) => [String(course.id), course.shortCode])),
    nextNumber,
    year: codeYear(reference),
  };
}

function namingInput(values: Row, input: Row) {
  const legacy = parseGroupName(input.name);
  // The group's own format, once set, decides between a branch code and ONL.
  const deliveryMode = values.deliveryMode ?? input.deliveryMode ?? legacy?.deliveryMode ?? 'offline';
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
  const naming = namingInput(values, input);
  values.deliveryMode = naming.deliveryMode;
  if (naming.trainingType === 'IND' && Number(values.maxStudents) !== 1) fail('groupIndividualCapacity');
  const course = await queryOne<{ shortCode: string | null }>(
    'SELECT short_code FROM academy_courses WHERE id = $1', [values.courseId]);
  if (!course?.shortCode) return fail('groupCodeCourseMissing');
  const school = naming.deliveryMode === 'offline'
    ? await queryOne<{ shortCode: string | null }>('SELECT short_code FROM academy_schools WHERE id = $1', [values.schoolId])
    : null;
  if (naming.deliveryMode === 'offline' && !school?.shortCode) fail('groupCodeBranchMissing');
  // Everything that can refuse the name is checked before a number is taken.
  const addition = additionFor(input);
  const longestCode = `${school?.shortCode ?? 'ONL'}-${course.shortCode}-${naming.trainingType}-00-${'0'.repeat(10)}`;
  if (composeGroupName(longestCode, addition).length > 255) fail('groupNameTooLong');
  // A sequence value is never handed out twice, even when this transaction
  // rolls back, so a deleted group's number is never reused.
  const allocated = await queryOne<{ number: string | number }>(
    `SELECT setval('academy_group_code_seq', GREATEST(nextval('academy_group_code_seq'), ${highestNameNumber} + 1)) AS number`);
  const number = Number(allocated?.number);
  if (!Number.isSafeInteger(number) || number < 1) fail('invalidData');
  const code = previewGroupCode({
    schoolCodes: school?.shortCode ? { [String(values.schoolId)]: school.shortCode } : {},
    courseCodes: { [String(values.courseId)]: course.shortCode },
    nextNumber: number,
    year: codeYear(new Date()),
  }, { ...naming, schoolId: values.schoolId ?? '', courseId: values.courseId });
  values.name = composeGroupName(code, addition);
}

export function preserveGroupCode(row: Row, values: Row, input: Row) {
  const original = parseGroupName(row.name);
  if (!original) {
    if (parseGroupName(values.name)) fail('groupNameAdditionInvalid');
    return;
  }
  const deliveryMode = input.deliveryMode ?? values.deliveryMode;
  if (deliveryMode !== undefined && deliveryMode !== null && deliveryMode !== original.deliveryMode) {
    fail(deliveryMode === 'online' ? 'groupOnlineRequiresNewGroup' : 'groupCodeImmutable');
  }
  if (input.trainingType !== undefined && input.trainingType !== original.trainingType) fail('groupCodeImmutable');
  if (original.trainingType === 'IND' && values.maxStudents !== undefined && Number(values.maxStudents) !== 1) fail('groupIndividualCapacity');
  if (input.nameSuffix !== undefined) values.name = composeGroupName(original.code, additionFor(input));
  else if (values.name !== undefined && parseGroupName(values.name)?.code !== original.code) fail('groupCodeImmutable');
  if (values.name && values.name.length > 255) fail('groupNameTooLong');
}
