import winston from 'winston';
import fs from 'fs';
import path from 'path';
import { isProductionEnvironment } from '../config';

const logsDir = path.resolve(process.cwd(), 'logs');
const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|auth[_-]?key)/i;
const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true, mode: 0o750 });
}
try {
  fs.chmodSync(logsDir, 0o750);
  for (const fileName of ['error.log', 'combined.log']) {
    const filePath = path.join(logsDir, fileName);
    if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o640);
  }
} catch {
  // Runtime logging still works when a bind-mounted directory disallows chmod.
}

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

const redactValue = (
  value: unknown,
  key = '',
  depth = 0,
  seen = new WeakSet<object>(),
): unknown => {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value !== 'object' || depth >= 6) return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, '', depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey, depth + 1, seen),
    ]),
  );
};

const redactSecrets = winston.format((info) => {
  for (const key of Object.keys(info)) {
    info[key] = redactValue(info[key], key);
  }
  return info;
});

export const logger = winston.createLogger({
  level: isProductionEnvironment ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    redactSecrets(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: MAX_LOG_FILE_BYTES,
      maxFiles: 5,
      options: { flags: 'a', mode: 0o640 },
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: MAX_LOG_FILE_BYTES,
      maxFiles: 5,
      options: { flags: 'a', mode: 0o640 },
    }),
  ],
});

// If not in production, also log to console with colors
if (!isProductionEnvironment) {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}
