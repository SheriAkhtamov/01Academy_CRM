const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|auth[_-]?key)/i;

const sanitizeString = (value: string) => value
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
  .replace(
    /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/"']+:)[^@\s/"']+(@)/gi,
    '$1[REDACTED]$2',
  )
  .replace(
    /([?&](?:access_token|auth_key|client_secret|code|password|secret|token)=)[^&\s]+/gi,
    '$1[REDACTED]',
  );

export const redactLogValue = (
  value: unknown,
  key = '',
  depth = 0,
  seen = new WeakSet<object>(),
): unknown => {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 8) return '[MAX_DEPTH]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactLogValue(entry, '', depth + 1, seen));
  }

  // Error.message, stack and cause are non-enumerable. Object.entries alone
  // discarded the reason for every nested scheduler/network failure.
  const entries = value instanceof Error ? {
    name: value.name,
    message: value.message,
    stack: value.stack,
    ...Object.fromEntries(['cause', 'errors'].filter((field) => field in value)
      .map((field) => [field, Reflect.get(value, field)])),
    ...Object.fromEntries(Object.entries(value)),
  } : value;

  return Object.fromEntries(Object.entries(entries).map(([entryKey, entryValue]) => [
    entryKey,
    redactLogValue(entryValue, entryKey, depth + 1, seen),
  ]));
};
