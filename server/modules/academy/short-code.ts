import { nullableText, queryOne, type Row } from './academy-core';

const fail = (message: string, statusCode: number): never => { throw Object.assign(new Error(message), { statusCode }); };

/**
 * The branch or course part of a group code (CYP, VC). Upper case letters and
 * digits, up to ten; ONL is reserved for online groups. Each code belongs to
 * one branch or one course.
 */
export async function normalizeShortCode(table: 'academy_schools' | 'academy_courses', values: Row, id?: number) {
  if (!('shortCode' in values)) return;
  const code = nullableText(values.shortCode)?.toUpperCase() ?? null;
  if (code === null) {
    values.shortCode = null;
    return;
  }
  if (!/^[A-Z0-9]{1,10}$/.test(code) || (table === 'academy_schools' && code === 'ONL')) fail('shortCodeInvalid', 400);
  const taken = await queryOne(
    `SELECT id FROM ${table === 'academy_schools' ? 'academy_schools' : 'academy_courses'}
     WHERE short_code = $1 AND ($2::int IS NULL OR id <> $2) LIMIT 1`,
    [code, id ?? null],
  );
  if (taken) fail('shortCodeTaken', 409);
  values.shortCode = code;
}

/** A concurrent save that took the same code reaches the unique index instead. */
export const isShortCodeConflict = (error: unknown) => {
  const failure = error as { code?: unknown; constraint?: unknown } | null;
  return failure?.code === '23505' && /short_code/.test(String(failure?.constraint ?? ''));
};
