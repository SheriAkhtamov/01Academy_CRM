import { createHmac, timingSafeEqual } from 'node:crypto';

export const normalizeEmployeePhone = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  // The CRM also stores Uzbek local numbers without the country prefix.
  const normalized = digits.length === 9 ? `998${digits}` : digits;
  return /^[1-9]\d{9,14}$/.test(normalized) ? normalized : null;
};

export const secureEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function validateTelegramInitData(raw: unknown, botToken: string, now = Date.now()): string {
  if (typeof raw !== 'string' || raw.length > 16384 || !raw) throw new Error('Invalid launch');
  const params = new URLSearchParams(raw);
  const entries = [...params.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('Duplicate launch fields');
  const hash = params.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid signature');
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const data = entries.filter(([name]) => name !== 'hash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, value]) => `${name}=${value}`).join('\n');
  const expected = createHmac('sha256', key).update(data).digest('hex');
  if (!secureEqual(hash, expected)) throw new Error('Invalid signature');
  const authDate = params.get('auth_date') ?? '';
  const age = Math.floor(now / 1000) - Number(authDate);
  if (!/^\d{1,12}$/.test(authDate) || age < -30 || age > 300) throw new Error('Expired launch');
  const user = JSON.parse(params.get('user') ?? 'null');
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot) throw new Error('Invalid user');
  return String(user.id);
}

export interface TaskToken {
  scope: 'telegram-tasks' | 'telegram-task-file';
  botId: string;
  telegramUserId: string;
  userId: number;
  verificationId: string;
  iat: number;
  exp: number;
  attachmentId?: number;
}

export function signTaskToken(payload: TaskToken, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`telegram-tasks.v1.${body}`).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyTaskToken(raw: unknown, secret: string, scope: TaskToken['scope'], now = Date.now()): TaskToken {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Invalid session');
  const [body, signature, extra] = raw.split('.');
  if (!body || !signature || extra !== undefined) throw new Error('Invalid session');
  const expected = createHmac('sha256', secret).update(`telegram-tasks.v1.${body}`).digest('base64url');
  if (!secureEqual(signature, expected)) throw new Error('Invalid session');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TaskToken;
  const seconds = Math.floor(now / 1000);
  if (payload.scope !== scope || !/^\d+$/.test(payload.botId) || !/^\d+$/.test(payload.telegramUserId)
    || !Number.isSafeInteger(payload.userId) || payload.userId <= 0 || typeof payload.verificationId !== 'string'
    || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
    || payload.iat > seconds + 30 || payload.exp <= seconds || payload.exp - payload.iat > 43200
    || (scope === 'telegram-task-file' && (!Number.isSafeInteger(payload.attachmentId) || payload.exp - payload.iat > 120))) {
    throw new Error('Invalid session');
  }
  return payload;
}
