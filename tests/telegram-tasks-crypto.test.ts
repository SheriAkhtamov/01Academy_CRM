import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeEmployeePhone, signTaskToken, validateTelegramInitData, verifyTaskToken, type TaskToken } from '../server/services/telegram-tasks-crypto';

const now = 1788436800000;
const botToken = '12345:test-only-token';
function launch(fields: Record<string, string> = {}) {
  const params = new URLSearchParams({ auth_date: String(now / 1000), user: JSON.stringify({ id: 123456, first_name: 'Test' }), ...fields });
  params.sort();
  const data = [...params.entries()].map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return params.toString();
}
const payload: TaskToken = { scope: 'telegram-tasks', botId: '12345', telegramUserId: '123456', userId: 7, verificationId: 'test-version', iat: now / 1000, exp: now / 1000 + 43200 };
describe('Telegram task cryptography', () => {
  it('validates an authentic launch including the optional Telegram signature field', () => {
    expect(validateTelegramInitData(launch({ signature: 'signed-by-telegram' }), botToken, now)).toBe('123456');
  });
  it.each([
    ['tampered', () => launch().replace('123456', '123457')],
    ['duplicate', () => `${launch()}&user=x`],
    ['expired', () => launch({ auth_date: String(now / 1000 - 301) })],
    ['future', () => launch({ auth_date: String(now / 1000 + 31) })],
    ['missing date', () => launch({ auth_date: '' })],
    ['bot user', () => launch({ user: JSON.stringify({ id: 5, is_bot: true }) })],
    ['unsafe id', () => launch({ user: JSON.stringify({ id: Number.MAX_SAFE_INTEGER + 1 }) })],
    ['negative id', () => launch({ user: JSON.stringify({ id: -2 }) })],
    ['oversized', () => 'x'.repeat(16385)],
  ])('rejects %s init data', (_label, input) => expect(() => validateTelegramInitData(input(), botToken, now)).toThrow());
  it('rejects init data signed for another bot', () => expect(() => validateTelegramInitData(launch(), 'different-token', now)).toThrow());
  it('verifies a scoped bearer token', () => expect(verifyTaskToken(signTaskToken(payload, 'secret'), 'secret', 'telegram-tasks', now)).toEqual(payload));
  it('cannot promote a file ticket to a task session', () => {
    const file: TaskToken = { ...payload, scope: 'telegram-task-file', attachmentId: 2, exp: payload.iat + 120 };
    const signed = signTaskToken(file, 'secret');
    expect(verifyTaskToken(signed, 'secret', 'telegram-task-file', now).attachmentId).toBe(2);
    expect(() => verifyTaskToken(signed, 'secret', 'telegram-tasks', now)).toThrow();
  });
  it('rejects changed bodies, keys, expiry and extra token segments', () => {
    const signed = signTaskToken(payload, 'secret');
    for (const token of [`x${signed}`, `${signed}.extra`, signTaskToken({ ...payload, exp: payload.iat }, 'secret')]) {
      expect(() => verifyTaskToken(token, 'secret', 'telegram-tasks', now)).toThrow();
    }
    expect(() => verifyTaskToken(signed, 'different', 'telegram-tasks', now)).toThrow();
  });
  it.each([
    ['+998 (90) 123-45-67', '998901234567'], ['90 123 45 67', '998901234567'],
    ['+7 999 123 45 67', '79991234567'], ['123', null], ['call 998901234567', null],
    ['+998901234567, +998901234568', null], [null, null],
  ])('normalizes %s without suffix matching', (input, expected) => expect(normalizeEmployeePhone(input)).toBe(expected));
});
